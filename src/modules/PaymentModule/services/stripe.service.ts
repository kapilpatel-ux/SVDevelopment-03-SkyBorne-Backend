// services/stripe.service.ts

import Stripe from "stripe";
import Payment from "../models/Payment";
import User from "../../UserModule/models/User";
import cron from "node-cron";
import dotenv from "dotenv";
import {
  getCurrencyForCountry,
  formatAmountForStripe,
} from "../../../config/currencyConfig";
import { convertUsingDB } from "../../../services/dbCurrencyService";

dotenv.config();

interface RecurringPaymentConfig {
  billingCycleDay?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class StripeService {
  private static stripe: Stripe;
  private static readonly DEFAULT_RECURRING_CONFIG: RecurringPaymentConfig = {
    billingCycleDay: 1,
    maxRetries: 3,
    retryDelayMs: 5000,
  };

  /**
   * Initialize Stripe with API key
   */
  static initialize() {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not defined");
    }
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }

  private static getStripeClient(): Stripe {
    if (!this.stripe) {
      this.initialize();
    }
    return this.stripe;
  }

  /**
   * Get billing interval based on billing type
   */
  private static getBillingInterval(billingType: "monthly" | "yearly" = "monthly"): "month" | "year" {
    return billingType === "yearly" ? "year" : "month";
  }

  /**
   * Get subscription duration in milliseconds
   */
  private static getSubscriptionDuration(billingType: "monthly" | "yearly" = "monthly"): number {
    return billingType === "yearly" 
      ? 365 * 24 * 60 * 60 * 1000  // 1 year
      : 30 * 24 * 60 * 60 * 1000;  // ~1 month
  }

  /**
   * Get all subscriptions for a customer
   */
  static async getCustomerSubscriptions(
    customerId: string,
  ): Promise<Stripe.Subscription[]> {
    try {
      const stripe = this.getStripeClient();
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
      });

