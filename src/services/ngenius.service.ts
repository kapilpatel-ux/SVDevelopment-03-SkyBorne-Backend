import axios, { AxiosError } from "axios";
import Payment from "../modules/PaymentModule/models/Payment";
import User from "../modules/UserModule/models/User";
import cron from "node-cron";
import dotenv from 'dotenv';
dotenv.config()

interface ErrorResponse {
  status?: number;
  message?: string;
  errors?: Array<{ detail: string; errorCode?: string }>;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface OrderResponse {
  reference: string;
  links?: Array<{ rel: string; href: string }>;
  _links?: { payment?: { href: string } };
}

interface RecurringPaymentConfig {
  billingCycleDay?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class NgeniusService {
  private static readonly TIMEOUT = 20000;
  private static readonly DEFAULT_RECURRING_CONFIG: RecurringPaymentConfig = {
    billingCycleDay: 1,
    maxRetries: 3,
    retryDelayMs: 5000,
  };

  /**
   * Initialize recurring payment cron job
   * Runs daily at 2 AM to process monthly billing
   */
  static initRecurringPaymentCron() {

    cron.schedule("0 2 * * *", async () => {
      await this.processRecurringPayments();
    });
  }

  /**
   * Process all monthly recurring payments
   */
  private static async processRecurringPayments() {
    try {
      const config = this.DEFAULT_RECURRING_CONFIG;
      const billingDay = config.billingCycleDay || 1;
      const today = new Date().getDate();

      if (today !== billingDay) {
        return;
      }

      // Find all active subscriptions
      const activeUsers = await User.find({
        "subscription.status": "active",
        "subscription.endDate": { $gt: new Date() },
      });

      for (const user of activeUsers) {
        try {
          await this.chargeRecurringPayment(user?.id.toString(), user?.plan as string);
        } catch (err) {
          console.error(`❌ Error charging user ${user.id}:`, err);
        }
      }
    } catch (error) {
      console.error("❌ Error in processRecurringPayments:", error);
    }
  }

  /**
   * Charge a user for their monthly subscription (for recurring payments)
   */
  static async chargeRecurringPayment(
    userId: string,
    plan: string,
    retryAttempt = 0,
    config = this.DEFAULT_RECURRING_CONFIG
  ): Promise<void> {
    try {
      const user = await User.findById(userId);

      if (!user || !user.plan) {
        throw new Error(`User ${userId} not found or has no plan`);
      }

      const amount = this.getPlanAmount(plan);

      // Create recurring order
      const { orderRef, reference } = await this.createOrder(
        amount,
        "AED",
        userId,
        plan,
        amount,
        "app" // Mark as app source for webhook verification
      );

      // Verify payment after short delay
      setTimeout(() => {
        this.verifyRecurringPayment(reference, userId, plan);
      }, 3000);

    } catch (error) {
      console.error(`❌ Recurring payment charge failed (Attempt ${retryAttempt + 1}):`, error);

      if (retryAttempt < (config.maxRetries || 3)) {
        setTimeout(() => {
          this.chargeRecurringPayment(userId, plan, retryAttempt + 1, config);
        }, config.retryDelayMs || 5000);
      } else {
        await this.suspendSubscription(userId);
        throw error;
      }
    }
  }

  /**
   * Verify and process recurring payment result
   */
  private static async verifyRecurringPayment(
    reference: string,
    userId: string,
    plan: string
  ) {
    try {
      const payment = await Payment.findOne({ reference });

      if (!payment) {
        console.error(`❌ Payment not found: ${reference}`);
        return;
      }

      // Fetch status from nGenius
      const orderStatus = await this.getOrderStatus(reference);

      let paymentStatus = "PENDING";

      if (
        orderStatus?._embedded?.payment &&
        orderStatus._embedded.payment.length > 0
      ) {
        const paymentData = orderStatus._embedded.payment[0];
        const ngeniusState = paymentData.state;

        if (
          ngeniusState === "CAPTURED" ||
          ngeniusState === "AUTHORISED" ||
          ngeniusState === "SETTLED"
        ) {
          paymentStatus = "COMPLETED";
        } else if (ngeniusState === "DECLINED" || ngeniusState === "FAILED") {
          paymentStatus = "FAILED";
        }
      }

      // Update payment record
      payment.status = paymentStatus as any;
      payment.ngeniusStatus = orderStatus?._embedded?.payment?.[0]?.state;
      payment.gatewayResponse = orderStatus;
      payment.verifiedAt = new Date();
      await payment.save();

      // If successful, update next billing date
      if (paymentStatus === "COMPLETED") {
        const user = await User.findById(userId);
        if (user && user.subscription) {
          user.subscription.endDate = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
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
   * Get monthly recurring cycle identifier (YYYY-MM format)
   */
  private static getMonthlyRecurringCycle(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Get plan amount from config
   */
  private static getPlanAmount(plan: string): number {
    const PLAN_AMOUNTS: { [key: string]: number } = {
      "gold-yoga": 99.99,
      "gold-zumba": 99.99,
      "gold-mixed": 129.99,
      "diamond": 199.99,
      "platinum": 299.99,
    };

    return PLAN_AMOUNTS[plan.toLowerCase()] || 99.99;
  }

  /**
   * Notify user of failed payment
   */
  static async notifyPaymentFailure(userId: string, plan: string) {
    try {
      const user = await User.findById(userId);
      if (user && user.email) {
        console.log(
          `📧 Sending payment failure notification to ${user.email}`
        );
        // TODO: Implement email notification
        // await sendEmail(user.email, 'Payment Failed', ...);
      }
    } catch (error) {
      console.error(`❌ Error notifying payment failure:`, error);
    }
  }

  /**
   * Notify user of subscription suspension
   */
  static async notifySubscriptionSuspended(userId: string) {
    try {
      const user = await User.findById(userId);
      if (user && user.email) {
        console.log(
          `📧 Sending suspension notification to ${user.email}`
        );
        // TODO: Implement email notification
        // await sendEmail(user.email, 'Subscription Suspended', ...);
      }
    } catch (error) {
      console.error(`❌ Error notifying suspension:`, error);
    }
  }

  /**
   * Notify user of successful payment
   */
  static async notifyPaymentSuccess(userId: string, payment: any) {
    try {
      const user = await User.findById(userId);

      if (!user) {
        console.error(`❌ User not found: ${userId}`);
        return;
      }
    } catch (error) {
      console.error(`❌ Error notifying payment success:`, error);
    }
  }

  /**
   * Cancel recurring subscription
   */
  static async cancelRecurringSubscription(userId: string): Promise<void> {
    try {
      const user = await User.findById(userId);

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      if (user.subscription) {
        user.subscription.status = "cancelled";
        user.subscription.cancelledAt = new Date();
        await user.save();
      }

    } catch (error) {
      console.error(`❌ Error cancelling subscription:`, error);
      throw error;
    }
  }

  /**
   * Get access token from nGenius
   */
  static async getAccessToken(): Promise<string> {
    try {
      const tokenURL = `${process.env.NGENIUS_API_URL}/identity/auth/access-token`;
      const apiKey = process.env.NGENIUS_API_KEY;

      if (!apiKey) {
        throw new Error('NGENIUS_API_KEY is not defined');
      }

      if (!process.env.NGENIUS_API_URL) {
        throw new Error('NGENIUS_API_URL is not defined');
      }

      const response = await axios.post<TokenResponse>(
        tokenURL,
        { grant_type: 'client_credentials' },
        {
          headers: {
            'Content-Type': 'application/vnd.ni-identity.v1+json',
            'Authorization': `Basic ${apiKey}`,
          },
          timeout: this.TIMEOUT,
        }
      );

      if (!response.data?.access_token) {
        throw new Error('No access token in response');
      }

      return response.data.access_token;
    } catch (error) {
      const axiosError = error as AxiosError<ErrorResponse>;

      console.error('❌ nGenius Token Error:');
      console.error('Status:', axiosError.response?.status);
      console.error('Message:', axiosError.message);

      if (axiosError.response?.status === 401) {
        throw new Error('Unauthorized - Invalid API credentials');
      }

      throw error;
    }
  }

  /**
   * Create order in nGenius
   * @param amount - Amount to charge
   * @param currency - Currency code (AED, USD, etc)
   * @param userId - User ID
   * @param plan - Plan type
   * @param userAmount - Display amount (before conversion)
   * @param source - Payment source ('app' or 'web')
   */
  static async createOrder(
    amount: number,
    currency: string,
    userId: string,
    plan: string,
    userAmount: number,
    source: "app" | "web" = "web",
    billingType: "monthly" | "yearly" = "monthly",
  ) {
    try {
      if (!process.env.NGENIUS_OUTLET_ID) {
        throw new Error('NGENIUS_OUTLET_ID is not defined');
      }

      const token = await this.getAccessToken();
      const orderRef = `NG-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
      const outletId = process.env.NGENIUS_OUTLET_ID.trim();
      const orderURL = `${process.env.NGENIUS_API_URL}/transactions/outlets/${outletId}/orders`;

      const redirectUrl = process.env.NGENIUS_REDIRECT_URL?.split('?')[0];
      const cancelUrl = process.env.NGENIUS_CANCEL_URL?.split('?')[0];

      const body = {
        action: "SALE",
        amount: {
          currencyCode: currency,
          value: Math.round(amount * 100), // Convert to minor units
        },
        merchantAttributes: {
          redirectUrl: redirectUrl,
          cancelUrl: cancelUrl,
        },
        merchantDefinedData: {
          orderRef,
          userId,
          plan,
          source, // Include source to differentiate app vs web
        },
      };

      const response = await axios.post<OrderResponse>(orderURL, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/vnd.ni-payment.v2+json",
          Accept: "application/vnd.ni-payment.v2+json",
        },
        timeout: this.TIMEOUT,
      });

      const data = response.data;
      const paymentLink =
        data?._links?.payment?.href ||
        data?.links?.find((l) => l.rel === "payment")?.href;

      if (!paymentLink) {
        throw new Error('No payment link returned');
      }

      // Create payment record
      const payment = await Payment.create({
        userId,
        orderRef,
        reference: data.reference,
        amount: userAmount,
        localAmount: amount,
        currency,
        plan,
        billingType,
        status: "PENDING",
        gateway: "ngenius",
        source: source,
        paymentLink,
        ngeniusStatus: "PENDING",
        isRecurring: true,
        recurringCycle: this.getMonthlyRecurringCycle(),
        billingAttempt: 1,
        gatewayResponse: data,
      });

      return {
        orderRef,
        paymentLink,
        reference: data.reference,
      };
    } catch (error) {
      const err = error as AxiosError<ErrorResponse>;
      console.error("❌ Order creation error:", err.message);
      throw err;
    }
  }

  /**
   * Get order status from nGenius
   */
  static async getOrderStatus(reference: string): Promise<any> {
    try {
      const token = await this.getAccessToken();
      const outletId = process.env.NGENIUS_OUTLET_ID;

      if (!outletId) {
        throw new Error('NGENIUS_OUTLET_ID is not defined');
      }

      const statusURL = `${process.env.NGENIUS_API_URL}/transactions/outlets/${outletId}/orders/${reference}`;

      const response = await axios.get(statusURL, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.ni-payment.v2+json",
        },
        timeout: this.TIMEOUT,
      });

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      console.error("❌ Error fetching order status:", err.message);
      throw error;
    }
  }
}
