/**
 * ============================================================
 * main.ts  —  Backfill runner
 * Location: src/modules/PaymentModule/controllers/main.ts
 * ============================================================
 *
 * HOW TO RUN (from project root):
 *
 *   DRY RUN (safe preview, no DB writes):
 *     npx ts-node -r tsconfig-paths/register src/modules/PaymentModule/controllers/main.ts
 *     npx ts-node -r tsconfig-paths/register src/modules/PaymentModule/controllers/main.ts --dry
 *
 *   LIVE (writes to DB — run after dry run looks correct):
 *     npx ts-node -r tsconfig-paths/register src/modules/PaymentModule/controllers/main.ts --live
 *
 *   Target a single subscription:
 *     npx ts-node -r tsconfig-paths/register src/modules/PaymentModule/controllers/main.ts --live --sub=sub_xxx
 *
 *   Limit by date range (unix timestamps):
 *     npx ts-node -r tsconfig-paths/register src/modules/PaymentModule/controllers/main.ts --live --from=1700000000 --to=1710000000
 * ============================================================
 */

import dotenv from "dotenv";
dotenv.config(); // ← must load env BEFORE any imports that use process.env

import mongoose from "mongoose";
import { backfillStripeRecurringPayments } from "./backfillStripeRecurringpayments"; 

// ─── Parse CLI flags ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const IS_DRY_RUN = !args.includes("--live"); // default = dry run (safe)
const TARGET_SUB = args.find((a) => a.startsWith("--sub="))?.split("=")[1];
const FROM_TS = args.find((a) => a.startsWith("--from="))
  ? Number(args.find((a) => a.startsWith("--from="))!.split("=")[1])
  : undefined;
const TO_TS = args.find((a) => a.startsWith("--to="))
  ? Number(args.find((a) => a.startsWith("--to="))!.split("=")[1])
  : undefined;

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const MONGO_URI = process.env.MONGO_URI;

  if (!MONGO_URI) {
    console.error("❌ MONGO_URI is not set in .env");
    process.exit(1);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("❌ STRIPE_SECRET_KEY is not set in .env");
    process.exit(1);
  }

  // Connect to MongoDB (reuses your existing DB config pattern)
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB\n");

  // Run the backfill
  await backfillStripeRecurringPayments({
    dryRun: IS_DRY_RUN,
    targetSub: TARGET_SUB,
    fromTs: FROM_TS,
    toTs: TO_TS,
  });

  await mongoose.disconnect();
  console.log("🔌 Disconnected from MongoDB");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});