      return subscriptions.data;
    } catch (error) {
      console.error("❌ Error fetching customer subscriptions:", error);
      throw error;
    }
  }

  /**
   * Create a checkout session for payment (REDIRECT METHOD)
   * User is redirected directly to Stripe Checkout
   * Supports both monthly and yearly billing
   */
  // static async createCheckoutSession(
  //   userId: string,
  //   amount: number,
  //   currency: string,
  //   plan: string,
  //   userAmount: number,
  //   source: "app" | "web" = "web",
  // ): Promise<{
  //   checkoutUrl: string;
  //   sessionId: string;
  //   reference: string;
  // }> {
  //   try {
  //     const user = await User.findById(userId);
  //     if (!user) throw new Error("User not found");

  //     const orderRef = `STR-${Date.now()}`;
  //      const successUrl =
  //     source === "app"
  //       ? "skybornedrop://payment-processing" 
  //       : `${process.env.FRONTEND_URL}/payment-success?sessionId={CHECKOUT_SESSION_ID}`;

  //   const cancelUrl =
  //     source === "app"
  //       ? "skybornedrop://payment-processing"
  //       : `${process.env.FRONTEND_URL}/payment-failed`;

  //     // Create checkout session
  //     const session = await this.stripe.checkout.sessions.create({
  //       payment_method_types: ["card"],

  //       mode: "subscription",

  //       line_items: [
  //         {
  //           price_data: {
  //             currency: currency.toLowerCase(),
  //             product_data: {
  //               name: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
  //               description: `${plan}`,
  //             },
  //             unit_amount: Math.round(amount * 100), // cents
  //             recurring: {
  //               interval: "month",
  //             },
  //           },
  //           quantity: 1,
  //         },
  //       ],

  //       customer_email: user.email,       

  //       metadata: {
  //         userId,
  //         plan,
  //         orderRef,
  //         userAmount: userAmount.toString()
  //       },
        
  //       success_url:successUrl,
  //       cancel_url: cancelUrl,
  //     } as Stripe.Checkout.SessionCreateParams);

  //     // Create payment record
  //     const payment = await Payment.create({
  //       userId,
  //       orderRef,
  //       reference: session.id,
  //       amount: userAmount,
  //       localAmount: amount,
  //       currency,
  //       plan,
  //       status: "PENDING",
  //       gateway: "stripe",
  //       paymentIntentId: session.id,
  //       gatewayResponse: {
  //         sessionId: session.id,
  //         checkoutUrl: session.url,
  //       },
  //       source: source,
  //     });
  //     // console.log("this is payment:- ", payment);

  //     return {
  //       checkoutUrl: session.url || "",
  //       sessionId: session.id,
  //       reference: session.id,
  //     };
  //   } catch (error) {
  //     console.error("❌ Error creating checkout session:", error);
  //     throw error;
  //   }
  // }

  /**
 * Create checkout session with automatic currency conversion
 * @param userId - User ID
 * @param amount - Amount in USD (base currency)
 * @param currency - Original currency (usually USD)
 * @param plan - Subscription plan
 * @param userAmount - Original amount before conversion
 * @param source - Source of payment (web/app)
 */
  static async createCheckoutSession(
    userId: string,
    amount: number,
    currency: string,
    plan: string,
    userAmount: number,
    source: "app" | "web" = "web",
    billingType: "monthly" | "yearly" = "monthly",
    customSuccessUrl?: string,
    customCancelUrl?: string,
    previousSubscriptionId?: string,
    deferUntil?: Date,
  ): Promise<{
    checkoutUrl: string;
    sessionId: string;
    reference: string;
    amount: number;          // ✅ NEW: Return converted amount
    currency: string;        // ✅ NEW: Return local currency
    originalAmount: number;  // ✅ NEW: Return original amount
    originalCurrency: string; // ✅ NEW: Return original currency
  }> {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error("User not found");

      const enableLocalCurrencyConversion =
        String(process.env.STRIPE_ENABLE_LOCAL_CURRENCY_CONVERSION || "")
          .trim()
          .toLowerCase() === "true";

      const countryCode = user.countryCode || user.country || "US";
      const forceUsdCountries = String(
        process.env.STRIPE_FORCE_USD_COUNTRIES || "AE",
      )
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
      const forceUsdForUser = forceUsdCountries.includes(
        String(countryCode || "").toUpperCase(),
      );

      // Default behavior: charge in the currency requested by the client (typically USD).
      // When local conversion is enabled, convert USD -> local currency based on user country.
      let localCurrency = String(currency || "USD").toLowerCase();
      let localCurrencyCode = String(currency || "USD").toUpperCase();

      let localAmount = amount;
      let conversionRate = 1;

      // Stripe cannot create subscriptions with mixed currencies under the same customer.
      // If the user already has a Stripe subscription, keep the currency consistent to
      // avoid "You cannot combine currencies on a single customer".
      const existingSubscriptionCurrencyCode =
        await this.getExistingSubscriptionCurrencyCode(user);

      if (existingSubscriptionCurrencyCode) {
        localCurrencyCode = existingSubscriptionCurrencyCode.toUpperCase();
        localCurrency = existingSubscriptionCurrencyCode.toLowerCase();

        if (String(currency || "").toUpperCase() !== localCurrencyCode) {
          const result = await convertUsingDB(
            amount,
            String(currency || "USD").toUpperCase(),
            localCurrencyCode,
          );
          localAmount = result.convertedAmount;
          conversionRate = result.rate;
        }
      } else if (forceUsdForUser) {
        localCurrencyCode = "USD";
        localCurrency = "usd";
      } else if (enableLocalCurrencyConversion) {
        const currencyMapping = getCurrencyForCountry(countryCode);
        localCurrency = currencyMapping.stripeCurrency;
        localCurrencyCode = currencyMapping.currency;

        if (String(currency || "").toUpperCase() !== localCurrencyCode) {
          const result = await convertUsingDB(
            amount,
            String(currency || "USD").toUpperCase(),
            localCurrencyCode,
          );

          localAmount = result.convertedAmount;
          conversionRate = result.rate;
        }
      }

      // ✅ NEW: Format amount for Stripe (multiply by 100 for most currencies, except JPY)
      const stripeAmount = formatAmountForStripe(localAmount, localCurrencyCode);

      const orderRef = `STR-${Date.now()}`;
      const billingInterval = this.getBillingInterval(billingType);
      const appSuccessUrl = customSuccessUrl || process.env.APP_PAYMENT_SUCCESS_URL;
      const appCancelUrl = customCancelUrl || process.env.APP_PAYMENT_CANCEL_URL;
      const webSuccessUrl = process.env.WEB_PAYMENT_SUCCESS_URL || `${process.env.FRONTEND_URL}/payment-success?sessionId={CHECKOUT_SESSION_ID}`;
      const webCancelUrl = process.env.WEB_PAYMENT_CANCEL_URL || `${process.env.FRONTEND_URL}/payment-failed`;

      if (source === "app" && (!appSuccessUrl || !appCancelUrl)) {
        throw new Error(
          "Missing app Stripe redirect URLs. Set APP_PAYMENT_SUCCESS_URL and APP_PAYMENT_CANCEL_URL.",
        );
      }

      if (source === "web" && (!webSuccessUrl || !webCancelUrl)) {
        throw new Error(
          "Missing web Stripe redirect URLs. Set WEB_PAYMENT_SUCCESS_URL/WEB_PAYMENT_CANCEL_URL or FRONTEND_URL.",
        );
      }

      const successUrl = source === "app" ? appSuccessUrl : webSuccessUrl;
      const cancelUrl = source === "app" ? appCancelUrl : webCancelUrl;

      // Always use a consistent Stripe customer id (reuse if exists, else create once).
      const customerId = await this.getOrCreateCustomer(user);
      const metadata: Stripe.MetadataParam = {
        userId,
        plan,
        orderRef,
        userAmount: userAmount.toString(),
        billingType,
        localAmount: localAmount.toString(),
        currency: localCurrencyCode,
        originalCurrency: String(currency || "USD").toUpperCase(),
        conversionRate: conversionRate.toString(),
      };

      if (previousSubscriptionId) {
        metadata.previousSubscriptionId = previousSubscriptionId;
      }

      let deferredAnchorUnix: number | null = null;
      if (deferUntil) {
        const trialEndMs = deferUntil.getTime();
        const trialEndUnix = Math.floor(trialEndMs / 1000);
        const nowUnix = Math.floor(Date.now() / 1000);
        if (trialEndUnix > nowUnix + 60) {
          deferredAnchorUnix = trialEndUnix;
          metadata.deferUntil = new Date(trialEndMs).toISOString();
          metadata.deferredCharge = "true";
        }
      }

      const sessionCreateParams: Stripe.Checkout.SessionCreateParams = {
        payment_method_types: ["card"],
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: localCurrency, // ✅ CHANGED: Use local currency instead of original
              product_data: {
                name: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
                description: `${plan} - ${billingType === "yearly" ? "Annual" : "Monthly"} Subscription`,
              },
              unit_amount: stripeAmount, // ✅ CHANGED: Use converted amount
              recurring: {
                interval: billingInterval,
                interval_count: billingType === "yearly" ? 1 : 1,
              },
            },
            quantity: 1,
          },
        ],
        metadata,
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer: customerId,
      };

      if (deferredAnchorUnix) {
        sessionCreateParams.subscription_data = {
          billing_cycle_anchor: deferredAnchorUnix,
          proration_behavior: "none",
        };
      }

      // Create checkout session with LOCAL CURRENCY
      const session = await this.stripe.checkout.sessions.create(
        sessionCreateParams,
      );

      // Create payment record with both amounts
      const payment = await Payment.create({
        userId,
        orderRef,
        reference: session.id,
        amount: userAmount,              // Original USD amount
        localAmount: localAmount,        // ✅ NEW: Converted local amount
        currency: localCurrencyCode,
        plan,
        billingType,
        previousSubscriptionId: previousSubscriptionId || undefined,
        status: "PENDING",
        gateway: "stripe",
        paymentIntentId: session.id,
        gatewayResponse: {
          sessionId: session.id,
          checkoutUrl: session.url,
        },
        source: source,
        metadata: {                      // ✅ NEW: Store conversion metadata
          countryCode,
          conversionRate,
          originalCurrency: String(currency || "USD").toUpperCase(),
        },
      });

      return {
        checkoutUrl: session.url || "",
        sessionId: session.id,
        reference: session.id,
        amount: localAmount,              // ✅ NEW: Return converted amount
        currency: localCurrencyCode,      // ✅ NEW: Return local currency
        originalAmount: userAmount,       // ✅ NEW: Return original amount
        originalCurrency: currency,       // ✅ NEW: Return original currency
      };
    } catch (error) {
      console.error("❌ Error creating checkout session:", error);
      throw error;
    }
  }
  /**
   * Get checkout session details
   */
  static async getCheckoutSession(
    sessionId: string,
  ): Promise<Stripe.Checkout.Session> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      return session;
    } catch (error) {
      console.error("❌ Error retrieving session:", error);
      throw error;
    }
  }

  /**
   * Fulfill order after successful payment (webhook handler)
   */
  static async fulfillOrder(sessionId: string) {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status === "paid") {
        // Get billing type from metadata
        const billingType = (session.metadata?.billingType as "monthly" | "yearly") || "monthly";
        
        // Update payment record
        const payment = await Payment.findOneAndUpdate(
          { paymentIntentId: sessionId },
          {
            status: "COMPLETED",
            billingType,
            verifiedAt: new Date(),
          },
          { new: true },
        );

        if (payment) {
          // Update user subscription
          const user = await User.findById(payment.userId);
          if (user) {
            const subscriptionDuration = this.getSubscriptionDuration(billingType);
            user.subscription = {
              ...user.subscription,
              startDate: new Date(),
              endDate: new Date(Date.now() + subscriptionDuration),
              status: "active",
              // plan: payment.plan as any,
            };
            await user.save();
          }

          return payment;
        }
      }
    } catch (error) {
      console.error("❌ Error fulfilling order:", error);
      throw error;
    }
  }

  /**
   * Get or create a Stripe customer for a user
   */
  private static async getExistingCustomer(user: any): Promise<string | null> {
    const stripe = this.getStripeClient();
    const setAndReturnCustomerId = async (customerId: string) => {
      if (!customerId) return customerId;
      if (user.stripeCustomerId !== customerId) {
        user.stripeCustomerId = customerId;
        await user.save();
      }
      return customerId;
    };

    if (user.stripeCustomerId) {
      try {
        const existing = await stripe.customers.retrieve(user.stripeCustomerId);
        if (!existing.deleted) {
          return user.stripeCustomerId;
        }
      } catch (error: any) {
        const notFound =
          error?.statusCode === 404 ||
          error?.code === "resource_missing" ||
          String(error?.message || "").toLowerCase().includes("no such customer");
        if (!notFound) {
          throw error;
        }
        console.warn(
          `⚠️ Invalid Stripe customerId (${user.stripeCustomerId}) for user ${user._id}.`,
        );
      }
    }

    // Recover customer from subscription if available (find existing only).
    if (user.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
        );
        const subscriptionCustomer = subscription.customer;
        const customerId =
          typeof subscriptionCustomer === "string"
            ? subscriptionCustomer
            : subscriptionCustomer?.id || "";

        if (customerId) {
          const existing = await stripe.customers.retrieve(customerId);
          if (!existing.deleted) {
            return await setAndReturnCustomerId(customerId);
          }
        }
      } catch (error: any) {
        console.warn(
          `⚠️ Unable to recover customer from subscription (${user.stripeSubscriptionId}) for user ${user._id}:`,
          error?.message || error,
        );
      }
    }

    return null;
  }

  private static async getExistingSubscriptionCurrencyCode(
    user: any,
  ): Promise<string | null> {
    const stripe = this.getStripeClient();

    // Fast path: stored subscription id
    if (user?.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
        );
        const priceCurrency =
          subscription.items?.data?.[0]?.price?.currency ||
          (subscription.items?.data?.[0] as any)?.plan?.currency;
        if (priceCurrency) return String(priceCurrency).toUpperCase();
      } catch (error: any) {
        const notFound =
          error?.statusCode === 404 ||
          error?.code === "resource_missing" ||
          String(error?.message || "").toLowerCase().includes("no such subscription");
        if (!notFound) {
          console.warn(
            `⚠️ Unable to read Stripe subscription (${user?.stripeSubscriptionId}) for user ${user?._id}:`,
            error?.message || error,
          );
        }
      }
    }

    const customerId = await this.getExistingCustomer(user);
    if (!customerId) return null;

    try {
      // Grab any subscription currency for this customer (we only need one)
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 1,
      });
      const sub = subs.data?.[0];
      const priceCurrency =
        sub?.items?.data?.[0]?.price?.currency ||
        (sub?.items?.data?.[0] as any)?.plan?.currency;
      if (priceCurrency) return String(priceCurrency).toUpperCase();
    } catch (error: any) {
      console.warn(
        `⚠️ Unable to list Stripe subscriptions for customer ${customerId}:`,
        error?.message || error,
      );
    }

    return null;
  }

  /**
   * Resolve an existing Stripe customer id for a user without creating a new customer.
   */
  static async resolveExistingCustomerId(user: any): Promise<string | null> {
    return this.getExistingCustomer(user);
  }

  static async getOrCreateCustomer(user: any): Promise<string> {
    try {
      const stripe = this.getStripeClient();
      const createNewCustomer = async () => {
        const customer = await stripe.customers.create({
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          metadata: {
            userId: user._id.toString(),
          },
        });

        user.stripeCustomerId = customer.id;
        await user.save();
        return customer.id;
      };
      const existingCustomerId = await this.getExistingCustomer(user);
      if (existingCustomerId) {
        return existingCustomerId;
      }

      return await createNewCustomer();
    } catch (error) {
      console.error("❌ Error creating Stripe customer:", error);
      throw error;
    }
  }

  static async getDefaultCardDetails(user: any) {
    const stripe = this.getStripeClient();
    const customerId = await this.getExistingCustomer(user);

    if (!customerId) {
      return {
        customerId: "",
        hasCard: false,
        card: null,
        billingDetails: {
          name: "",
          email: "",
          phone: "",
          address: {
            line1: "",
            line2: "",
            city: "",
            state: "",
            postal_code: "",
            country: "",
          },
        },
      };
    }

    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      throw new Error("Stripe customer not found");
    }

    let defaultPaymentMethodId =
      typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id || null;

    // Fallback 1: subscription-level default payment method
    if (!defaultPaymentMethodId && user?.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
        );
        const subPm = (subscription as any)?.default_payment_method;
        defaultPaymentMethodId =
          typeof subPm === "string" ? subPm : subPm?.id || null;
      } catch (error: any) {
        console.warn(
          `⚠️ Failed to resolve default payment method from subscription (${user?.stripeSubscriptionId}) for user ${user?._id}:`,
          error?.message || error,
        );
      }
    }

    // Fallback 2: any attached card payment method
    if (!defaultPaymentMethodId) {
      try {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: customerId,
          type: "card",
          limit: 1,
        });
        defaultPaymentMethodId = paymentMethods?.data?.[0]?.id || null;
      } catch (error: any) {
        console.warn(
          `⚠️ Failed to list card payment methods for customer ${customerId}:`,
          error?.message || error,
        );
      }
    }

    if (!defaultPaymentMethodId) {
      return {
        customerId,
        hasCard: false,
        card: null,
        billingDetails: {
          name: customer.name || "",
          email: customer.email || "",
          phone: customer.phone || "",
          address: {
            line1: "",
            line2: "",
            city: "",
            state: "",
            postal_code: "",
            country: "",
          },
        },
      };
    }

    const paymentMethod = await stripe.paymentMethods.retrieve(defaultPaymentMethodId);
    const details = (paymentMethod.billing_details || {}) as any;
    const address = (details.address || {}) as any;
    const card = paymentMethod.card;

    return {
      customerId,
      hasCard: Boolean(card),
      card: card
        ? {
            paymentMethodId: paymentMethod.id,
            brand: card.brand,
            last4: card.last4,
            expMonth: card.exp_month,
            expYear: card.exp_year,
            funding: card.funding || null,
          }
        : null,
      billingDetails: {
        name: details.name || customer.name || "",
        email: details.email || customer.email || "",
        phone: details.phone || customer.phone || "",
        address: {
          line1: address.line1 || "",
          line2: address.line2 || "",
          city: address.city || "",
          state: address.state || "",
          postal_code: address.postal_code || "",
          country: address.country || "",
        },
      },
    };
  }

  static async createCardSetupIntent(user: any) {
    const stripe = this.getStripeClient();
    const customerId = await this.getExistingCustomer(user);
    if (!customerId) {
      throw new Error("No existing Stripe customer found for this user");
    }
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });
    return {
      customerId,
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
    };
  }

  static async createCardUpdatePortalSession(user: any, returnUrl?: string) {
    const stripe = this.getStripeClient();
    const customerId = await this.getExistingCustomer(user);
    if (!customerId) {
      throw new Error("No existing Stripe customer found for this user");
    }
    const fallbackReturnUrl = `${process.env.FRONTEND_URL || ""}/payments`;
    const safeReturnUrl =
      typeof returnUrl === "string" && /^https?:\/\//i.test(returnUrl)
        ? returnUrl
        : fallbackReturnUrl;

    // Force the "payment method update" flow so the portal doesn't show subscription
    // management actions (e.g., cancel subscription).
    const configurationId = String(
      process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_CARD_UPDATE_ID || "",
    ).trim();

    // To fully hide invoice history / subscriptions, you must use a Billing Portal
    // configuration with those features disabled.
    if (!configurationId) {
      const allowDefaultPortal = /^(1|true|yes)$/i.test(
        String(process.env.STRIPE_ALLOW_DEFAULT_BILLING_PORTAL_FOR_CARD_UPDATE || ""),
      );

      if (!allowDefaultPortal) {
        throw new Error(
          "Missing Stripe billing portal configuration. Set STRIPE_BILLING_PORTAL_CONFIGURATION_CARD_UPDATE_ID to a Billing Portal configuration with invoice history and subscription cancellation disabled.",
        );
      }

      console.warn(
        "⚠️  [StripeService.createCardUpdatePortalSession] STRIPE_BILLING_PORTAL_CONFIGURATION_CARD_UPDATE_ID is not set; creating session without configuration because STRIPE_ALLOW_DEFAULT_BILLING_PORTAL_FOR_CARD_UPDATE is enabled.",
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      ...(configurationId ? { configuration: configurationId } : {}),
      flow_data: {
        type: "payment_method_update",
        after_completion: {
          type: "redirect",
          redirect: { return_url: safeReturnUrl },
        },
      },
      // Keep return_url for backward-compatibility with older portal behavior.
      return_url: safeReturnUrl,
    } as any);

    return {
      customerId,
      url: session.url,
    };
  }

  static async setDefaultPaymentMethodForUser(
    user: any,
    paymentMethodId: string,
    billingDetails?: {
      name?: string;
      email?: string;
      phone?: string;
      address?: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
      };
    },
  ) {
    const stripe = this.getStripeClient();
    const customerId = await this.getExistingCustomer(user);
    if (!customerId) {
      throw new Error("No existing Stripe customer found for this user");
    }

    // Ensure payment method is attached to this customer.
    const existingPaymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    const currentCustomer =
      typeof existingPaymentMethod.customer === "string"
        ? existingPaymentMethod.customer
        : existingPaymentMethod.customer?.id || null;

    if (!currentCustomer) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } else if (currentCustomer !== customerId) {
      throw new Error("Payment method belongs to a different customer");
    }

    if (billingDetails) {
      await stripe.paymentMethods.update(paymentMethodId, {
        billing_details: {
          name: billingDetails.name,
          email: billingDetails.email,
          phone: billingDetails.phone,
          address: billingDetails.address,
        },
      });
    }

    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
      name: billingDetails?.name || undefined,
      email: billingDetails?.email || undefined,
      phone: billingDetails?.phone || undefined,
      address: billingDetails?.address || undefined,
    });

    if (user.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.update(user.stripeSubscriptionId, {
          default_payment_method: paymentMethodId,
        });
      } catch (error) {
        console.warn("⚠️ Failed to update Stripe subscription default payment method:", error);
      }
    }

    return this.getDefaultCardDetails(user);
  }

  /**
   * Create a payment intent for one-time payment
   */
  // static async createPaymentIntent(
  //   userId: string,
  //   amount: number, // in cents
  //   currency: string,
  //   plan: string,
  //   userAmount: number,
  // ): Promise<{
  //   clientSecret: string;
  //   reference: string;
  //   amount: number;
  // }> {
  //   try {
  //     const user = await User.findById(userId);
  //     if (!user) throw new Error("User not found");

  //     const customerId = await this.getOrCreateCustomer(user);
  //     const orderRef = `STR-${Date.now()}`;

  //     // Create payment intent
  //     const paymentIntent = await this.stripe.paymentIntents.create({
  //       customer: customerId,
  //       amount: stripeAmount, // Convert to cents
  //       currency: localCurrency,
  //       description: `Plan: ${plan} - Monthly Subscription`,
  //       metadata: {
  //         userId: userId,
  //         plan,
  //         orderRef,
  //         isRecurring: "true",
  //       },
  //       // Enable off-session for recurring charges
  //       off_session: false,
  //       setup_future_usage: "off_session",
  //     });

  //     // Create payment record
  //     const payment = await Payment.create({
  //       userId,
  //       orderRef,
  //       reference: paymentIntent.id,
  //       amount: userAmount,
  //       localAmount: amount,
  //       currency,
  //       plan,
  //       status: "PENDING",
  //       gateway: "stripe",
  //       paymentIntentId: paymentIntent.id,
  //       gatewayResponse: {
  //         paymentIntentId: paymentIntent.id,
  //         clientSecret: paymentIntent.client_secret,
  //       },
  //     });

  //     return {
  //       clientSecret: paymentIntent.client_secret || "",
  //       reference: paymentIntent.id,
  //       amount: userAmount,
  //     };
  //   } catch (error) {
  //     console.error("❌ Error creating payment intent:", error);
  //     throw error;
  //   }
  // }

  static async createPaymentIntent(
    userId: string,
    amount: number, // in cents
    currency: string,
    plan: string,
    userAmount: number,
    billingType: "monthly" | "yearly" = "monthly",
  ): Promise<{
    clientSecret: string;
    reference: string;
    amount: number;
  }> {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error("User not found");

      const customerId = await this.getOrCreateCustomer(user);
      const orderRef = `STR-${Date.now()}`;

      // ✅ FIX: Add currency conversion logic
      const countryCode = user.countryCode || user.country || "US";
      const currencyMapping = getCurrencyForCountry(countryCode);
      const localCurrency = currencyMapping.stripeCurrency;
      const localCurrencyCode = currencyMapping.currency;

      let localAmount = amount;
      let conversionRate = 1;

      if (currency !== localCurrencyCode) {
        const result = await convertUsingDB(
          amount,
          currency,
          localCurrencyCode,
        );

        localAmount = result.convertedAmount;
        conversionRate = result.rate;
      }

      const stripeAmount = formatAmountForStripe(localAmount, localCurrencyCode);

      // Create payment intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        customer: customerId,
        amount: stripeAmount, // ✅ FIXED: Now defined
        currency: localCurrency, // ✅ FIXED: Now defined
        description: `Plan: ${plan} - ${billingType === "yearly" ? "Annual" : "Monthly"} Subscription`,
        metadata: {
          userId: userId,
          plan,
          orderRef,
          billingType,
          isRecurring: "true",
        },
        off_session: false,
        setup_future_usage: "off_session",
      });

      // Create payment record
      const payment = await Payment.create({
        userId,
        orderRef,
        reference: paymentIntent.id,
        amount: userAmount,
        localAmount: localAmount, // ✅ FIXED
        currency: localCurrencyCode, // ✅ FIXED
        plan,
        billingType,
        status: "PENDING",
        gateway: "stripe",
        paymentIntentId: paymentIntent.id,
        gatewayResponse: {
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
        },
      });

      return {
        clientSecret: paymentIntent.client_secret || "",
        reference: paymentIntent.id,
        amount: userAmount,
      };
    } catch (error) {
      console.error("❌ Error creating payment intent:", error);
      throw error;
    }
  }

  /**
   * Get payment intent status
   */
  static async getPaymentIntentStatus(paymentIntentId: string): Promise<{
    status: string;
    amount: number;
    currency: string;
  }> {
    try {
      const paymentIntent =
        await this.stripe.paymentIntents.retrieve(paymentIntentId);

      return {
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency.toUpperCase(),
      };
    } catch (error) {
      console.error("❌ Error fetching payment intent:", error);
      throw error;
    }
  }

  /**
   * Create subscription for recurring billing
   */
  static async createSubscription(
    userId: string,
    priceId: string,
    plan: string,
    billingType: "monthly" | "yearly" = "monthly",
  ): Promise<{ subscriptionId: string; clientSecret?: string }> {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error("User not found");

      const customerId = await this.getOrCreateCustomer(user);
      const billingInterval = this.getBillingInterval(billingType);

      const subscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        metadata: {
          userId: userId,
          plan,
          billingType,
        },
        // Collect payment on subscription creation
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
      });

      // latest_invoice can be a string ID or an Invoice object; use a safe cast and a type guard to access payment_intent
      const latestInvoice = subscription.latest_invoice as
        | Stripe.Invoice
        | string
        | null;
      const paymentIntent =
        typeof latestInvoice === "object" && latestInvoice !== null
          ? ((latestInvoice as any).payment_intent as
              | Stripe.PaymentIntent
              | undefined)
          : undefined;

      return {
        subscriptionId: subscription.id,
        clientSecret: paymentIntent?.client_secret as string,
      };
    } catch (error) {
      console.error("❌ Error creating subscription:", error);
      throw error;
    }
  }

  /**
   * Upgrade/downgrade an existing Stripe subscription while keeping the same subscription ID.
   */
  static async upgradeSubscriptionPlan(
    userId: string,
    subscriptionId: string,
    amount: number,
    currency: string,
    plan: string,
    billingType: "monthly" | "yearly" = "monthly",
  ): Promise<{
    subscriptionId: string;
    amount: number;
    currency: string;
    localAmount: number;
    localCurrency: string;
    plan: string;
    billingType: "monthly" | "yearly";
    currentPeriodEnd: Date | null;
  }> {
    try {
      const stripe = this.getStripeClient();
      const user = await User.findById(userId);
      if (!user) throw new Error("User not found");

      const existingSubscription = await stripe.subscriptions.retrieve(
        subscriptionId,
      );

      const existingItem = existingSubscription.items?.data?.[0];
      if (!existingItem?.id) {
        throw new Error("Stripe subscription item not found for upgrade");
      }

      const existingPrice = existingItem.price;
      const detectedCurrency =
        typeof existingPrice === "string"
          ? ""
          : String(existingPrice?.currency || "").toLowerCase();
      if (!detectedCurrency) {
        throw new Error("Unable to determine existing subscription currency");
      }
      const existingStripeCurrency = detectedCurrency;
      const existingCurrencyCode = existingStripeCurrency.toUpperCase();

      let localAmount = amount;
      const inputCurrencyCode = String(currency || "USD").toUpperCase();
      if (inputCurrencyCode !== existingCurrencyCode) {
        const result = await convertUsingDB(
          amount,
          inputCurrencyCode,
          existingCurrencyCode,
        );
        localAmount = result.convertedAmount;
      }

      const stripeAmount = formatAmountForStripe(localAmount, existingCurrencyCode);
      const billingInterval = this.getBillingInterval(billingType);

      const newPrice = await stripe.prices.create({
        currency: existingStripeCurrency,
        unit_amount: stripeAmount,
        recurring: { interval: billingInterval, interval_count: 1 },
        product_data: {
          name: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
        },
        metadata: {
          userId,
          subscriptionId,
          plan,
          billingType,
          originalCurrency: inputCurrencyCode,
          originalAmount: amount.toString(),
          localCurrency: existingCurrencyCode,
          localAmount: localAmount.toString(),
        },
      });

      const updatedSubscription = await stripe.subscriptions.update(
        subscriptionId,
        {
          items: [{ id: existingItem.id, price: newPrice.id }],
          proration_behavior: "create_prorations",
          metadata: {
            userId,
            plan,
            billingType,
            upgradedAt: new Date().toISOString(),
          },
        },
      );
      const currentPeriodEndUnix = (updatedSubscription as any)?.current_period_end;

      return {
        subscriptionId: updatedSubscription.id,
        amount,
        currency: inputCurrencyCode,
        localAmount,
        localCurrency: existingCurrencyCode,
        plan,
        billingType,
        currentPeriodEnd: currentPeriodEndUnix
          ? new Date(Number(currentPeriodEndUnix) * 1000)
          : null,
      };
    } catch (error) {
      console.error("❌ Error upgrading Stripe subscription plan:", error);
      throw error;
    }
  }

  /**
   * Charge recurring payment using saved payment method
   * Supports both monthly and yearly billing cycles
   */
  // static async chargeRecurringPayment(
  //   userId: string,
  //   plan: string,
  //   amount: number, // in cents
  //   currency: string,
  //   billingType: "monthly" | "yearly" = "monthly",
  //   retryAttempt = 0,
  //   config = this.DEFAULT_RECURRING_CONFIG,
  // ): Promise<void> {
  //   try {
  //     const user = await User.findById(userId);
  //     if (!user || !user.plan) {
  //       throw new Error(`User ${userId} not found or has no plan`);
  //     }

  //     const customerId = await this.getOrCreateCustomer(user);
  //     const orderRef = `STR-REC-${Date.now()}`;

  //     // Get default payment method
  //     const paymentMethods = await this.stripe.paymentMethods.list({
  //       customer: customerId,
  //       type: "card",
  //     });

  //     if (paymentMethods.data.length === 0) {
  //       throw new Error("No payment method on file");
  //     }

  //     const defaultPaymentMethod = paymentMethods.data[0];

  //     // Create invoice for recurring charge
  //     const paymentIntent = await this.stripe.paymentIntents.create({
  //       customer: customerId,
  //       amount: Math.round(amount * 100),
  //       currency: currency.toLowerCase(),
  //       payment_method: defaultPaymentMethod.id,
  //       off_session: true,
  //       confirm: true,
  //       description: `Recurring charge for ${plan} (${billingType})`,
  //       metadata: {
  //         userId: userId,
  //         plan,
  //         billingType,
  //         orderRef,
  //         isRecurring: "true",
  //       },
  //     });

  //     // Create payment record
  //     const payment = await Payment.create({
  //       userId,
  //       orderRef,
  //       reference: paymentIntent.id,
  //       amount: amount / 100,
  //       localAmount: amount / 100,
  //       currency,
  //       plan,
  //       billingType,
  //       status: "PENDING",
  //       gateway: "stripe",
  //       paymentIntentId: paymentIntent.id,
  //       isRecurring: true,
  //       recurringCycle: this.getMonthlyRecurringCycle(),
  //       billingAttempt: retryAttempt + 1,
  //       gatewayResponse: { paymentIntentId: paymentIntent.id },
  //     });

  //     // Verify payment after delay
  //     setTimeout(() => {
  //       this.verifyRecurringPayment(paymentIntent.id, userId, plan, billingType);
  //     }, 3000);
  //   } catch (error) {
  //     console.error(
  //       `❌ Recurring payment charge failed (Attempt ${retryAttempt + 1}):`,
  //       error,
  //     );

  //     if (retryAttempt < (config.maxRetries || 3)) {
  //       setTimeout(() => {
  //         this.chargeRecurringPayment(
  //           userId,
  //           plan,
  //           amount,
  //           currency,
  //           billingType,
  //           retryAttempt + 1,
  //           config,
  //         );
  //       }, config.retryDelayMs || 5000);
  //     } else {
  //       await this.suspendSubscription(userId);
  //       throw error;
  //     }
  //   }
  // }

  /**
   * Verify recurring payment result
   */
  private static async verifyRecurringPayment(
    paymentIntentId: string,
    userId: string,
    plan: string,
    billingType: "monthly" | "yearly" = "monthly",
  ) {
    try {
      const payment = await Payment.findOne({
        paymentIntentId,
      });

      if (!payment) {
        console.error(`❌ Payment not found: ${paymentIntentId}`);
        return;
      }

      const paymentIntent =
        await this.stripe.paymentIntents.retrieve(paymentIntentId);

      let paymentStatus = "PENDING";

      if (paymentIntent.status === "succeeded") {
        paymentStatus = "COMPLETED";
      } else if (paymentIntent.status === "requires_action") {
        paymentStatus = "PENDING";
      } else if (paymentIntent.status === "requires_payment_method") {
        paymentStatus = "FAILED";
      }

      payment.status = paymentStatus as any;
      payment.billingType = billingType;
      payment.gatewayResponse = { paymentIntentId: paymentIntent.id };
      payment.verifiedAt = new Date();
      await payment.save();

      if (paymentStatus === "COMPLETED") {
        const user = await User.findById(userId);
        if (user && user.subscription) {
          const subscriptionDuration = this.getSubscriptionDuration(billingType);
          user.subscription.endDate = new Date(
            Date.now() + subscriptionDuration,
          );
          await user.save();
        }
      } else {
        await this.notifyPaymentFailure(userId, plan);
      }
    } catch (error) {
      console.error(`❌ Error verifying recurring payment:`, error);
    }
  }

  /**
   * Initialize recurring payment cron job
   */
  // static initRecurringPaymentCron() {
  //   cron.schedule("0 2 * * *", async () => {
  //     await this.processRecurringPayments();
  //   });
  // }

  /**
   * Process all Stripe recurring payments
   * Handles both monthly and yearly subscriptions
   */
  private static async processRecurringPayments() {
    try {
      // Find all active Stripe subscriptions
      const activeUsers = await User.find({
        "subscription.status": "active",
        gateway: "stripe",
      });

      for (const user of activeUsers) {
        try {
          const billingType = user.billingType || "monthly";
          const planAmount = this.getPlanAmount(user.plan as string);
          
          // await this.chargeRecurringPayment(
          //   user._id.toString(),
          //   user.plan as string,
          //   planAmount,
          //   "USD",
          //   billingType as any,
          // );
        } catch (err) {
          console.error(`❌ Error charging user ${user._id}:`, err);
        }
      }
    } catch (error) {
      console.error("❌ Error in processRecurringPayments:", error);
    }
  }

  /**
   * Suspend subscription due to failed payments
   */
  private static async suspendSubscription(userId: string) {
    try {
      const user = await User.findById(userId);
      if (user && user.subscription) {
        user.subscription.status = "suspended";
        user.subscription.suspendedAt = new Date();
        await user.save();

        await this.notifySubscriptionSuspended(userId);
      }
    } catch (error) {
      console.error(`❌ Error suspending subscription:`, error);
    }
  }

  /**
   * Get monthly recurring cycle identifier
   */
  private static getMonthlyRecurringCycle(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Get plan amount
   */
  private static getPlanAmount(plan: string): number {
    const PLAN_AMOUNTS: { [key: string]: number } = {
      "gold-yoga": 100,
      "gold-zumba": 100,
      "gold-mixed": 100,
      diamond: 200,
      platinum: 300,
    };

    return PLAN_AMOUNTS[plan.toLowerCase()] || 50;
  }

  /**
   * Notify user of failed payment
   */
  private static async notifyPaymentFailure(userId: string, plan: string) {
    try {
      const user = await User.findById(userId);
      if (user && user.email) {
        // Implement email notification here
      }
    } catch (error) {
      console.error(`❌ Error notifying payment failure:`, error);
    }
  }

  /**
   * Notify user of subscription suspension
   */
  private static async notifySubscriptionSuspended(userId: string) {
    try {
      const user = await User.findById(userId);
      if (user && user.email) {
        // Implement email notification here
      }
    } catch (error) {
      console.error(`❌ Error notifying suspension:`, error);
    }
  }

  /**
   * Cancel subscription
   */
  static async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      console.error(`❌ Error cancelling Stripe subscription:`, error);
      throw error;
    }
  }

  /**
   * Schedule subscription cancellation at period end
   */
  static async setSubscriptionCancelAtPeriodEnd(
    subscriptionId: string,
  ): Promise<void> {
    try {
      const stripe = this.getStripeClient();
      await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    } catch (error) {
      console.error(`❌ Error setting cancel_at_period_end:`, error);
      throw error;
    }
  }
}
