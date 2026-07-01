import express from "express";
import Stripe from "stripe";
import Payment from "../models/Payment";
import User from "../../UserModule/models/User";
import PaymentController from "./paymentController";
import { StripeService } from "../services/stripe.service";
import { sendRecurringPaymentFailureEmail } from "../../../services/recurringPaymentFailureEmail";
import RecurringPaymentFailure from "../models/RecurringPaymentFailure";
import { PushNotificationService } from "../../../services/pushNotification.service";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover",
});

type StripeCheckoutSession = Awaited<
  ReturnType<typeof stripe.checkout.sessions.retrieve>
>;

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw",
  "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const getSubscriptionId = (invoice: Stripe.Invoice): string | null => {
  // Stripe API v2 (2025+): subscription nested under parent.subscription_details
  const parent = (invoice as any).parent;
  if (parent?.subscription_details?.subscription) {
    const sub = parent.subscription_details.subscription;
    return typeof sub === "string" ? sub : sub.id;
  }
  // Legacy fallback
  const subscription = (invoice as any).subscription;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
};

const getInvoiceAmount = (invoice: Stripe.Invoice): number => {
  const amountInMinor = invoice.amount_paid || invoice.amount_due || 0;
  const currency = (invoice.currency || "usd").toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return amountInMinor;
  return amountInMinor / 100;
};

const getInvoiceTransactionId = (invoice: Stripe.Invoice): string | null => {
  const asAny = invoice as any;

  const paymentIntent = asAny.payment_intent;
  if (typeof paymentIntent === "string" && paymentIntent.startsWith("pi_")) {
    return paymentIntent;
  }
  if (paymentIntent?.id?.startsWith?.("pi_")) return paymentIntent.id;

  const paymentIntentFromParent = asAny.parent?.payment_intent;
  if (
    typeof paymentIntentFromParent === "string" &&
    paymentIntentFromParent.startsWith("pi_")
  ) {
    return paymentIntentFromParent;
  }
  if (paymentIntentFromParent?.id?.startsWith?.("pi_")) {
    return paymentIntentFromParent.id;
  }

  const latestCharge = paymentIntent?.latest_charge;
  if (latestCharge?.payment_intent?.id?.startsWith?.("pi_")) {
    return latestCharge.payment_intent.id;
  }
  if (
    typeof latestCharge?.payment_intent === "string" &&
    latestCharge.payment_intent.startsWith("pi_")
  ) {
    return latestCharge.payment_intent;
  }

  const charge = asAny.charge;
  if (charge?.payment_intent?.id?.startsWith?.("pi_")) {
    return charge.payment_intent.id;
  }
  if (
    typeof charge?.payment_intent === "string" &&
    charge.payment_intent.startsWith("pi_")
  ) {
    return charge.payment_intent;
  }

  const topLevelLatestCharge = asAny.latest_charge;
  if (topLevelLatestCharge?.payment_intent?.id?.startsWith?.("pi_")) {
    return topLevelLatestCharge.payment_intent.id;
  }
  if (
    typeof topLevelLatestCharge?.payment_intent === "string" &&
    topLevelLatestCharge.payment_intent.startsWith("pi_")
  ) {
    return topLevelLatestCharge.payment_intent;
  }

  const paymentRecord = asAny.payments?.data?.[0]?.payment || null;
  if (paymentRecord?.payment_intent?.id?.startsWith?.("pi_")) {
    return paymentRecord.payment_intent.id;
  }
  if (
    typeof paymentRecord?.payment_intent === "string" &&
    paymentRecord.payment_intent.startsWith("pi_")
  ) {
    return paymentRecord.payment_intent;
  }

  const paymentIntentFromPayments = asAny.payments?.data?.[0]?.payment_intent;
  if (
    typeof paymentIntentFromPayments === "string" &&
    paymentIntentFromPayments.startsWith("pi_")
  ) {
    return paymentIntentFromPayments;
  }
  if (paymentIntentFromPayments?.id?.startsWith?.("pi_")) {
    return paymentIntentFromPayments.id;
  }

  return null;
};

