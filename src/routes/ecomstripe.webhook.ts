import express from "express";
import Stripe from "stripe";
import { EcomStripeService } from "../services/EcomStripe.service"; 
import EcomPayment from "../modules/EcomPaymentModule/Ecompayment.model";

const router = express.Router();
type StripeCheckoutSession = Awaited<
  ReturnType<Stripe["checkout"]["sessions"]["retrieve"]>
>;

/**
 * POST /webhooks/ecom-stripe
 * Handles Stripe events for ECOM product purchases ONLY.
 * Completely separate from subscription webhook at /webhooks/stripe
 */


router.post(
  "/",
  async (req, res) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      console.error("❌ [EcomWebhook] STRIPE_SECRET_KEY is missing");
      return res.status(500).json({
        success: false,
        message: "Stripe secret key not configured",
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-12-15.clover" as any,
    });

    // Read at request-time so dotenv/env is guaranteed to be available
    const webhookSecret = process.env.STRIPE_ECOM_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("❌ [EcomWebhook] STRIPE_ECOM_WEBHOOK_SECRET is missing");
      return res.status(500).json({
        success: false,
        message: "Webhook secret not configured",
      });
    }

    const sig = req.headers["stripe-signature"] as string;
    if (!sig) {
      return res.status(400).send("Webhook Error: Missing stripe-signature header");
    }

    let event: Stripe.Event;



    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

      console.log("aaaa", event);
      
    } catch (err: any) {
      console.error("❌ [EcomWebhook] Signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {

        /**
         * ✅ MAIN EVENT — One-time payment completed
         * This only fires for mode: "payment" sessions (ecom),
         * not mode: "subscription" sessions (handled by other webhook)
         */
        case "checkout.session.completed": {
          const session = event.data.object as StripeCheckoutSession;

          // ── Guard: only process ecom sessions ────────────────────────────
          if (session.metadata?.type !== "ecom") {
            console.log("ℹ️ [EcomWebhook] Skipping non-ecom session");
            break;
          }

          // ── Guard: only paid sessions ─────────────────────────────────────
          if (session.payment_status !== "paid") {
            console.log("ℹ️ [EcomWebhook] Session not paid yet, skipping");
            break;
          }

          // ── Idempotency: skip if already processed ────────────────────────
          const existing = await EcomPayment.findOne({
            orderRef: session.metadata?.orderRef,
          });
          if (existing && existing.status === "succeeded") {
            console.log("ℹ️ [EcomWebhook] Already processed:", session.metadata?.orderRef);
            break;
          }

          console.log("🔵 [EcomWebhook] Fulfilling order:", session.metadata?.orderRef);
          await EcomStripeService.fulfillEcomOrder(session.id);

          break;
        }

        /**
         * ⚠️ Payment failed (e.g. card declined on checkout)
         */
        case "payment_intent.payment_failed": {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;

          // Only update ecom payments
          await EcomPayment.findOneAndUpdate(
            { stripePaymentIntentId: paymentIntent.id },
            { status: "failed" }
          );

          console.log("⚠️ [EcomWebhook] Payment failed:", paymentIntent.id);
          break;
        }

        default:
          console.log("ℹ️ [EcomWebhook] Unhandled event:", event.type);
      }

      return res.status(200).json({ received: true });
    } catch (err: any) {
      console.error("❌ [EcomWebhook] Processing error:", err.message);
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

export default router;
