// src/services/classReminder/ClassReminderService.ts
import countryModel  from "../modules/CountryModule/country.model";
import User from "../modules/UserModule/models/User";
import Meeting, { IPopulatedMeeting } from "../modules/MeetingModule/MeetingModels/Meeting";
import { addClassReminderEmailJob } from "./queues/classReminderEmailQueue";
import { IMeeting } from "../modules/MeetingModule/MeetingModels/Meeting";
import regionModel from "../modules/RegionModule/region.model";
import { PushNotificationService } from "./pushNotification.service";

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
      }).select("email firstName lastName countryCode");

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
        countryCode: user.countryCode || "",
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

      await addClassReminderEmailJob({
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
      });

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
        `✅ Class reminder job queued for ${uniqueUserEmails.length} users. Meeting: ${meeting.title}`
      );

      return {
        success: true,
        message: `Reminder emails queued for ${uniqueUserEmails.length} users`,
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
        countryCode: user.countryCode || "",
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