const getInvoicePaymentReference = (invoice: Stripe.Invoice): string => {
  const txn = getInvoiceTransactionId(invoice);
  if (txn) return txn;
  return `inv_${invoice.id}`;
};

const getCheckoutTransactionId = (
  session: StripeCheckoutSession,
): string | null => {
  const paymentIntent = session.payment_intent;
  if (!paymentIntent) return null;
  return typeof paymentIntent === "string" ? paymentIntent : paymentIntent.id;
};

const getCheckoutInvoiceId = (
  session: StripeCheckoutSession,
): string | null => {
  const invoice = session.invoice;
  if (!invoice) return null;
  return typeof invoice === "string" ? invoice : invoice.id;
};

const getChargeIdFromInvoice = (invoice: Stripe.Invoice): string | null => {
  const asAny = invoice as any;

  const charge = asAny.charge;
  if (typeof charge === "string" && charge.startsWith("ch_")) return charge;
  if (charge?.id?.startsWith?.("ch_")) return charge.id;

  const latestChargeFromPi = asAny.payment_intent?.latest_charge;
  if (
    typeof latestChargeFromPi === "string" &&
    latestChargeFromPi.startsWith("ch_")
  ) {
    return latestChargeFromPi;
  }
  if (latestChargeFromPi?.id?.startsWith?.("ch_")) return latestChargeFromPi.id;

  const latestCharge = asAny.latest_charge;
  if (typeof latestCharge === "string" && latestCharge.startsWith("ch_")) {
    return latestCharge;
  }
  if (latestCharge?.id?.startsWith?.("ch_")) return latestCharge.id;

  return null;
};

const hydrateInvoice = async (invoice: Stripe.Invoice): Promise<Stripe.Invoice> => {
  if (!invoice.id) return invoice;
  try {
    return await stripe.invoices.retrieve(invoice.id, {
      expand: [
        "payment_intent",
        "payment_intent.latest_charge",
        "charge",
        "payments",
      ],
    });
  } catch (err: any) {
    console.warn("⚠️ Failed to hydrate invoice for transaction lookup:", {
      invoiceId: invoice.id,
      error: err.message,
    });
    return invoice;
  }
};

const resolveInvoiceTransactionId = async (
  invoice: Stripe.Invoice,
): Promise<string | null> => {
  const directId = getInvoiceTransactionId(invoice);
  if (directId) return directId;

  const chargeId = getChargeIdFromInvoice(invoice);
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId, {
        expand: ["payment_intent"],
      });
      const paymentIntent = (charge as any).payment_intent;
      if (typeof paymentIntent === "string" && paymentIntent.startsWith("pi_")) {
        return paymentIntent;
      }
      if (paymentIntent?.id?.startsWith?.("pi_")) return paymentIntent.id;
    } catch (err: any) {
      console.warn("⚠️ Failed charge lookup for invoice transaction id:", {
        invoiceId: invoice.id,
        chargeId,
        error: err.message,
      });
    }
  }

  return null;
};

const resolveCheckoutPaymentIntentId = async (
  session: StripeCheckoutSession,
): Promise<string | null> => {
  const directCheckoutPi = getCheckoutTransactionId(session);
  if (directCheckoutPi?.startsWith("pi_")) {
    return directCheckoutPi;
  }

  const checkoutInvoiceId = getCheckoutInvoiceId(session);
  if (!checkoutInvoiceId) {
    return null;
  }

  try {
    const invoice = await stripe.invoices.retrieve(checkoutInvoiceId, {
      expand: [
        "payment_intent",
        "payment_intent.latest_charge",
        "charge",
        "payments",
      ],
    });

    return await resolveInvoiceTransactionId(invoice as Stripe.Invoice);
  } catch (err: any) {
    console.warn("⚠️ Failed to resolve checkout payment_intent from invoice:", {
      sessionId: session.id,
      invoiceId: checkoutInvoiceId,
      error: err.message,
    });
    return null;
  }
};

// ─── WEBHOOK ROUTER ───────────────────────────────────────────────────────────

