// src/services/email/initializeEmailServices.ts
import { startClassReminderCron } from "../cron/ClassReminderCron";
import { startSubscriptionExpiryReminderCron } from "../cron/SubscriptionExpiryReminderCron";

export const initializeEmailServices = () => {
  console.log("📧 Initializing email services...");
  try {
    console.log("ℹ️ Skipping class reminder processor in server (dedicated worker expected)");
    startClassReminderCron();
    startSubscriptionExpiryReminderCron();
    console.log("✅ All email services initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing email services:", error);
    throw error;
  }
};
