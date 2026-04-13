import dotenv from "dotenv";
dotenv.config();

import { classReminderEmailQueue } from "../services/queues/classReminderEmailQueue";
import sgMail from "@sendgrid/mail";
import { initConsoleErrorLogger } from "../utils/consoleLogger";
import { COUNTRY_TIMEZONE_MAP } from "../constants/countryTimezoneMap";
import { getCode } from "country-list";

initConsoleErrorLogger();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

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
  trainerName: string,
  localTime: string,
  meetingId: string,
): string => {
  const webLink = `${
    process.env.DASHBOARD_URL || "https://app.skybornedrop.com"
  }/dashboard`;
  const appDeepLink = `skybornedrop://Home`;

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
            padding: 40px 30px;
            text-align: center;
            color: white;
        }
        
        .header h1 {
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 1px;
            margin: 0;
        }

        .content {
            padding: 40px 30px;
        }

        .greeting {
            font-size: 18px;
            font-weight: 600;
            color: #c94a7f;
            margin-bottom: 15px;
        }

        .class-info {
            background-color: #f9f9f9;
            border-left: 4px solid #c94a7f;
            padding: 20px;
            margin: 25px 0;
            border-radius: 4px;
        }

        .class-title {
            font-size: 20px;
            font-weight: 700;
            color: #2c2c2c;
            margin: 0 0 12px 0;
        }

        .class-detail {
            font-size: 14px;
            color: #555;
            margin: 8px 0;
        }

        .label {
            font-weight: 600;
            color: #666;
        }
        
        .cta-section {
            display: flex;
            flex-direction: row;
            gap: 15px;
            margin: 30px 0;
            justify-content: center;
        }

        .cta-button {
            display: inline-block;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 15px;
            transition: all 0.3s ease;
            cursor: pointer;
            border: none;
        }

        .cta-button.primary {
            background-color: #c94a7f;
            color: #ffffff;
        }

        .cta-button.primary:hover {
            background-color: #b03a6f;
        }

        .cta-button.secondary {
            background-color: #ffffff;
            color: #c94a7f;
            border: 2px solid #c94a7f;
        }

        .cta-button.secondary:hover {
            background-color: #f8f8f8;
        }

        .divider {
            height: 1px;
            background-color: #e0e0e0;
            margin: 30px 0;
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
                font-size: 26px;
            }
            
            .cta-button {
                padding: 12px 24px;
                font-size: 14px;
            }
            
            .cta-section {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header Section -->
        <div class="header">
            <h1>Upcoming Class Reminder</h1>
        </div>
        
        <!-- Main Content Section -->
        <div class="content">
            <p class="greeting">Hi ${firstName},</p>

            <p>Your class is coming up soon! Here are the details:</p>

            <!-- Class Info -->
            <div class="class-info">
                <h2 class="class-title">${meetingTitle}</h2>
                <p class="class-detail"><span class="label">Trainer:</span> ${trainerName}</p>
                <p class="class-detail"><span class="label">Time:</span> ${localTime}</p>
                <p class="class-detail">Make sure you're ready to join on time!</p>
            </div>

            <!-- Call to Action Buttons -->
            <div class="cta-section">
                <a href="${webLink}" class="cta-button primary" style="background-color: #c94a7f; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 600; display: inline-block;">
                    Join Class
                </a>
                
                <a href="${appDeepLink}" class="cta-button primary" style="background-color: #c94a7f; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 600; display: inline-block;">
                    View Details In App
                </a>
            </div>
            
            <div class="divider"></div>
            
            <p style="font-size: 14px; color: #777;">
                Open the Skyborne app or click the button above to join your class. See you there!
            </p>
        </div>
        
        <!-- Footer Section -->
        <div class="footer">
            <p>© 2025 SKYBORNE. All rights reserved.</p>
            <p style="margin-top: 10px; color: #ccc; font-size: 12px;">
                This is an automatic reminder for your scheduled class.
            </p>
        </div>
    </div>
</body>
</html>
  `;
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

  if (!userEmails || userEmails.length === 0) {
    console.warn("[ClassReminderEmailWorker] No user emails provided");
    return { success: false, emailCount: 0 };
  }

  let successCount = 0;
  let failureCount = 0;

  for (const userEmail of userEmails) {
    try {
      const { email, firstName } = userEmail;

      if (!email) {
        console.warn("[ClassReminderEmailWorker] Skipping email without address");
        failureCount++;
        continue;
      }

      const timezone = resolveUserTimeZone(userEmail);
      let localTime = "TBD";

      if (!isNaN(meetingStartDate.getTime())) {
        try {
          localTime = meetingStartDate.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
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
        }
      }

      const htmlContent = getClassReminderEmailHTML(
        firstName || "there",
        meetingTitle,
        trainerName || "Your Trainer",
        localTime,
        meetingId,
      );

      const msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL as string,
        subject: `⏰ Reminder: ${meetingTitle} starts in ${
          reminderOffsetMinutes >= 60
            ? `${Math.round(reminderOffsetMinutes / 60)} hours`
            : `${reminderOffsetMinutes} minutes`
        }!`,
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
