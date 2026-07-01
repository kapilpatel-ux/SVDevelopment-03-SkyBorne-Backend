import dotenv from "dotenv";
import http, { IncomingHttpHeaders } from "http";
import https from "https";
import mongoose from "mongoose";
import Stripe from "stripe";

dotenv.config();

interface CliOptions {
  endpoint: string;
  invoiceId: string;
  subscriptionId: string;
  customerEmail: string;
  phoneNumber: string;
  status: "processing" | "cancelled";
  currency: string;
  amountDue: number;
  sendTwice: boolean;
  checkDb: boolean;
}

interface WebhookResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const cliArgs = process.argv.slice(2);

const hasFlag = (flag: string): boolean => cliArgs.includes(flag);

const getArgValue = (name: string): string | undefined => {
  const prefix = `${name}=`;
  const arg = cliArgs.find((entry) => entry.startsWith(prefix));
  if (!arg) return undefined;
  return arg.slice(prefix.length);
};

const printUsage = () => {
  console.log(`
Usage:
  npm run test:webhook:stripe-failed -- [options]

Options:
  --endpoint=<url>         Default: http://localhost:<PORT>/webhooks/stripe
  --invoice-id=<id>        Default: in_test_failed_<timestamp>
  --subscription-id=<id>   Default: sub_test_123
  --customer-email=<email> Default: test+failed@example.com
  --phone-number=<value>   Default: +10000000000
  --status=<value>         Default: processing (processing|cancelled)
  --currency=<code>        Default: usd
  --amount-due=<minor>     Default: 1000
  --twice                  Send the same webhook payload twice
  --check-db               Query MongoDB for RecurringPaymentFailure/Payment
  --help                   Show this usage
`);
};

const parseOptions = (): CliOptions => {
  const endpoint =
    getArgValue("--endpoint") ||
    `http://localhost:${process.env.PORT || "8000"}/webhooks/stripe`;

  const timestampSuffix = Date.now();
  const invoiceId =
    getArgValue("--invoice-id") || `in_test_failed_${timestampSuffix}`;
  const subscriptionId =
    getArgValue("--subscription-id") || "sub_test_123";
  const customerEmail =
    getArgValue("--customer-email") || "test+failed@example.com";
  const phoneNumber = getArgValue("--phone-number") || "+10000000000";
  const statusArg = (getArgValue("--status") || "processing").toLowerCase();
  const validStatuses = ["processing", "cancelled"] as const;
  if (!validStatuses.includes(statusArg as (typeof validStatuses)[number])) {
    throw new Error("Invalid --status. Allowed values: processing, cancelled");
  }

  const currency = (getArgValue("--currency") || "usd").toLowerCase();

  const amountDueArg = getArgValue("--amount-due");
  const amountDue = amountDueArg ? Number(amountDueArg) : 1000;

  if (!Number.isFinite(amountDue) || amountDue < 0) {
    throw new Error("Invalid --amount-due. Use a non-negative integer.");
  }

  return {
    endpoint,
    invoiceId,
    subscriptionId,
    customerEmail,
    phoneNumber,
    status: statusArg as "processing" | "cancelled",
    currency,
    amountDue,
    sendTwice: hasFlag("--twice"),
    checkDb: hasFlag("--check-db"),
  };
};

const buildFailedInvoiceEvent = (options: CliOptions) => ({
  id: `evt_test_invoice_payment_failed_${Date.now()}`,
  object: "event",
  type: "invoice.payment_failed",
  livemode: false,
  data: {
    object: {
      id: options.invoiceId,
      object: "invoice",
      billing_reason: "subscription_cycle",
      subscription: options.subscriptionId,
      customer_email: options.customerEmail,
      customer_phone: options.phoneNumber,
      status: options.status,
      currency: options.currency,
      amount_due: options.amountDue,
      amount_paid: 0,
      metadata: {
        phoneNumber: options.phoneNumber,
        status: options.status,
      },
    },
  },
});

