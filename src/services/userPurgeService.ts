import cron from "node-cron";
import User from "../modules/UserModule/models/User";
import Payment from "../modules/PaymentModule/models/Payment";
import MeetingParticipant from "../modules/MeetingModule/MeetingModels/MeetingParticipant";
import MeetingAttendance from "../modules/MeetingModule/MeetingModels/MeetingAttendance";
import { Feedback } from "../modules/FeedbackModule/FeedbackModel";
import UserSubscription from "../modules/PaymentModule/models/Subscription";

/**
 * Permanently remove anonymized users whose records were anonymized more than `days` days ago.
 * Criteria: user.email starts with "deleted+" and ends with "@remove.local" and updatedAt < cutoff
 */
export async function purgeAnonymizedUsers(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const users = await User.find({
    email: { $regex: /^deleted\+.*@remove\.local$/i },
    updatedAt: { $lt: cutoff },
  }).select("_id");

  if (!users || users.length === 0) return { deletedCount: 0 };

  const ids = users.map((u) => u._id);

  // Delete related records again (safe to call multiple times)
  await Promise.all([
    Payment.deleteMany({ userId: { $in: ids } }),
    UserSubscription.deleteMany({ userId: { $in: ids } }),
    MeetingParticipant.deleteMany({ userId: { $in: ids } }),
    MeetingAttendance.deleteMany({ user: { $in: ids } }),
    Feedback.deleteMany({ userId: { $in: ids } }),
  ]);

  const result = await User.deleteMany({ _id: { $in: ids } });

  return { deletedCount: result.deletedCount || ids.length };
}

/**
 * Initialize a daily cron job that purges anonymized users older than configured days.
 * Runs at 03:30 UTC by default.
 */
export function startUserPurgeCron(days = 30) {
  // Run daily at 03:30
  cron.schedule("30 3 * * *", async () => {
    try {
      const res = await purgeAnonymizedUsers(days);
      console.log(`User purge job completed, deleted: ${res.deletedCount}`);
    } catch (err) {
      console.error("Error running user purge job:", err);
    }
  });
}

export default purgeAnonymizedUsers;
