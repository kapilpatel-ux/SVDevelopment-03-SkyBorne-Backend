// src/services/classReminder/ClassReminderService.ts
import countryModel  from "../modules/CountryModule/country.model";
import User from "../modules/UserModule/models/User";
import Meeting, { IPopulatedMeeting } from "../modules/MeetingModule/MeetingModels/Meeting";
import { addClassReminderEmailJob } from "./queues/classReminderEmailQueue";
import { IMeeting } from "../modules/MeetingModule/MeetingModels/Meeting";
import regionModel from "../modules/RegionModule/region.model";
import { PushNotificationService } from "./pushNotification.service";
import sgMail from "@sendgrid/mail";
import { COUNTRY_TIMEZONE_MAP } from "../constants/countryTimezoneMap";
import { getCode } from "country-list";

let sendGridConfigured = false;

const ensureSendGridConfigured = () => {
  if (sendGridConfigured) return true;
  const key = String(process.env.SENDGRID_API_KEY || "").trim();
  if (!key) {
    console.error("[ClassReminderService] SENDGRID_API_KEY is missing");
    return false;
  }
  sgMail.setApiKey(key);
  sendGridConfigured = true;
  return true;
};

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
  } catch {
    // noop
  }

  return tz;
};

const resolveUserTimeZone = (user: any): string => {
  const explicitTimeZone = String(user?.timeZone || user?.timezone || "").trim();
  if (explicitTimeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: explicitTimeZone }).format(new Date());
      return explicitTimeZone;
    } catch {
      // fallback to country mapping
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

const formatReminderTime = (dateInput: any, timeZone?: string) => {
  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) return "TBD";
  try {
    return parsed.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: timeZone || "UTC",
    });
  } catch {
    return parsed.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    });
  }
};

const formatReminderDate = (dateInput: any, timeZone?: string) => {
  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) return "TBD";
  try {
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: timeZone || "UTC",
    });
  } catch {
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
};

