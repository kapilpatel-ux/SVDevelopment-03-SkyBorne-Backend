// src/services/email/classReminderEmail.ts
import dotenv from "dotenv";
dotenv.config();

import { classReminderEmailQueue } from "./queues/classReminderEmailQueue";
import sgMail from "@sendgrid/mail";
import { COUNTRY_TIMEZONE_MAP } from "../constants/countryTimezoneMap";
import MailLog from "../modules/MailModule/MailModel";
import { initConsoleErrorLogger } from "../utils/consoleLogger";
import { getCode } from "country-list";

initConsoleErrorLogger();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const TIMEZONE_ABBREVIATION_MAP: Record<string, string> = {
  "Asia/Kolkata": "IST",
  "Asia/Dubai": "GST",
  UTC: "UTC",
};

const getTimezoneDisplayLabel = (timezone: string): string => {
  const tz = String(timezone || "").trim() || "UTC";
  const mappedAbbreviation = TIMEZONE_ABBREVIATION_MAP[tz];
  if (mappedAbbreviation) {
    return `${tz} (${mappedAbbreviation})`;
  }

  try {
    const now = new Date();
    const shortOffset = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;

    if (shortOffset) {
      return `${tz} (${shortOffset})`;
    }
  } catch (error) {
    // Fallback to timezone string when Intl formatting fails.
  }

  return tz;
};

const resolveUserTimeZone = (user: any): string => {
  const explicitTimeZone = String(
    user?.timeZone || user?.timezone || ""
  ).trim();
  if (explicitTimeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: explicitTimeZone }).format(
        new Date()
      );
      return explicitTimeZone;
    } catch {
      // Fall back to country-based resolution when the timezone is invalid.
    }
  }

  const rawCountry = String(user?.country || "").trim();
  const rawCode = String(user?.countryCode || "").trim().toUpperCase();
  let countryCode = "";

  if (rawCountry) {
    if (/^[A-Za-z]{2}$/.test(rawCountry)) {
      countryCode = rawCountry.toUpperCase();
    } else {
      const fromName = getCode(rawCountry);
      if (fromName) {
        countryCode = fromName.toUpperCase();
      }
    }
  }

  if (!countryCode && rawCode) {
    countryCode = rawCode;
  }

  return COUNTRY_TIMEZONE_MAP[countryCode] || "UTC";
};

