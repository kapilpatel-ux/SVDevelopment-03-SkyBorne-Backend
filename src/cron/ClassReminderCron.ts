// src/services/cron/ClassReminderCron.ts
import cron from "node-cron";
import Meeting from "../modules/MeetingModule/MeetingModels/Meeting";
import { ClassReminderService } from "../services/classReminderService";

/**
 * Cron Job: Check for upcoming classes and send reminders 10 minutes before
 * Runs every minute to check if any class is starting in the next 10-15 minutes
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
        { minutesBefore: 10, flag: "reminder10MinSent" as const },
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
        }).select("_id title liveRegion liveTime localTime reminder30MinSent reminder10MinSent");

        if (upcomingMeetings.length > 0) {
          console.log(
            `⏰ Found ${upcomingMeetings.length} class(es) for ${reminder.minutesBefore} minutes reminder`,
          );
        }

        for (const meeting of upcomingMeetings) {
          try {
            await ClassReminderService.sendClassReminder(
              (meeting._id as string).toString(),
              reminder.minutesBefore,
            );

            const updateData: Record<string, boolean> = {
              [reminder.flag]: true,
            };

            await Meeting.updateOne({ _id: meeting._id }, updateData);

            console.log(
              `✅ ${reminder.minutesBefore} minute reminder sent and marked for meeting ${meeting._id}`,
            );
          } catch (error) {
            console.error(
              `❌ Error processing ${reminder.minutesBefore} minute reminder for meeting ${meeting._id}:`,
              error,
            );
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