const getClassReminderEmailHTML = (params: {
  firstName: string;
  meetingTitle: string;
  region: string;
  localTime: string;
  localDate: string;
  timezoneDisplay: string;
  trainerName: string;
  duration: number;
  reminderOffsetMinutes: number;
}) => {
  const {
    firstName,
    meetingTitle,
    region,
    localTime,
    localDate,
    timezoneDisplay,
    trainerName,
    duration,
    reminderOffsetMinutes,
  } = params;

  const webLink = process.env.DASHBOARD_URL || "https://app.skybornedrop.com";
  const timeUntilClass =
    reminderOffsetMinutes >= 60
      ? `${Math.round(reminderOffsetMinutes / 60)} hours`
      : `${reminderOffsetMinutes} minutes`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#f5f5f5; color:#333; margin:0; }
    .container { max-width:600px; margin:0 auto; background:#fff; }
    .header { background:linear-gradient(135deg,#c94a7f 0%,#d97fa0 100%); color:#fff; text-align:center; padding:30px; }
    .content { padding:40px 30px; }
    .class-details { background:#f9f9f9; border-left:4px solid #c94a7f; padding:20px; margin:25px 0; border-radius:4px; }
    .row { display:flex; justify-content:space-between; margin:10px 0; }
    .label { color:#777; font-weight:500; }
    .value { color:#000; font-weight:600; margin-left:4px; }
    .divider { height:1px; background:#e0e0e0; margin:14px 0; }
    .cta { text-align:center; margin:24px 0; }
    .btn { display:inline-block; background:#c94a7f; color:#fff; text-decoration:none; padding:12px 28px; border-radius:6px; font-weight:600; }
    .note { background:#fff8e6; border:2px solid #ffc107; border-radius:6px; padding:12px; text-align:center; font-weight:600; color:#ff9800; }
    .footer { background:#fafafa; border-top:1px solid #e0e0e0; color:#999; text-align:center; font-size:13px; padding:25px 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin:0 0 8px 0;">CLASS REMINDER</h1>
      <p style="margin:0;">Your class is starting soon!</p>
    </div>
    <div class="content">
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Your fitness class is starting in approximately <strong>${timeUntilClass}</strong>.</p>
      <div class="class-details">
        <div class="row"><span class="label">Class Title</span><span class="value">${meetingTitle}</span></div>
        <div class="divider"></div>
        <div class="row"><span class="label">Trainer</span><span class="value">${trainerName}</span></div>
        <div class="row"><span class="label">Region</span><span class="value">${String(region || "").toUpperCase()}</span></div>
        <div class="divider"></div>
        <div class="row"><span class="label">Time</span><span class="value">${localTime} (${timezoneDisplay})</span></div>
        <div class="row"><span class="label">Duration</span><span class="value">${duration} minutes</span></div>
        <div class="row"><span class="label">Date</span><span class="value">${localDate}</span></div>
      </div>
      <div class="note">Make sure to join 5 minutes before the class starts!</div>
      <div class="cta"><a class="btn" href="${webLink}">View Class Details</a></div>
    </div>
    <div class="footer">
      <p>© 2025 SKYBORNE. All rights reserved.</p>
      <p style="margin-top:8px;color:#ccc;font-size:12px;">You received this email because you are registered for this class on SKYBORNE.</p>
    </div>
  </div>
</body>
</html>`;
};

const sendClassReminderEmailsDirect = async (params: {
  meetingTitle: string;
  region: string;
  trainerName: string;
  duration: number;
  reminderOffsetMinutes: number;
  classStartAt: any;
  startDate?: any;
  userEmails: Array<{
    email: string;
    firstName?: string;
    country?: string;
    countryCode?: string;
    timeZone?: string;
  }>;
}) => {
  const {
    meetingTitle,
    region,
    trainerName,
    duration,
    reminderOffsetMinutes,
    classStartAt,
    startDate,
    userEmails,
  } = params;

  if (!ensureSendGridConfigured()) {
    throw new Error("SendGrid is not configured");
  }

  const fromEmail = String(process.env.SENDGRID_FROM_EMAIL || "").trim();
  if (!fromEmail) {
    throw new Error("SENDGRID_FROM_EMAIL is missing");
  }

  let successCount = 0;
  let failureCount = 0;
  const startAt = classStartAt || startDate;

  for (const user of userEmails) {
    const to = String(user?.email || "").trim();
    if (!to) continue;
    const firstName = String(user?.firstName || "there").trim();
    const userTimeZone = resolveUserTimeZone(user);
    const localTime = formatReminderTime(startAt, userTimeZone);
    const localDate = formatReminderDate(startAt, userTimeZone);
    const timezoneDisplay = getTimezoneDisplayLabel(userTimeZone);

    const msg = {
      to,
      from: fromEmail,
      subject: `⏰ Reminder: ${meetingTitle} starts in ${
        reminderOffsetMinutes >= 60
          ? `${Math.round(reminderOffsetMinutes / 60)} hours`
          : `${reminderOffsetMinutes} minutes`
      }!`,
      html: getClassReminderEmailHTML({
        firstName,
        meetingTitle,
        region,
        localTime,
        localDate,
        timezoneDisplay,
        trainerName: trainerName || "Your Trainer",
        duration,
        reminderOffsetMinutes,
      }),
    };

    try {
      await sgMail.send(msg as any);
      successCount += 1;
    } catch (error: any) {
      failureCount += 1;
      console.error("[ClassReminderService] Direct reminder email failed", {
        to,
        error: error?.message || error,
      });
    }
  }

  return { successCount, failureCount };
};

const resolveMeetingRegionDetails = (
  meeting: IPopulatedMeeting | IMeeting,
) => {
  const regions = Array.isArray(meeting?.regions) ? meeting.regions : [];
  const liveRegionKey = String(meeting?.liveRegion || "")
    .trim()
    .toLowerCase();
  const liveTimeValue = String(meeting?.liveTime || "").trim();

  const matchingRegions = regions.filter(
    (entry: any) =>
      String(entry?.region || "").trim().toLowerCase() === liveRegionKey,
  );

  const bestMatch =
    matchingRegions.find(
      (entry: any) => String(entry?.localTime || "").trim() === liveTimeValue,
    ) ||
    matchingRegions.find(
      (entry: any) => entry?.localTime || entry?.date || entry?.timezone,
    ) ||
    matchingRegions[0];

  return {
    regionTimeZone: String(bestMatch?.timezone || "").trim(),
    regionLocalTime: String(bestMatch?.localTime || "").trim(),
    regionLocalDate: String(bestMatch?.date || "").trim(),
  };
};

export class ClassReminderService {
  /**
   * Find all countries that belong to a specific region
   * @param region - The region name (e.g., "Gulf", "India")
   * @returns Array of country codes that belong to this region
   */
static async getCountriesByRegion(regionName: string) {
  console.log("[ClassReminderService] getCountriesByRegion:start", { regionName });
  
  try {
    console.log("[ClassReminderService] getCountriesByRegion:query-region", { regionName });
    // 1️⃣ Find region document
    const regionDoc = await regionModel.findOne({ name: regionName });

    if (!regionDoc) {
      console.warn(`⚠️ Region not found: ${regionName}`);
      return [];
    }

    console.log("[ClassReminderService] getCountriesByRegion:region-found", {
      regionId: regionDoc._id?.toString?.(),
      regionName: regionDoc.name,
    });

    // 2️⃣ Use ObjectId to fetch countries
    const countries = await countryModel.find({
      region: regionDoc._id,
      status: "active",
    }).select("code name");

    console.log("[ClassReminderService] getCountriesByRegion:done", {
      regionName,
      countriesCount: countries.length,
      countryCodes: countries.map((country: any) => country.code),
    });

    return countries;
  } catch (error) {
    console.error(`❌ Error fetching countries for region ${regionName}:`, error);
    throw error;
  }
}

  /**
   * Find all users in a specific region
   * @param region - The region name
   * @returns Array of users with email and name
   */
  static async getUsersByRegion(region: string) {
    try {
      console.log("[ClassReminderService] getUsersByRegion:start", { region });

      // First, get all countries in this region
      const countries = await this.getCountriesByRegion(region);
      const countryCodes = countries.map((c:any) => c.code);

      console.log("[ClassReminderService] getUsersByRegion:countries", {
        region,
        countriesCount: countries.length,
        countryCodes,
      });

      if (countryCodes.length === 0) {
        console.warn(`⚠️ No countries found for region: ${region}`);
        return [];
      }

      // Find all users in these countries
      const users = await User.find({
        countryCode: { $in: countryCodes },
        isActive: true,
        isEmailVerified: true,
        "subscription.status": "active",
      }).select("email firstName lastName countryCode country timeZone");

      console.log("[ClassReminderService] getUsersByRegion:done", {
        region,
        usersCount: users.length,
      });

      return users;
    } catch (error) {
      console.error(`❌ Error fetching users for region ${region}:`, error);
      throw error;
    }
  }

  /**
   * Send class reminder emails for a specific meeting
   * @param meetingId - The ID of the meeting
   * @param minutesBefore - How many minutes before the class (default: 10)
   */
  static async sendClassReminder(meetingId: string, minutesBefore: number = 10) {
    try {
      console.log("[ClassReminderService] sendClassReminder:start", {
        meetingId,
        minutesBefore,
      });

      // Fetch the meeting with populated fields
     const meeting = (await Meeting.findById(meetingId)
        .populate("trainer", "name")
        .populate("service", "title")
        .lean()) as IPopulatedMeeting | null;

      if (!meeting) {
        console.error(`❌ Meeting not found: ${meetingId}`);
        return { success: false, message: "Meeting not found" };
      }

      console.log("[ClassReminderService] sendClassReminder:meeting-found", {
        meetingId: (meeting._id as string)?.toString?.() || meetingId,
        title: meeting.title,
        region: meeting.liveRegion,
        localTime: meeting.localTime,
      });

      // Check if it's time to send the reminder
      const now = new Date();
      const classStartTime = new Date(meeting.localTime);
      const timeDifference = classStartTime.getTime() - now.getTime();
      const minutesDifference = timeDifference / (1000 * 60);

      console.log("[ClassReminderService] sendClassReminder:timing-check", {
        now: now.toISOString(),
        classStartAt: classStartTime.toISOString(),
        minutesDifference,
        windowStart: minutesBefore - 5,
        windowEnd: minutesBefore + 5,
      });

      // Send reminder only if we're within the specified window (e.g., 10-15 minutes before)
      if (minutesDifference < minutesBefore - 5 || minutesDifference > minutesBefore + 5) {
        console.log(
          `⏭️ Not the right time to send reminder. Minutes until class: ${minutesDifference}`
        );
        return {
          success: false,
          message: `Class starts in ${minutesDifference.toFixed(2)} minutes, not within ${minutesBefore} minute window`,
        };
      }

      // Get the region from the meeting
      const region = meeting.liveRegion;

      // Find all users in this region
      const users = await this.getUsersByRegion(region);

      console.log("[ClassReminderService] sendClassReminder:users-fetched", {
        region,
        usersCount: users.length,
      });

      if (users.length === 0) {
        console.warn(`⚠️ No users found in region: ${region}`);
        return {
          success: true,
          message: "No active users found in this region",
          emailsSent: 0,
        };
      }

      // Format user emails for the queue
      const userEmails = users.map((user: any) => ({
        userId: String(user._id),
        email: user.email,
        firstName: user.firstName || user.lastName || "User",
        country: user.country || "",
        countryCode: user.countryCode || "",
        timeZone: user.timeZone || "",
      }));

      const uniqueEmailsMap = new Map<string, (typeof userEmails)[number]>();
      for (const entry of userEmails) {
        const emailKey = String(entry.email || "").trim().toLowerCase();
        if (!emailKey) continue;
        if (!uniqueEmailsMap.has(emailKey)) {
          uniqueEmailsMap.set(emailKey, entry);
        }
      }
      const uniqueUserEmails = Array.from(uniqueEmailsMap.values());

      if (uniqueUserEmails.length !== userEmails.length) {
        console.warn(
          `[ClassReminderService] sendClassReminder:dedupe-emails removed ${
            userEmails.length - uniqueUserEmails.length
          } duplicate emails`,
        );
      }

      // Get trainer name
      const trainerName = (meeting.trainer as any)?.name || "Your Trainer";
      const { regionTimeZone, regionLocalTime, regionLocalDate } =
        resolveMeetingRegionDetails(meeting);

      console.log("[ClassReminderService] sendClassReminder:queue-job", {
        meetingId: (meeting._id as string).toString(),
        region,
        usersCount: uniqueUserEmails.length,
        trainerName,
      });

      const reminderJobPayload = {
        meetingId: (meeting._id as string).toString(),
        meetingTitle: meeting.title,
        region: region,
        reminderOffsetMinutes: minutesBefore,
        liveTime: meeting.liveTime,
        classStartAt: meeting.localTime,
        startDate: meeting.startDate,
        regionTimeZone,
        regionLocalTime,
        regionLocalDate,
        duration: meeting.duration,
        trainerName: trainerName,
        userEmails: uniqueUserEmails,
      };

      let sentByFallback = false;
      try {
        await addClassReminderEmailJob(reminderJobPayload);
      } catch (queueError: any) {
        console.error(
          "[ClassReminderService] Queue add failed, attempting direct email fallback",
          {
            meetingId: (meeting._id as string).toString(),
            minutesBefore,
            error: queueError?.message || queueError,
          },
        );

        const directResult = await sendClassReminderEmailsDirect({
          meetingTitle: meeting.title,
          region,
          trainerName,
          duration: meeting.duration,
          reminderOffsetMinutes: minutesBefore,
          classStartAt: meeting.localTime,
          startDate: meeting.startDate,
          userEmails: uniqueUserEmails,
        });

        sentByFallback = directResult.successCount > 0;
        if (!sentByFallback) {
          throw new Error(
            `Queue failed and direct fallback sent 0 emails (failures: ${directResult.failureCount})`,
          );
        }
      }

      const pushUserIds = uniqueUserEmails
        .map((entry: any) => String(entry.userId || "").trim())
        .filter(Boolean);

      const shouldSendPushReminder = [30, 10].includes(minutesBefore);

      if (pushUserIds.length > 0 && shouldSendPushReminder) {
        PushNotificationService.sendSessionReminderToUsers(pushUserIds, {
          meetingId: (meeting._id as string).toString(),
          meetingTitle: meeting.title,
          minutesBefore,
          classStartAt: new Date(meeting.localTime),
          region,
        }).catch((pushError: any) => {
          console.error("❌ Failed to send class reminder push notification:", pushError?.message || pushError);
        });
      } else if (pushUserIds.length > 0 && !shouldSendPushReminder) {
        console.log("[ClassReminderService] push reminder skipped for offset", {
          meetingId: (meeting._id as string).toString(),
          minutesBefore,
        });
      }

      console.log(
        sentByFallback
          ? `✅ Class reminder emails sent directly for ${uniqueUserEmails.length} users (queue fallback). Meeting: ${meeting.title}`
          : `✅ Class reminder job queued for ${uniqueUserEmails.length} users. Meeting: ${meeting.title}`,
      );

      return {
        success: true,
        message: sentByFallback
          ? `Reminder emails sent directly for ${uniqueUserEmails.length} users`
          : `Reminder emails queued for ${uniqueUserEmails.length} users`,
        emailsSent: uniqueUserEmails.length,
      };
    } catch (error) {
      console.error(`❌ Error sending class reminder:`, error);
      throw error;
    }
  }

  /**
   * Send reminder emails to all users in a meeting's region
   * This can be called manually from the API endpoint
   * @param meetingId - The ID of the meeting
   */
  static async sendImmediateClassReminder(meetingId: string) {
    try {
      console.log("[ClassReminderService] sendImmediateClassReminder:start", { meetingId });

      const meeting = (await Meeting.findById(meetingId)
        .populate("trainer", "name")
        .populate("service", "title")) as IMeeting & {
        trainer?: { name: string };
        service?: { title: string };
      };

      if (!meeting) {
        return { success: false, message: "Meeting not found" };
      }

      const region = meeting.liveRegion;
      console.log("[ClassReminderService] sendImmediateClassReminder:meeting-found", {
        meetingId: (meeting._id as string)?.toString?.() || meetingId,
        title: meeting.title,
        region,
        localTime: meeting.localTime,
      });

      const users = await this.getUsersByRegion(region);

      console.log("[ClassReminderService] sendImmediateClassReminder:users-fetched", {
        region,
        usersCount: users.length,
      });

      if (users.length === 0) {
        return {
          success: true,
          message: "No active users found in this region",
          emailsSent: 0,
        };
      }

      const userEmails = users.map((user: any) => ({
        email: user.email,
        firstName: user.firstName || user.lastName || "User",
        country: user.country || "",
        countryCode: user.countryCode || "",
        timeZone: user.timeZone || "",
      }));

      const uniqueEmailsMap = new Map<string, (typeof userEmails)[number]>();
      for (const entry of userEmails) {
        const emailKey = String(entry.email || "").trim().toLowerCase();
        if (!emailKey) continue;
        if (!uniqueEmailsMap.has(emailKey)) {
          uniqueEmailsMap.set(emailKey, entry);
        }
      }
      const uniqueUserEmails = Array.from(uniqueEmailsMap.values());

      if (uniqueUserEmails.length !== userEmails.length) {
        console.warn(
          `[ClassReminderService] sendImmediateClassReminder:dedupe-emails removed ${
            userEmails.length - uniqueUserEmails.length
          } duplicate emails`,
        );
      }

      const trainerName = (meeting.trainer as any)?.name || "Your Trainer";
      const { regionTimeZone, regionLocalTime, regionLocalDate } =
        resolveMeetingRegionDetails(meeting);

      console.log("[ClassReminderService] sendImmediateClassReminder:queue-job", {
        meetingId: (meeting._id as string).toString(),
        region,
        usersCount: uniqueUserEmails.length,
        trainerName,
      });

      await addClassReminderEmailJob({
        meetingId: (meeting._id as string).toString(),
        meetingTitle: meeting.title,
        region: region,
        reminderOffsetMinutes: 10,
        liveTime: meeting.liveTime,
        classStartAt: meeting.localTime,
        startDate: meeting.startDate,
        regionTimeZone,
        regionLocalTime,
        regionLocalDate,
        duration: meeting.duration,
        trainerName: trainerName,
        userEmails: uniqueUserEmails,
      });

      console.log("[ClassReminderService] sendImmediateClassReminder:queued", {
        meetingId: (meeting._id as string).toString(),
        usersCount: uniqueUserEmails.length,
      });

      return {
        success: true,
        message: `Reminder emails queued for ${uniqueUserEmails.length} users`,
        emailsSent: uniqueUserEmails.length,
      };
    } catch (error) {
      console.error(`❌ Error sending immediate class reminder:`, error);
      throw error;
    }
  }
}
