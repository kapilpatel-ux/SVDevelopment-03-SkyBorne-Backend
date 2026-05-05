// modules/PaymentModule/controllers/PaymentController.ts

import { Request, Response } from "express";
import mongoose from "mongoose";
import { NgeniusService } from "../../../services/ngenius.service";
import { StripeService } from "../services/stripe.service";
import Payment from "../models/Payment";
import User from "../../UserModule/models/User";
import { PLAN_CONFIG } from "../../../config/planConfig";
import { PlanType } from "../../UserModule/interface/userInterface";
import PlanModel from "../../PlanModule/models/Plan";
import { generateInvoicePDF } from "../../../services/invoiceService";
import { getVatRateForCountry } from "../../../utils/vat";
import { v4 as uuidv4 } from "uuid";
import {
  getPreferredGateway,
  isGatewaySupported,
} from "../../../config/paymentGatewayConfig";
import { getIO } from "../../../config/socket";
import CancelSubscriptionModel from "../../CancelSubscriptionModule/CancelSubscriptionModel";
import RecurringPaymentFailure from "../models/RecurringPaymentFailure";
import { PushNotificationService } from "../../../services/pushNotification.service";

type PreferedType = "stripe" | "ngenius";

async function enqueueWelcomeEmail(payload: any) {
  const { addWelcomeEmailJob } = await import("../../../services/queues/emailQueue");
  return addWelcomeEmailJob(payload);
}

async function enqueueInvoiceEmail(payload: any, invoicePdfBase64: string) {
  const { addInvoiceEmailJob } = await import(
    "../../../services/queues/invoiceEmailQueue"
  );
  return addInvoiceEmailJob(payload, invoicePdfBase64);
}

export default class PaymentController {
  /**
   * Initialize both payment gateways
   */
  static initPaymentSystems() {
    NgeniusService.initRecurringPaymentCron();
    StripeService.initialize();
    // StripeService.initRecurringPaymentCron();
  }

/**
   * Create payment order with automatic gateway selection
   * For Stripe: Returns checkoutUrl for direct redirect
   * For nGenius: Returns paymentLink for redirect
   * Supports both monthly and yearly billing
   */
  // static async createPaymentOrder(req: Request, res: Response) {
  //   try {
  //     let { amount, currency = "USD", userId, plan, source } = req.body;
  //     //    amount = 0.011
  //     const paymentSource = source === "app" ? "app" : "web";
  //     const userAmount = amount;

  //     // Validation
  //     if (!userId || !plan) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "userId and plan are required",
  //       });
  //     }

  //     const user = await User.findById(userId);
  //     if (!user) {
  //       return res.status(404).json({
  //         success: false,
  //         message: "User not found",
  //       });
  //     }

  //     // Determine preferred gateway based on country
  //     const countryCode = user.country || user.countryCode;
  //     const preferredGateway =
  //       paymentSource == "app" ? "stripe" : getPreferredGateway(countryCode);
  //     // const preferredGateway: PreferedType = "stripe";

  //     if (preferredGateway === "ngenius" && currency === "USD") {
  //       const rate = await getUsdToAedRate();
  //       amount = Number((amount * rate).toFixed(2));
  //       currency = "AED";
  //     }

  //     let paymentData: any;

  //     if (preferredGateway === "ngenius") {
  //       paymentData = await NgeniusService.createOrder(
  //         amount,
  //         currency,
  //         userId,
  //         plan,
  //         userAmount,
  //       );
  //     } else if (preferredGateway === "stripe") {
  //       // For Stripe: Create checkout session (redirect method)
  //       paymentData = await StripeService.createCheckoutSession(
  //         userId,
  //         amount,
  //         currency,
  //         plan,
  //         userAmount,
  //         paymentSource,
  //       );
  //       // Return paymentLink for compatibility with frontend
  //       paymentData.paymentLink = paymentData.checkoutUrl;
  //     } else {
  //       return res.status(400).json({
  //         success: false,
  //         message: "No suitable payment gateway found for your country",
  //       });
  //     }

  //     // Update user with gateway preference
  //     user.gateway = preferredGateway;
  //     user.lastPaymentGateway = preferredGateway;
  //     await user.save();

  //     return res.status(200).json({
  //       success: true,
  //       gateway: preferredGateway,
  //       ...paymentData,
  //       message: "Payment order created successfully",
  //     });
  //   } catch (err) {
  //     console.error("❌ Payment order error:", err);
  //     return res.status(500).json({
  //       success: false,
  //       message: "Failed to create payment order",
  //     });
  //   }
  // }

