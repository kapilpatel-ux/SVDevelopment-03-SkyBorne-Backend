import dotenv from "dotenv";
dotenv.config();
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover" as any,
});

async function main() {
  const invoice = await stripe.invoices.retrieve("in_1T2wH139om0H69ZJnqpTuaP1", {
    expand: ["subscription", "payment_intent"],
  });

  console.log("FULL INVOICE KEYS:", Object.keys(invoice));
  console.log("subscription:", (invoice as any).subscription);
  console.log("parent:", (invoice as any).parent);
  console.log("billing_reason:", invoice.billing_reason);
  console.log("issuing_credit_note:", (invoice as any).issuing_credit_note);

  // Print everything except lines (too long)
  const { lines, ...rest } = invoice as any;
  console.log("\n--- Full invoice ---");
  console.log(JSON.stringify(rest, null, 2));
}

main().catch(console.error);