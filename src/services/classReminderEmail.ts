// src/services/email/classReminderEmail.ts
import dotenv from "dotenv";
dotenv.config();

import { classReminderEmailQueue } from "./queues/classReminderEmailQueue";
import sgMail from "@sendgrid/mail";
import MailLog from "../modules/MailModule/MailModel";
import { initConsoleErrorLogger } from "../utils/consoleLogger";
import {
  formatMeetingDateTimeForUser,
  getClassReminderEmailHTML,
  getClassReminderEmailSubject,
  resolveMeetingStartDate,
} from "./classReminderEmailUtils";

initConsoleErrorLogger();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

// Process the queue
classReminderEmailQueue.process(async (job: any) => {
  const {
    meetingId,
    userEmails,
    meetingTitle,
    region,
    reminderOffsetMinutes = 10,
    classStartAt,
    startDate,
    duration,
    trainerName,
  } = job.data;
  const meetingStartDate = resolveMeetingStartDate(classStartAt, startDate);
  const normalizedUsers = Array.isArray(userEmails) ? userEmails : [];
  const uniqueUserEmailsMap = new Map<string, (typeof normalizedUsers)[number]>();
  for (const user of normalizedUsers) {
    const emailKey = String(user?.email || "").trim().toLowerCase();
    if (!emailKey) continue;
    if (!uniqueUserEmailsMap.has(emailKey)) {
      uniqueUserEmailsMap.set(emailKey, user);
    }
  }
  const uniqueUserEmails = Array.from(uniqueUserEmailsMap.values());
  if (uniqueUserEmails.length !== normalizedUsers.length) {
    console.warn(
      `⚠️ Deduped class reminder recipients from ${normalizedUsers.length} to ${uniqueUserEmails.length}`,
    );
  }
  let mailLogWritten = false;

  try {
    // Send email to all users in the region
    if (isNaN(meetingStartDate.getTime())) {
      throw new Error("Invalid class start time in reminder job payload");
    }
    const emailResults = await Promise.all(
      uniqueUserEmails.map(async (user: any) => {
        const { localTime, localDate, timezoneDisplay, timezonesDisplayHtml } =
          formatMeetingDateTimeForUser(meetingStartDate, user);

        const htmlContent = getClassReminderEmailHTML(
          user.firstName,
          meetingTitle,
          region,
          localTime,
          localDate,
          timezoneDisplay,
          trainerName,
          duration,
          reminderOffsetMinutes,
          timezonesDisplayHtml,
          meetingId,
        );

        const msg = {
          to: user.email,
          from: process.env.SENDGRID_FROM_EMAIL as string,
          subject: getClassReminderEmailSubject(
            meetingTitle,
            reminderOffsetMinutes,
          ),
          html: htmlContent,
        };

        try {
          await sgMail.send(msg);
          return { email: user.email, success: true };
        } catch (sendError: any) {
          return { email: user.email, success: false, error: sendError };
        }
      })
    );

    const failures = emailResults.filter((result) => !result.success);
    const successCount = emailResults.length - failures.length;
    const failureCount = failures.length;

    await MailLog.create({
      meetingId: String(job?.data?.meetingId || "").trim() || undefined,
      meetingTitle: meetingTitle || "Untitled Meeting",
      meetingTime: meetingStartDate,
      sentAt: new Date(),
      totalUsers: uniqueUserEmails.length,
      status: failureCount === 0 ? "success" : "failed",
    });
    mailLogWritten = true;

    if (failureCount > 0) {
      console.error(
        `❌ Class reminder email failures: ${failureCount} of ${emailResults.length}`,
      );
      const sampleError = failures[0]?.error;
      if (sampleError?.message) {
        console.error("Sample error:", sampleError.message);
      }
      if (sampleError?.response?.body) {
        console.error(
          "🔍 SendGrid Error Body:",
          JSON.stringify(sampleError.response.body, null, 2),
        );
      }
    }

    console.log(
      `✅ Class reminder emails sent to ${successCount} users for class: ${meetingTitle}`,
    );

    if (successCount === 0) {
      throw new Error("All class reminder emails failed to send");
    }

    return {
      success: failureCount === 0,
      emailsSent: successCount,
      failures: failureCount,
    };
  } catch (err: any) {
    console.error(`❌ Email send failed for class reminder`);
    console.error("Error Message:", err.message);

    try {
      if (!mailLogWritten) {
        await MailLog.create({
          meetingId: String(job?.data?.meetingId || "").trim() || undefined,
          meetingTitle: meetingTitle || "Untitled Meeting",
          meetingTime: isNaN(meetingStartDate.getTime())
            ? new Date()
            : meetingStartDate,
          sentAt: new Date(),
        totalUsers: uniqueUserEmails.length,
          status: "failed",
        });
      }
    } catch (mailLogError: any) {
      console.error(
        "❌ Failed to store failed mail log:",
        mailLogError?.message || mailLogError,
      );
    }

    if (err.response?.body) {
      console.error(
        "🔍 SendGrid Error Body:",
        JSON.stringify(err.response.body, null, 2),
      );
    }

    const errors = err.response?.body?.errors;
    if (errors && errors.length > 0) {
      console.error("🔥 EXACT SENDGRID ERROR:", errors[0].message);
    }

    throw err;
  }
});

classReminderEmailQueue.on("completed", (job: any) =>
  console.log(`🎉 Class reminder email job ${job.id} completed`),
);

classReminderEmailQueue.on("failed", (job: any, err: any) =>
  console.error(`🔥 Class reminder email job ${job.id} failed: ${err.message}`),
);