  static async createPaymentOrder(req: Request, res: Response) {
    try {
      let {
        amount,
        currency = "USD",
        userId,
        plan,
        source,
        billingType = "monthly",
        successUrl,
        cancelUrl,
      } = req.body;

      const normalizedSource = String(source ?? "")
        .trim()
        .toLowerCase();
      const userAgent = String(req.headers["user-agent"] ?? "").toLowerCase();
      const explicitClientSource = String(
        req.headers["x-client-source"] ?? req.headers["x-platform"] ?? ""
      )
        .trim()
        .toLowerCase();

      const isAppSource =
        normalizedSource === "app" ||
        normalizedSource === "mobile" ||
        explicitClientSource === "app" ||
        explicitClientSource === "mobile" ||
        userAgent.includes("okhttp") ||
        userAgent.includes("reactnative") ||
        userAgent.includes("react-native") ||
        userAgent.includes("dalvik");

      const paymentSource = isAppSource ? "app" : "web";
      const appSuccessUrl =
        successUrl || process.env.APP_PAYMENT_SUCCESS_URL;
      const appCancelUrl =
        cancelUrl || process.env.APP_PAYMENT_CANCEL_URL;
      let userAmount = Number(amount) || 0;

      if (paymentSource === "app" && (!appSuccessUrl || !appCancelUrl)) {
        return res.status(500).json({
          success: false,
          message:
            "Missing app payment redirect URLs. Set APP_PAYMENT_SUCCESS_URL and APP_PAYMENT_CANCEL_URL in environment.",
        });
      }

      // Validation
      if (!userId || !plan) {
        return res.status(400).json({
          success: false,
          message: "userId and plan are required",
        });
      }

      // Validate billingType
      if (!["monthly", "yearly"].includes(billingType)) {
        return res.status(400).json({
          success: false,
          message: "billingType must be 'monthly' or 'yearly'",
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      let resolvedSubscriptionId: string | null = user.stripeSubscriptionId || null;

      if (
        user.stripeSubscriptionId &&
        user.subscription?.status === "active"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Active Stripe subscription already exists. Use upgrade plan API instead of create-order.",
        });
      }

      // Determine preferred gateway based on country
      const countryCode = user.country || user.countryCode;
      const preferredGateway =
        paymentSource == "app" ? "stripe" : getPreferredGateway(countryCode);

      // Apply currency conversion for nGenius if needed
      if (preferredGateway === "ngenius" && currency === "USD") {
        const rate = await getUsdToAedRate();
        amount = Number((amount * rate).toFixed(2));
        currency = "AED";
      }

      let paymentData: any;

      if (preferredGateway === "ngenius") {
        // For nGenius, convert USD to AED if needed
        if (currency === "USD") {
          const rate = await getUsdToAedRate();
          amount = Number((amount * rate).toFixed(2));
          currency = "AED";
        }

        paymentData = await NgeniusService.createOrder(
          amount,
          currency,
          userId,
          plan,
          userAmount,
          paymentSource,
          billingType,
        );
      } else if (preferredGateway === "stripe") {
        // For Stripe: Create checkout session (redirect method)
        // Pass billingType to calculate correct pricing
        paymentData = await StripeService.createCheckoutSession(
          userId,
          amount,
          currency,
          plan,
          userAmount,
          paymentSource,
          billingType, // Pass billing type
          paymentSource === "app" ? appSuccessUrl : undefined,
          paymentSource === "app" ? appCancelUrl : undefined,
        );

        // Add paymentLink for frontend compatibility
        paymentData.paymentLink = paymentData.checkoutUrl;

        // console.log("✅ Stripe payment created:", {
        //   orderRef: paymentData.orderRef,
        //   originalAmount: `${userAmount} ${currency}`,
        //   localAmount: `${paymentData.amount} ${paymentData.currency}`,
        // });
      } else {
        return res.status(400).json({
          success: false,
          message: "No suitable payment gateway found for your country",
        });
      }

      // Update user with gateway preference and billing type
      user.gateway = preferredGateway;
      user.lastPaymentGateway = preferredGateway;
      user.billingType = billingType; // Store user's billing type preference
      await user.save();

      return res.status(200).json({
        success: true,
        gateway: preferredGateway,
        billingType,
        ...paymentData,
        message: "Payment order created successfully",
      });
    } catch (err) {
      console.error("❌ Payment order error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to create payment order",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  static async upgradePlanOrder(req: Request, res: Response) {
    try {
      let {
        userId,
        plan,
        amount,
        currency = "USD",
        billingType = "monthly",
        source,
        successUrl,
        cancelUrl,
      } = req.body;

      if (!userId || !plan || amount === undefined || amount === null) {
        return res.status(400).json({
          success: false,
          message: "userId, plan and amount are required",
        });
      }

      if (!["monthly", "yearly"].includes(billingType)) {
        return res.status(400).json({
          success: false,
          message: "billingType must be 'monthly' or 'yearly'",
        });
      }

      const normalizedSource = String(source ?? "")
        .trim()
        .toLowerCase();
      const userAgent = String(req.headers["user-agent"] ?? "").toLowerCase();
      const explicitClientSource = String(
        req.headers["x-client-source"] ?? req.headers["x-platform"] ?? ""
      )
        .trim()
        .toLowerCase();

      const isAppSource =
        normalizedSource === "app" ||
        normalizedSource === "mobile" ||
        explicitClientSource === "app" ||
        explicitClientSource === "mobile" ||
        userAgent.includes("okhttp") ||
        userAgent.includes("reactnative") ||
        userAgent.includes("react-native") ||
        userAgent.includes("dalvik");

      const paymentSource = isAppSource ? "app" : "web";
      const appSuccessUrl = successUrl || process.env.APP_PAYMENT_SUCCESS_URL;
      const appCancelUrl = cancelUrl || process.env.APP_PAYMENT_CANCEL_URL;
      const userAmount = Number(amount) || 0;

      if (paymentSource === "app" && (!appSuccessUrl || !appCancelUrl)) {
        return res.status(500).json({
          success: false,
          message:
            "Missing app payment redirect URLs. Set APP_PAYMENT_SUCCESS_URL and APP_PAYMENT_CANCEL_URL in environment.",
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const countryCode = user.country || user.countryCode;
      let preferredGateway =
        paymentSource === "app" ? "stripe" : getPreferredGateway(countryCode);

      if (user.stripeSubscriptionId) {
        preferredGateway = "stripe";
      }

      let previousSubscriptionId: string | null = null;
      let deferUntil: Date | null = null;

      if (preferredGateway === "stripe") {
        previousSubscriptionId = user.stripeSubscriptionId || null;

        try {
          const customerId = await StripeService.resolveExistingCustomerId(user);
          if (customerId) {
            const activeSubscriptions =
              await StripeService.getCustomerSubscriptions(customerId);
            if (activeSubscriptions.length > 0) {
              const matchedSubscription =
                (previousSubscriptionId
                  ? activeSubscriptions.find(
                      (subscription) => subscription.id === previousSubscriptionId,
                    )
                  : null) || activeSubscriptions[0];

              previousSubscriptionId = matchedSubscription.id;

              const periodEndUnix =
                (matchedSubscription as any).current_period_end || 0;
              if (periodEndUnix) {
                const periodEndMs = Number(periodEndUnix) * 1000;
                if (periodEndMs > Date.now() + 60 * 1000) {
                  deferUntil = new Date(periodEndMs);
                }
              }
            }
          }
        } catch (error) {
          console.warn(
            "Warning: unable to resolve Stripe subscriptions for upgrade:",
            error,
          );
        }

        // Fallback to locally-tracked subscription endDate when Stripe data
        // is unavailable (still only for Stripe upgrades).
        if (!deferUntil && user.subscription?.status === "active") {
          const localEndDate = user.subscription?.endDate;
          if (localEndDate) {
            const localEndMs = new Date(localEndDate).getTime();
            if (localEndMs > Date.now() + 60 * 1000) {
              deferUntil = new Date(localEndMs);
            }
          }
        }

        // If we are deferring the charge, make sure the current Stripe
        // subscription cancels at period end (not immediately).
        if (deferUntil && previousSubscriptionId) {
          try {
            await StripeService.setSubscriptionCancelAtPeriodEnd(
              previousSubscriptionId,
            );
          } catch (error) {
            console.warn(
              "Warning: unable to set cancel_at_period_end for upgrade:",
              error,
            );
          }
        }
      }

      let paymentData: any;

      if (preferredGateway === "ngenius") {
        if (currency === "USD") {
          const rate = await getUsdToAedRate();
          amount = Number((amount * rate).toFixed(2));
          currency = "AED";
        }

        paymentData = await NgeniusService.createOrder(
          amount,
          currency,
          userId,
          plan,
          userAmount,
          paymentSource,
          billingType,
        );
      } else if (preferredGateway === "stripe") {
        paymentData = await StripeService.createCheckoutSession(
          userId,
          amount,
          currency,
          plan,
          userAmount,
          paymentSource,
          billingType,
          paymentSource === "app" ? appSuccessUrl : undefined,
          paymentSource === "app" ? appCancelUrl : undefined,
          previousSubscriptionId || undefined,
          deferUntil || undefined,
        );

        paymentData.paymentLink = paymentData.checkoutUrl;
      } else {
        return res.status(400).json({
          success: false,
          message: "No suitable payment gateway found for your country",
        });
      }

      user.gateway = preferredGateway;
      user.lastPaymentGateway = preferredGateway;
      user.billingType = billingType;

      if (deferUntil) {
        user.pendingPlan = plan;
        user.pendingBillingType = billingType;
        user.pendingEffectiveDate = deferUntil;
      } else {
        user.pendingPlan = null;
        user.pendingBillingType = null;
        user.pendingEffectiveDate = null;
      }
      await user.save();

      return res.status(200).json({
        success: true,
        gateway: preferredGateway,
        billingType,
        deferUntil: deferUntil ? deferUntil.toISOString() : null,
        ...paymentData,
        message: "Upgrade order created successfully",
      });
    } catch (err) {
      console.error("❌ Upgrade plan error:", err);
      const anyErr = err as any;
      const message =
        anyErr?.message ||
        anyErr?.raw?.message ||
        anyErr?.error?.message ||
        "Failed to upgrade plan";
      return res.status(500).json({
        success: false,
        message,
        error: message,
      });
    }
  }

  /**
   * Enhanced verifyStripeCheckout for mobile
   */
  static async verifyStripeCheckout(req: Request, res: Response) {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: "Session ID is required",
        });
      }

      // Get session details from Stripe
      const session = await StripeService.getCheckoutSession(sessionId);

      const deferUntilRaw = (session.metadata as any)?.deferUntil;
      const deferUntilMs = deferUntilRaw
        ? Date.parse(String(deferUntilRaw))
        : NaN;
      const isDeferredUpgrade =
        Number.isFinite(deferUntilMs) && deferUntilMs > Date.now() + 60 * 1000;

      if (isDeferredUpgrade) {
        const metadata = session.metadata as any;
        const pendingPlan = String(metadata?.plan || "").trim() || null;
        const pendingBillingType =
          metadata?.billingType === "yearly" ? "yearly" : "monthly";
        const pendingEffectiveDate = deferUntilRaw
          ? new Date(String(deferUntilRaw))
          : null;

        if (metadata?.userId) {
          await User.findByIdAndUpdate(metadata.userId, {
            pendingPlan,
            pendingBillingType,
            pendingEffectiveDate,
          });
        }

        return res.status(200).json({
          success: true,
          message:
            "Upgrade scheduled. Payment will be collected after current subscription ends.",
          status: "PENDING",
          gateway: "stripe",
          deferUntil: deferUntilRaw || null,
        });
      }

      if (session.payment_status === "paid") {
        // Get or create payment record
        let payment = await Payment.findOne({
          reference: sessionId,
        });

        if (!payment) {
          // Create payment record if it doesn't exist (shouldn't happen normally)
          const metadata = session.metadata as any;
          payment = await Payment.create({
            userId: metadata?.userId,
            orderRef: metadata?.orderRef,
            reference: sessionId,
            amount: metadata?.userAmount || (session.amount_total || 0) / 100,
            localAmount: (session.amount_total || 0) / 100,
            currency: session.currency?.toUpperCase() || "USD",
            plan: metadata?.plan,
            status: "COMPLETED",
            gateway: "stripe",
            paymentIntentId: sessionId,
            gatewayResponse: session,
            verifiedAt: new Date(),
          });
        } else {
          // Update existing payment
          payment.status = "COMPLETED";
          payment.gatewayResponse = session;
          payment.verifiedAt = new Date();
          await payment.save();
        }

        return res.status(200).json({
          success: true,
          message: "✅ Payment verified!",
          status: "SUCCESS",
          orderRef: payment.orderRef,
          amount: payment.amount,
          currency: payment.currency,
          plan: payment.plan,
          gateway: "stripe",
        });
      } else if (session.payment_status === "unpaid") {
        return res.status(200).json({
          success: false,
          message: "Payment is still processing",
          status: "PENDING",
          gateway: "stripe",
        });
      } else {
        return res.status(200).json({
          success: false,
          message: "Payment was not completed",
          status: "FAILED",
          gateway: "stripe",
        });
      }
    } catch (error: any) {
      console.error("❌ Stripe checkout verification error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to verify Stripe payment",
        details: error.message,
      });
    }
  }

  /**
   * Get payment status (works with both gateways)
   */
  static async getPaymentStatus(req: Request, res: Response) {
    try {
      const { orderRef } = req.params;

      const payment = await Payment.findOne({ orderRef });

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Payment not found",
        });
      }

      return res.status(200).json({
        success: true,
        status: payment.status,
        gateway: payment.gateway,
        orderRef: payment.orderRef,
        isRecurring: payment.isRecurring,
        recurringCycle: payment.recurringCycle,
      });
    } catch (err) {
      console.error("❌ Error getting payment status:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to get payment status",
      });
    }
  }

  /**
   * Verify payment - routes to appropriate gateway handler
   * Works for both nGenius and Stripe
   */
  static async verifyPayment(req: Request, res: Response, next: any) {
    try {
      const { orderRef, paymentIntentId } = req.body;

      // console.log("this is the paymentintentId:-", paymentIntentId);
      if (paymentIntentId) {
        // ✅ Stripe
        return PaymentController.verifyStripePayment(req, res, next);
      }

      if (orderRef) {
        // ✅ nGenius
        return PaymentController.verifyNgeniusPayment(req, res, next);
      }

      return res.status(400).json({
        success: false,
        error: "orderRef or paymentIntentId is required",
      });
    } catch (error) {
      console.error("❌ Verify Payment Error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to verify payment",
      });
    }
  }
  static async me(req: Request, res: Response) {
    try {
      const userId =
        (req as any)?.user?.id || (req as any)?.user?._id?.toString?.();

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId).select("-password");

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        user,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching user profile",
      });
    }
  }

  static async getCardDetails(req: Request, res: Response) {
    try {
      const userId =
        (req as any)?.user?.id || (req as any)?.user?._id?.toString?.();
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const cardData = await StripeService.getDefaultCardDetails(user);
      return res.status(200).json({
        success: true,
        data: cardData,
      });
    } catch (error: any) {
      console.error("❌ [getCardDetails] Error:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to fetch card details",
      });
    }
  }

  static async createCardSetupIntent(req: Request, res: Response) {
    try {
      const userId =
        (req as any)?.user?.id || (req as any)?.user?._id?.toString?.();
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const setupIntent = await StripeService.createCardSetupIntent(user);
      return res.status(200).json({
        success: true,
        data: setupIntent,
      });
    } catch (error: any) {
      console.error("❌ [createCardSetupIntent] Error:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to create setup intent",
      });
    }
  }

  static async updateCardDetails(req: Request, res: Response) {
    try {
      const userId =
        (req as any)?.user?.id || (req as any)?.user?._id?.toString?.();
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const paymentMethodId = String(req.body?.paymentMethodId || "").trim();
      if (!paymentMethodId) {
        return res.status(400).json({
          success: false,
          message: "paymentMethodId is required",
        });
      }

      const billingDetails = {
        name: req.body?.billingDetails?.name || "",
        email: req.body?.billingDetails?.email || "",
        phone: req.body?.billingDetails?.phone || "",
        address: {
          line1: req.body?.billingDetails?.address?.line1 || "",
          line2: req.body?.billingDetails?.address?.line2 || "",
          city: req.body?.billingDetails?.address?.city || "",
          state: req.body?.billingDetails?.address?.state || "",
          postal_code: req.body?.billingDetails?.address?.postal_code || "",
          country: req.body?.billingDetails?.address?.country || "",
        },
      };

      const updated = await StripeService.setDefaultPaymentMethodForUser(
        user,
        paymentMethodId,
        billingDetails,
      );

      await RecurringPaymentFailure.deleteMany({
        $or: [{ userId: user._id }, { email: String(user.email || "").toLowerCase() }],
      });

      return res.status(200).json({
        success: true,
        message: "Card details updated successfully",
        data: updated,
      });
    } catch (error: any) {
      console.error("❌ [updateCardDetails] Error:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to update card details",
      });
    }
  }

  static async createCardPortalSession(req: Request, res: Response) {
    try {
      const userId =
        (req as any)?.user?.id || (req as any)?.user?._id?.toString?.();
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const requestedReturnUrl = String(req.body?.returnUrl || "").trim() || undefined;
      const clientSourceHeader = String(req.headers["x-client-source"] || "").toLowerCase();
      const isAppClient = clientSourceHeader === "app";

      const defaultAppReturnUrlBase = String(process.env.API_BASE_URL || "").trim();
      const defaultWebReturnUrl = `${process.env.FRONTEND_URL || ""}/payments`;
      const defaultAppReturnUrl = defaultAppReturnUrlBase
        ? `${defaultAppReturnUrlBase}/payment/stripe-portal-return?dest=app`
        : undefined;

      const computedReturnUrl =
        requestedReturnUrl || (isAppClient ? defaultAppReturnUrl : defaultWebReturnUrl);

      const session = await StripeService.createCardUpdatePortalSession(user, computedReturnUrl);
      return res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error: any) {
      console.error("❌ [createCardPortalSession] Error:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to create Stripe card update session",
      });
    }
  }

  static async stripePortalReturn(req: Request, res: Response) {
    const dest = String(req.query?.dest || "web").toLowerCase();
    const fallbackWebUrl = `${process.env.FRONTEND_URL || ""}/payments`;

    if (dest !== "app") {
      return res.redirect(302, fallbackWebUrl);
    }

    const deepLink = "skybornedrop://billing-portal?status=complete";
    const fallbackUrl = fallbackWebUrl;

    // Use a small HTML page that attempts to open the app via deep link,
    // with a timed fallback to the web payments page.
    res.status(200);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Returning to Skyborne…</title>
    <meta http-equiv="refresh" content="2;url=${fallbackUrl}" />
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;margin:0;padding:24px;background:#fff;color:#111}
      .box{max-width:520px;margin:0 auto}
      .muted{color:#555;font-size:14px;line-height:1.4}
    </style>
  </head>
  <body>
    <div class="box">
      <h2>Returning to Skyborne…</h2>
      <p class="muted">If the app doesn’t open automatically, you can return to the web page.</p>
      <p><a href="${fallbackUrl}">Continue on web</a></p>
    </div>
    <script>
      (function () {
        var deepLink = ${JSON.stringify(deepLink)};
        var fallbackUrl = ${JSON.stringify(fallbackUrl)};
        try { window.location.href = deepLink; } catch (e) {}
        setTimeout(function () { window.location.href = fallbackUrl; }, 1200);
      })();
    </script>
  </body>
</html>`);
  }

  /**
   * Enhanced verifyNgeniusPayment for mobile
   */
  private static async verifyNgeniusPayment(
    req: Request,
    res: Response,
    next?: any,
  ) {
    try {
      const { orderRef, reference } = req.body;

      if (!orderRef && !reference) {
        return res.status(400).json({
          success: false,
          error: "Order reference is required",
        });
      }

      let payment = await Payment.findOne({
        $or: [{ orderRef }, { reference }],
      });

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: "Payment record not found",
        });
      }

      // Already fully processed
      if (payment.subscriptionActivated) {
        const user = await User.findById(payment.userId).select(
          "onboardingCompleted",
        );
        return res.status(200).json({
          success: true,
          message: "✅ Payment already processed",
          status: payment.status,
          orderRef: payment.orderRef,
          amount: payment.amount,
          currency: payment.currency,
          plan: payment.plan,
          gateway: "ngenius",
          user,
        });
      }

      // Completed payment exists but activation did not happen yet
      if (payment.status === "COMPLETED") {
        return this.activateSubscription(payment, true, res, next);
      }

      // Fetch current status from nGenius
      const refToCheck = reference || payment.reference;
      let ngeniusStatus = "PENDING";
      let orderStatus: any = {};

      if (refToCheck) {
        try {
          orderStatus = await NgeniusService.getOrderStatus(refToCheck);

          if (
            orderStatus?._embedded?.payment &&
            orderStatus._embedded.payment.length > 0
          ) {
            const paymentData = orderStatus._embedded.payment[0];
            ngeniusStatus = paymentData.state;
          } else {
            ngeniusStatus = orderStatus?.status || "PENDING";
          }

        } catch (error) {
          console.error("❌ Error fetching order status:", error);
          ngeniusStatus = "PENDING";
        }
      }

      let paymentStatus = "PENDING";

      if (
        ngeniusStatus === "CAPTURED" ||
        ngeniusStatus === "AUTHORISED" ||
        ngeniusStatus === "SETTLED"
      ) {
        paymentStatus = "COMPLETED";
      } else if (ngeniusStatus === "DECLINED" || ngeniusStatus === "FAILED") {
        paymentStatus = "FAILED";
      } else if (ngeniusStatus === "CANCELLED") {
        paymentStatus = "CANCELLED";
      }

      // Update payment
      payment = await Payment.findOneAndUpdate(
        { _id: payment._id },
        {
          status: paymentStatus,
          ngeniusStatus,
          reference: refToCheck,
          gatewayResponse: orderStatus,
          verifiedAt: new Date(),
        },
        { new: true },
      );

      if (paymentStatus === "COMPLETED") {
        return this.activateSubscription(payment, true, res, next);
      }

      return res.status(200).json({
        success: false,
        message: `Payment ${paymentStatus}`,
        status: paymentStatus,
        orderRef: payment?.orderRef,
        amount: payment?.amount,
        currency: payment?.currency,
        plan: payment?.plan,
        gateway: "ngenius",
      });
    } catch (error: any) {
      console.error("❌ nGenius Verification Error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to verify nGenius payment",
        details: error.message,
      });
    }
  }
  /**
   * Verify Stripe payment - UPDATED TO PREVENT DUPLICATE ACTIVATION
   */
  private static async verifyStripePayment(
    req: Request,
    res: Response,
    next: any,
  ) {
    try {
      const { paymentIntentId } = req.body;

      if (!paymentIntentId) {
        return res.status(400).json({
          success: false,
          error: "Payment intent ID (sessionId) is required",
        });
      }

      let payment = await Payment.findOne({
        reference: paymentIntentId, // session ID is stored in reference
      });

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: "Payment record not found",
        });
      }

      // ✅ FIX: Check if subscription was already activated (subscription status field)
      // This prevents double activation even if payment is marked COMPLETED
      if (payment.subscriptionActivated) {
        const user = await User.findById(payment.userId).select(
          "onboardingCompleted",
        );
        if (payment.status === "COMPLETED" && !user?.onboardingCompleted) {
          return this.activateSubscription(payment, true, res, next);
        }
        return res.status(200).json({
          success: true,
          message: "✅ Payment already processed",
          gateway: payment.gateway,
          orderRef: payment.orderRef,
          status: payment.status,
          plan: payment.plan,
          user,
        });
      }

      // Retrieve the session from Stripe
      const session = await StripeService.getCheckoutSession(paymentIntentId);

      const deferUntilRaw = (session.metadata as any)?.deferUntil;
      const deferUntilMs = deferUntilRaw
        ? Date.parse(String(deferUntilRaw))
        : NaN;
      const isDeferredUpgrade =
        Number.isFinite(deferUntilMs) && deferUntilMs > Date.now() + 60 * 1000;

      let paymentStatus = "PENDING";

      if (!isDeferredUpgrade) {
        if (
          session.payment_status === "paid" ||
          session.payment_status === "no_payment_required"
        ) {
          paymentStatus = "COMPLETED";
        } else if (session.payment_status === "unpaid") {
          paymentStatus = "FAILED";
        }
      }

      const subscriptionId = session.subscription as string | null;
      const transactionId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;

      // Update payment state first; subscriptionActivated is marked only after successful activation
      payment = await Payment.findOneAndUpdate(
        { _id: payment._id },
        {
          subscriptionId: subscriptionId || payment.subscriptionId,
          transactionId: transactionId || payment.transactionId,
          paymentIntentId: transactionId || payment.paymentIntentId,
          status: paymentStatus,
          gatewayResponse: session,
          ...(isDeferredUpgrade ? {} : { verifiedAt: new Date() }),
        },
        { new: true },
      );

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: "Payment record not found",
        });
      }

      if (isDeferredUpgrade) {
        return res.status(200).json({
          success: true,
          message:
            "Upgrade scheduled. Payment will be collected after current subscription ends.",
          status: "PENDING",
          orderRef: payment.orderRef,
          amount: payment.amount,
          currency: payment.currency,
          plan: payment.plan,
          gateway: "stripe",
          deferUntil: deferUntilRaw || null,
        });
      }

      return this.activateSubscription(
        payment,
        paymentStatus === "COMPLETED",
        res,
        next,
      );
    } catch (error) {
      console.error("❌ Stripe Verification Error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to verify payment",
      });
    }
  }

  public static async handleSuccessfulPayment(payment: any) {
    return this.activateSubscription(payment, true, null as any, () => {});
  }

/**
   * Activate subscription for both gateways
   * Updates user plan, subscription, classCredits, and totalClassCredits
   * Handles both monthly and yearly billing
   * Only called once per payment flow
   */
  private static async activateSubscription(
    payment: any,
    isSuccessful: boolean,
    res: Response,
    next: any,
  ) {
    try {
      let user: any = null;
      if (isSuccessful) {
        user = await User.findById(payment?.userId);

        if (!user) {
          console.error("❌ User not found:", payment?.userId);
        } else {
          const plan = String(payment?.plan || "").trim();
          const billingType =
            payment?.billingType === "yearly" ? "yearly" : "monthly";

          if (!plan) {
            throw new Error("Plan is missing in payment record");
          }

          const baseCredits = await resolvePlanCredits(plan);
          if (!baseCredits) {
            throw new Error(`Unable to resolve credits for plan: ${plan}`);
          }

          let newCredits = { ...baseCredits };

          // ✅ If yearly billing, multiply credits by 12
          if (billingType === "yearly") {
            newCredits = {
              yoga: (newCredits?.yoga || 0) * 12,
              zumba: (newCredits?.zumba || 0) * 12,
              specialty: (newCredits?.specialty || 0) * 12,
            };
          }

          // Check if user has an existing active plan
          const hasExistingPlan =
            user.plan && user.subscription?.status === "active";
          const previousPlan = String(user.plan || "").trim();

          // Update classCredits
          if (hasExistingPlan) {
            user.classCredits = addCredits(user.classCredits, newCredits);
          } else {
            user.classCredits = {
              yoga: newCredits.yoga || 0,
              zumba: newCredits.zumba || 0,
              specialty: newCredits.specialty || 0,
            };
          }

          user.overAllclassCredits = addCredits(
            user.overAllclassCredits,
            newCredits,
          );

          // Calculate new totalClassCredits (cumulative total)
          const totalNewCredits =
            (newCredits?.yoga || 0) +
            (newCredits?.zumba || 0) +
            (newCredits?.specialty || 0);

          user.totalClassCredits =
            (user.totalClassCredits || 0) + totalNewCredits;

          // ✅ Calculate subscription end date based on billing type
          const subscriptionDuration = billingType === "yearly"
            ? 365 * 24 * 60 * 60 * 1000  // 1 year
            : 30 * 24 * 60 * 60 * 1000;  // ~1 month

          // Update subscription
          user.subscription = {
            startDate: user.subscription?.startDate || new Date(),
            endDate: new Date(Date.now() + subscriptionDuration),
            status: "active",
          };

          // ✅ CRITICAL: Store billing type and Stripe subscription ID for future reference
          user.billingType = billingType;
          if (payment?.gateway === "stripe" && payment?.subscriptionId) {
            user.stripeSubscriptionId = payment.subscriptionId;
          }

          // Update plan
          user.plan = plan;
          user.pendingPlan = null;
          user.pendingBillingType = null;
          user.pendingEffectiveDate = null;
          user.onboardingCompleted = true;

          await user.save();

          PushNotificationService.sendPaymentStatus(String(user._id), {
            success: true,
            amount: Number(payment?.amount || 0),
            currency: String(payment?.currency || ""),
            plan,
            invoiceId: String(payment?.invoiceId || ""),
          }).catch((error: any) => {
            console.error("❌ Failed to send payment-success push notification:", error?.message || error);
          });

          if (hasExistingPlan && previousPlan && previousPlan !== plan) {
            PushNotificationService.sendPlanChanged(String(user._id), previousPlan, plan).catch(
              (error: any) => {
                console.error("❌ Failed to send plan-changed push notification:", error?.message || error);
              },
            );
          }

          if (payment) {
            payment.subscriptionActivated = true;
          }

          if (payment?.source === "app") {
            await this.notifyPaymentSuccess(user._id.toString(), payment);
          }

          // Generate and queue invoice
          const invoiceId = `INV-${Date.now()}-${uuidv4()
            .slice(0, 8)
            .toUpperCase()}`;

          try {
            const subscriptionEndDate = new Date(Date.now() + subscriptionDuration);
            
            const vatRate = getVatRateForCountry(user.country, user.countryCode);

            const invoicePDF = await generateInvoicePDF({
              invoiceId,
              orderRef: payment!.orderRef,
              userId: user._id.toString(),
              userEmail: user.email,
              userName: user.firstName + " " + user.lastName,
              plan: toDisplayPlanName(plan),
              amount: payment!.amount,
              currency: "USD",
              date: new Date(),
              subscriptionEndDate: subscriptionEndDate,
              paymentMethod: `${payment.gateway.toUpperCase()} Payment Gateway`,
              taxRate: vatRate,
            });

            const invoicePDFBase64 = invoicePDF.toString("base64");

            enqueueInvoiceEmail(
              {
                invoiceId,
                orderRef: payment?.orderRef as string,
                userId: user._id.toString(),
                email: user.email,
                userName: user.firstName + " " + user.lastName,
                plan: plan,
                amount: payment!.amount,
                currency: "USD",
                date: new Date(),
                subscriptionEndDate: subscriptionEndDate,
                paymentMethod: `${payment.gateway.toUpperCase()} Payment Gateway`,
                taxRate: vatRate,
              },
              invoicePDFBase64,
            ).catch((err) =>
              console.error("❌ Invoice queue add failed:", err),
            );

            if (payment) payment.invoiceId = invoiceId;
            await payment?.save();
          } catch (invoiceErr) {
            console.error("❌ Error generating/sending invoice:", invoiceErr);
          }

          if (payment?.isModified?.()) {
            await payment.save();
          }

          enqueueWelcomeEmail({
            userId: user._id.toString(),
            email: user.email,
            firstName: user.firstName,
            plan: user.plan,
            subscriptionStartDate: user.subscription.startDate as Date,
            subscriptionEndDate: user.subscription.endDate as Date,
          }).catch((err) => console.error("❌ Queue add failed:", err));
        }
      }

      const subscriptionDuration = payment?.billingType === "yearly"
        ? 365 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;

      const responsePayload = {
        success: isSuccessful,
        gateway: payment?.gateway,
        orderRef: payment?.orderRef,
        reference: payment?.reference,
        subscriptionId: payment?.subscriptionId,
        transactionId: payment?.transactionId,
        amount: payment?.amount,
        currency: payment?.currency,
        status: payment?.status,
        plan: payment?.plan,
        billingType: payment?.billingType,
        user: user
          ? { onboardingCompleted: Boolean(user.onboardingCompleted) }
          : undefined,
        subscriptionEndDate: new Date(Date.now() + subscriptionDuration),
        message: isSuccessful
          ? `✅ Payment successful! Subscription activated. ${payment?.billingType === "yearly" ? "Annual" : "Monthly"} billing will begin.`
          : `❌ Payment ${payment?.status}`,
      };

      if (!res) {
        return responsePayload;
      }

      return res.status(isSuccessful ? 200 : 400).json(responsePayload);
    } catch (error) {
      console.error("❌ Subscription Activation Error:", error);
      if (!res) {
        throw error;
      }
      if (typeof next === "function") {
        return next(error);
      }
      return res.status(500).json({
        success: false,
        error: "Subscription activation failed",
      });
    }
  }

  /**
   * Cancel subscription (works with both gateways)
   */
  // static async cancelSubscription(req: Request, res: Response) {
  //   try {
  //     const { userId } = req.body;

  //     if (!userId) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "userId is required",
  //       });
  //     }

  //     const user = await User.findById(userId);
  //     if (!user) {
  //       return res.status(404).json({
  //         success: false,
  //         message: "User not found",
  //       });
  //     }

  //     const gateway = user.gateway || "ngenius";

  //     if (gateway === "stripe" && user.stripeSubscriptionId) {
  //       await StripeService.cancelSubscription(user.stripeSubscriptionId);
  //     } else {
  //       await NgeniusService.cancelRecurringSubscription(userId);
  //     }

  //     // Update user subscription status
  //     user.subscription = {
  //       ...user.subscription,
  //       status: "cancelled",
  //       cancelledAt: new Date(),
  //     };
  //     await user.save();

  //     return res.status(200).json({
  //       success: true,
  //       message: "Subscription cancelled successfully",
  //     });
  //   } catch (err) {
  //     console.error("❌ Error cancelling subscription:", err);
  //     return res.status(500).json({
  //       success: false,
  //       message: "Failed to cancel subscription",
  //     });
  //   }
  // }

  /**
   * Get subscription status
   */
  static async getSubscriptionStatus(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      const user = await User.findById(userId).select(
        "subscription plan gateway",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const isActive =
        user.subscription?.status === "active" &&
        user.subscription!.endDate &&
        user.subscription.endDate > new Date();

      return res.status(200).json({
        success: true,
        subscription: {
          status: user.subscription?.status,
          startDate: user.subscription?.startDate,
          endDate: user.subscription?.endDate,
          isActive,
          plan: user.plan,
          gateway: user.gateway,
          daysRemaining: isActive
            ? Math.ceil(
                ((user?.subscription?.endDate?.getTime?.() ?? 0) - Date.now()) /
                  (1000 * 60 * 60 * 24),
              )
            : 0,
        },
      });
    } catch (err) {
      console.error("❌ Error getting subscription status:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to get subscription status",
      });
    }
  }

  /**
   * Get payment history for a user
   */
  static async getPaymentHistory(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }

      const payments = await Payment.find({ 
        userId,
        status: "COMPLETED" })
        .sort({ createdAt: -1 })
        .lean();

      if (!payments || payments.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No payments found for this user",
          payments: [],
          total: 0,
        });
      }

      return res.status(200).json({
        success: true,
        payments: payments.map((payment) => ({
          _id: payment._id,
          orderRef: payment.orderRef,
          reference: payment.reference,
          amount: payment.amount,
          localAmount: payment.localAmount,
          currency: payment.currency,
          plan: payment.plan,
          status: payment.status,
          gateway: payment.gateway,
          invoiceId: payment.invoiceId,
          subscriptionId: payment.subscriptionId,
          transactionId: payment.transactionId,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          paymentMethod: payment.reference
            ? `Visa ****${String(payment.reference).slice(-4)}`
            : "N/A",
        })),
        total: payments.length,
      });
    } catch (error) {
      console.error("❌ Error fetching payment history:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch payment history",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get payment statistics for dashboard
   */
  static async getPaymentStats(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }

      const payments = await Payment.find({
        userId,
        status: "COMPLETED",
      }).lean();

      // Calculate total spent
      const totalSpent = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

      // Calculate this month's spending
      const now = new Date();
      const currentMonth = payments.filter((p) => {
        const paymentDate = new Date(p.createdAt);
        return (
          paymentDate.getMonth() === now.getMonth() &&
          paymentDate.getFullYear() === now.getFullYear()
        );
      });
      const thisMonth = currentMonth.reduce(
        (sum, p) => sum + (p.amount || 0),
        0,
      );

      // Get last payment
      const lastPayment = payments.length > 0 ? payments[0] : null;

      // Get payment counts by status
      const allPayments = await Payment.find({ userId }).lean();
      const statusCounts = {
        completed: allPayments.filter((p) => p.status === "COMPLETED").length,
        pending: allPayments.filter((p) => p.status === "PENDING").length,
        failed: allPayments.filter((p) => p.status === "FAILED").length,
        cancelled: allPayments.filter((p) => p.status === "CANCELLED").length,
      };

      return res.status(200).json({
        success: true,
        stats: {
          totalSpent: parseFloat(totalSpent.toFixed(2)),
          thisMonth: parseFloat(thisMonth.toFixed(2)),
          totalTransactions: payments.length,
          lastPaymentAmount: lastPayment ? lastPayment.amount : 0,
          lastPaymentDate: lastPayment ? lastPayment.createdAt : null,
          statusCounts,
        },
      });
    } catch (error) {
      console.error("❌ Error fetching payment stats:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch payment statistics",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get all payments (Admin only)
   */
  static async getAllPayments(req: Request, res: Response) {
    try {
      const {
        search,
        status,
        gateway,
        country,
        page = 1,
        limit = 10,
      } = req.query;

      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 10;
      const skip = (pageNum - 1) * limitNum;

      const matchQuery: any = {};

      // Filter by status
      const validStatuses = ["COMPLETED", "PENDING", "FAILED", "CANCELLED"];
      if (
        status &&
        status !== "all" &&
        validStatuses.includes(String(status).toUpperCase())
      ) {
        matchQuery.status = String(status).toUpperCase();
      } else {
        // Preserve existing default behavior
        matchQuery.status = "COMPLETED";
      }

      // Filter by gateway
      const validGateways = ["ngenius", "stripe"];
      if (
        gateway &&
        gateway !== "all" &&
        validGateways.includes(String(gateway).toLowerCase())
      ) {
        matchQuery.gateway = String(gateway).toLowerCase();
      }

      const escapeRegex = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Build aggregation pipeline
      const pipeline: any[] = [
        // Match payment filters (status, gateway)
        { $match: matchQuery },
        // Lookup user data
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        // Keep payments even when user record is missing
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      ];

      // Filter by country if provided
      if (country && country !== "all") {
        const countryCode = String(country).toUpperCase();
        pipeline.push({
          $match: {
            "user.countryCode": countryCode,
          },
        });
      }

      // Apply search at DB level BEFORE pagination
      if (search && String(search).trim()) {
        const searchRegex = escapeRegex(String(search).trim());
        pipeline.push({
          $match: {
            $or: [
              { "user.email": { $regex: searchRegex, $options: "i" } },
              { orderRef: { $regex: searchRegex, $options: "i" } },
              { reference: { $regex: searchRegex, $options: "i" } },
              {
                $expr: {
                  $regexMatch: {
                    input: {
                      $trim: {
                        input: {
                          $concat: [
                            { $ifNull: ["$user.firstName", ""] },
                            " ",
                            { $ifNull: ["$user.lastName", ""] },
                          ],
                        },
                      },
                    },
                    regex: searchRegex,
                    options: "i",
                  },
                },
              },
              {
                $expr: {
                  $regexMatch: {
                    input: { $toString: "$_id" },
                    regex: searchRegex,
                    options: "i",
                  },
                },
              },
            ],
          },
        });
      }

      // Add sorting, facet for count and pagination
      pipeline.push(
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            metadata: [{ $count: "total" }],
            data: [{ $skip: skip }, { $limit: limitNum }],
          },
        },
      );

      const result = await Payment.aggregate(pipeline as any);

      const totalCount = result[0]?.metadata[0]?.total || 0;
      const payments = result[0]?.data || [];

      // Format response
      const formattedPayments = payments.map((payment: any) => {
        const user = payment.user;
        const username = user
          ? `${user.firstName} ${user.lastName || ""}`.trim()
          : "Unknown";

        return {
          _id: payment._id,
          userId: user?._id || payment.userId || null,
          username,
          email: user?.email || "N/A",
          phoneNumber: user?.phoneNumber || "N/A",
          stripeSubscriptionId: user?.stripeSubscriptionId || "N/A",
          country: user?.country || "N/A",
          orderRef: payment.orderRef,
          reference: payment.reference,
          amount: payment.amount,
          localAmount: payment.localAmount,
          currency: payment.currency,
          plan: payment.plan,
          gateway: payment.gateway,
          status: payment.status,
          invoiceId: payment.invoiceId,
          verifiedAt: payment.verifiedAt,
          subscriptionId: payment.subscriptionId,
          transactionId: payment.transactionId,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          paymentMethod: payment.reference
            ? `Visa ****${String(payment.reference).slice(-4)}`
            : "N/A",
        };
      });

      return res.status(200).json({
        success: true,
        payments: formattedPayments,
        total: totalCount,
        filteredCount: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
        currentFilters: {
          status: status || "all",
          gateway: gateway || "all",
          country: country || "all",
          search: search || "",
        },
      });
    } catch (error) {
      console.error("❌ Error fetching all payments:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch payments",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get all recurring payment failures (Admin)
   */
  static async getAllRecurringPaymentFailures(req: Request, res: Response) {
    try {
      const { search, status, page = 1, limit = 10 } = req.query;

      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.max(1, parseInt(String(limit), 10) || 10);
      const skip = (pageNum - 1) * limitNum;

      const matchQuery: any = {};
      const andConditions: any[] = [];
      const validStatuses = ["processing", "cancelled"];

      if (status && status !== "all") {
        const normalizedStatus = String(status).trim().toLowerCase();
        if (!validStatuses.includes(normalizedStatus)) {
          return res.status(400).json({
            success: false,
            message: `Invalid status. Allowed: ${validStatuses.join(", ")}, all`,
          });
        }
        if (normalizedStatus === "processing") {
          andConditions.push({
            $or: [{ status: "processing" }, { status: { $exists: false } }],
          });
        } else {
          andConditions.push({ status: "cancelled" });
        }
      }

      if (search && String(search).trim()) {
        const escapedSearch = String(search)
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        andConditions.push({
          $or: [
            { email: { $regex: escapedSearch, $options: "i" } },
            { phoneNumber: { $regex: escapedSearch, $options: "i" } },
            { subscriptionId: { $regex: escapedSearch, $options: "i" } },
            { invoiceId: { $regex: escapedSearch, $options: "i" } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: "$_id" },
                  regex: escapedSearch,
                  options: "i",
                },
              },
            },
          ],
        });
      }

      if (andConditions.length === 1) {
        Object.assign(matchQuery, andConditions[0]);
      } else if (andConditions.length > 1) {
        matchQuery.$and = andConditions;
      }

      const [totalCount, failures] = await Promise.all([
        RecurringPaymentFailure.countDocuments(matchQuery),
        RecurringPaymentFailure.find(matchQuery)
          .sort({ failedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .populate({
            path: "userId",
            select: "firstName lastName email phoneNumber dialingCode localNumber",
          })
          .lean(),
      ]);

      const formattedFailures = failures.map((entry: any) => {
        const user = entry.userId && typeof entry.userId === "object" ? entry.userId : null;
        const fallbackPhone = String(
          user?.phoneNumber || `${user?.dialingCode || ""}${user?.localNumber || ""}`,
        )
          .trim()
          .replace(/\s+/g, "");

        return {
          _id: entry._id,
          userId: user?._id || entry.userId || null,
          fullName: user
            ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || null
            : null,
          email: entry.email || user?.email || null,
          phoneNumber: entry.phoneNumber || fallbackPhone || null,
          subscriptionId: entry.subscriptionId || null,
          invoiceId: entry.invoiceId || null,
          status: entry.status || "processing",
          failedAt: entry.failedAt,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        };
      });

      return res.status(200).json({
        success: true,
        failures: formattedFailures,
        total: totalCount,
        filteredCount: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
        currentFilters: {
          status: status || "all",
          search: search || "",
        },
      });
    } catch (error) {
      console.error("❌ Error fetching recurring payment failures:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch recurring payment failures",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Export payments as CSV (Admin only)
   */
  static async exportPaymentsCSV(req: Request, res: Response) {
    try {
      const { search, status, gateway, country } = req.query;

      const matchQuery: any = {};

      // Match the same filter behavior as getAllPayments
      const validStatuses = ["COMPLETED", "PENDING", "FAILED", "CANCELLED"];
      if (
        status &&
        status !== "all" &&
        validStatuses.includes(String(status).toUpperCase())
      ) {
        matchQuery.status = String(status).toUpperCase();
      } else {
        matchQuery.status = "COMPLETED";
      }

      const validGateways = ["ngenius", "stripe"];
      if (
        gateway &&
        gateway !== "all" &&
        validGateways.includes(String(gateway).toLowerCase())
      ) {
        matchQuery.gateway = String(gateway).toLowerCase();
      }

      const escapeRegex = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const pipeline: any[] = [
        { $match: matchQuery },
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      ];

      if (country && country !== "all") {
        const countryCode = String(country).toUpperCase();
        pipeline.push({
          $match: {
            "user.countryCode": countryCode,
          },
        });
      }

      if (search && String(search).trim()) {
        const searchRegex = escapeRegex(String(search).trim());
        pipeline.push({
          $match: {
            $or: [
              { "user.email": { $regex: searchRegex, $options: "i" } },
              { orderRef: { $regex: searchRegex, $options: "i" } },
              { reference: { $regex: searchRegex, $options: "i" } },
              {
                $expr: {
                  $regexMatch: {
                    input: {
                      $trim: {
                        input: {
                          $concat: [
                            { $ifNull: ["$user.firstName", ""] },
                            " ",
                            { $ifNull: ["$user.lastName", ""] },
                          ],
                        },
                      },
                    },
                    regex: searchRegex,
                    options: "i",
                  },
                },
              },
              {
                $expr: {
                  $regexMatch: {
                    input: { $toString: "$_id" },
                    regex: searchRegex,
                    options: "i",
                  },
                },
              },
            ],
          },
        });
      }

      pipeline.push({ $sort: { createdAt: -1 } });

      const filteredPayments = await Payment.aggregate(pipeline as any);

      // Generate CSV
      const headers = [
        "Subscription Id",
        "Transaction Id",
        "Order Reference",
        "Username",
        "Email",
        "Phone Number",
        "Verified At",
        "Date",
        "Plan",
        "Amount",
        "Currency",
        "Status",
        "Country",
      ];

      const rows = filteredPayments.map((payment: any) => {
        const user = payment.user;
        const username = user
          ? `${user.firstName} ${user.lastName || ""}`.trim()
          : "Unknown";

        const formatDate = (dateString: string) => {
          return new Date(dateString).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        };

        const formatPlanName = (planName: string) => {
          if (!planName) return "N/A";
          return planName
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        };

        const formatStatusLabel = (status: string) => {
          return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        };

        return [
          payment.subscriptionId || user?.stripeSubscriptionId || "N/A",
          payment.transactionId || "N/A",
          payment.orderRef || "N/A",
          username,
          user?.email || "N/A",
          user?.phoneNumber || "N/A",
          payment.verifiedAt ? formatDate(payment.verifiedAt) : "N/A",
          formatDate(payment.createdAt),
          formatPlanName(payment.plan),
          payment.amount?.toString() || "0",
          payment.currency || "USD",
          formatStatusLabel(payment.status),
          user?.country || "N/A",
        ];
      });

      // Escape CSV values
      const escapeCSV = (value: string): string => {
        const escaped = String(value).replace(/"/g, '""');
        return escaped.includes(",") ||
          escaped.includes('"') ||
          escaped.includes("\n")
          ? `"${escaped}"`
          : escaped;
      };

      const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map(escapeCSV).join(",")),
      ].join("\n");

      // Set headers for file download
      const filename = `payments_${new Date().toISOString().split("T")[0]}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );

      return res.status(200).send(csvContent);
    } catch (error) {
      console.error("❌ Error exporting payments CSV:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to export payments CSV",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get admin dashboard statistics
   */
  static async getAdminPaymentStats(req: Request, res: Response) {
    try {
      const payments = await Payment.find().lean();

      if (!payments || payments.length === 0) {
        return res.status(200).json({
          success: true,
          stats: {
            totalRevenue: 0,
            thisMonth: 0,
            lastPaymentAmount: 0,
            totalCount: 0,
            completedCount: 0,
            failedCount: 0,
            pendingCount: 0,
            successRate: 0,
            averageTransactionValue: 0,
            activeSubscriptions: 0,
            byGateway: {
              ngenius: { count: 0, revenue: 0 },
              stripe: { count: 0, revenue: 0 },
            },
          },
        });
      }

      const completedPayments = payments.filter(
        (p) => p.status === "COMPLETED",
      );
      const failedPayments = payments.filter((p) => p.status === "FAILED");
      const pendingPayments = payments.filter((p) => p.status === "PENDING");

      const totalRevenue = completedPayments.reduce(
        (sum, p) => sum + p.amount,
        0,
      );

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      const thisMonth = completedPayments
        .filter((p) => {
          const paymentDate = new Date(p.createdAt);
          return (
            paymentDate.getMonth() === currentMonth &&
            paymentDate.getFullYear() === currentYear
          );
        })
        .reduce((sum, p) => sum + p.amount, 0);

      const lastPaymentAmount =
        completedPayments.length > 0
          ? completedPayments[completedPayments.length - 1].amount
          : 0;

      const successRate =
        payments.length > 0
          ? parseFloat(
              ((completedPayments.length / payments.length) * 100).toFixed(2),
            )
          : 0;

      const averageTransactionValue =
        completedPayments.length > 0
          ? parseFloat((totalRevenue / completedPayments.length).toFixed(2))
          : 0;

      // Match active subscriptions the same way as admin overview stats
      const activeUsers = await User.countDocuments({
        role: "user",
        isActive: true,
        onboardingCompleted: true,
        "subscription.status": "active",
      });

      // Revenue by gateway
      const ngeniusPayments = completedPayments.filter(
        (p) => p.gateway === "ngenius",
      );
      const stripePayments = completedPayments.filter(
        (p) => p.gateway === "stripe",
      );

      const ngeniusRevenue = ngeniusPayments.reduce(
        (sum, p) => sum + p.amount,
        0,
      );
      const stripeRevenue = stripePayments.reduce(
        (sum, p) => sum + p.amount,
        0,
      );

      return res.status(200).json({
        success: true,
        stats: {
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          thisMonth: parseFloat(thisMonth.toFixed(2)),
          lastPaymentAmount,
          totalCount: completedPayments.length,
          completedCount: completedPayments.length,
          failedCount: failedPayments.length,
          pendingCount: pendingPayments.length,
          successRate,
          averageTransactionValue,
          activeSubscriptions: activeUsers,
          byGateway: {
            ngenius: {
              count: ngeniusPayments.length,
              revenue: parseFloat(ngeniusRevenue.toFixed(2)),
            },
            stripe: {
              count: stripePayments.length,
              revenue: parseFloat(stripeRevenue.toFixed(2)),
            },
          },
        },
      });
    } catch (error) {
      console.error("❌ Error fetching admin stats:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch payment statistics",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // ✅ CORRECTED IMPLEMENTATION

  /**
   * Cancel subscription for a user
   * Works with both Stripe and nGenius gateways
   */
  static async cancelSubscription(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { adminDescription } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      let resolvedSubscriptionId: string | null = user.stripeSubscriptionId || null;

      // Check if user has an active subscription
      if (!user.subscription || user.subscription.status !== "active") {
        const cancelSubscriptionId = resolvedSubscriptionId || "N/A";
        const fallbackPhone =
          String((user as any)?.dialingCode || "") +
          String((user as any)?.localNumber || "");
        const phoneNumber = (user as any)?.phoneNumber || fallbackPhone.trim() || "";

        await CancelSubscriptionModel.findOneAndUpdate(
          { userId: String(user._id) },
          {
            $set: {
              subscriptionId: cancelSubscriptionId,
              status: "cancelled",
              cancelledAt: new Date(),
              ...(adminDescription !== undefined
                ? { adminDescription: String(adminDescription).trim() }
                : {}),
            },
            $setOnInsert: {
              firstName: user.firstName || "",
              lastName: user.lastName || "",
              email: user.email || "",
              phoneNumber,
              country: user.country || "",
              subscribedAt: user.subscription?.startDate || undefined,
              userId: String(user._id),
              plan: user.plan || "",
              description: "",
            },
          },
          { new: true, sort: { createdAt: -1 }, upsert: true }
        );

        return res.status(200).json({
          success: true,
          message: "Subscription cancelled successfully",
          subscription: {
            status: user.subscription?.status || "inactive",
            cancelledAt: user.subscription?.cancelledAt || null,
            plan: user.plan,
          },
        });
      }

      const gateway = user.gateway || user.lastPaymentGateway;

      // Cancel based on gateway
      if (gateway === "stripe") {
        // ✅ Use stripeSubscriptionId from user
        if (!user.stripeSubscriptionId) {
          // Fallback: Get from payment record
          const payment = await Payment.findOne({
            userId: user._id,
            gateway: "stripe",
            status: "COMPLETED",
          }).sort({ createdAt: -1 });

          if (!payment?.subscriptionId) {
            // No Stripe subscription found; proceed with local cancellation
            resolvedSubscriptionId = resolvedSubscriptionId || "N/A";
          } else {
            resolvedSubscriptionId = payment.subscriptionId;
            try {
              await StripeService.cancelSubscription(payment.subscriptionId);
            } catch (stripeErr: any) {
              const msg = String(stripeErr?.message || "");
              if (!msg.includes("No such subscription")) {
                throw stripeErr;
              }
            }
          }
        } else {
          try {
            await StripeService.cancelSubscription(user.stripeSubscriptionId);
          } catch (stripeErr: any) {
            const msg = String(stripeErr?.message || "");
            if (!msg.includes("No such subscription")) {
              throw stripeErr;
            }
          }
        }
      } else if (gateway === "ngenius") {
        // For nGenius, mark payments as cancelled
        await Payment.updateMany(
          {
            userId: user._id,
            gateway: "ngenius",
            status: { $in: ["PENDING", "COMPLETED"] },
          },
          {
            status: "CANCELLED",
            cancelledAt: new Date(),
          },
        );
      } else {
        return res.status(400).json({
          success: false,
          message: "Unable to determine payment gateway for cancellation",
        });
      }

      // ✅ Update user subscription status (single operation)
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          "subscription.status": "cancelled",
          "subscription.cancelledAt": new Date(),
          // Optional: Clear the subscription ID on cancel
          stripeSubscriptionId: null,
        },
        { new: true },
      );

      const cancelSubscriptionId = resolvedSubscriptionId || "N/A";
      const fallbackPhone =
        String((user as any)?.dialingCode || "") +
        String((user as any)?.localNumber || "");
      const phoneNumber = (user as any)?.phoneNumber || fallbackPhone.trim() || "";

      const updateCancelRequest = await CancelSubscriptionModel.findOneAndUpdate(
        { userId: String(user._id) },
        {
          $set: {
            subscriptionId: cancelSubscriptionId,
            status: "cancelled",
            cancelledAt: new Date(),
            ...(adminDescription !== undefined
              ? { adminDescription: String(adminDescription).trim() }
              : {}),
          },
          $setOnInsert: {
            firstName: user.firstName || "",
            lastName: user.lastName || "",
            email: user.email || "",
            phoneNumber,
            country: user.country || "",
            subscribedAt: user.subscription?.startDate || undefined,
            userId: String(user._id),
            plan: user.plan || "",
            description: "",
          },
        },
        { new: true, sort: { createdAt: -1 }, upsert: true }
      );

      return res.status(200).json({
        success: true,
        message: "Subscription cancelled successfully",
        subscription: {
          status: updatedUser?.subscription?.status,
          cancelledAt: updatedUser?.subscription?.cancelledAt,
          plan: updatedUser?.plan,
        },
      });
    } catch (error) {
      console.error("❌ Cancel subscription error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to cancel subscription",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Update cancel subscription request status from admin panel
   */
  static async updateCancelSubscriptionStatus(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { status, adminDescription } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const allowedStatuses = ["pending", "retained", "cancelled"] as const;
      if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "status must be one of pending, retained, cancelled",
        });
      }

      const updateData: any = {
        status,
      };

      if (adminDescription !== undefined) {
        updateData.adminDescription = String(adminDescription).trim();
      }

      if (status === "cancelled") {
        updateData.cancelledAt = new Date();
      }

      const updatedCancelRequest = await CancelSubscriptionModel.findOneAndUpdate(
        { userId },
        updateData,
        { new: true, sort: { createdAt: -1 } },
      );

      if (!updatedCancelRequest) {
        return res.status(404).json({
          success: false,
          message: "Cancel subscription request not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Cancel subscription status updated successfully",
        data: updatedCancelRequest,
      });
    } catch (error) {
      console.error("❌ Update cancel subscription status error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update cancel subscription status",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Cancel Stripe subscription
   */
  private static async cancelStripeSubscription(user: any) {
    try {
      if (!user.stripeSubscriptionId) {
        throw new Error(`No Stripe subscription ID found for user ${user._id}`);
      }

      // Cancel the subscription at Stripe
      const cancelledSubscription = await StripeService.cancelSubscription(
        user.stripeSubscriptionId,
      );

      // Mark related payments as cancelled
      await Payment.updateMany(
        {
          userId: user._id,
          gateway: "stripe",
          status: { $in: ["PENDING", "COMPLETED"] },
        },
        {
          status: "CANCELLED",
          cancelledAt: new Date(),
        },
      );

    } catch (error) {
      console.error("❌ Error cancelling Stripe subscription:", error);
      throw error;
    }
  }

  /**
   * Cancel nGenius subscription
   */
  private static async cancelNgeniusSubscription(user: any) {
    try {
      // For nGenius, stop processing recurring charges
      const result = await Payment.updateMany(
        {
          userId: user._id,
          gateway: "ngenius",
          status: { $in: ["PENDING", "COMPLETED"] },
        },
        {
          status: "CANCELLED",
          cancelledAt: new Date(),
          isRecurring: false, // Stop recurring charges
        },
      );

    } catch (error) {
      console.error("❌ Error cancelling nGenius subscription:", error);
      throw error;
    }
  }
  /**
   * Verify mobile payment - Called by React Native app after user closes payment browser
   * Supports both Stripe and nGenius
   */
  static async verifyMobilePayment(req: Request, res: Response) {
    try {
      const { sessionId, orderRef, reference } = req.body;

      // console.log("📱 Mobile payment verification:", {
      //   sessionId,
      //   orderRef,
      //   reference,
      // });

      // Determine which gateway and call appropriate verification
      if (sessionId) {
        // ✅ Stripe verification
        return this.verifyStripeCheckout(req, res);
      } else if (orderRef || reference) {
        // ✅ nGenius verification
        return this.verifyNgeniusPayment(req, res, (err: any) => {
          console.error("nGenius verification error:", err);
          return res.status(500).json({
            success: false,
            error: "nGenius verification failed",
          });
        });
      }

      return res.status(400).json({
        success: false,
        error: "sessionId, orderRef, or reference is required",
      });
    } catch (error) {
      console.error("❌ Mobile verification error:", error);
      return res.status(500).json({
        success: false,
        error: "Payment verification failed",
      });
    }
  }

  private static async notifyPaymentSuccess(userId: string, payment: any) {
    try {
      const io = getIO();
      if (!io) {
        console.warn("⚠️ Socket.io not initialized");
        return;
      }

      io.to(`user-${userId}`).emit("payment-success", {
        success: true,
        userId,
        message: "Payment successful! Your subscription is now active.",
        plan: payment?.plan,
        amount: payment?.amount,
        currency: payment?.currency,
        subscriptionStartDate: new Date(),
        subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

    } catch (error) {
      console.error("❌ Error sending socket notification:", error);
    }
  }
}

// ==================== HELPER FUNCTIONS ====================

async function getUsdToAedRate() {
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?amount=1&from=USD&to=AED",
    );
    const data = await res.json();
    return data.rates?.AED || 3.6725;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return 3.6725;
  }
}

const LEGACY_PLAN_CONFIG: Record<PlanType, { yoga: number; zumba: number; specialty: number }> =
  PLAN_CONFIG;

type Credits = { yoga: number; zumba: number; specialty: number };

async function resolvePlanCredits(planKey: string): Promise<Credits | null> {
  const normalizedPlanKey = planKey.trim().toLowerCase();
  const legacyCredits = LEGACY_PLAN_CONFIG[normalizedPlanKey as PlanType];
  if (legacyCredits) {
    return { ...legacyCredits };
  }

  const query: any = {
    $or: [
      { uuid: planKey },
      { name: { $regex: `^${escapeRegExp(planKey)}$`, $options: "i" } },
    ],
  };

  if (mongoose.Types.ObjectId.isValid(planKey)) {
    query.$or.push({ _id: planKey });
  }

  const planDoc = await PlanModel.findOne(query).lean();
  if (planDoc) {
    return distributeCreditsFromPlan({
      classCountPerMonth: Number(planDoc.classCountPerMonth || 0),
      services: Array.isArray(planDoc.services) ? planDoc.services : [],
      serviceClassCounts: Array.isArray((planDoc as any).serviceClassCounts)
        ? (planDoc as any).serviceClassCounts
        : [],
    });
  }

  const candidatePlans = await PlanModel.find(
    {},
    { services: 1, classCountPerMonth: 1, serviceClassCounts: 1, name: 1 },
  ).lean();
  const matchedBySlug = candidatePlans.find(
    (candidate) => slugifyPlanName(candidate.name || "") === normalizedPlanKey,
  );

  if (!matchedBySlug) {
    return null;
  }

  return distributeCreditsFromPlan({
    classCountPerMonth: Number(matchedBySlug.classCountPerMonth || 0),
    services: Array.isArray(matchedBySlug.services) ? matchedBySlug.services : [],
    serviceClassCounts: Array.isArray((matchedBySlug as any).serviceClassCounts)
      ? (matchedBySlug as any).serviceClassCounts
      : [],
  });
}

function distributeCreditsFromPlan(plan: {
  classCountPerMonth: number;
  services: string[];
  serviceClassCounts?: Array<{ service?: string; classCountPerMonth?: number }>;
}): Credits {
  if (Array.isArray(plan.serviceClassCounts) && plan.serviceClassCounts.length > 0) {
    const creditsFromServices: Credits = { yoga: 0, zumba: 0, specialty: 0 };

    for (const serviceEntry of plan.serviceClassCounts) {
      const bucket = getPlanBuckets([String(serviceEntry?.service || "")])[0] || "specialty";
      const classCount = Math.max(
        0,
        Math.floor(Number(serviceEntry?.classCountPerMonth || 0)),
      );
      creditsFromServices[bucket] += classCount;
    }

    return creditsFromServices;
  }

  const totalClasses = Math.max(0, Math.floor(plan.classCountPerMonth || 0));
  const buckets = getPlanBuckets(plan.services);

  if (totalClasses === 0 || buckets.length === 0) {
    return { yoga: 0, zumba: 0, specialty: totalClasses };
  }

  const credits: Credits = { yoga: 0, zumba: 0, specialty: 0 };
  const base = Math.floor(totalClasses / buckets.length);
  let remainder = totalClasses % buckets.length;

  buckets.forEach((bucket, index) => {
    credits[bucket] += base + (index < remainder ? 1 : 0);
  });

  return credits;
}

function getPlanBuckets(services: string[]): Array<keyof Credits> {
  const buckets: Array<keyof Credits> = [];

  for (const rawService of services) {
    const normalized = String(rawService || "").trim().toLowerCase();
    let bucket: keyof Credits = "specialty";

    if (normalized.includes("yoga")) {
      bucket = "yoga";
    } else if (normalized.includes("zumba")) {
      bucket = "zumba";
    }

    if (!buckets.includes(bucket)) {
      buckets.push(bucket);
    }
  }

  return buckets;
}

function slugifyPlanName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toDisplayPlanName(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Helper function to add credits (for upgrades)
function addCredits(current: any, additional: any) {
  return {
    yoga: (current?.yoga || 0) + (additional?.yoga || 0),
    zumba: (current?.zumba || 0) + (additional?.zumba || 0),
    specialty: (current?.specialty || 0) + (additional?.specialty || 0),
  };
}
