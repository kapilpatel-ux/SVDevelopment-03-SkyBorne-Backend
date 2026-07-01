import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import User from "../../UserModule/models/User";
import Payment from "../models/Payment";

async function main() {
  await mongoose.connect(process.env.MONGO_URI!);
  console.log("✅ Connected\n");

  // Find all payments that have a subscriptionId (these are the ones we can test with)
  const paymentsWithSub = await Payment.find({
    gateway: "stripe",
    subscriptionId: { $exists: true, $ne: null },
    status: "COMPLETED",
  }).select("orderRef subscriptionId invoiceId amount currency userId").limit(10);

  console.log(`── Payments WITH subscriptionId (${paymentsWithSub.length} found) ──`);
  for (const p of paymentsWithSub) {
    const user = await User.findById(p.userId).select("email stripeCustomerId stripeSubscriptionId");
    console.log(`\n  orderRef     : ${p.orderRef}`);
    console.log(`  subscriptionId: ${(p as any).subscriptionId}`);
    console.log(`  amount       : ${p.amount} ${p.currency}`);
    console.log(`  user email   : ${user?.email || "NOT FOUND"}`);
    console.log(`  stripeCustomerId: ${(user as any)?.stripeCustomerId || "NULL"}`);
  }

  // Count how many subscription_cycle invoices exist in Stripe for these subs
  // (we'll just list the sub IDs for you to test with)
  console.log("\n── Subscription IDs to test backfill with ──");
  const uniqueSubs = [...new Set(paymentsWithSub.map(p => (p as any).subscriptionId))];
  uniqueSubs.forEach(sid => console.log(`  --sub=${sid}`));

  await mongoose.disconnect();
  console.log("\n🔌 Disconnected");
}

main().catch(console.error);