router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event: Stripe.Event;

    if (!sig) {
      console.error("❌ Missing stripe-signature header");
      return res.status(400).send("Webhook Error: Missing stripe-signature header");
    }

    if (!webhookSecret) {
      console.error("❌ STRIPE_WEBHOOK_SECRET is not configured");
      return res
        .status(500)
        .json({ error: "Webhook misconfigured: STRIPE_WEBHOOK_SECRET missing" });
    }

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      console.log("🔔 Stripe webhook received:", {
        eventId: event.id,
        type: event.type,
        livemode: event.livemode,
      });
    } catch (err: any) {
      console.error("❌ Stripe signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {

        // ── Subscription Activation ───────────────────────────────────────
        case "checkout.session.completed": {
          const session = event.data.object as StripeCheckoutSession;
          const { orderRef } = session.metadata || {};
          const sessionInvoiceId = getCheckoutInvoiceId(session);
          const resolvedPaymentIntentId =
            await resolveCheckoutPaymentIntentId(session);

          console.log("📦 checkout.session.completed:", {
            eventId: event.id,
            orderRef,
            sessionId: session.id,
            subscriptionId: session.subscription || null,
            invoiceId: sessionInvoiceId,
            paymentIntentId: resolvedPaymentIntentId,
          });

          console.log("🔎 checkout.session.completed raw ids:", {
            eventId: event.id,
            sessionId: session.id,
            sessionInvoice: session.invoice || null,
            sessionPaymentIntent: session.payment_intent || null,
            sessionSubscription: session.subscription || null,
            resolvedPaymentIntentId,
          });

          if (!orderRef) {
            console.warn("⚠️ Missing orderRef in checkout session metadata");
            break;
          }

          const payment = await Payment.findOne({ orderRef });
          if (!payment) {
            console.warn("⚠️ Payment not found for orderRef:", orderRef);
            break;
          }

          const deferUntilRaw = (session.metadata as any)?.deferUntil;
          const deferUntilMs = deferUntilRaw
            ? Date.parse(String(deferUntilRaw))
            : NaN;
          const isDeferredUpgrade =
            Number.isFinite(deferUntilMs) &&
            deferUntilMs > Date.now() + 60 * 1000;

          payment.status = isDeferredUpgrade ? "PENDING" : "COMPLETED";

          payment.reference = session.id;
          payment.subscriptionId = session.subscription as string;
          if (resolvedPaymentIntentId?.startsWith("pi_")) {
            payment.transactionId = resolvedPaymentIntentId;
            payment.paymentIntentId = resolvedPaymentIntentId;
          } else {
            console.warn("⚠️ No pi_ payment intent resolved for checkout session", {
              eventId: event.id,
              orderRef,
              sessionId: session.id,
              resolvedPaymentIntentId: resolvedPaymentIntentId || null,
            });
          }
          payment.invoiceId = sessionInvoiceId || payment.invoiceId;
          payment.gateway = "stripe";
          payment.gatewayResponse = session;
          if (!isDeferredUpgrade) {
            payment.verifiedAt = new Date();
          }

          await payment.save();
          console.log("✅ Payment updated from checkout session:", {
            paymentId: String(payment._id),
            orderRef: payment.orderRef,
            subscriptionId: payment.subscriptionId,
            transactionId: payment.transactionId,
            status: payment.status,
          });

          const sessionCustomer = session.customer;
          const customerId =
            typeof sessionCustomer === "string"
              ? sessionCustomer
              : sessionCustomer?.id || "";
          if (customerId && payment.userId) {
            await User.findByIdAndUpdate(payment.userId, {
              stripeCustomerId: customerId,
            });
          }

          if (!isDeferredUpgrade) {
            await PaymentController.handleSuccessfulPayment(payment);
            console.log("🚀 Subscription activation handler executed:", {
              paymentId: String(payment._id),
              orderRef: payment.orderRef,
            });
          } else {
            console.log("⏳ Deferred upgrade detected; activation postponed:", {
              paymentId: String(payment._id),
              orderRef: payment.orderRef,
              deferUntil: deferUntilRaw || null,
            });
          }

          const rawPreviousSubscriptionId =
            (session.metadata as any)?.previousSubscriptionId ||
            payment.previousSubscriptionId ||
            "";
          const previousSubscriptionId = String(rawPreviousSubscriptionId).trim();
          const newSubscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id || "";

          if (previousSubscriptionId) {
            payment.previousSubscriptionId = previousSubscriptionId;
          }

          if (!isDeferredUpgrade) {
            if (
              previousSubscriptionId &&
              newSubscriptionId &&
              previousSubscriptionId !== newSubscriptionId &&
              !payment.previousSubscriptionCancelledAt
            ) {
              try {
                await StripeService.cancelSubscription(previousSubscriptionId);
                payment.previousSubscriptionCancelledAt = new Date();
                await payment.save();

                console.log("🧹 Previous Stripe subscription cancelled:", {
                  previousSubscriptionId,
                  newSubscriptionId: newSubscriptionId || null,
                  paymentId: String(payment._id),
                });
              } catch (cancelError: any) {
                console.error("❌ Failed to cancel previous Stripe subscription:", {
                  previousSubscriptionId,
                  newSubscriptionId: newSubscriptionId || null,
                  error: cancelError?.message || cancelError,
                });
              }
            } else if (
              previousSubscriptionId &&
              payment.previousSubscriptionCancelledAt
            ) {
              console.log("ℹ️ Previous subscription already cancelled:", {
                previousSubscriptionId,
                paymentId: String(payment._id),
                cancelledAt: payment.previousSubscriptionCancelledAt,
              });
            }
          }

          break;
        }

        // ── Recurring Subscription Charge Success ─────────────────────────
        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          const hydratedInvoice = await hydrateInvoice(invoice);
          const billingReason = invoice.billing_reason || "";
          const isRecurringCycle = billingReason === "subscription_cycle";

          console.log("🧾 invoice.payment_succeeded:", {
            eventId: event.id,
            invoiceId: invoice.id,
            billingReason,
            isRecurringCycle,
          });

          if (!isRecurringCycle) {
            console.log("ℹ️ Skipping non-recurring invoice.payment_succeeded");
            break;
          }

          const subscriptionId = getSubscriptionId(hydratedInvoice);
          if (!subscriptionId || !hydratedInvoice.id) {
            console.warn("⚠️ Missing subscriptionId or invoice.id in succeeded invoice");
            break;
          }

          const transactionId = await resolveInvoiceTransactionId(hydratedInvoice);

          // Idempotency: skip if already recorded
          const existingInvoicePayment = await Payment.findOne({
            invoiceId: hydratedInvoice.id,
            gateway: "stripe",
          });
          if (existingInvoicePayment) {
            console.log("ℹ️ Duplicate recurring invoice webhook ignored:", {
              invoiceId: hydratedInvoice.id,
              existingPaymentId: String(existingInvoicePayment._id),
            });
            break;
          }

          const basePayment = await Payment.findOne({
            gateway: "stripe",
            subscriptionId,
          }).sort({ createdAt: -1 });

          console.log("🔎 Base payment lookup:", {
            subscriptionId,
            found: Boolean(basePayment),
            basePaymentId: basePayment?._id?.toString() || null,
          });

          const user = basePayment?.userId
            ? await User.findById(basePayment.userId)
            : await User.findOne({ stripeSubscriptionId: subscriptionId });

          if (!user) {
            console.warn("⚠️ User not found for recurring invoice:", {
              subscriptionId,
              invoiceId: hydratedInvoice.id,
            });
            break;
          }
          const paidLocalAmount = getInvoiceAmount(hydratedInvoice);
          const amount =
            basePayment?.localAmount && basePayment.localAmount > 0
              ? Number(
                  ((paidLocalAmount * (basePayment.amount || 0)) /
                    basePayment.localAmount).toFixed(2),
                )
              : paidLocalAmount;

          // NOTE: `amount` is stored in our base currency (USD). Stripe may bill in a local
          // currency depending on the original checkout session, so keep that local currency
          // only inside the Stripe invoice payload (gatewayResponse) and use USD for emails/invoices.
          const baseCurrency = (basePayment?.currency || "USD").toUpperCase();
          const localCurrency = (
            hydratedInvoice.currency ||
            (basePayment as any)?.localCurrency ||
            "USD"
          ).toUpperCase();

          const recurringPayment = await Payment.create({
            userId: user._id,
            orderRef: `STRIPE-REC-${hydratedInvoice.id}`,
            reference: getInvoicePaymentReference(hydratedInvoice),
            amount,
            localAmount: paidLocalAmount,
            plan: basePayment?.plan || user.plan || "unknown",
            currency: baseCurrency,
            status: "COMPLETED",
            gateway: "stripe",
            billingType: basePayment?.billingType || user.billingType || "monthly",
            invoiceId: hydratedInvoice.id,
            subscriptionId,
            transactionId: transactionId || undefined,
            paymentIntentId: transactionId || undefined,
            source: basePayment?.source || "web",
            isRecurring: true,
            recurringCycle: new Date().toISOString().slice(0, 7),
            verifiedAt: new Date(),
            gatewayResponse: {
              ...(hydratedInvoice as any),
              __skyborne: {
                baseCurrency,
                localCurrency,
              },
            },
          });

          console.log("✅ Recurring payment created:", {
            paymentId: String(recurringPayment._id),
            invoiceId: hydratedInvoice.id,
            subscriptionId,
            transactionId,
            amount: recurringPayment.amount,
            currency: recurringPayment.currency,
            localCurrency,
          });

          await PaymentController.handleSuccessfulPayment(recurringPayment);
          console.log("🚀 Recurring subscription handler executed:", {
            paymentId: String(recurringPayment._id),
            userId: String(user._id),
          });

          const periodEnd =
            hydratedInvoice.lines?.data?.[0]?.period?.end ||
            (hydratedInvoice as any).period_end;

          if (periodEnd) {
            await User.findByIdAndUpdate(user._id, {
              "subscription.status": "active",
              "subscription.endDate": new Date(Number(periodEnd) * 1000),
            });
            console.log("📅 User subscription endDate updated:", {
              userId: user._id.toString(),
              periodEndUnix: Number(periodEnd),
            });
          }

          await RecurringPaymentFailure.deleteMany({
            $or: [
              { userId: user._id },
              { email: String(user.email || "").toLowerCase() },
              { subscriptionId },
            ],
          });

          break;
        }

        // ── Recurring Payment Failed ───────────────────────────────────────
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const hydratedInvoice = await hydrateInvoice(invoice);
          const billingReason = hydratedInvoice.billing_reason || "";
          const isRecurringCycle = billingReason === "subscription_cycle";
          const subscriptionId = getSubscriptionId(hydratedInvoice);
          const transactionId = await resolveInvoiceTransactionId(hydratedInvoice);

          console.log("❌ invoice.payment_failed:", {
            eventId: event.id,
            invoiceId: hydratedInvoice.id,
            subscriptionId,
            transactionId,
            billingReason: hydratedInvoice.billing_reason || null,
          });

          if (!isRecurringCycle) {
            console.log("ℹ️ Skipping non-recurring invoice.payment_failed");
            break;
          }

          if (!subscriptionId) {
            console.warn("⚠️ Missing subscriptionId in failed invoice");
            break;
          }

          const basePayment = await Payment.findOne({
            gateway: "stripe",
            subscriptionId,
          })
            .sort({ createdAt: -1 })
            .select("userId");

          const failedUser =
            (basePayment?.userId
              ? await User.findById(basePayment.userId).select(
                  "email firstName phoneNumber dialingCode localNumber",
                )
              : null) ||
            (await User.findOne({ stripeSubscriptionId: subscriptionId }).select(
              "email firstName phoneNumber dialingCode localNumber",
            ));

          const recipientEmail = String(
            failedUser?.email || (hydratedInvoice as any).customer_email || "",
          )
            .trim()
            .toLowerCase();

          if (failedUser?._id) {
            PushNotificationService.sendPaymentStatus(String(failedUser._id), {
              success: false,
              amount: getInvoiceAmount(hydratedInvoice),
              currency: String(hydratedInvoice.currency || "").toUpperCase(),
              plan: String((basePayment as any)?.plan || ""),
              invoiceId: String(hydratedInvoice.id || ""),
            }).catch((pushError: any) => {
              console.error("❌ Failed to send Stripe payment-failed push notification:", pushError?.message || pushError);
            });
          }

          if (!recipientEmail) {
            console.warn("⚠️ Failed recurring user email not found for storing");
            break;
          }

          const recipientPhoneNumber = String(
            failedUser?.phoneNumber ||
              `${failedUser?.dialingCode || ""}${failedUser?.localNumber || ""}`,
          )
            .trim()
            .replace(/\s+/g, "");

          const failedAt = new Date();
          const payload = {
            userId: failedUser?._id || undefined,
            email: recipientEmail,
            phoneNumber: recipientPhoneNumber || undefined,
            subscriptionId: subscriptionId || undefined,
            invoiceId: hydratedInvoice.id || undefined,
            status: "processing" as const,
            failedAt,
          };

          let shouldSendFailureEmail = true;
          let dedupeReason = "none";

          if (hydratedInvoice.id) {
            const existingFailureByInvoice = await RecurringPaymentFailure.findOne({
              invoiceId: hydratedInvoice.id,
            })
              .select("_id")
              .lean();

            if (existingFailureByInvoice) {
              shouldSendFailureEmail = false;
              dedupeReason = "invoice_already_recorded";
            }
          }

          if (shouldSendFailureEmail) {
            const upsertResult = await RecurringPaymentFailure.updateOne(
              {
                subscriptionId,
                status: "processing",
              },
              { $setOnInsert: payload },
              { upsert: true },
            );

            shouldSendFailureEmail = upsertResult.upsertedCount > 0;

            if (!shouldSendFailureEmail) {
              dedupeReason = "active_subscription_failure";
            }
          }

          console.log("📝 Recurring failure stored:", {
            userId: failedUser?._id?.toString() || null,
            email: recipientEmail,
            subscriptionId,
            phoneNumber: recipientPhoneNumber || null,
            invoiceId: hydratedInvoice.id || null,
            status: "processing",
            shouldSendFailureEmail,
            dedupeReason,
          });

          if (shouldSendFailureEmail) {
            try {
              await sendRecurringPaymentFailureEmail({
                to: recipientEmail,
                firstName: (failedUser as any)?.firstName || undefined,
                failedAt,
                subscriptionId: subscriptionId || undefined,
                invoiceId: hydratedInvoice.id || undefined,
                gracePeriodHours: 48,
              });

              console.log("📧 Recurring failure email sent:", {
                userId: failedUser?._id?.toString() || null,
                email: recipientEmail,
                invoiceId: hydratedInvoice.id || null,
              });
            } catch (emailError: any) {
              console.error("❌ Failed to send recurring failure email:", {
                userId: failedUser?._id?.toString() || null,
                email: recipientEmail,
                invoiceId: hydratedInvoice.id || null,
                error: emailError?.message || emailError,
              });
            }
          } else {
            console.log("ℹ️ Recurring failure email already sent for subscription:", {
              subscriptionId,
              invoiceId: hydratedInvoice.id || null,
              dedupeReason,
            });
          }

          console.log("👤 User retained for 48-hour grace period after failure:", {
            userId: failedUser?._id?.toString() || null,
          });

          break;
        }

        default:
          console.log("ℹ️ Unhandled Stripe event:", {
            eventId: event.id,
            type: event.type,
          });
      }

      console.log("✅ Stripe webhook processed:", {
        eventId: event.id,
        type: event.type,
      });
      res.status(200).json({ received: true });
    } catch (err) {
      console.error("❌ Stripe webhook processing error:", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  },
);

export default router;
