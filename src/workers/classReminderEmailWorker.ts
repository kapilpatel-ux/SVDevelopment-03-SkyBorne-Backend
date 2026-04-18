import dotenv from "dotenv";
dotenv.config();

import { classReminderEmailQueue } from "../services/queues/classReminderEmailQueue";
import sgMail from "@sendgrid/mail";
import { initConsoleErrorLogger } from "../utils/consoleLogger";
import {
  formatMeetingDateTimeForUser,
  getClassReminderEmailHTML,
  getClassReminderEmailSubject,
  resolveMeetingStartDate,
} from "../services/classReminderEmailUtils";

initConsoleErrorLogger();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

classReminderEmailQueue.process(async (job) => {
  const {
    meetingId,
    meetingTitle,
    trainerName,
    region,
    duration,
    reminderOffsetMinutes = 10,
    classStartAt,
    startDate,
    userEmails,
  } = job.data;

  const meetingStartDate = resolveMeetingStartDate(classStartAt, startDate);
  const normalizedUsers = Array.isArray(userEmails) ? userEmails : [];
  const uniqueUserEmailsMap = new Map<string, (typeof normalizedUsers)[number]>();
  for (const user of normalizedUsers) {
    const emailKey = String(user?.email || "").trim().toLowerCase();
    if (!emailKey || uniqueUserEmailsMap.has(emailKey)) continue;
    uniqueUserEmailsMap.set(emailKey, user);
  }
  const uniqueUserEmails = Array.from(uniqueUserEmailsMap.values());

  if (!uniqueUserEmails.length) {
    console.warn("[ClassReminderEmailWorker] No user emails provided");
    return { success: false, emailCount: 0 };
  }

  if (uniqueUserEmails.length !== normalizedUsers.length) {
    console.warn(
      `⚠️ Deduped class reminder recipients from ${normalizedUsers.length} to ${uniqueUserEmails.length}`,
    );
  }

  let successCount = 0;
  let failureCount = 0;

  for (const userEmail of uniqueUserEmails) {
    try {
      const { email, firstName } = userEmail;

      if (!email) {
        console.warn("[ClassReminderEmailWorker] Skipping email without address");
        failureCount++;
        continue;
      }

      const { localTime, localDate, timezoneDisplay } =
        formatMeetingDateTimeForUser(meetingStartDate, userEmail);

      const htmlContent = getClassReminderEmailHTML(
        firstName || "there",
        meetingTitle,
        region,
        localTime,
        localDate,
        timezoneDisplay,
        trainerName || "Your Trainer",
        duration,
        reminderOffsetMinutes,
      );

      const msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL as string,
        subject: getClassReminderEmailSubject(
          meetingTitle,
          reminderOffsetMinutes,
        ),
        html: htmlContent,
      };

      await sgMail.send(msg);
      successCount++;

      console.log(
        `✅ Class reminder email sent to ${email} for meeting ${meetingId}`
      );
    } catch (err: any) {
      failureCount++;
      console.error(
        `❌ Failed to send class reminder email to ${userEmail.email}:`,
        err.message
      );

      if (err.response?.body?.errors) {
        console.error(
          "SendGrid errors:",
          JSON.stringify(err.response.body.errors, null, 2)
        );
      }
    }
  }

  console.log(
    `[ClassReminderEmailWorker] Job completed - Success: ${successCount}, Failure: ${failureCount}`
  );

  return { success: true, emailCount: successCount, failureCount };
});

classReminderEmailQueue.on("completed", (job) =>
  console.log(`🎉 Class reminder email job ${job.id} completed`)
);

classReminderEmailQueue.on("failed", (job, err) =>
  console.error(`🔥 Class reminder email job ${job.id} failed: ${err.message}`)
);
