import cron from "node-cron";
import User from "../modules/UserModule/models/User";
import { PushNotificationService } from "../services/pushNotification.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS = new Set([7, 1]);

const toUtcDayStart = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const computeDaysLeft = (endDate: Date, now: Date) => {
  const endDay = toUtcDayStart(endDate).getTime();
  const nowDay = toUtcDayStart(now).getTime();
  return Math.ceil((endDay - nowDay) / DAY_MS);
};

export const runSubscriptionExpiryReminderOnce = async () => {
  const now = new Date();

  const activeUsers = await User.find({
    "subscription.status": "active",
    "subscription.endDate": { $ne: null },
    isActive: true,
    isEmailVerified: true,
  }).select("_id subscription.endDate");

  for (const user of activeUsers) {
    const endDate = user?.subscription?.endDate
      ? new Date(user.subscription.endDate)
      : null;

    if (!endDate || Number.isNaN(endDate.getTime())) continue;

    const daysLeft = computeDaysLeft(endDate, now);
    if (!REMINDER_DAYS.has(daysLeft)) continue;

    const dedupeKey = [
      "subscription-expiry",
      String(user._id),
      String(daysLeft),
      toUtcDayStart(endDate).toISOString().slice(0, 10),
    ].join(":");

    try {
      await PushNotificationService.sendSubscriptionExpiryReminder(
        String(user._id),
        daysLeft,
        endDate,
        dedupeKey,
      );
    } catch (error: any) {
      console.error("❌ [SubscriptionExpiryReminderCron] Failed to send reminder:", {
        userId: String(user._id),
        daysLeft,
        error: error?.message || error,
      });
    }
  }
};

export const startSubscriptionExpiryReminderCron = () => {
  console.log("[SubscriptionExpiryReminderCron] startup run triggered");
  runSubscriptionExpiryReminderOnce().catch((error: any) => {
    console.error("[SubscriptionExpiryReminderCron] startup run failed", error?.message || error);
  });

  // Daily at 09:00 UTC
  cron.schedule("0 9 * * *", async () => {
    await runSubscriptionExpiryReminderOnce();
  });

  console.log("[SubscriptionExpiryReminderCron] started (daily at 09:00 UTC)");
};
