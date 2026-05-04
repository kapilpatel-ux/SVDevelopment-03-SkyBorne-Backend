import dotenv from "dotenv";
dotenv.config();

import { classReminderEmailQueue } from "../services/queues/classReminderEmailQueue";
import sgMail from "@sendgrid/mail";
import mongoose from "mongoose";
import connectDB from "../config/db";
import { initConsoleErrorLogger } from "../utils/consoleLogger";
import {
  CLASS_REMINDER_TEMPLATE_VERSION,
  formatMeetingDateTimeForUser,
  getClassReminderEmailHTML,
  getClassReminderEmailSubject,
  resolveMeetingStartDate,
} from "../services/classReminderEmailUtils";
import MailLog from "../modules/MailModule/MailModel";

initConsoleErrorLogger();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const ensureMongoConnection = async () => {
  if (mongoose.connection.readyState === 1) return;
  await connectDB();
};

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

      const { localTime, localDate, timezoneDisplay, timezonesDisplayHtml } =
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
        timezonesDisplayHtml,
        meetingId,
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
        `✅ Class reminder email sent to ${email} for meeting ${meetingId} using template ${CLASS_REMINDER_TEMPLATE_VERSION}`
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

  try {
    await ensureMongoConnection();
    const hasValidMeetingTime = !Number.isNaN(meetingStartDate.getTime());
    await MailLog.create({
      meetingId: String(meetingId || "").trim() || undefined,
      meetingTitle: String(meetingTitle || "").trim() || "Untitled Class",
      meetingTime: hasValidMeetingTime ? meetingStartDate : new Date(),
      sentAt: new Date(),
      totalUsers: uniqueUserEmails.length,
      status: successCount > 0 ? "success" : "failed",
    });
  } catch (mailLogError: any) {
    console.error(
      `[ClassReminderEmailWorker] Failed to persist MailLog for meeting ${meetingId}:`,
      mailLogError?.message || mailLogError,
    );
  }

  return { success: true, emailCount: successCount, failureCount };
});

classReminderEmailQueue.on("completed", (job) =>
  console.log(`🎉 Class reminder email job ${job.id} completed`)
);

classReminderEmailQueue.on("failed", (job, err) =>
  console.error(`🔥 Class reminder email job ${job.id} failed: ${err.message}`)
);

const bootstrapWorker = async () => {
  try {
    await ensureMongoConnection();
    console.log("✅ ClassReminderEmailWorker bootstrap completed");
  } catch (error: any) {
    console.error(
      `❌ ClassReminderEmailWorker bootstrap failed: ${error?.message || error}`,
    );
    process.exit(1);
  }
};

void bootstrapWorker();
