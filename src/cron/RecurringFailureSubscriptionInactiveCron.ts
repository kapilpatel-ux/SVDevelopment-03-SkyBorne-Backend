import cron from "node-cron";
import RecurringPaymentFailure from "../modules/PaymentModule/models/RecurringPaymentFailure";
import User from "../modules/UserModule/models/User";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export const runRecurringFailureSubscriptionInactiveOnce = async () => {
  try {
    const failedEntries = await RecurringPaymentFailure.find({})
      .sort({ failedAt: 1 })
      .limit(500)
      .lean();

    if (!failedEntries.length) {
      return;
    }

    const now = Date.now();
    const processedEntryIds: string[] = [];

    for (const entry of failedEntries) {
      try {
        const email = String(entry.email || "").trim().toLowerCase();
        if (!email) {
          continue;
        }

        const user = await User.findOne({ email }).select("subscription email");
        if (!user?.subscription?.endDate) {
          continue;
        }

        const endDateMs = new Date(user.subscription.endDate).getTime();
        if (Number.isNaN(endDateMs)) {
          continue;
        }

        const isPast48Hours = now - endDateMs >= FORTY_EIGHT_HOURS_MS;

        if (!isPast48Hours) {
          continue;
        }

        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              "subscription.status": "inactive",
            },
          },
        );

        processedEntryIds.push(String(entry._id));

        console.log("[RecurringFailureInactiveCron] user set to inactive", {
          userId: String(user._id),
          email,
        });
      } catch (entryError: any) {
        console.error("[RecurringFailureInactiveCron] entry processing failed", {
          entryId: String(entry._id),
          error: entryError?.message || entryError,
        });
      }
    }

    if (processedEntryIds.length > 0) {
      await RecurringPaymentFailure.deleteMany({
        _id: { $in: processedEntryIds },
      });

      console.log("[RecurringFailureInactiveCron] processed entries deleted", {
        count: processedEntryIds.length,
      });
    }
  } catch (error: any) {
    console.error("[RecurringFailureInactiveCron] run failed", error?.message || error);
  }
};

export const startRecurringFailureSubscriptionInactiveCron = () => {
  // Daily once at 12:10 AM IST
  cron.schedule(
    "10 0 * * *",
    async () => {
      await runRecurringFailureSubscriptionInactiveOnce();
    },
    {
      timezone: "Asia/Kolkata",
    },
  );

  console.log("[RecurringFailureInactiveCron] started (daily 00:10 IST)");
};