const postWebhook = async (
  endpoint: string,
  rawPayload: string,
  signature: string,
): Promise<WebhookResponse> => {
  const url = new URL(endpoint);
  const useHttps = url.protocol === "https:";
  const client = useHttps ? https : http;

  const requestOptions: http.RequestOptions = {
    method: "POST",
    hostname: url.hostname,
    port: url.port ? Number(url.port) : useHttps ? 443 : 80,
    path: `${url.pathname}${url.search}`,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(rawPayload),
      "stripe-signature": signature,
    },
  };

  return new Promise<WebhookResponse>((resolve, reject) => {
    const req = client.request(requestOptions, (res) => {
      let body = "";
      res.setEncoding("utf8");

      res.on("data", (chunk: string) => {
        body += chunk;
      });

      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
        });
      });
    });

    req.on("error", reject);
    req.write(rawPayload);
    req.end();
  });
};

const logResponse = (attempt: number, response: WebhookResponse) => {
  console.log(`\n[Attempt ${attempt}] Response status: ${response.statusCode}`);
  console.log(`[Attempt ${attempt}] Response body: ${response.body || "<empty>"}`);
};

const verifyDbState = async (
  invoiceId: string,
  expected: Pick<CliOptions, "status" | "phoneNumber">,
) => {
  if (!process.env.MONGO_URI) {
    console.warn(
      "\n[DB CHECK] Skipped: MONGO_URI is not set. Add it to use --check-db.",
    );
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const [{ default: Payment }, { default: RecurringPaymentFailure }] =
      await Promise.all([
        import("../modules/PaymentModule/models/Payment"),
        import("../modules/PaymentModule/models/RecurringPaymentFailure"),
      ]);

    const failureCount = await RecurringPaymentFailure.countDocuments({ invoiceId });
    const paymentCount = await Payment.countDocuments({ invoiceId });
    const failureDoc = await RecurringPaymentFailure.findOne({ invoiceId }).lean();

    console.log("\n[DB CHECK] Results");
    console.log(`- RecurringPaymentFailure count for invoice: ${failureCount}`);
    console.log(`- Payment count for invoice: ${paymentCount}`);
    console.log(
      `- Stored status: ${
        (failureDoc as any)?.status ?? "<missing>"
      } (expected ${expected.status})`,
    );
    console.log(
      `- Stored phoneNumber: ${
        (failureDoc as any)?.phoneNumber ?? "<missing>"
      } (requested ${expected.phoneNumber})`,
    );
    console.log("- RecurringPaymentFailure document:");
    console.log(failureDoc || null);
  } finally {
    await mongoose.disconnect();
  }
};

const main = async () => {
  if (hasFlag("--help")) {
    printUsage();
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required in environment.");
  }

  const options = parseOptions();

  const eventPayload = buildFailedInvoiceEvent(options);
  const rawPayload = JSON.stringify(eventPayload);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: rawPayload,
    secret: webhookSecret,
    timestamp: Math.floor(Date.now() / 1000),
  });

  console.log("Sending webhook test payload...");
  console.log(`- Endpoint: ${options.endpoint}`);
  console.log(`- Invoice ID: ${options.invoiceId}`);
  console.log(`- Subscription ID: ${options.subscriptionId}`);
  console.log(`- Customer email: ${options.customerEmail}`);
  console.log(`- Phone number: ${options.phoneNumber}`);
  console.log(`- Status: ${options.status}`);
  console.log(`- Send twice: ${options.sendTwice}`);
  console.log(`- Check DB: ${options.checkDb}`);

  const firstResponse = await postWebhook(options.endpoint, rawPayload, signature);
  logResponse(1, firstResponse);

  if (options.sendTwice) {
    const secondResponse = await postWebhook(
      options.endpoint,
      rawPayload,
      signature,
    );
    logResponse(2, secondResponse);
  }

  if (options.checkDb) {
    await verifyDbState(options.invoiceId, {
      status: options.status,
      phoneNumber: options.phoneNumber,
    });
  }
};

main().catch((error: any) => {
  console.error("\nWebhook test failed:", error?.message || error);
  process.exit(1);
});
