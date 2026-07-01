import cron from "node-cron";
import RecurringPaymentFailure from "../modules/PaymentModule/models/RecurringPaymentFailure";
import Payment from "../modules/PaymentModule/models/Payment";
import User from "../modules/UserModule/models/User";
import { StripeService } from "../modules/PaymentModule/services/stripe.service";
import CancelSubscriptionModel from "../modules/CancelSubscriptionModule/CancelSubscriptionModel";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export const runRecurringFailureSubscriptionInactiveOnce = async () => {
  try {
    const failedEntries = await RecurringPaymentFailure.find({
      $or: [{ status: "processing" }, { status: { $exists: false } }],
    })
      .sort({ failedAt: 1 })
      .limit(500)
      .lean();

    if (!failedEntries.length) {
      return;
    }
    const now = Date.now();

    for (const entry of failedEntries) {
      try {
        const entryId = String(entry._id);
        const email = String(entry.email || "")
          .trim()
          .toLowerCase();
        const entrySubscriptionId = String(entry.subscriptionId || "").trim();
        const failedAtMs = new Date(entry.failedAt).getTime();

        // if (Number.isNaN(failedAtMs)) {
        //   console.warn("[RecurringFailureInactiveCron] invalid failedAt on entry", {
        //     entryId,
        //     email,
        //     failedAt: entry.failedAt,
        //   });

        //   await RecurringPaymentFailure.updateOne(
        //     { _id: entry._id },
        //     { $set: { status: "cancelled" } },
        //   );
        //   continue;
        // }

        const isPast48Hours = now - failedAtMs >= FORTY_EIGHT_HOURS_MS;

        if (!isPast48Hours) {
          continue;
        }
        const user =
          (entry.userId
            ? await User.findById(entry.userId).select(
                "subscription email stripeSubscriptionId",
              )
            : null) ||
          (email
            ? await User.findOne({ email }).select(
                "subscription email stripeSubscriptionId",
              )
            : null);

        if (!user) {
          console.warn(
            "[RecurringFailureInactiveCron] user not found for entry",
            {
              entryId,
              email,
            },
          );
        } else {
          const recoveredPaymentQuery: Record<string, any> = {
            userId: user._id,
            gateway: "stripe",
            status: "COMPLETED",
            isRecurring: true,
            verifiedAt: { $gte: new Date(failedAtMs) },
          };

          // Avoid treating payments from a different subscription as recovery.
          if (entrySubscriptionId) {
            recoveredPaymentQuery.subscriptionId = entrySubscriptionId;
          }

          const recoveredPayment = await Payment.findOne(recoveredPaymentQuery)
            .sort({ verifiedAt: -1 })
            .select("_id verifiedAt subscriptionId")
            .lean();

          if (recoveredPayment) {
            await RecurringPaymentFailure.updateOne(
              { _id: entry._id },
              { $set: { status: "cancelled" } },
            );
            console.log(
              "[RecurringFailureInactiveCron] payment recovered, entry marked cancelled",
              {
                entryId,
                userId: String(user._id),
                email,
                paymentId: String(recoveredPayment._id),
                entrySubscriptionId,
                paymentSubscriptionId: String(recoveredPayment.subscriptionId || ""),
              },
            );
            continue;
          }
        }

        let didCancelStripeSubscription = false;
        let stripeSubscriptionIdToCancel = user?.stripeSubscriptionId
          ? String(user.stripeSubscriptionId).trim()
          : "";

        if (!stripeSubscriptionIdToCancel && entrySubscriptionId) {
          stripeSubscriptionIdToCancel = entrySubscriptionId;
        }

        if (!stripeSubscriptionIdToCancel && user?._id) {
          const latestStripePayment = await Payment.findOne({
            userId: user._id,
            gateway: "stripe",
            status: "COMPLETED",
            subscriptionId: { $exists: true, $ne: null },
          })
            .sort({ createdAt: -1 })
            .select("subscriptionId")
            .lean();

          stripeSubscriptionIdToCancel = String(
            latestStripePayment?.subscriptionId || "",
          ).trim();
        }

        if (stripeSubscriptionIdToCancel) {
          try {
            await StripeService.cancelSubscription(
              stripeSubscriptionIdToCancel,
            );
            didCancelStripeSubscription = true;
            console.log(
              "[RecurringFailureInactiveCron] stripe subscription cancelled",
              {
                entryId,
                userId: user?._id ? String(user._id) : null,
                email,
                subscriptionId: stripeSubscriptionIdToCancel,
              },
            );
          } catch (stripeCancelError: any) {
            const message = String(
              stripeCancelError?.message || "",
            ).toLowerCase();
            const code = String(stripeCancelError?.code || "").toLowerCase();

            const isAlreadyCancelled =
              code === "resource_missing" ||
              message.includes("no such subscription") ||
              message.includes("already canceled") ||
              message.includes("already cancelled");

            if (!isAlreadyCancelled) {
              throw stripeCancelError;
            }

            console.warn(
              "[RecurringFailureInactiveCron] stripe subscription already cancelled/missing",
              {
                entryId,
                userId: user?._id ? String(user._id) : null,
                email,
                subscriptionId: stripeSubscriptionIdToCancel,
              },
            );
            didCancelStripeSubscription = true;
          }
        } else {
          console.warn(
            "[RecurringFailureInactiveCron] no stripe subscription id found for cancellation",
            {
              entryId,
              userId: user?._id ? String(user._id) : null,
              email,
            },
          );
        }

        if (user?._id) {
          const shouldUpdateInactiveStatus =
            user.subscription?.status !== "inactive" ||
            !!user.stripeSubscriptionId;

          if (shouldUpdateInactiveStatus) {
            const userUpdate: Record<string, any> = {
              "subscription.status": "inactive",
            };

            if (user.stripeSubscriptionId) {
              userUpdate.stripeSubscriptionId = null;
            }

            await User.updateOne(
              { _id: user._id },
              {
                $set: userUpdate,
              },
            );
          }
        }

        if (didCancelStripeSubscription) {
          if (user?._id) {
            await CancelSubscriptionModel.findOneAndUpdate(
              { userId: String(user._id), status: "pending" },
              {
                status: "cancelled",
                adminDescription: "cancelled by system",
              },
              {
                sort: { createdAt: -1 },
              },
            );
          }

          await RecurringPaymentFailure.deleteOne({ _id: entry._id });
          console.log(
            "[RecurringFailureInactiveCron] entry removed after stripe cancellation",
            {
              entryId,
              userId: user?._id ? String(user._id) : null,
              email,
            },
          );
          continue;
        }

        await RecurringPaymentFailure.updateOne(
          { _id: entry._id },
          { $set: { status: "cancelled" } },
        );

        console.log("[RecurringFailureInactiveCron] entry marked cancelled", {
          entryId,
          userId: user?._id ? String(user._id) : null,
          email,
        });
      } catch (entryError: any) {
        console.error(
          "[RecurringFailureInactiveCron] entry processing failed",
          {
            entryId: String(entry._id),
            error: entryError?.message || entryError,
          },
        );
      }
    }
  } catch (error: any) {
    console.error(
      "[RecurringFailureInactiveCron] run failed",
      error?.message || error,
    );
  }
};

export const startRecurringFailureSubscriptionInactiveCron = () => {
  // Run once on startup so pending entries are handled immediately.
  console.log("[RecurringFailureInactiveCron] startup run triggered", {
    at: new Date().toISOString(),
  });
  runRecurringFailureSubscriptionInactiveOnce().catch((error: any) => {
    console.error(
      "[RecurringFailureInactiveCron] startup run failed",
      error?.message || error,
    );
  });

  // Testing schedule: run every minute (IST timezone retained)
  cron.schedule(
    "* * * * *",
    async () => {
      console.log("[RecurringFailureInactiveCron] cron tick", {
        at: new Date().toISOString(),
      });
      await runRecurringFailureSubscriptionInactiveOnce();
    },
    {
      timezone: "Asia/Kolkata",
    },
  );

  console.log(
    "[RecurringFailureInactiveCron] started (every minute for testing)",
  );
};