const getClassReminderEmailHTML = (
  firstName: string,
  meetingTitle: string,
  region: string,
  localTime: string,
  localDate: string,
  timezone: string,
  trainerName: string,
  duration: number,
  reminderOffsetMinutes: number,
): string => {
  const webLink = process.env.DASHBOARD_URL || "https://app.skybornedrop.com";
  const timeUntilClass =
    reminderOffsetMinutes >= 60
      ? `${Math.round(reminderOffsetMinutes / 60)} hours`
      : `${reminderOffsetMinutes} minutes`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f5f5f5;
            line-height: 1.6;
            color: #333;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #c94a7f 0%, #d97fa0 100%);
            padding: 30px;
            text-align: center;
            color: #ffffff;
        }
        
        .header h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            letter-spacing: 0.5px;
        }
        
        .header p {
            font-size: 16px;
            opacity: 0.95;
        }
        
        .content {
            padding: 40px 30px;
        }
        
        .greeting {
            font-size: 16px;
            color: #333;
            margin-bottom: 20px;
            line-height: 1.8;
        }
        
        .class-details {
            background-color: #f9f9f9;
            border-left: 4px solid #c94a7f;
            padding: 20px;
            margin: 25px 0;
            border-radius: 4px;
        }
        
        .detail-row {
            display: flex;
            justify-content: space-between;
            margin: 12px 0;
            font-size: 15px;
        }
        
        .detail-label {
            color: #777;
            font-weight: 500;
        }
        
        .detail-value {
            color: #000;
            margin-left: 4px;
            font-weight: 600;
        }
        
        .divider {
            height: 1px;
            background-color: #e0e0e0;
            margin: 20px 0;
        }
        
        .cta-section {
            text-align: center;
            margin: 30px 0;
        }
        
        .cta-button {
            display: inline-block;
            padding: 14px 40px;
            background-color: #c94a7f;
            color: #ffffff;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        
        .cta-button:hover {
            background-color: #b03a6f;
            text-decoration: none;
        }
        
        .reminder-box {
            background-color: #fff8e6;
            border: 2px solid #ffc107;
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
            text-align: center;
            font-weight: 600;
            color: #ff9800;
            font-size: 16px;
        }
        
        .footer {
            background-color: #fafafa;
            padding: 25px 30px;
            border-top: 1px solid #e0e0e0;
            text-align: center;
            font-size: 13px;
            color: #999;
        }
        
        .footer a {
            color: #c94a7f;
            text-decoration: none;
        }
        
        .footer p {
            margin: 5px 0;
        }
        
        @media (max-width: 600px) {
            .content {
                padding: 30px 20px;
            }
            
            .header h1 {
                font-size: 24px;
            }
            
            .detail-row {
                flex-direction: column;
            }
            
            .detail-label {
                margin-bottom: 5px;
            }
            
            .cta-button {
                padding: 12px 30px;
                font-size: 15px;
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header Section -->
        <div class="header">
            <h1>CLASS REMINDER</h1>
            <p>Your class is starting soon!</p>
        </div>
        
        <!-- Main Content Section -->
        <div class="content">
            <p class="greeting">
                Hi <strong>${firstName}</strong>,
            </p>
            
            <p class="greeting">
                Your fitness class is starting in approximately <strong>${timeUntilClass}</strong>. Do not miss it!
            </p>
            
            <!-- Class Info -->
            <div class="class-details">
                <div class="detail-row">
                    <span class="detail-label">Class Title</span>
                    <span class="detail-value">${meetingTitle}</span>
                </div>
                
                <div class="divider"></div>
                
                <div class="detail-row">
                    <span class="detail-label">Trainer</span>
                    <span class="detail-value">${trainerName}</span>
                </div>
                
                <div class="detail-row">
                    <span class="detail-label">Region</span>
                    <span class="detail-value">${String(region || "").toUpperCase()}</span>
                </div>
                
                <div class="divider"></div>
                
                <div class="detail-row">
                    <span class="detail-label">Time</span>
                    <span class="detail-value">${localTime} (${timezone})</span>
                </div>
                
                <div class="detail-row">
                    <span class="detail-label">Duration</span>
                    <span class="detail-value">${duration} minutes</span>
                </div>
                
                <div class="detail-row">
                    <span class="detail-label">Date</span>
                    <span class="detail-value">${localDate}</span>
                </div>
            </div>
            
            <div class="reminder-box">
                Make sure to join 5 minutes before the class starts!
            </div>
            
            <!-- Call to Action Button -->
            <div class="cta-section">
                <a href="${webLink}" class="cta-button">
                    View Class Details
                </a>
            </div>
            
            <p class="greeting" style="font-size: 14px; color: #777; text-align: center;">
                If you have any questions, feel free to contact our support team.
            </p>
        </div>
        
        <!-- Footer Section -->
        <div class="footer">
            <p>© 2025 SKYBORNE. All rights reserved.</p>
            <p style="margin-top: 10px; color: #ccc; font-size: 12px;">
                You received this email because you are registered for this class on SKYBORNE.
            </p>
        </div>
    </div>
</body>
</html>
  `;
};

// Process the queue
classReminderEmailQueue.process(async (job: any) => {
  const {
    userEmails,
    meetingTitle,
    region,
    reminderOffsetMinutes = 10,
    classStartAt,
    startDate,
    duration,
    trainerName,
  } = job.data;
  const resolveValidMeetingStartDate = () => {
    const candidates = [classStartAt, startDate];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const parsed = new Date(candidate);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date(NaN);
  };
  const meetingStartDate = resolveValidMeetingStartDate();
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
        const timezone = resolveUserTimeZone(user);
        const timezoneDisplay = getTimezoneDisplayLabel(timezone);
        let localTime = "TBD";
        let localDate = "TBD";

        if (!isNaN(meetingStartDate.getTime())) {
          try {
            localTime = meetingStartDate.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: timezone,
            });
            localDate = meetingStartDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              timeZone: timezone,
            });
          } catch (formatErr: any) {
            console.warn(
              `⚠️ Failed to format reminder date/time for timezone ${timezone}. Falling back to UTC.`,
              formatErr?.message || formatErr,
            );
            localTime = meetingStartDate.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: "UTC",
            });
            localDate = meetingStartDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            });
          }
        }

        if (/invalid date/i.test(localTime)) {
          localTime = "TBD";
        }
        if (/invalid date/i.test(localDate)) {
          localDate = "TBD";
        }

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
        );

        const msg = {
          to: user.email,
          from: process.env.SENDGRID_FROM_EMAIL as string,
          subject: `⏰ Reminder: ${meetingTitle} starts in ${
            reminderOffsetMinutes >= 60
              ? `${Math.round(reminderOffsetMinutes / 60)} hours`
              : `${reminderOffsetMinutes} minutes`
          }!`,
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
