// src/services/cron/ClassReminderCron.ts
import cron from "node-cron";
import Meeting from "../modules/MeetingModule/MeetingModels/Meeting";
import { ClassReminderService } from "../services/classReminderService";

/**
 * Cron Job: Check for upcoming classes and send reminders.
 * Runs every minute and sends reminders for configured offsets.
 */
export const startClassReminderCron = () => {
  console.log("🚀 Starting Class Reminder Cron Job...");

  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      console.log("⏰ Cron started:", new Date().toISOString());
      const reminderConfigs = [
        { minutesBefore: 30, flag: "reminder30MinSent" as const },
        { minutesBefore: 24 * 60, flag: "reminder24HourSent" as const },
      ];

      for (const reminder of reminderConfigs) {
        const timeWindow = {
          start: new Date(now.getTime() + (reminder.minutesBefore - 5) * 60 * 1000),
          end: new Date(now.getTime() + (reminder.minutesBefore + 5) * 60 * 1000),
        };

        const upcomingMeetings = await Meeting.find({
          localTime: {
            $gte: timeWindow.start,
            $lte: timeWindow.end,
          },
          [reminder.flag]: { $ne: true },
        }).select(
          "_id title liveRegion liveTime localTime reminder24HourSent reminder30MinSent reminder10MinSent",
        );

        if (upcomingMeetings.length > 0) {
          console.log(
            `⏰ Found ${upcomingMeetings.length} class(es) for ${reminder.minutesBefore} minutes reminder`,
          );
        }

        for (const meeting of upcomingMeetings) {
          let claimed = false;
          try {
            const claim = await Meeting.findOneAndUpdate(
              { _id: meeting._id, [reminder.flag]: { $ne: true } },
              { $set: { [reminder.flag]: true } },
            ).select("_id");

            if (!claim) {
              console.log(
                `⏭️ Skipping ${reminder.minutesBefore} minute reminder for meeting ${meeting._id} (already claimed)`,
              );
              continue;
            }
            claimed = true;

            await ClassReminderService.sendClassReminder(
              (meeting._id as string).toString(),
              reminder.minutesBefore,
            );

            console.log(
              `✅ ${reminder.minutesBefore} minute reminder sent and marked for meeting ${meeting._id}`,
            );
          } catch (error) {
            console.error(
              `❌ Error processing ${reminder.minutesBefore} minute reminder for meeting ${meeting._id}:`,
              error,
            );
            if (claimed) {
              await Meeting.updateOne(
                { _id: meeting._id },
                { $set: { [reminder.flag]: false } },
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Error in Class Reminder Cron Job:", error);
    }
  });

  console.log("✅ Class Reminder Cron Job Started (runs every minute)");
};


/**
 * Stop the cron job (if needed)
 */
export const stopClassReminderCron = () => {
  console.log("🛑 Stopping Class Reminder Cron Job");
  // Cron jobs from node-cron are automatically stopped on process exit
};
