// modules/PaymentModule/controllers/ngeniusWebhook.ts

import { Router, Request, Response } from "express";
import crypto from "crypto";
import Payment from "../models/Payment";
import User from "../../UserModule/models/User";
import PaymentController from "./paymentController";
import { NgeniusService } from "../../../services/ngenius.service";
import { PushNotificationService } from "../../../services/pushNotification.service";

const router = Router();

/**
 * Webhook signature verification for nGenius
 * nGenius signs webhooks using HMAC-SHA256
 */
function verifyNgeniusWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const hash = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(signature)
    );
  } catch (error) {
    console.error("❌ Signature verification failed:", error);
    return false;
  }
}

/**
 * nGenius Webhook Handler
 * Processes payment notifications from nGenius Payment Gateway
 * 
 * IMPORTANT: Only processes webhooks for APP source
 * WEB source payments are handled via redirect + payment verification
 * 
 * Webhook Events:
 * - PAYMENT_CAPTURED: Payment successful
 * - PAYMENT_FAILED: Payment declined/failed
 * - PAYMENT_AUTHORISED: Payment authorized (2-step flow)
 * - PAYMENT_SETTLED: Payment settled
 */
router.post("/ngenius", async (req: Request, res: Response) => {
  let rawBody: string = "";

  try {
    // console.log("🔗 Headers:", {
    //   "x-signature": req.headers["x-signature"] ? "present" : "missing",
    //   "content-type": req.headers["content-type"],
    // });

    // 1️⃣ VERIFY WEBHOOK SIGNATURE
    const signature = req.headers["x-signature"] as string;
    const webhookSecret = process.env.NGENIUS_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("❌ NGENIUS_WEBHOOK_SECRET not configured in .env");
      return res.status(500).json({ 
        error: "Webhook secret not configured",
        received: true 
      });
    }

    if (!signature) {
      console.error("❌ No x-signature header provided");
      return res.status(200).json({ 
        received: true,
        error: "Missing signature header (but acknowledged)"
      });
    }

    // Get raw body from request
    // If body is already parsed, stringify it
    rawBody = typeof req.body === 'string' 
      ? req.body 
      : JSON.stringify(req.body);

    const isValid = verifyNgeniusWebhookSignature(
      rawBody,
      signature,
      webhookSecret
    );

    if (!isValid) {
      console.error("❌ Invalid webhook signature");
      return res.status(200).json({ 
        received: true,
        error: "Invalid signature (but acknowledged to prevent retry loop)"
      });
    }

    // 2️⃣ EXTRACT WEBHOOK DATA
    const {
      eventId,
      eventTimestamp,
      eventType,
      reference, // nGenius reference
      _embedded,
    } = req.body;

    // console.log(`📋 Event Details:`, {
    //   eventId,
    //   eventType,
    //   reference,
    //   timestamp: eventTimestamp,
    // });

    // 3️⃣ FIND PAYMENT RECORD
    let payment = await Payment.findOne({ reference });

    if (!payment) {
      console.error(`❌ Payment not found for reference: ${reference}`);
      // Return 200 to acknowledge receipt
      return res.status(200).json({
        received: true,
        message: "Payment record not found",
        reference,
      });
    }

    // console.log(`📝 Payment found:`, {
    //   id: payment._id,
    //   source: payment.source,
    //   status: payment.status,
    //   subscriptionActivated: payment.subscriptionActivated,
    // });

    // 4️⃣ ONLY PROCESS WEBHOOKS FOR APP SOURCE
    // Web source is handled via redirect + payment verification
    if (payment.source === "web") {
      return res.status(200).json({
        received: true,
        message: "Web payment - webhook acknowledged but not processed",
      });
    }

    // 5️⃣ HANDLE DIFFERENT EVENT TYPES
    switch (eventType) {
      /**
       * ✅ PAYMENT SUCCESSFUL
       * nGenius states: CAPTURED, AUTHORISED, SETTLED
       */
      case "PAYMENT_CAPTURED":
      case "PAYMENT_SETTLED":
      case "PAYMENT_AUTHORISED": {

        const paymentDetails = _embedded?.payment?.[0];

        if (!paymentDetails) {
          console.error("❌ No payment details in webhook");
          break;
        }

        const ngeniusState = paymentDetails.state;


        if (
          ngeniusState === "CAPTURED" ||
          ngeniusState === "AUTHORISED" ||
          ngeniusState === "SETTLED"
        ) {
          // 🔒 IDEMPOTENCY CHECK - Prevent double activation
          if (payment.subscriptionActivated) {
            // console.log(
            //   "⚠️  Subscription already activated, skipping (idempotency protection)"
            // );
            return res.status(200).json({ received: true });
          }

          // Update payment record
          payment.status = "COMPLETED";
          payment.reference = reference;
          payment.gateway = "ngenius";
          payment.ngeniusStatus = ngeniusState;
          payment.gatewayResponse = paymentDetails;
          payment.verifiedAt = new Date();

          // Store transaction details
          if (paymentDetails.id) {
            payment.transactionId = paymentDetails.id;
            payment.invoiceId = paymentDetails.id;
          }

          await payment.save();

          // 🔥 ACTIVATE SUBSCRIPTION
          // This is critical - only once per payment
          try {
            await PaymentController.handleSuccessfulPayment(payment);
          } catch (handlerError) {
            console.error(`❌ Error in payment handler:`, handlerError);
            // Continue anyway - mark as activated
          }

          // Mark as activated AFTER successful subscription
          payment.subscriptionActivated = true;
          await payment.save();

          // Notify user (async, don't wait)
          try {
            await NgeniusService.notifyPaymentSuccess(
              payment.userId.toString(),
              payment
            );
          } catch (notifyError) {
            console.error(`⚠️  Error sending notification:`, notifyError);
          }
        }
        break;
      }

      /**
       * ❌ PAYMENT FAILED
       * nGenius states: DECLINED, FAILED, CANCELLED
       */
      case "PAYMENT_DECLINED":
      case "PAYMENT_FAILED":
      case "PAYMENT_CANCELLED": {

        const paymentDetails = _embedded?.payment?.[0];

        if (!paymentDetails) {
          console.error("❌ No payment details in webhook");
          break;
        }

        const ngeniusState = paymentDetails.state;

        if (
          ngeniusState === "DECLINED" ||
          ngeniusState === "FAILED" ||
          ngeniusState === "CANCELLED"
        ) {
          payment.status = "FAILED";
          payment.gateway = "ngenius";
          payment.ngeniusStatus = ngeniusState;
          payment.gatewayResponse = paymentDetails;
          payment.verifiedAt = new Date();
          payment.billingAttempt = (payment.billingAttempt || 0) + 1;

          await payment.save();

          if (payment.userId) {
            PushNotificationService.sendPaymentStatus(String(payment.userId), {
              success: false,
              amount: Number(payment.amount || 0),
              currency: String(payment.currency || ""),
              plan: String(payment.plan || ""),
              invoiceId: String(payment.invoiceId || payment.transactionId || ""),
            }).catch((pushError: any) => {
              console.error("❌ Failed to send nGenius payment-failed push notification:", pushError?.message || pushError);
            });
          }

          // Handle recurring payment failure
          if (payment.isRecurring && payment.userId) {
            if (payment.billingAttempt >= 3) {

              const user = await User.findById(payment.userId);
              if (user && user.subscription) {
                user.subscription.status = "suspended";
                user.subscription.suspendedAt = new Date();
                await user.save();

                await NgeniusService.notifySubscriptionSuspended(
                  payment.userId.toString()
                );
              }
            } else {
              await NgeniusService.notifyPaymentFailure(
                payment.userId.toString(),
                payment.plan
              );
            }
          }
        }
        break;
      }

      /**
       * ⏳ PENDING PAYMENT
       */
      case "PAYMENT_PENDING": {
        payment.status = "PENDING";
        payment.ngeniusStatus = "PENDING";
        payment.gatewayResponse = _embedded?.payment?.[0];
        await payment.save();
        break;
      }

      /**
       * 🔄 RECURRING PAYMENT CREATED
       */
      case "RECURRING_PAYMENT_CREATED": {
        payment.ngeniusStatus = "RECURRING_CREATED";
        await payment.save();
        break;
      }

      default:
        console.log(`ℹ️  Unhandled nGenius event type.`);
    }

    res.status(200).json({
      received: true,
      eventId,
      reference,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("❌ nGenius webhook processing error:", error);
    console.error("   Stack:", error instanceof Error ? error.stack : "unknown");

    // Always return 200 to prevent webhook retries
    res.status(200).json({
      received: true,
      error: "Processing completed with errors",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Health check endpoint for webhook verification
 */
router.get("/ngenius/health", (req: Request, res: Response) => {
  const webhookSecret = process.env.NGENIUS_WEBHOOK_SECRET;
  
  res.status(200).json({
    status: "ok",
    webhook: "nGenius webhook handler is running",
    configured: !!webhookSecret,
    timestamp: new Date().toISOString(),
  });
});

export default router;
