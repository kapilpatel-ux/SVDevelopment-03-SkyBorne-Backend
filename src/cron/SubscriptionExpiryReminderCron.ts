import cron from "node-cron";
import User from "../modules/UserModule/models/User";
import { sendSubscriptionExpiryReminderEmail } from "../services/subscriptionExpiryReminderEmail";

const REMINDER_DAYS_BEFORE = 7;

const getTargetDateRange = () => {
  const now = new Date();
  const target = new Date(now);
  target.setUTCDate(target.getUTCDate() + REMINDER_DAYS_BEFORE);

  const start = new Date(target);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(target);
  end.setUTCHours(23, 59, 59, 999);

  return { start, end };
};

export const runSubscriptionExpiryReminderOnce = async () => {
  try {
    const { start, end } = getTargetDateRange();

    const users = await User.find({
      isActive: true,
      isEmailVerified: true,
      "subscription.status": "active",
      "subscription.endDate": {
        $gte: start,
        $lte: end,
      },
    }).select("firstName email plan subscription");

    if (!users.length) {
      return;
    }

    for (const user of users) {
      try {
        const endDate = user.subscription?.endDate;
        if (!endDate) {
          continue;
        }

        const alreadySentFor = user.subscription?.expiryReminderSentFor;
        if (
          alreadySentFor instanceof Date &&
          alreadySentFor.getTime() === endDate.getTime()
        ) {
          continue;
        }

        await sendSubscriptionExpiryReminderEmail({
          to: user.email,
          firstName: user.firstName,
          plan: user.plan,
          expiryDate: endDate,
          autoRenewDate: endDate,
          daysRemaining: REMINDER_DAYS_BEFORE,
        });

        await User.updateOne(
          { _id: user._id },
          { $set: { "subscription.expiryReminderSentFor": endDate } },
        );

        console.log(
          `[SubscriptionReminder] Sent 7-day reminder to ${user.email} for expiry ${endDate.toISOString()}`,
        );
      } catch (innerError: any) {
        console.error(
          `[SubscriptionReminder] Failed for user ${user.email}:`,
          innerError?.message || innerError,
        );
      }
    }
  } catch (error: any) {
    console.error(
      "[SubscriptionReminder] Cron run failed:",
      error?.message || error,
    );
  }
};

export const startSubscriptionExpiryReminderCron = () => {
  // Runs daily at 9:15 AM IST
  cron.schedule(
    "15 9 * * *",
    async () => {
      await runSubscriptionExpiryReminderOnce();
    },
    {
      timezone: "Asia/Kolkata",
    },
  );

  console.log("[SubscriptionReminder] Cron started (daily 09:15 IST)");
};
