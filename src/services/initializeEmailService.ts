// src/services/email/initializeEmailServices.ts
import { startClassReminderCron } from "../cron/ClassReminderCron";
import { startSubscriptionExpiryReminderCron } from "../cron/SubscriptionExpiryReminderCron";
// import "./classReminderEmail"; // Import to start processing the queue

/**
 * Initialize all email-related services and cron jobs
 * Call this once when your application starts
 */
export const initializeEmailServices = () => {
  console.log("📧 Initializing email services...");

  try {
    // Start the class reminder cron job
    startClassReminderCron();
    startSubscriptionExpiryReminderCron();

    console.log("✅ All email services initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing email services:", error);
    throw error;
  }
};

/**
 * Usage in your main app file (e.g., server.ts or index.ts):
 *
 * import { initializeEmailServices } from "./services/email/initializeEmailServices";
 *
 * // After setting up your Express app and connecting to MongoDB:
 * initializeEmailServices();
 */