// src/services/email/initializeEmailServices.ts
import { startClassReminderCron } from "../cron/ClassReminderCron";
import { startSubscriptionExpiryReminderCron } from "../cron/SubscriptionExpiryReminderCron";

/**
 * Initialize all email-related services and cron jobs
 * Call this once when your application starts
 */
export const initializeEmailServices = () => {
  console.log("📧 Initializing email services...");

  try {
    const isProduction =
      process.env.APP_ENV === "production" ||
      process.env.NODE_ENV === "production";
    const shouldProcessClassReminderInServer =
      process.env.CLASS_REMINDER_PROCESS_IN_SERVER === "true" || !isProduction;

    if (shouldProcessClassReminderInServer) {
      // Register class-reminder queue processor in the API server process.
      // In production, this should usually be handled by the dedicated worker process.
      require("./classReminderEmail");
      console.log(
        "📨 Class reminder queue processor registered in server process",
      );
    } else {
      console.log(
        "ℹ️ Skipping class reminder processor in server (dedicated worker expected)",
      );
    }

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
