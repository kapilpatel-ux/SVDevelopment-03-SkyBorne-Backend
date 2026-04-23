  /* eslint-disable @typescript-eslint/no-explicit-any */
  import Stripe from "stripe";
  import Payment from "../models/Payment";
  import User from "../../UserModule/models/User";
  import PaymentController from "./paymentController";

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-12-15.clover" as any,
  });

  const ZERO_DECIMAL_CURRENCIES = new Set([
    "bif",
    "clp",
    "djf",
    "gnf",
    "jpy",
    "kmf",
    "krw",
    "mga",
    "pyg",
    "rwf",
    "ugx",
    "vnd",
    "vuv",
    "xaf",
    "xof",
    "xpf",
  ]);

  // ─── HELPERS ──────────────────────────────────────────────────────────────────

  function getInvoiceAmount(invoice: Stripe.Invoice): number {
    const amountInMinor = invoice.amount_paid || invoice.amount_due || 0;
    const currency = (invoice.currency || "usd").toLowerCase();
    return ZERO_DECIMAL_CURRENCIES.has(currency)
      ? amountInMinor
      : amountInMinor / 100;
  }

  function getInvoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
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
  }
  function getInvoicePaymentReference(invoice: Stripe.Invoice): string {
    return `inv_${invoice.id}`;
  }

  function getChargeIdFromInvoice(invoice: Stripe.Invoice): string | null {
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
  }

  async function resolveInvoiceTransactionId(
    invoice: Stripe.Invoice,
  ): Promise<string | null> {
    const directId = getInvoicePaymentIntentId(invoice);
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
        console.warn(
          `  ⚠️  [${invoice.id}] Failed charge lookup for ${chargeId}: ${err.message}`,
        );
      }
    }

    console.warn(`  ⚠️  [${invoice.id}] Could not resolve PaymentIntent id (pi_...)`);
    console.warn("     Context:", {
      status: invoice.status,
      billingReason: invoice.billing_reason,
      paid: (invoice as any).paid,
      amountPaid: invoice.amount_paid,
      amountDue: invoice.amount_due,
      collectionMethod: invoice.collection_method,
      chargeId: chargeId || null,
      hasPaymentIntent: Boolean((invoice as any)?.payment_intent),
      hasCharge: Boolean((invoice as any)?.charge),
      hasPaymentsArray: Boolean((invoice as any)?.payments?.data?.length),
    });
    return null;
  }

  function getSubscriptionId(invoice: Stripe.Invoice): string | null {
    // Stripe API v2 (2025+): subscription is nested under parent.subscription_details.subscription
    const parent = (invoice as any).parent;
    if (parent?.subscription_details?.subscription) {
      const sub = parent.subscription_details.subscription;
      return typeof sub === "string" ? sub : sub.id;
    }
    // Legacy fallback for older API versions
    const subscription = (invoice as any).subscription;
    if (!subscription) return null;
    return typeof subscription === "string" ? subscription : subscription.id;
  }

  // ─── TYPES ────────────────────────────────────────────────────────────────────

  interface BackfillStats {
    total: number;
    created: number;
    skipped_already_exists: number;
    skipped_not_recurring: number;
    skipped_no_user: number;
    skipped_no_subscription: number;
    failed: number;
  }

  export interface BackfillOptions {
    dryRun?: boolean;
    targetSub?: string;
    fromTs?: number;
    toTs?: number;
  }

  // ─── PROCESS SINGLE INVOICE ───────────────────────────────────────────────────

  async function processInvoice(
    invoiceSummary: Stripe.Invoice,
    isDryRun: boolean,
    stats: BackfillStats,
  ): Promise<void> {
    stats.total++;

    const invoiceId = invoiceSummary.id;

    // Pre-filter using list-level fields (no extra API call needed)
    if (invoiceSummary.billing_reason !== "subscription_cycle") {
      stats.skipped_not_recurring++;
      return;
    }

    if (invoiceSummary.status !== "paid") {
      console.log(
        `  ⏭  [${invoiceId}] Not paid (status=${invoiceSummary.status}) — skip`,
      );
      stats.skipped_not_recurring++;
      return;
    }

    // Idempotency check before making extra API call
    const existing = await Payment.findOne({ invoiceId, gateway: "stripe" });
    if (existing) {
      console.log(`  ✅ [${invoiceId}] Already in DB — skip`);
      stats.skipped_already_exists++;
      return;
    }

    // Fetch full invoice individually — list endpoint doesn't return subscription/payment_intent
    let invoice: Stripe.Invoice;
    try {
      invoice = await stripe.invoices.retrieve(invoiceId, {
        expand: [
          "payment_intent",
          "payment_intent.latest_charge",
          "charge",
          "payments",
        ],
      });
    } catch (err: any) {
      console.error(
        `  ❌ [${invoiceId}] Failed to retrieve full invoice:`,
        err.message,
      );
      stats.failed++;
      return;
    }

    const subscriptionId = getSubscriptionId(invoice);

    if (!subscriptionId) {
      console.warn(
        `  ⚠️  [${invoiceId}] No subscriptionId on full invoice — skip`,
      );
      stats.skipped_no_subscription++;
      return;
    }

    const basePayment = await Payment.findOne({
      gateway: "stripe",
      subscriptionId,
    }).sort({ createdAt: 1 });

    // 1st: user from base payment
    // 2nd: user from stripeSubscriptionId
    // 3rd: user from stripeCustomerId (covers cases where sub was created before we stored subscriptionId)
    const stripeCustomerId = (invoice as any).customer;
    const user =
      (basePayment?.userId ? await User.findById(basePayment.userId) : null) ||
      (await User.findOne({ stripeSubscriptionId: subscriptionId })) ||
      (stripeCustomerId ? await User.findOne({ stripeCustomerId }) : null);

    if (!user) {
      console.warn(
        `  ❌ [${invoiceId}] No user found for subscription ${subscriptionId} ` +
          `or customer ${stripeCustomerId || "N/A"} — skip`,
      );
      stats.skipped_no_user++;
      return;
    }

    const paidLocalAmount = getInvoiceAmount(invoice);
    const amount =
      basePayment?.localAmount && basePayment.localAmount > 0
        ? Number(
            (
              (paidLocalAmount * (basePayment.amount || 0)) /
              basePayment.localAmount
            ).toFixed(2),
          )
        : paidLocalAmount;

    const transactionId = await resolveInvoiceTransactionId(invoice);
    const invoiceDate = new Date(invoice.created * 1000);
    const recurringCycle = invoiceDate.toISOString().slice(0, 7); // "YYYY-MM"

    const periodEnd =
      invoice.lines?.data?.[0]?.period?.end || (invoice as any).period_end;

    if (isDryRun) {
      console.log(
        `  🔍 [DRY RUN] Would create:\n` +
          `     invoiceId     : ${invoiceId}\n` +
          `     orderRef      : STRIPE-REC-${invoiceId}\n` +
          `     userId        : ${user._id}\n` +
          `     subscriptionId: ${subscriptionId}\n` +
          `     transactionId : ${transactionId || "N/A"}\n` +
          `     amount        : ${amount} ${(invoice.currency || "USD").toUpperCase()}\n` +
          `     localAmount   : ${paidLocalAmount}\n` +
          `     recurringCycle: ${recurringCycle}\n` +
          `     plan          : ${basePayment?.plan || (user as any).plan || "unknown"}\n` +
          `     billingType   : ${basePayment?.billingType || (user as any).billingType || "monthly"}\n` +
          `     invoiceDate   : ${invoiceDate.toISOString()}`,
      );
      stats.created++;
      return;
    }

    try {
      const baseCurrency = (basePayment?.currency || "USD").toUpperCase();
      const localCurrency = (
        invoice.currency ||
        basePayment?.currency ||
        "USD"
      ).toUpperCase();

      const recurringPayment = await Payment.create({
        userId: user._id,
        orderRef: `STRIPE-REC-${invoiceId}`,
        reference: transactionId || getInvoicePaymentReference(invoice),
        amount,
        localAmount: paidLocalAmount,
        plan: basePayment?.plan || (user as any).plan || "unknown",
        currency: baseCurrency,
        status: "COMPLETED",
        gateway: "stripe",
        billingType:
          basePayment?.billingType || (user as any).billingType || "monthly",
        invoiceId,
        subscriptionId,
        transactionId: transactionId || undefined,
        paymentIntentId: transactionId || undefined,
        source: basePayment?.source || "web",
        isRecurring: true,
        recurringCycle,
        verifiedAt: new Date(
          invoice.status_transitions?.paid_at
            ? invoice.status_transitions.paid_at * 1000
            : invoice.created * 1000,
        ),
        gatewayResponse: {
          ...(invoice as any),
          __skyborne: {
            baseCurrency,
            localCurrency,
          },
        },
      });

      await PaymentController.handleSuccessfulPayment(recurringPayment);

      if (periodEnd) {
        await User.findByIdAndUpdate(user._id, {
          "subscription.status": "active",
          "subscription.endDate": new Date(Number(periodEnd) * 1000),
        });
      }

      console.log(
        `  ✅ Created | invoiceId=${invoiceId} | user=${user._id} | ` +
          `amount=${amount} ${recurringPayment.currency} | cycle=${recurringCycle} | ` +
          `txn=${transactionId || "N/A"}`,
      );
      stats.created++;
    } catch (err: any) {
      if (err?.code === 11000) {
        const keyPattern = err?.keyPattern ? JSON.stringify(err.keyPattern) : "unknown";
        const keyValue = err?.keyValue ? JSON.stringify(err.keyValue) : "unknown";
        console.warn(
          `  ⚠️  [${invoiceId}] Duplicate key (${keyPattern} => ${keyValue}) — skip`,
        );
        stats.skipped_already_exists++;
      } else {
        console.error(`  ❌ [${invoiceId}] Error:`, err.message);
        stats.failed++;
      }
    }
  }

  // ─── EXPORTED MAIN FUNCTION ───────────────────────────────────────────────────

  export async function backfillStripeRecurringPayments(
    options: BackfillOptions = {},
  ): Promise<BackfillStats> {
    const { dryRun = true, targetSub, fromTs, toTs } = options;

    const stats: BackfillStats = {
      total: 0,
      created: 0,
      skipped_already_exists: 0,
      skipped_not_recurring: 0,
      skipped_no_user: 0,
      skipped_no_subscription: 0,
      failed: 0,
    };

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  STRIPE RECURRING PAYMENTS BACKFILL");
    console.log(
      `  Mode          : ${dryRun ? "🔍 DRY RUN (no DB writes)" : "🔴 LIVE (writing to DB)"}`,
    );
    if (targetSub) console.log(`  Filter sub    : ${targetSub}`);
    if (fromTs)
      console.log(`  From          : ${new Date(fromTs * 1000).toISOString()}`);
    if (toTs)
      console.log(`  To            : ${new Date(toTs * 1000).toISOString()}`);
    console.log("═══════════════════════════════════════════════════════════\n");

    const listParams: any = { status: "paid", limit: 100 };

    if (fromTs || toTs) {
      listParams.created = {};
      if (fromTs) listParams.created.gte = fromTs;
      if (toTs) listParams.created.lte = toTs;
    }

    if (targetSub) listParams.subscription = targetSub;

    console.log("📦 Fetching invoice list from Stripe...\n");

    let pageCount = 0;
    let hasMore = true;
    let startingAfter: string | undefined = undefined;

    while (hasMore) {
      const params: any = { ...listParams };
      if (startingAfter) params.starting_after = startingAfter;

      const page = await stripe.invoices.list(params);
      pageCount++;

      const cycleCount = page.data.filter(
        (inv) => inv.billing_reason === "subscription_cycle",
      ).length;

      console.log(
        `📄 Page ${pageCount}: ${page.data.length} total | ` +
          `${cycleCount} subscription_cycle`,
      );

      for (const invoice of page.data) {
        await processInvoice(invoice, dryRun, stats);
      }

      hasMore = page.has_more;
      startingAfter =
        page.data.length > 0 ? page.data[page.data.length - 1].id : undefined;

      if (!startingAfter) hasMore = false;
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  BACKFILL COMPLETE ${dryRun ? "(DRY RUN)" : "(LIVE)"}`);
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Total invoices scanned     : ${stats.total}`);
    console.log(
      `  ${dryRun ? "Would create" : "Created"} payments        : ${stats.created}`,
    );
    console.log(`  Skipped (already in DB)    : ${stats.skipped_already_exists}`);
    console.log(`  Skipped (not recurring)    : ${stats.skipped_not_recurring}`);
    console.log(
      `  Skipped (no subscription)  : ${stats.skipped_no_subscription}`,
    );
    console.log(`  Skipped (no user found)    : ${stats.skipped_no_user}`);
    console.log(`  Failed                     : ${stats.failed}`);
    console.log("═══════════════════════════════════════════════════════════\n");

    if (dryRun && stats.created > 0) {
      console.log(
        `✅ Dry run done. Re-run with --live to write ${stats.created} records.\n`,
      );
    }

    return stats;
  }
