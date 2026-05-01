import { NextFunction, Request, Response } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import Meeting, { IMeeting, IService } from "./MeetingModels/Meeting";
import MeetingAttendance from "./MeetingModels/MeetingAttendance";
import { clearZoomTokenCache, getZoomAccessToken } from "../../utils/zoomAuth";
import mongoose, { Types } from "mongoose";
import MeetingParticipant from "./MeetingModels/MeetingParticipant";
import User from "../UserModule/models/User";
import Service from "../ServiceModule/models/Service";
import { ServiceType } from "../UserModule/interface/userInterface";
import CountryRepository from "../CountryModule/country.repository";
import { ICountry } from "../CountryModule/country.model";
import TrainerModel from "../TrainerModule/TrainerModel";
import { channel } from "diagnostics_channel";
import { PushNotificationService } from "../../services/pushNotification.service";

const _countryRepository = new CountryRepository();

const toZoomEndDateTime = (dateInput: string | Date) => {
  const end = new Date(dateInput);
  // Keep whole end date inclusive for all recurrence types.
  end.setUTCHours(23, 59, 59, 999);
  // Zoom expects RFC3339 without milliseconds for recurrence end_date_time.
  return end.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const toZoomWeekDay = (date: Date) => {
  const jsWeekDay = date.getUTCDay();
  return jsWeekDay === 0 ? 7 : jsWeekDay;
};

const WEEKDAY_NAME_TO_ZOOM: Record<string, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

const toZoomApiWeekday = (internalWeekday: number) => {
  // Internal: Mon=1..Sun=7
  // Zoom API: Sun=1..Sat=7
  if (!Number.isInteger(internalWeekday) || internalWeekday < 1 || internalWeekday > 7) {
    return internalWeekday;
  }
  return internalWeekday === 7 ? 1 : internalWeekday + 1;
};

const toZoomApiWeeklyDaysCsv = (days: number[]) =>
  (Array.isArray(days) ? days : [])
    .map((day) => toZoomApiWeekday(Number(day)))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .join(",");

const isSameSlot = (a: Date, b: Date, toleranceMs = 60 * 1000) =>
  Math.abs(a.getTime() - b.getTime()) <= toleranceMs;

const resolveMeetingTimezone = (regions: any[], liveRegion: string): string => {
  if (!Array.isArray(regions)) return "UTC";
  const matchedRegion = regions.find(
    (entry) =>
      String(entry?.region || "").trim().toLowerCase() ===
      String(liveRegion || "").trim().toLowerCase(),
  );
  const tz = String(matchedRegion?.timezone || "").trim();
  return tz || "UTC";
};

const extractZoomPassword = (url?: string | null): string => {
  if (!url) return "";
  try {
    return new URL(url).searchParams.get("pwd") || "";
  } catch (error) {
    return "";
  }
};

const buildZoomAppJoinUrl = (
  meetingId: number | string,
  password?: string,
): string => {
  const baseUrl = `https://zoom.us/j/${meetingId}`;
  if (!password) return baseUrl;
  return `${baseUrl}?pwd=${encodeURIComponent(password)}`;
};

const getZoomWeekdayInTimezone = (date: Date, timeZone: string): number => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone,
  })
    .format(date)
    .toLowerCase()
    .slice(0, 3);
  return WEEKDAY_NAME_TO_ZOOM[weekday] || toZoomWeekDay(date);
};

const toZoomLocalDateTime = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value || "00";

  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}`;
};

const alignRecurringStartDate = ({
  startAt,
  recurrenceType,
  customDays,
  timeZone,
}: {
  startAt: Date;
  recurrenceType: "weekly" | "monthly" | "custom" | "bi-weekly";
  customDays: number[];
  timeZone: string;
}) => {
  if (!["custom", "bi-weekly"].includes(recurrenceType)) {
    return startAt;
  }

  const normalizedDays = Array.from(
    new Set(
      (Array.isArray(customDays) ? customDays : [])
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
    ),
  );

  if (normalizedDays.length === 0) return startAt;

  const selected = new Set(normalizedDays);
  if (selected.has(getZoomWeekdayInTimezone(startAt, timeZone))) {
    return startAt;
  }

  // Move to the nearest selected weekday in the future so first class is valid.
  for (let offset = 1; offset <= 14; offset++) {
    const candidate = new Date(startAt);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    if (selected.has(getZoomWeekdayInTimezone(candidate, timeZone))) {
      return candidate;
    }
  }

  return startAt;
};

const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const buildUtcDateWithBaseTime = (day: Date, base: Date) => {
  const next = new Date(day);
  next.setUTCHours(
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds(),
  );
  return next;
};

const getUtcMondayOfWeek = (date: Date) => {
  const dayStart = startOfUtcDay(date);
  const weekday = toZoomWeekDay(dayStart); // 1..7
  dayStart.setUTCDate(dayStart.getUTCDate() - (weekday - 1));
  return dayStart;
};

const getDatePartsInTimezone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const pick = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || "0");

  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
  };
};

const getMondayOfWeekInTimezone = (date: Date, timeZone: string) => {
  const { year, month, day } = getDatePartsInTimezone(date, timeZone);
  const weekDay = getZoomWeekdayInTimezone(date, timeZone); // 1..7 (Mon..Sun)
  const monday = new Date(Date.UTC(year, month - 1, day));
  monday.setUTCDate(monday.getUTCDate() - (weekDay - 1));
  return monday;
};

const countMonthlyOccurrencesInRange = (
  startAt: Date,
  endAt: Date,
  timeZone: string,
) => {
  const start = getDatePartsInTimezone(startAt, timeZone);
  const end = getDatePartsInTimezone(endAt, timeZone);
  const targetDay = start.day;

  if (!targetDay) return 1;

  let year = start.year;
  let month = start.month; // 1..12
  let count = 0;

  while (year < end.year || (year === end.year && month <= end.month)) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (targetDay <= daysInMonth) {
      const isBeforeOrOnEnd =
        year < end.year ||
        (year === end.year &&
          (month < end.month || (month === end.month && targetDay <= end.day)));
      if (isBeforeOrOnEnd) {
        count += 1;
      }
    }

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return Math.max(count, 1);
};

const countType2OccurrencesInRange = ({
  startAt,
  endAt,
  recurrenceType,
  customDays,
  timeZone,
}: {
  startAt: Date;
  endAt: Date;
  recurrenceType: "weekly" | "custom" | "bi-weekly";
  customDays: number[];
  timeZone: string;
}) => {
  const dates = generateRecurringDatesInRange({
    startAt,
    endAt,
    recurrenceType,
    customDays,
    timeZone,
  });
  return Math.max(dates.length, 1);
};

const generateRecurringDatesInRange = ({
  startAt,
  endAt,
  recurrenceType,
  customDays,
  timeZone,
}: {
  startAt: Date;
  endAt: Date;
  recurrenceType: "weekly" | "monthly" | "custom" | "bi-weekly";
  customDays: number[];
  timeZone?: string;
}) => {
  const result: Date[] = [];
  const safeStart = new Date(startAt);
  const safeEnd = new Date(endAt);
  if (isNaN(safeStart.getTime()) || isNaN(safeEnd.getTime()) || safeStart > safeEnd) {
    return result;
  }

  if (recurrenceType === "monthly") {
    const startDayOfMonth = safeStart.getUTCDate();
    let monthCursor = new Date(
      Date.UTC(safeStart.getUTCFullYear(), safeStart.getUTCMonth(), 1),
    );
    while (monthCursor <= safeEnd) {
      const daysInMonth = new Date(
        Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 0),
      ).getUTCDate();
      if (startDayOfMonth <= daysInMonth) {
        const candidate = new Date(
          Date.UTC(
            monthCursor.getUTCFullYear(),
            monthCursor.getUTCMonth(),
            startDayOfMonth,
            safeStart.getUTCHours(),
            safeStart.getUTCMinutes(),
            safeStart.getUTCSeconds(),
            safeStart.getUTCMilliseconds(),
          ),
        );
        if (candidate >= safeStart && candidate <= safeEnd) {
          result.push(candidate);
        }
      }
      monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
    }
    return result;
  }

  const validCustomDays =
    Array.isArray(customDays) && customDays.length > 0
      ? customDays
      : [
          timeZone
            ? getZoomWeekdayInTimezone(safeStart, timeZone)
            : toZoomWeekDay(safeStart),
        ];
  const selectedDays = new Set(validCustomDays);
  const weekAnchorMonday =
    recurrenceType === "bi-weekly" && timeZone
      ? getMondayOfWeekInTimezone(safeStart, timeZone)
      : getUtcMondayOfWeek(safeStart);
  const startWeekDayInContext =
    timeZone
      ? getZoomWeekdayInTimezone(safeStart, timeZone)
      : toZoomWeekDay(safeStart);

  let dayCursor = startOfUtcDay(safeStart);
  while (dayCursor <= safeEnd) {
    const candidate = buildUtcDateWithBaseTime(dayCursor, safeStart);
    if (candidate >= safeStart && candidate <= safeEnd) {
      const candidateWeekDayInContext =
        timeZone
          ? getZoomWeekdayInTimezone(candidate, timeZone)
          : toZoomWeekDay(candidate);
      const daySelected =
        recurrenceType === "weekly"
          ? candidateWeekDayInContext === startWeekDayInContext
          : recurrenceType === "bi-weekly"
            ? selectedDays.has(candidateWeekDayInContext)
            : selectedDays.has(candidateWeekDayInContext);
      if (daySelected) {
        if (recurrenceType === "bi-weekly") {
          const candidateMonday =
            timeZone
              ? getMondayOfWeekInTimezone(candidate, timeZone)
              : getUtcMondayOfWeek(candidate);
          const diffMs = candidateMonday.getTime() - weekAnchorMonday.getTime();
          const weekIndex = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
          if (weekIndex % 2 === 0) {
            result.push(candidate);
          }
        } else {
          result.push(candidate);
        }
      }
    }
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
  }

  return result;
};

export default class MeetingController {
static async CreateMeeting(req: Request, res: Response) {
  try {
    const token = await getZoomAccessToken();
    const {
      service,
      title,
      liveRegion,
      liveTime,
      trainer,
      duration,
      recurringClass = false,
      recurrenceType = "weekly",
      customDays = [],
      rotationEnabled,
      startDate,
      localTime,
      regions,
      adminId,
      weeklyEndDate,
    } = req.body;
    const normalizedCustomDays = Array.from(
      new Set(
        (Array.isArray(customDays) ? customDays : [])
          .map((day) => Number(day))
          .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
      ),
    );

    // Validate required fields
    if (
      !service ||
      !title ||
      !liveRegion ||
      !liveTime ||
      !trainer ||
      !duration ||
      !startDate ||
      !localTime ||
      !regions ||
      !adminId
    ) {
      console.warn(
        "⚠️ [CreateMeeting] Validation failed - Missing required fields",
      );
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Validate recurrence settings if recurring class is enabled
    if (recurringClass) {
      if (!recurrenceType || !["weekly", "monthly", "custom", "bi-weekly"].includes(recurrenceType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid recurrence type. Must be 'weekly', 'monthly', 'custom', or 'bi-weekly'",
        });
      }

      if (
        (recurrenceType === "custom" || recurrenceType === "bi-weekly") &&
        normalizedCustomDays.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Custom days are required and must be between 1 (Mon) and 7 (Sun) when recurrence type is 'custom' or 'bi-weekly'",
        });
      }
    }

    // Generate meeting topic
    const topic = `${title} - Live Class`;

    const meetingTimeZone = resolveMeetingTimezone(regions, liveRegion);
    const inputStartDateTime = new Date(localTime);
    const startDateTime = recurringClass
      ? alignRecurringStartDate({
          startAt: inputStartDateTime,
          recurrenceType,
          customDays: normalizedCustomDays,
          timeZone: meetingTimeZone,
        })
      : inputStartDateTime;

    // Get weekday for Zoom (1–7, where 1 = Monday, 7 = Sunday)
    const zoomWeekDay = getZoomWeekdayInTimezone(startDateTime, meetingTimeZone);

    // Format time as HH:MM for Zoom API
    const hours = String(startDateTime.getUTCHours()).padStart(2, "0");
    const minutes = String(startDateTime.getUTCMinutes()).padStart(2, "0");
    const startTimeForZoom = `${hours}:${minutes}`;

    console.log("⏰ [CreateMeeting] Meeting configuration:", {
      recurringClass,
      recurrenceType,
      customDays,
      zoomWeekDay,
      startTimeForZoom: toZoomLocalDateTime(startDateTime, meetingTimeZone),
      meetingTimeZone,
      weeklyEndDate: weeklyEndDate || "No end date (unlimited)",
    });

    // Build recurrence object based on settings
    let recurrenceSettings: any = null;

    if (recurringClass) {
      if (recurrenceType === "weekly") {
        // Weekly recurrence - every week on the same day
        recurrenceSettings = {
          type: 2, // Weekly
          repeat_interval: 1,
          weekly_days: toZoomApiWeekday(zoomWeekDay),
        };
      } else if (recurrenceType === "monthly") {
        // Monthly recurrence
        const dayOfMonth = getDatePartsInTimezone(
          startDateTime,
          meetingTimeZone,
        ).day;
        recurrenceSettings = {
          type: 3, // Monthly
          repeat_interval: 1,
          monthly_day: dayOfMonth,
        };
      } else if (recurrenceType === "custom") {
        // Custom days - weekly but on specific days
        recurrenceSettings = {
          type: 2, // Weekly
          repeat_interval: 1,
          weekly_days: toZoomApiWeeklyDaysCsv(normalizedCustomDays),
        };
      } else if (recurrenceType === "bi-weekly") {
        // Bi-weekly recurrence on selected weekdays
        recurrenceSettings = {
          type: 2, // Weekly
          repeat_interval: 2,
          weekly_days: toZoomApiWeeklyDaysCsv(normalizedCustomDays),
        };
      }

      // Add end date
      if (weeklyEndDate) {
        if (recurrenceType === "monthly") {
          const monthlyEnd = new Date(weeklyEndDate);
          recurrenceSettings.end_times = countMonthlyOccurrencesInRange(
            startDateTime,
            monthlyEnd,
            meetingTimeZone,
          );
        } else if (
          recurrenceType === "weekly" ||
          recurrenceType === "custom" ||
          recurrenceType === "bi-weekly"
        ) {
          const endTimes = countType2OccurrencesInRange({
            startAt: startDateTime,
            endAt: new Date(weeklyEndDate),
            recurrenceType,
            customDays: normalizedCustomDays,
            timeZone: meetingTimeZone,
          });
          // Zoom type-2 recurrence supports up to 60 occurrences.
          if (endTimes <= 60) {
            recurrenceSettings.end_times = endTimes;
          } else {
            recurrenceSettings.end_date_time = toZoomEndDateTime(weeklyEndDate);
          }
        } else {
          recurrenceSettings.end_date_time = toZoomEndDateTime(weeklyEndDate);
        }
      } else {
        const defaultEndDate = new Date(startDateTime);
        defaultEndDate.setFullYear(defaultEndDate.getFullYear() + 1);
        recurrenceSettings.end_date_time = toZoomEndDateTime(defaultEndDate);
      }
    }

    // Determine meeting type
    const meetingType = recurringClass ? 8 : 2; // 8 = recurring, 2 = scheduled

    console.log("📋 [CreateMeeting] Zoom API payload:", {
      topic,
      type: meetingType,
      start_time: toZoomLocalDateTime(startDateTime, meetingTimeZone),
      duration,
      recurrence: recurrenceSettings,
      timezone: meetingTimeZone,
    });

    const zoomPayload: any = {
      topic,
      type: meetingType,
      start_time: toZoomLocalDateTime(startDateTime, meetingTimeZone),
      duration,
      timezone: meetingTimeZone,
      settings: {
        mute_upon_entry: true,
        allow_multiple_audio_unmute: false,
        allow_participants_to_unmute_themselves: false,
        allow_participants_to_unmute: false,
        auto_recording: "cloud",
        host_video: true,
        participant_video: true,
        join_before_host: false,
        waiting_room: false,
      },
    };

    // Only add recurrence if it's a recurring meeting
    if (recurringClass && recurrenceSettings) {
      zoomPayload.recurrence = recurrenceSettings;
    }

    const zoomResponse = await axios.post(
      "https://api.zoom.us/v2/users/me/meetings",
      zoomPayload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    const meetingId = zoomResponse.data.id;
    const password = zoomResponse.data.password;
    const occurrences = zoomResponse.data.occurrences;

    // Web client URLs
    const webJoinUrl = `https://app.zoom.us/wc/${meetingId}/join?pwd=${password}&browser=1`;
    const webStartUrl = `https://app.zoom.us/wc/${meetingId}/start?pwd=${password}&browser=1`;

    const meetingRecord = await Meeting.create({
      zoomMeetingId: meetingId,
      service,
      title,
      regions,
      liveRegion,
      liveTime,
      trainer,
      duration,
      recurringClass,
      recurrenceType: recurringClass ? recurrenceType : null,
      customDays:
        recurringClass &&
        (recurrenceType === "custom" || recurrenceType === "bi-weekly")
          ? normalizedCustomDays
          : [],
      rotationEnabled: false,
      isRecurring: recurringClass,
      isLive: true,
      startDate: recurringClass ? startDateTime : new Date(startDate),
      localTime: startDateTime,
      joinUrl: webJoinUrl,
      startUrl: webStartUrl,
      recordingUrl: "",
      createdBy: adminId,
      weeklyEndDate: weeklyEndDate ? new Date(weeklyEndDate) : null,
    });

    console.log("✅ [CreateMeeting] Parent meeting saved to DB:", {
      id: meetingRecord._id,
      zoomMeetingId: meetingRecord.zoomMeetingId,
      isLive: meetingRecord.isLive,
      recurringClass: meetingRecord.recurringClass,
      recurrenceType: meetingRecord.recurrenceType,
      regionsCount: meetingRecord.regions.length,
      title: meetingRecord.title,
    });

    // Store all recurring instances in database
    const storedInstances: any[] = [];

    if (recurringClass) {
      const recurrenceRangeEnd = weeklyEndDate
        ? new Date(toZoomEndDateTime(weeklyEndDate))
        : null;

      type NormalizedOccurrence = {
        occurrenceId: string;
        startTime: Date;
      };

      let zoomOccurrences: any[] = Array.isArray(occurrences) ? occurrences : [];
      try {
        const zoomMeetingResp = await axios.get(
          `https://api.zoom.us/v2/meetings/${meetingId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            params: {
              show_previous_occurrences: true,
            },
          },
        );
        const fetchedOccurrences: any[] = Array.isArray(zoomMeetingResp?.data?.occurrences)
          ? zoomMeetingResp.data.occurrences
          : [];
        if (fetchedOccurrences.length > zoomOccurrences.length) {
          zoomOccurrences = fetchedOccurrences;
        }
      } catch (fetchErr: any) {
        console.warn(
          "⚠️ [CreateMeeting] Could not fetch full Zoom occurrences, using create response only:",
          fetchErr?.response?.data || fetchErr?.message,
        );
      }

      const normalizedByStart = new Map<number, NormalizedOccurrence>();
      for (const occ of zoomOccurrences) {
        const occurrenceId = String(occ?.occurrence_id || "");
        const occStart = new Date(occ?.start_time);
        if (!occurrenceId || isNaN(occStart.getTime())) continue;
        if (isSameSlot(occStart, startDateTime)) continue;
        if (recurrenceRangeEnd && occStart.getTime() > recurrenceRangeEnd.getTime()) {
          continue;
        }
        normalizedByStart.set(occStart.getTime(), { occurrenceId, startTime: occStart });
      }

      const targetOccurrences: NormalizedOccurrence[] = [];
      const seenOccurrenceIds = new Set<string>();
      for (const [, item] of normalizedByStart.entries()) {
        if (!seenOccurrenceIds.has(item.occurrenceId)) {
          seenOccurrenceIds.add(item.occurrenceId);
          targetOccurrences.push(item);
        }
      }

      if (
        recurrenceRangeEnd &&
        recurrenceType &&
        ["weekly", "monthly", "custom", "bi-weekly"].includes(recurrenceType)
      ) {
        const generatedDates = generateRecurringDatesInRange({
          startAt: new Date(startDateTime),
          endAt: recurrenceRangeEnd,
          recurrenceType: recurrenceType as
            | "weekly"
            | "monthly"
            | "custom"
            | "bi-weekly",
          customDays: normalizedCustomDays,
          timeZone: meetingTimeZone,
        });

        for (const generatedDate of generatedDates) {
          if (isSameSlot(generatedDate, startDateTime)) continue;
          const matchedZoom = normalizedByStart.get(generatedDate.getTime());
          const generatedOccurrenceId =
            matchedZoom?.occurrenceId || `local-${generatedDate.toISOString()}`;
          if (seenOccurrenceIds.has(generatedOccurrenceId)) continue;
          seenOccurrenceIds.add(generatedOccurrenceId);
          targetOccurrences.push({
            occurrenceId: generatedOccurrenceId,
            startTime: generatedDate,
          });
        }
      }

      console.log(`📦 [CreateMeeting] Storing ${targetOccurrences.length} recurring instances...`);
      for (const occ of targetOccurrences) {
        try {
          const instanceRecord = await Meeting.create({
            zoomMeetingId: meetingId,
            occurrenceId: occ.occurrenceId,
            service,
            title,
            regions,
            liveRegion,
            liveTime,
            trainer,
            duration,
            recurringClass: false,
            recurrenceType: null,
            customDays: [],
            rotationEnabled: false,
            isRecurring: false, // Individual instances are not recurring
            isLive: true,
            startDate: occ.startTime,
            localTime: occ.startTime,
            joinUrl: webJoinUrl,
            startUrl: webStartUrl,
            recordingUrl: "",
            createdBy: adminId,
            parentMeetingId: meetingRecord._id,
          });

          storedInstances.push({
            _id: instanceRecord._id,
            occurrenceId: occ.occurrenceId,
            startTime: occ.startTime.toISOString(),
          });
        } catch (error: any) {
          console.error(
            `  ❌ Error saving instance ${occ.occurrenceId}:`,
            error.message,
          );
        }
      }
    }

    let responseMessage = "";
    if (recurringClass) {
      const recurrenceInfo =
        recurrenceType === "custom" || recurrenceType === "bi-weekly"
        ? `custom schedule (${normalizedCustomDays.join(", ")})`
        : recurrenceType;
      responseMessage = `${recurrenceInfo.charAt(0).toUpperCase() + recurrenceInfo.slice(1)} recurring meeting "${title}" created successfully. Live session for ${liveRegion}. Recording available for other regions.`;
    } else {
      responseMessage = `Meeting "${title}" created successfully. Live session for ${liveRegion}. Recording available for other regions.`;
    }

    console.log("📊 [CreateMeeting] Response summary:", {
      meetingId: meetingRecord._id,
      title: meetingRecord.title,
      recurringClass: meetingRecord.recurringClass,
      recurrenceType: meetingRecord.recurrenceType,
      regionsCount: meetingRecord.regions.length,
      isRecurring: recurringClass,
      nextOccurrences: occurrences?.length || 0,
      storedInstances: storedInstances.length,
      message: responseMessage,
    });

    // PushNotificationService.sendMeetingLifecycleToRegion({
    //   action: "created",
    //   meetingId: String(meetingRecord._id),
    //   meetingTitle: meetingRecord.title,
    //   region: meetingRecord.liveRegion,
    //   localTime: new Date(meetingRecord.localTime),
    // }).catch((error: any) => {
    //   console.error("❌ Failed to send meeting-created push notification:", error?.message || error);
    // });

    return res.json({
      success: true,
      data: {
        meeting: meetingRecord,
        message: responseMessage,
        occurrences: occurrences,
        storedInstances: storedInstances,
        totalInstancesStored: storedInstances.length,
      },
    });
  } catch (error: any) {
    console.error("❌ [CreateMeeting] ERROR CAUGHT");
    console.error("📍 [CreateMeeting] Error type:", error.constructor.name);
    console.error("📝 [CreateMeeting] Error message:", error.message);
    console.error(
      "🔍 [CreateMeeting] Zoom API error data:",
      error.response?.data,
    );
    console.error("📊 [CreateMeeting] Full error object:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Error creating meeting",
      error: error.response?.data,
    });
  }
}

static async GetUpcomingMeetings(req: Request, res: Response) {
  console.log("📍 [GetUpcomingMeetings] Fetching upcoming meetings with query:", req.query);
	  try {
	    const { search = "", skip = 0, limit = 10, region } = req?.query;
	    const skipNum = parseInt(skip as string) || 0;
	    const limitNum = parseInt(limit as string) || 10;
	    const normalizedRegion =
	      typeof region === "string" ? region.trim() : "";
      const hasValidRegionFilter = Boolean(
        normalizedRegion &&
          normalizedRegion !== "+" &&
          normalizedRegion.toLowerCase() !== "all",
      );

    const userId = req.user?.id;
    const userRole = (req as any).user?.role;
    console.log("role", userRole);
    

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const user = await User.findById(userId).select(
      "plan country countryCode role trainer"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Check if user is admin or trainer
    const effectiveRole = user.role || userRole;
    const isAdminOrTrainer =
      effectiveRole === "admin" || effectiveRole === "trainer";
    const now = new Date();
    const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);
	    // ✅ Region validation - only required for regular users
	    if (!isAdminOrTrainer) {
	      if (!hasValidRegionFilter) {
	        return res.json({
	          success: true,
	          count: 0,
          totalCount: 0,
          hasMore: false,
          meetings: [],
          userPlan: user.plan,
          message: "Region not specified or invalid",
        });
      }
    }

    let serviceTitles: string[] = [];

    // ✅ Service filtering - only for regular users
    if (!isAdminOrTrainer) {
      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }
    }

    // Build filter
    const filter: any = {
      // Keep meetings visible in upcoming list for 60 minutes after start time
      localTime: { $gte: sixtyMinutesAgo },
      title: { $regex: search, $options: "i" },
    };

    // ✅ Trainer should only see assigned classes
    if (effectiveRole === "trainer") {
      if (!user.trainer) {
        return res.json({
          success: true,
          count: 0,
          totalCount: 0,
          hasMore: false,
          meetings: [],
          userPlan: user.plan,
          message: "No trainer assigned to this user",
        });
      }
      filter.trainer = user.trainer;
    }

    // ✅ Service filter - only add for regular users
    if (!isAdminOrTrainer && serviceTitles.length > 0) {
      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);
      filter.service = { $in: serviceIds };
    }

    // ✅ Region filter: only for regular users
    if (!isAdminOrTrainer) {
      filter.liveRegion = normalizedRegion;
    }

    console.log("📍 [GetUpcomingMeetings] User role:", userRole, "Is Admin/Trainer:", isAdminOrTrainer);
    console.log("📍 [GetUpcomingMeetings] Filter:", filter);

    // Get total count
    const totalCount = await Meeting.countDocuments(filter);

    // Fetch paginated meetings
    const meetings = await Meeting.find(filter)
      .sort({ localTime: 1 })
      .skip(skipNum)
      .limit(limitNum)
      .populate("service", "title name _id")
      .populate("trainer", "name email _id")
      .populate("createdBy", "firstName lastName email _id")
      .lean();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      count: meetings?.length,
      totalCount,
      hasMore: skipNum + limitNum < totalCount,
      meetings,
      userPlan: user.plan,
    });
  } catch (error: any) {
    console.error("Error fetching upcoming meetings:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Error fetching upcoming meetings",
    });
  }
}

static async GetAllMeetings(req: Request, res: Response) {
  try {
	    const { search = "", skip = 0, limit = 10, region } = req?.query;
	    const skipNum = parseInt(skip as string) || 0;
	    const limitNum = parseInt(limit as string) || 10;
	    const normalizedRegion =
	      typeof region === "string" ? region.trim() : "";
      const hasValidRegionFilter = Boolean(
        normalizedRegion &&
          normalizedRegion !== "+" &&
          normalizedRegion.toLowerCase() !== "all",
      );

    const userId = req.user?.id;
    console.log("user id ", userId);

    const userRole = (req as any).user?.role;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const user = await User.findById(userId).select(
      "plan country countryCode role trainer"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Check if user is admin or trainer
    const effectiveRole = user.role || userRole;
    const isAdminOrTrainer =
      effectiveRole === "admin" || effectiveRole === "trainer";
    const now = new Date();
    const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);

	    // ✅ Region validation - only required for regular users
	    if (!isAdminOrTrainer) {
	      if (!hasValidRegionFilter) {
	        return res.json({
	          success: true,
	          count: 0,
          totalCount: 0,
          hasMore: false,
          meetings: [],
          userPlan: user.plan,
          message: "Region not specified or invalid",
        });
      }
    }

    let serviceTitles: string[] = [];

    // ✅ Service filtering - only for regular users
    if (!isAdminOrTrainer) {
      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }
    }

    // Build filter
    const filter: any = {
      title: { $regex: search, $options: "i" },
    };

    // ✅ Trainer should only see assigned classes
    if (effectiveRole === "trainer") {
      if (!user.trainer) {
        return res.json({
          success: true,
          count: 0,
          totalCount: 0,
          hasMore: false,
          meetings: [],
          userPlan: user.plan,
          message: "No trainer assigned to this user",
        });
      }
      filter.trainer = user.trainer;
    }

    // ✅ Service filter - only add for regular users
    if (!isAdminOrTrainer && serviceTitles.length > 0) {
      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);
      filter.service = { $in: serviceIds };
    }

	    // ✅ Region filter: only for regular users
	    if (!isAdminOrTrainer) {
	      filter.liveRegion = normalizedRegion;
	    }

    // ✅ For regular users, show upcoming classes + past classes they attended
    if (!isAdminOrTrainer) {
      const attendedMeetingIds = await MeetingAttendance.distinct("meeting", {
        user: userId,
      });

      filter.$or = [
        // Upcoming (keep visible up to 60 minutes after start)
        { localTime: { $gte: sixtyMinutesAgo } },
        // Past sessions only if user attended
        { localTime: { $lt: sixtyMinutesAgo }, _id: { $in: attendedMeetingIds } },
      ];
    }

    console.log(
      "📍 [GetAllMeetings] User role:",
      effectiveRole,
      "Is Admin/Trainer:",
      isAdminOrTrainer,
    );
    console.log("📍 [GetAllMeetings] Filter:", filter);

    // Get total count for the filtered meetings
    const totalCount = await Meeting.countDocuments(filter);

    // Fetch paginated meetings
    const meetings = await Meeting.find(filter)
      .sort({ localTime: -1 }) // Sort by most recent first
      .skip(skipNum)
      .limit(limitNum)
      .populate("service", "title name _id")
      .populate("trainer", "name email _id")
      .populate("createdBy", "firstName lastName email _id")
      .lean();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      count: meetings?.length,
      totalCount,
      hasMore: skipNum + limitNum < totalCount,
      meetings,
      userPlan: user.plan,
    });
  } catch (error: any) {
    console.error("Error fetching all meetings:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Error fetching all meetings",
    });
  }
}

static async GetMeetingRecording(req: Request, res: Response) {
  let videoStream: any = null;
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();

  try {
    // Step 1: Find meeting
    console.log(`[${requestId}] 📋 Step 1: Finding meeting ${req.params.id}...`);
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      console.log(`[${requestId}] ❌ Meeting not found`);
      return res.status(404).json({ error: "Meeting not found" });
    }
    console.log(`[${requestId}] ✅ Meeting found: ${meeting.zoomMeetingId}`);

    // Step 2: Get access token
    console.log(`[${requestId}] 🔑 Step 2: Getting Zoom access token...`);
    const token = await getZoomAccessToken();
    console.log(`[${requestId}] ✅ Token obtained (length: ${token.length})`);

    // Step 3: Get recordings list
    console.log(`[${requestId}] 📹 Step 3: Fetching recordings from Zoom API...`);
    const { data: recordingsData } = await axios.get(
      `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}/recordings`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    console.log(`[${requestId}] ✅ Recordings API response received`);
    console.log(`[${requestId}] Total recording files: ${recordingsData.recording_files?.length || 0}`);
    const getFileDurationSeconds = (file: any): number => {
      const startMs = new Date(file?.recording_start || "").getTime();
      const endMs = new Date(file?.recording_end || "").getTime();
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        return Math.floor((endMs - startMs) / 1000);
      }
      return 0;
    };

    recordingsData.recording_files?.forEach((f: any, idx: number) => {
      console.log(
        `[${requestId}]   [${idx}] Type: ${f.file_type}, Size: ${f.file_size}, Name: ${f.file_name}, Duration: ${getFileDurationSeconds(f)}s`,
      );
    });

    // Step 4: Find best MP4 file
    console.log(`[${requestId}] 🎯 Step 4: Finding best MP4 file...`);
    const minDurationSeconds = 10 * 60;
    const mp4Candidates = (recordingsData.recording_files || [])
      .filter((f: any) => f.file_type === "MP4" && f.download_url)
      .map((f: any) => ({
        file: f,
        durationSeconds: getFileDurationSeconds(f),
        fileSize: Number(f.file_size || 0),
      }));

    if (!mp4Candidates.length) {
      console.log(`[${requestId}] ❌ No MP4 file found`);
      return res.status(404).json({ error: "Recording file not found" });
    }

    const byBestCandidate = (a: any, b: any) =>
      b.durationSeconds - a.durationSeconds ||
      b.fileSize - a.fileSize ||
      new Date(b.file?.recording_start || 0).getTime() -
        new Date(a.file?.recording_start || 0).getTime();

    const longCandidates = mp4Candidates
      .filter((entry: any) => entry.durationSeconds >= minDurationSeconds)
      .sort(byBestCandidate);

    const selected = longCandidates[0] || mp4Candidates.sort(byBestCandidate)[0];
    const file = selected.file;

    if (!longCandidates.length) {
      console.log(
        `[${requestId}] ⚠️ No MP4 >= ${minDurationSeconds}s. Falling back to longest MP4 (${selected.durationSeconds}s).`,
      );
    }

    console.log(`[${requestId}] ✅ MP4 file found`);
    console.log(`[${requestId}]   File name: ${file.file_name}`);
    console.log(`[${requestId}]   File size: ${file.file_size} bytes`);
    console.log(`[${requestId}]   Duration: ${selected.durationSeconds}s`);
    console.log(`[${requestId}]   Download URL: ${file.download_url.substring(0, 80)}...`);

    // Step 5: Prepare download URL
    console.log(`[${requestId}] 🔗 Step 5: Preparing download URL with access token...`);
    const downloadUrl = `${file.download_url}?access_token=${token}`;
    console.log(`[${requestId}] ✅ Download URL prepared`);

    // Step 6: Test HEAD request
    console.log(`[${requestId}] 📊 Step 6: Testing HEAD request...`);
    let fileSize = 0;
    try {
      const headResponse = await axios.head(downloadUrl, {
        timeout: 10000,
        maxRedirects: 5,
      });
      fileSize = parseInt(headResponse.headers["content-length"] || "0", 10);
      console.log(`[${requestId}] ✅ HEAD request successful`);
      console.log(`[${requestId}]   Status: ${headResponse.status}`);
      console.log(`[${requestId}]   Content-Type: ${headResponse.headers["content-type"]}`);
      console.log(`[${requestId}]   Content-Length: ${fileSize}`);
      console.log(`[${requestId}]   Accept-Ranges: ${headResponse.headers["accept-ranges"]}`);
    } catch (headErr: any) {
      console.warn(`[${requestId}] ⚠️  HEAD request failed: ${headErr.message}`);
      console.log(`[${requestId}] Continuing without file size...`);
    }

    // Step 7: Set response headers
    console.log(`[${requestId}] 📤 Step 7: Setting response headers...`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Disposition", 'inline; filename="recording.mp4"');
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    

    // Step 8: Handle Range requests
    const range = req.headers.range as string | undefined;
    console.log(`[${requestId}] 📍 Step 8: Range request handling...`);
    
    if (range && fileSize > 0) {
      console.log(`[${requestId}] ✅ Range request detected: ${range}`);
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Content-Length", chunkSize);

      console.log(`[${requestId}]   Sending 206 Partial Content`);
      console.log(`[${requestId}]   Range: ${start}-${end}/${fileSize}`);
      console.log(`[${requestId}]   Chunk size: ${chunkSize}`);

      videoStream = await axios.get(downloadUrl, {
        responseType: "stream",
        headers: {
          Range: `bytes=${start}-${end}`,
        },
        timeout: 30000,
        maxRedirects: 5,
      });
    } else {
      console.log(`[${requestId}] ℹ️  Full file request (no Range header)`);
      res.statusCode = 200;
      
      if (fileSize > 0) {
        res.setHeader("Content-Length", fileSize);
        console.log(`[${requestId}]   Content-Length: ${fileSize}`);
      }

      videoStream = await axios.get(downloadUrl, {
        responseType: "stream",
        timeout: 30000,
        maxRedirects: 5,
      });
    }

    console.log(`[${requestId}] ✅ Stream obtained from Zoom`);
    
    // Step 9: Set up stream error handlers
    console.log(`[${requestId}] 🛡️  Step 9: Setting up error handlers...`);

    videoStream.data.on("error", (error: Error) => {
      console.error(`[${requestId}] ❌ STREAM ERROR:`, error.message);
      if (!res.headersSent) {
        console.log(`[${requestId}] Sending 500 error response`);
        res.status(500).json({ error: "Stream error", details: error.message });
      } else {
        console.log(`[${requestId}] Headers already sent, destroying response`);
        res.destroy();
      }
    });

    res.on("error", (error: Error) => {
      console.error(`[${requestId}] ❌ RESPONSE ERROR:`, error.message);
      if (videoStream?.data?.destroy) {
        console.log(`[${requestId}] Destroying video stream`);
        videoStream.data.destroy();
      }
    });

    req.on("close", () => {
      console.log(`[${requestId}] 🔌 Client disconnected`);
      if (videoStream?.data?.destroy) {
        console.log(`[${requestId}] Cleaning up stream resources`);
        videoStream.data.destroy();
      }
    });

    // Step 10: Pipe stream to response
    console.log(`[${requestId}] 🚀 Step 10: Starting stream pipe...`);
    let bytesSent = 0;
    
    videoStream.data.on("data", (chunk: Buffer) => {
      bytesSent += chunk.length;
      if (bytesSent % (1024 * 1024) === 0) { // Log every 1MB
        console.log(`[${requestId}] 📊 Streamed: ${(bytesSent / 1024 / 1024).toFixed(2)} MB`);
      }
    });

    videoStream.data.on("end", () => {
      console.log(`[${requestId}] ✅ Stream ended`);
      console.log(`[${requestId}] Total bytes sent: ${bytesSent}`);
    });

    videoStream.data.pipe(res).on("error", (error: Error) => {
      console.error(`[${requestId}] ❌ PIPE ERROR:`, error.message);
      if (videoStream?.data?.destroy) {
        console.log(`[${requestId}] Destroying stream due to pipe error`);
        videoStream.data.destroy();
      }
    });

    console.log(`[${requestId}] ✅ Stream pipe established\n`);

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`\n[${requestId}] ❌ CRITICAL ERROR (${elapsed}ms elapsed)`);
    console.error(`[${requestId}] Error message: ${error.message}`);
    console.error(`[${requestId}] Error stack:`, error.stack);
    
    if (videoStream?.data?.destroy) {
      console.log(`[${requestId}] Cleaning up stream`);
      videoStream.data.destroy();
    }

    if (!res.headersSent) {
      console.log(`[${requestId}] Sending error response`);
      res.status(500).json({ 
        error: "Error streaming recording",
        details: error.message,
        requestId
      });
    } else {
      console.log(`[${requestId}] Headers already sent, cannot respond`);
      res.destroy();
    }
  }

  // Log completion
  const elapsed = Date.now() - startTime;
}

  static async GetTodaysMeetings(req: Request, res: Response) {
    try {
      const { search = "" } = req?.query;

      const userId = req.user?.id; // Assuming user is attached to request

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Fetch user with their plan
      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Get today's date range (start of day to end of day)
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );

      // Determine which service titles to filter based on plan
      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        // Diamond and Platinum can see all classes
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      // Fetch service IDs based on titles
      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      const meetings = await Meeting.find({
        localTime: {
          $gte: startOfDay,
          $lt: endOfDay,
        },
        title: { $regex: search, $options: "i" },
        service: { $in: serviceIds },
      })
        .sort({ localTime: 1 })
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: meetings?.length,
        meetings,
        userPlan: user.plan,
      });
    } catch (error: any) {
      console.error("Error fetching today's meetings:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching today's meetings",
      });
    }
  }

  /**
   * Get past/completed sessions for the current user
   * Shows sessions that have already occurred (localTime is in the past)
   * Supports pagination and search
   */
  static async GetPastSessions(req: Request, res: Response) {
    try {
      const { search = "", skip = 0, limit = 10 } = req?.query;
      const skipNum = parseInt(skip as string) || 0;
      const limitNum = parseInt(limit as string) || 10;

      const userId = req.user?.id;
      const userRole = (req as any).user?.role;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId).select(
        "plan country countryCode role trainer subscription createdAt",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const escapeRegex = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // ✅ Check if user is admin or trainer
      const effectiveRole = user.role || userRole;
      const isAdminOrTrainer =
        effectiveRole === "admin" || effectiveRole === "trainer";

      // Get current time - only show sessions that have already completed
      const now = new Date();
      const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);

      let serviceTitles: string[] = [];

      // ✅ Service filtering - only for regular users
      if (!isAdminOrTrainer) {
        if (user.plan === "gold-yoga") {
          serviceTitles = ["Yoga"];
        } else if (user.plan === "gold-zumba") {
          serviceTitles = ["Zumba Dance"];
        } else if (user.plan === "gold-mixed") {
          serviceTitles = ["Yoga", "Zumba Dance"];
        } else if (user.plan === "diamond" || user.plan === "platinum") {
          serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
        }
      }

      const filter: any = {
        localTime: { $lt: sixtyMinutesAgo },
      };

      // ✅ For regular users, only show sessions from when they joined the portal
      if (!isAdminOrTrainer) {
        const joinStart = user.createdAt || user.subscription?.startDate || null;
        if (joinStart) {
          filter.localTime.$gte = new Date(joinStart);
        }
      }

      // ✅ Trainer should only see assigned classes
      if (effectiveRole === "trainer") {
        if (!user.trainer) {
          return res.json({
            success: true,
            count: 0,
            totalCount: 0,
            hasMore: false,
            meetings: [],
            userPlan: user.plan,
            message: "No trainer assigned to this user",
          });
        }
        filter.trainer = user.trainer;
      }

      // ✅ Service filter - only add for regular users
      if (!isAdminOrTrainer && serviceTitles.length > 0) {
        const services = await Service.find({
          title: { $in: serviceTitles },
        }).select("_id");

        const serviceIds = services.map((service) => service._id);
        filter.service = { $in: serviceIds };
      }

      const pipeline: any[] = [
        { $match: filter },
        {
          $lookup: {
            from: "services",
            localField: "service",
            foreignField: "_id",
            as: "service",
          },
        },
        { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "coaches",
            localField: "trainer",
            foreignField: "_id",
            as: "trainer",
          },
        },
        { $unwind: { path: "$trainer", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "users",
            localField: "createdBy",
            foreignField: "_id",
            as: "createdBy",
          },
        },
        { $unwind: { path: "$createdBy", preserveNullAndEmptyArrays: true } },
      ];

      if (search && (search as string)?.trim()) {
        const searchRegex = new RegExp(escapeRegex(search as string), "i");
        pipeline.push({
          $match: {
            $or: [
              { title: searchRegex },
              { "service.title": searchRegex },
              { "trainer.name": searchRegex },
            ],
          },
        });
      }

      const totalCountAgg = await Meeting.aggregate([
        ...pipeline,
        { $count: "totalCount" },
      ]);
      const totalCount = totalCountAgg[0]?.totalCount || 0;

      const enrichedMeetings = await Meeting.aggregate([
        ...pipeline,
        { $sort: { localTime: -1 } },
        { $skip: skipNum },
        { $limit: limitNum },
      ]);

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: enrichedMeetings?.length,
        totalCount,
        hasMore: skipNum + limitNum < totalCount,
        meetings: enrichedMeetings,
        userPlan: user.plan,
      });
    } catch (error: any) {
      console.error("Error fetching past sessions:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching past sessions",
      });
    }
  }

  /**
   * Get user session history (attended sessions only)
   * Uses MeetingAttendance as the source of truth for the current user
   */
  static async GetSessionHistory(req: Request, res: Response) {
    try {
      const { search = "", skip = 0, limit = 10 } = req?.query;
      const skipNum = parseInt(skip as string) || 0;
      const limitNum = parseInt(limit as string) || 10;

      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const now = new Date();

      const escapeRegex = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const attendanceMatch: any = {
        user: new mongoose.Types.ObjectId(userId),
        $or: [
          { totalDuration: { $gt: 0 } },
          { status: { $in: ["joined", "completed"] } },
          { "sessions.0": { $exists: true } },
        ],
      };

      const pipeline: any[] = [
        { $match: attendanceMatch },
        {
          $lookup: {
            from: "meetings",
            localField: "meeting",
            foreignField: "_id",
            as: "meeting",
          },
        },
        { $unwind: "$meeting" },
        {
          $match: {
            "meeting.localTime": { $lt: now },
            "meeting.status": { $in: ["completed", "pending"] },
          },
        },
        {
          $lookup: {
            from: "services",
            localField: "meeting.service",
            foreignField: "_id",
            as: "service",
          },
        },
        { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "coaches",
            localField: "meeting.trainer",
            foreignField: "_id",
            as: "trainer",
          },
        },
        { $unwind: { path: "$trainer", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "users",
            localField: "meeting.createdBy",
            foreignField: "_id",
            as: "createdBy",
          },
        },
        { $unwind: { path: "$createdBy", preserveNullAndEmptyArrays: true } },
      ];

      if (search && (search as string)?.trim()) {
        const searchRegex = new RegExp(escapeRegex(search as string), "i");
        pipeline.push({
          $match: {
            $or: [
              { "meeting.title": searchRegex },
              { "service.title": searchRegex },
              { "trainer.name": searchRegex },
            ],
          },
        });
      }

      const totalCountAgg = await MeetingAttendance.aggregate([
        ...pipeline,
        { $count: "totalCount" },
      ]);
      const totalCount = totalCountAgg[0]?.totalCount || 0;

      const meetings = await MeetingAttendance.aggregate([
        ...pipeline,
        { $sort: { "meeting.localTime": -1 } },
        { $skip: skipNum },
        { $limit: limitNum },
        {
          $project: {
            _id: "$meeting._id",
            title: "$meeting.title",
            localTime: "$meeting.localTime",
            duration: "$meeting.duration",
            recordingUrl: "$meeting.recordingUrl",
            status: "$meeting.status",
            service: {
              _id: "$service._id",
              title: "$service.title",
              name: "$service.name",
            },
            trainer: {
              _id: "$trainer._id",
              name: "$trainer.name",
              email: "$trainer.email",
            },
            createdBy: {
              _id: "$createdBy._id",
              firstName: "$createdBy.firstName",
              lastName: "$createdBy.lastName",
              email: "$createdBy.email",
            },
            attendance: {
              totalDuration: "$totalDuration",
              status: "$status",
            },
          },
        },
      ]);

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: meetings?.length,
        totalCount,
        hasMore: skipNum + limitNum < totalCount,
        meetings,
        userPlan: user.plan,
      });
    } catch (error: any) {
      console.error("Error fetching session history:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching session history",
      });
    }
  }

  static async GetTrainerUpcomingMeetings(req: Request, res: Response) {
    try {
      const userId = req.user?.id; // User ID from auth
      const { search = "", date } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Fetch user and get their trainer ID
      const user = await User.findById(userId).select("trainer");

      if (!user || !user.trainer) {
        return res.status(400).json({
          success: false,
          message: "User is not associated with a trainer profile",
        });
      }

      const trainerId = user.trainer;

      // Get today's date at midnight
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get tomorrow at midnight
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // If specific date is provided, use that
      let startTime = today;
      let endTime = tomorrow;

      if (date) {
        const specifiedDate = new Date(date as string);
        specifiedDate.setHours(0, 0, 0, 0);
        startTime = specifiedDate;
        endTime = new Date(specifiedDate);
        endTime.setDate(endTime.getDate() + 1);
      }

      // Find meetings where this trainer is assigned
      const meetings = await Meeting.find({
        trainer: trainerId, // Filter by trainer
        localTime: {
          $gte: startTime,
          $lt: endTime,
        },
        title: { $regex: search || "", $options: "i" },
      })
        .sort({ localTime: 1 })
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      // Transform response to include region info
      const formattedMeetings = meetings.map((meeting: any) => ({
        ...meeting,
        regions: [
          {
            region: meeting.region || "IN",
            mode: meeting.isLive ? "live" : "recorded",
          },
        ],
      }));

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: formattedMeetings.length,
        meetings: formattedMeetings,
        date: date || today.toISOString().split("T")[0],
      });
    } catch (error: any) {
      console.error("Error fetching trainer upcoming meetings:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching upcoming meetings",
      });
    }
  }

  static async getWeeklyActivity(req: Request, res: Response) {
    try {
      const userId = req.user?.id || req.params.userId;

      if (!userId) {
        return res.status(400).json({ message: "User ID required" });
      }

      // Get start & end of current week (Mon - Sun)
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Fetch attendance records for this week
      const attendances = await MeetingAttendance.find({
        user: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startOfWeek, $lte: endOfWeek },
      }).lean();

      // Prepare week map
      const weekDays = ["M", "T", "W", "T", "F", "S", "S"];
      const activityMap: Record<number, boolean> = {
        0: false,
        1: false,
        2: false,
        3: false,
        4: false,
        5: false,
        6: false,
      };

      // Mark active days
      attendances.forEach((attendance) => {
        attendance.sessions?.forEach((session) => {
          const dayIndex = (new Date(session.joinTime).getDay() + 6) % 7;
          activityMap[dayIndex] = true;
        });

        if (attendance.status === "completed" && attendance.completedAt) {
          const dayIndex = (new Date(attendance.completedAt).getDay() + 6) % 7;
          activityMap[dayIndex] = true;
        }
      });

      const days = weekDays.map((day, index) => ({
        day,
        completed: activityMap[index],
      }));

      const completedDays = days.filter((d) => d.completed).length;
      const progressPercent = Math.round((completedDays / 7) * 100);

      res.json({
        totalDays: 7,
        completedDays,
        progressPercent,
        days,
      });
    } catch (error) {
      console.error("Weekly activity error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }

  static async JoinMeeting(req: Request, res: Response) {
    try {
      const { meetingId, userId, region } = req.body;
      const user = req.user;

      const userData = await User.findById(userId);
      if (!userData) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Find the meeting
      const meeting = await Meeting.findById(meetingId).populate(
        "createdBy",
        "_id",
      );

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      console.log("meeting", meeting);

      // Check if user is a trainer or admin
      const isTrainer = userData.role === "trainer";
      const isAdmin = userData.role === "admin";
      const isTrainerOrAdmin = isTrainer || isAdmin;

      if (
        !isTrainerOrAdmin &&
        String(meeting.status || "").toLowerCase() === "completed"
      ) {
        return res.status(403).json({
          success: false,
          message: "meeting is completed by trainer please watch recording",
        });
      }

      // Determine service type
      const serviceType =
        (meeting?.service as IService)?.title?.toLowerCase() == "zumba dance"
          ? "zumba"
          : (meeting?.service as IService)?.title?.toLowerCase();

      // Check class credits only for regular participants (not trainers or admins)
      if (!isTrainerOrAdmin) {
        const credits: any =
          userData.classCredits?.[serviceType as ServiceType] || 0;

        if (credits <= 0) {
          return res.status(403).json({
            success: false,
            message: `You do not have enough ${serviceType} credits to join this session`,
          });
        }
      }

      // Find the region entry for this specific region
      // const regionEntry = meeting.regions.find(
      //   (r) => r.region.toLowerCase() === region.toLowerCase(),
      // );

      // if (!regionEntry) {
      //   return res.status(404).json({
      //     success: false,
      //     message: `Region "${region}" not found in this meeting`,
      //   });
      // }

      // Check if meeting has ended
      const meetingEndTime =
        new Date(meeting.localTime).getTime() + meeting.duration * 60000;
      const currentTime = Date.now();

      // if (currentTime > meetingEndTime) {
      //   return res.status(400).json({
      //     success: false,
      //     expired: true,
      //     message: "Meeting has already ended",
      //   });
      // }

      // Determine the URL based on region mode
      let accessUrl: string;
      const recordUrl = `${process.env.API_BASE_URL}/meetings/${meeting?._id}/recording`;
      const isLiveMode = "live";

      if (isLiveMode) {
        // Admin/Trainer enter as host via startUrl, participants use joinUrl.
        accessUrl =
          isTrainerOrAdmin && meeting?.startUrl
            ? meeting.startUrl
            : meeting?.joinUrl;
      } else {
        // For replay mode, use the recordingUrl
        // Check if recording is available
        if (!meeting?.recordingUrl) {
          return res.status(400).json({
            success: false,
            message:
              "Recording not yet available. Meeting may still be in progress or processing.",
            canRetry: true,
          });
        }
        // accessUrl = meeting?.recordingUrl;
        accessUrl = `${process.env.API_BASE_URL}/meetings/${meeting?._id}/recording`;
      }

      const zoomPassword = extractZoomPassword(
        meeting?.startUrl || meeting?.joinUrl,
      );
      const appAccessUrl =
        isLiveMode && meeting?.zoomMeetingId
          ? buildZoomAppJoinUrl(meeting.zoomMeetingId, zoomPassword)
          : null;

      // console.log("meeting id", meeting.zoomMeetingId);

      const participantRecord = await MeetingParticipant.create({
        meetingId,
        zoomMeetingId: meeting.zoomMeetingId,
        userId: user!.id,
        email: user!.email,
        // zoomParticipantId will be filled when webhook fires
      });

      // Find or create attendance record
      let attendance = await MeetingAttendance.findOne({
        meeting: meetingId,
        user: userId,
      });

      if (!attendance) {
        attendance = await MeetingAttendance.create({
          meeting: meetingId,
          user: userId,
          region, // Store which region user is accessing from
          status: "joined",
          joinedAt: new Date(),
          totalSessions: 1,
          sessions: [{ joinTime: new Date(), mode: isLiveMode }],
        });
      } else {
        // Add new session entry with mode info
        attendance.sessions.push({
          joinTime: new Date(),
          mode: isLiveMode,
        });
        if (attendance.status === "registered") {
          attendance.status = "joined";
        }
        attendance.joinedAt = attendance.joinedAt || new Date();
        attendance.totalSessions = (attendance.totalSessions || 0) + 1;
        await attendance.save();
      }

      PushNotificationService.sendBookingConfirmed(String(userId), {
        meetingId: String(meeting._id),
        meetingTitle: meeting.title,
        localTime: new Date(meeting.localTime),
      }).catch((error: any) => {
        console.error("❌ Failed to send booking-confirmed push notification:", error?.message || error);
      });

      return res.json({
        success: true,
        data: {
          accessUrl, // Returns joinUrl for live, recordingUrl for replay
          appAccessUrl,
          // need to change
          // mode: regionEntry.mode,
          mode: isLiveMode,
          recordUrl,
          attendanceId: attendance._id,
          role: isTrainerOrAdmin ? 1 : 0,
          meetingDetails: {
            meetingId: meeting._id,
            // region: regionEntry.region,
            // timezone: regionEntry.timezone,
            // localTime: regionEntry.localTime,
            service: meeting.service,
            trainer: meeting.trainer,
            liveRegion: meeting.liveRegion,
            duration: meeting.duration,
          },
        },
      });
    } catch (error: any) {
      console.error("Error joining meeting:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error joining meeting",
      });
    }
  }
  // -----------------------------------------
  // LEAVE MEETING
  // -----------------------------------------
  static async LeaveMeeting(req: Request, res: Response) {
    try {
      const { attendanceId, userId } = req.body;

      const attendance = await MeetingAttendance.findById(attendanceId);
      if (!attendance) {
        return res.status(404).json({
          success: false,
          message: "Attendance record not found",
        });
      }

      // Update the last session with leave time
      if (attendance.sessions.length > 0) {
        const lastSession = attendance.sessions[attendance.sessions.length - 1];
        lastSession.leaveTime = new Date();

        // Calculate session duration in minutes
        const duration =
          (lastSession.leaveTime.getTime() - lastSession.joinTime.getTime()) /
          60000;
        lastSession.duration = Math.round(duration);
      }

      await attendance.save();

      return res.json({
        success: true,
        message: "Left meeting successfully",
        data: {
          attendanceId: attendance._id,
        },
      });
    } catch (error: any) {
      console.error("Error leaving meeting:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error leaving meeting",
      });
    }
  }

  static async getSessionsWithPagination(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const limit = Math.max(parseInt(req.query.limit as string) || 10, 1);
      const search = String(req.query.search || "").trim();
      const skip = (page - 1) * limit;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const attendedStatuses: Array<"joined" | "completed"> = [
        "joined",
        "completed",
      ];

      const filter: any = {
        user: new Types.ObjectId(userId),
        status: { $in: attendedStatuses },
      };

      const meetingPopulate: any = {
        path: "meeting",
        select: "title description startDate localTime duration trainer",
      };

      if (search) {
        meetingPopulate.match = {
          title: { $regex: search, $options: "i" },
        };
      }

      const [records, totalBeforeSearch] = await Promise.all([
        MeetingAttendance.find(filter, {
          meeting: 1,
          user: 1,
          sessions: 1,
          totalDuration: 1,
          totalSessions: 1,
          completedAt: 1,
          joinedAt: 1,
          region: 1,
          progress: 1,
          status: 1,
          createdAt: 1,
        })
          .populate(meetingPopulate)
          .sort({ completedAt: -1, joinedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        MeetingAttendance.countDocuments(filter),
      ]);

      const sessions = records.filter((record: any) => Boolean(record?.meeting));

      let total = totalBeforeSearch;
      if (search) {
        total = await MeetingAttendance.aggregate([
          {
            $match: {
              user: new Types.ObjectId(userId),
              status: { $in: attendedStatuses },
            },
          },
          {
            $lookup: {
              from: "meetings",
              localField: "meeting",
              foreignField: "_id",
              as: "meetingDoc",
            },
          },
          { $unwind: "$meetingDoc" },
          {
            $match: {
              "meetingDoc.title": { $regex: search, $options: "i" },
            },
          },
          { $count: "total" },
        ]).then((result) => result?.[0]?.total || 0);
      }

      return res.json({
        success: true,
        data: {
          sessions,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit) || 1,
            total,
            limit,
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error: any) {
      console.error("Error fetching completed attended sessions:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Error fetching completed sessions",
      });
    }
  }

  // Add this to your MeetingController

  static async GetMonthlyAttendance(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      const { period = "6months" } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Get current date and calculate back based on period
      const now = new Date();
      let monthsBack = 5; // default 6 months (including current)

      if (period === "3months") {
        monthsBack = 2; // 3 months including current
      } else if (period === "1year") {
        monthsBack = 11; // 12 months including current
      }

      const periodAgo = new Date(now);
      periodAgo.setMonth(periodAgo.getMonth() - monthsBack);

      // Aggregate attendance by month
      const monthlyData = await MeetingAttendance.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            status: { $in: ["joined", "completed"] },
            createdAt: {
              $gte: periodAgo,
            },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        {
          $sort: {
            "_id.year": 1,
            "_id.month": 1,
          },
        },
      ]);

      // Format the response with month names
      const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];

      // Create an array of all months in the selected period
      const allMonths = [];
      for (let i = monthsBack; i >= 0; i--) {
        const date = new Date(now);
        date.setMonth(date.getMonth() - i);
        allMonths.push({
          month: monthNames[date.getMonth()],
          year: date.getFullYear(),
          monthNum: date.getMonth() + 1,
        });
      }

      // Map aggregated data to include all months with 0 count if no data
      const formattedData = allMonths.map((monthObj) => {
        const found = monthlyData.find(
          (item) =>
            item._id.month === monthObj.monthNum &&
            item._id.year === monthObj.year,
        );
        return {
          month: monthObj.month,
          count: found ? found.count : 0,
        };
      });

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        data: formattedData,
      });
    } catch (error: any) {
      console.error("Error fetching monthly attendance:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching monthly attendance",
      });
    }
  }

  static async getAllMeetings(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || "";
      const status = (req.query.status as string) || "";
      const filter = (req.query.filter as string) || "";

      // Calculate skip for pagination
      const skip = (page - 1) * limit;

      // Build search query
      const searchQuery: any = {};

      if (search) {
        searchQuery.$or = [
          { title: { $regex: search, $options: "i" } },
          { "trainer.name": { $regex: search, $options: "i" } },
          { liveRegion: { $regex: search, $options: "i" } },
        ];
      }

      const normalizedStatus = String(status || "").trim().toLowerCase();
      if (normalizedStatus && normalizedStatus !== "all") {
        if (normalizedStatus === "upcoming" || normalizedStatus === "completed") {
          const now = new Date();
          const meetingEndExpr = {
            $add: [
              "$localTime",
              { $multiply: ["$duration", 60 * 1000] },
            ],
          };
          searchQuery.$expr =
            normalizedStatus === "completed"
              ? { $lt: [meetingEndExpr, now] }
              : { $gte: [meetingEndExpr, now] };
        } else if (normalizedStatus === "live" || normalizedStatus === "replay") {
          // Backward compatibility: treat as isLive flag
          searchQuery.isLive = normalizedStatus === "live";
        }
      }

      // Add service filter (ObjectId)
      if (filter) {
        const filterIds = filter.split(",").map((id) => id.trim());
        searchQuery.service = { $in: filterIds };
      }

      // Fetch meetings with pagination and populate references
      const meetings = await Meeting.find(searchQuery)
        .populate("service")
        .populate("trainer")
        .populate("createdBy")
        .sort({ startDate: 1, localTime: 1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Get total count for pagination info
      const totalCount = await Meeting.countDocuments(searchQuery);
      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        success: true,
        data: {
          meetings,
          pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error: any) {
      console.error("Error fetching monthly attendance:", error.message);
      next();
    }
  }


  static async CreateShareLink(req: Request, res: Response) {
    try {
      const { meetingId } = req.body;

      if (!meetingId || !mongoose.Types.ObjectId.isValid(meetingId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid meeting ID",
        });
      }

      const meeting = await Meeting.findById(meetingId).select(
        "localTime duration joinUrl",
      );

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const meetingEndMs =
        new Date(meeting.localTime).getTime() + meeting.duration * 60000;
      const graceMs = 2 * 60 * 60 * 1000;
      let expSec = Math.floor((meetingEndMs + graceMs) / 1000);

      if (!Number.isFinite(expSec)) {
        expSec = nowSec + 7 * 24 * 60 * 60;
      }

      const ttlSec = Math.max(expSec - nowSec, 15 * 60);
      const secret =
        process.env.MEETING_SHARE_SECRET ||
        process.env.JWT_ACCESS_SECRET ||
        "meeting-share-secret";

      const token = jwt.sign(
        { meetingId: (meeting._id as number).toString(), typ: "meeting_share" },
        secret,
        { expiresIn: ttlSec },
      );

      const expiresAt = new Date((nowSec + ttlSec) * 1000).toISOString();
      const frontendUrl = process.env.FRONTEND_URL || process.env.WEB_URL || "";
      const shareUrl = frontendUrl
        ? `${frontendUrl.replace(/\/$/, "")}/zoom-redirect?token=${token}`
        : null;

      return res.json({
        success: true,
        data: {
          token,
          expiresAt,
          shareUrl,
        },
      });
    } catch (error: any) {
      console.error("Error creating share link:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error creating share link",
      });
    }
  }

  static async RedirectMeeting(req: Request, res: Response) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Token is required",
        });
      }

      const secret =
        process.env.MEETING_SHARE_SECRET ||
        process.env.JWT_ACCESS_SECRET ||
        "meeting-share-secret";

      let decoded: any;

      try {
        decoded = jwt.verify(token, secret);
      } catch (error: any) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token",
        });
      }

      if (
        !decoded ||
        typeof decoded !== "object" ||
        decoded.typ !== "meeting_share" ||
        !decoded.meetingId
      ) {
        return res.status(401).json({
          success: false,
          message: "Invalid token",
        });
      }

      const meeting = await Meeting.findById(decoded.meetingId).select(
        "joinUrl",
      );

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      if (!meeting.joinUrl) {
        return res.status(400).json({
          success: false,
          message: "Join URL not available",
        });
      }

      return res.json({
        success: true,
        joinUrl: meeting.joinUrl,
        meetingId: meeting._id,
      });
    } catch (error: any) {
      console.error("Error redirecting meeting:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error redirecting meeting",
      });
    }
  }

  static async DeepLinkRedirect(req: Request, res: Response) {
    try {
      const { meetingId } = req.params;

      if (!meetingId) {
        return res.status(400).json({
          success: false,
          message: "Meeting ID is required",
        });
      }

      // Verify the meeting exists
      const meeting = await Meeting.findById(meetingId).select("_id title");

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      // Get frontend URL from environment
      const frontendUrl = process.env.FRONTEND_URL || process.env.WEB_URL || "https://app.skybornedrop.com";
      
      // Redirect to the meeting page on the web app
      // Email clients will follow this redirect properly
      const redirectUrl = `${frontendUrl.replace(/\/$/, "")}/class/${encodeURIComponent(meetingId)}`;
      
      // Use HTTP 301 redirect (permanent) - works reliably in email clients
      return res.redirect(301, redirectUrl);
    } catch (error: any) {
      console.error("Error in deep link redirect:", error.message);
      return res.status(500).json({
        success: false,
        message: "Error processing deep link",
      });
    }
  }

  static async GetMeetingById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Validate MongoDB ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid meeting ID",
        });
      }

      const meeting = await Meeting.findById(id)
        .populate("service", "_id title description image isActive")
        .populate("trainer", "_id name email")
        .populate("createdBy", "_id firstName lastName email")
        .lean();

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      return res.json({
        success: true,
        data: meeting,
      });
    } catch (error: any) {
      console.error("Error fetching meeting:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching meeting",
      });
    }
  }

static async UpdateMeeting(req: Request, res: Response) {
  try {
    const { id } = req.params;

    // Validate MongoDB ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid meeting ID",
      });
    }

    const {
      service,
      title,
      liveRegion,
      liveTime,
      trainer,
      duration,
      status,
      autoRecording,
      rotationEnabled,
      startDate,
      localTime,
      regions,
      recurringClass,
      recurrenceType,
      customDays,
      weeklyEndDate,
    } = req.body;

    const hasStatusOnlyUpdate =
      status !== undefined &&
      service === undefined &&
      title === undefined &&
      liveRegion === undefined &&
      liveTime === undefined &&
      trainer === undefined &&
      duration === undefined &&
      autoRecording === undefined &&
      rotationEnabled === undefined &&
      startDate === undefined &&
      localTime === undefined &&
      regions === undefined &&
      recurringClass === undefined &&
      recurrenceType === undefined &&
      customDays === undefined &&
      weeklyEndDate === undefined;

    // Find the meeting by ID only.
    let meeting = await Meeting.findById(id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found",
      });
    }

    const previousMeetingSnapshot = {
      title: String(meeting.title || ""),
      localTime: new Date(meeting.localTime),
      liveRegion: String(meeting.liveRegion || ""),
    };

    if (hasStatusOnlyUpdate) {
      const normalizedStatus = String(status || "")
        .trim()
        .toLowerCase();
      const allowedStatuses = ["pending", "completed", "failed"];

      if (!allowedStatuses.includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Allowed: pending, completed, failed",
        });
      }

      meeting.status = normalizedStatus as "pending" | "completed" | "failed";
      await meeting.save();

      const occurrenceId = String((meeting as any).occurrenceId || "").trim();
      const localTimeMs = new Date(meeting.localTime).getTime();
      const slotWindowMs = 60 * 1000;
      const statusSyncFilter: any = {
        zoomMeetingId: meeting.zoomMeetingId,
        _id: { $ne: meeting._id },
      };

      if (occurrenceId) {
        statusSyncFilter.occurrenceId = occurrenceId;
      } else if (!Number.isNaN(localTimeMs)) {
        statusSyncFilter.localTime = {
          $gte: new Date(localTimeMs - slotWindowMs),
          $lte: new Date(localTimeMs + slotWindowMs),
        };
      }

      await Meeting.updateMany(statusSyncFilter, {
        $set: { status: normalizedStatus },
      });

      return res.json({
        success: true,
        data: {
          meeting,
          message: `Meeting marked as ${normalizedStatus}`,
        },
      });
    }

    const updateScope = String(
      (req.query.scope as string) || req.body?.scope || "",
    ).toLowerCase();
    const defaultSingleForRecurringParent =
      Boolean(
        meeting.recurringClass &&
          !meeting.parentMeetingId &&
          updateScope !== "series",
      );
    const isSingleClassUpdate = Boolean(
      meeting.parentMeetingId ||
        updateScope === "single" ||
        defaultSingleForRecurringParent,
    );

    const nextService = service ?? meeting.service;
    const nextTitle = title ?? meeting.title;
    const nextLiveRegion = liveRegion ?? meeting.liveRegion;
    const nextLiveTime = liveTime ?? meeting.liveTime;
    const nextTrainer = trainer ?? meeting.trainer;
    const nextDuration = duration ?? meeting.duration;
    const nextRotationEnabled =
      typeof rotationEnabled === "boolean"
        ? rotationEnabled
        : meeting.rotationEnabled;
    const nextRegions = regions ?? meeting.regions;

    // Validate recurrence settings only for series update.
    const nextRecurringClass =
      typeof recurringClass === "boolean"
        ? recurringClass
        : meeting.recurringClass;
    const nextRecurrenceType = nextRecurringClass
      ? recurrenceType ?? meeting.recurrenceType ?? "weekly"
      : null;
    const nextCustomDays = nextRecurringClass
      ? Array.from(
          new Set(
            (
              Array.isArray(customDays)
                ? customDays
                : Array.isArray(meeting.customDays)
                  ? meeting.customDays
                  : []
            )
              .map((day) => Number(day))
              .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
          ),
        )
      : [];
    const nextWeeklyEndDate =
      weeklyEndDate !== undefined
        ? (weeklyEndDate ? new Date(weeklyEndDate) : null)
        : meeting.weeklyEndDate ?? null;

    if (!isSingleClassUpdate && nextRecurringClass) {
      if (!nextRecurrenceType || !["weekly", "monthly", "custom", "bi-weekly"].includes(nextRecurrenceType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid recurrence type. Must be 'weekly', 'monthly', 'custom', or 'bi-weekly'",
        });
      }

      if (
        (nextRecurrenceType === "custom" || nextRecurrenceType === "bi-weekly") &&
        nextCustomDays.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Custom days are required when recurrence type is 'custom' or 'bi-weekly'",
        });
      }
    }

	    console.log("✅ [UpdateMeeting] Meeting found, updating fields...");
	    const meetingTimeZone = resolveMeetingTimezone(nextRegions, nextLiveRegion);

	    if (isSingleClassUpdate) {
	      let occurrenceIdToUpdate: string | null = meeting.occurrenceId
	        ? String(meeting.occurrenceId)
	        : null;
	      const singleClassLocalTime = localTime
	        ? new Date(localTime)
	        : new Date(meeting.localTime);
	      if (isNaN(singleClassLocalTime.getTime())) {
	        return res.status(400).json({
	          success: false,
	          message: "Invalid localTime provided for meeting update",
	        });
	      }

	      try {
	        const token = await getZoomAccessToken();
	        const topic = `${nextTitle} - Live Class`;
	        const zoomSinglePayload: any = {
	          topic,
	          start_time: toZoomLocalDateTime(singleClassLocalTime, meetingTimeZone),
	          duration: nextDuration,
	          timezone: meetingTimeZone,
	          settings: {
	            mute_upon_entry: true,
	            allow_multiple_audio_unmute: false,
	            allow_participants_to_unmute_themselves: false,
	            allow_participants_to_unmute: false,
	            auto_recording: autoRecording ? "cloud" : "none",
	            host_video: true,
	            participant_video: true,
	            join_before_host: false,
	            waiting_room: false,
	          },
	        };
	        const zoomPatchConfig: any = {
	          headers: {
	            Authorization: `Bearer ${token}`,
	            "Content-Type": "application/json",
	          },
        };

        // For recurring meetings, never patch Zoom without occurrence_id,
        // otherwise Zoom updates the whole series.
        const requiresOccurrenceId = Boolean(meeting.parentMeetingId || meeting.recurringClass);
        if (requiresOccurrenceId && !occurrenceIdToUpdate) {
          const zoomMeetingResp = await axios.get(
            `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              params: {
                show_previous_occurrences: true,
              },
            },
          );
          const zoomOccurrences: any[] = Array.isArray(zoomMeetingResp?.data?.occurrences)
            ? zoomMeetingResp.data.occurrences
            : [];
          const meetingStart = new Date(meeting.localTime);
          const matched = zoomOccurrences.find((occ: any) => {
            const start = new Date(occ?.start_time);
            return !isNaN(start.getTime()) && isSameSlot(start, meetingStart);
          });
          if (matched?.occurrence_id) {
            occurrenceIdToUpdate = String(matched.occurrence_id);
          }
        }

        if (requiresOccurrenceId && !occurrenceIdToUpdate) {
          return res.status(409).json({
            success: false,
            message:
              "Could not resolve recurring occurrence for this class. Single-class update is blocked to avoid updating all classes.",
          });
        }

        if (occurrenceIdToUpdate) {
          zoomPatchConfig.params = { occurrence_id: occurrenceIdToUpdate };
        }

	        await axios.patch(
	          `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
	          zoomSinglePayload,
	          zoomPatchConfig,
	        );
	      } catch (zoomError: any) {
	        const zoomErrorCode = zoomError?.response?.data?.code;
	        if (zoomErrorCode === 4711) {
          try {
            clearZoomTokenCache();
            const freshToken = await getZoomAccessToken({ forceRefresh: true });
            const retryConfig: any = {
              headers: {
                Authorization: `Bearer ${freshToken}`,
                "Content-Type": "application/json",
              },
            };
            if (occurrenceIdToUpdate) {
              retryConfig.params = { occurrence_id: occurrenceIdToUpdate };
            }

	            await axios.patch(
	              `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
	              {
	                topic: `${nextTitle} - Live Class`,
	                start_time: toZoomLocalDateTime(singleClassLocalTime, meetingTimeZone),
	                duration: nextDuration,
	                timezone: meetingTimeZone,
	                settings: {
	                  mute_upon_entry: true,
	                  allow_multiple_audio_unmute: false,
	                  allow_participants_to_unmute_themselves: false,
	                  allow_participants_to_unmute: false,
	                  auto_recording: autoRecording ? "cloud" : "none",
	                  host_video: true,
	                  participant_video: true,
	                  join_before_host: false,
	                  waiting_room: false,
	                },
	              },
	              retryConfig,
	            );
	          } catch (retryErr: any) {
	            return res.status(502).json({
	              success: false,
              message:
                "Failed to update meeting name on Zoom. Local data was not changed.",
              error: retryErr?.response?.data || retryErr?.message,
            });
          }
        } else {
          return res.status(502).json({
            success: false,
            message:
              "Failed to update meeting name on Zoom. Local data was not changed.",
            error: zoomError?.response?.data || zoomError?.message,
          });
        }
      }

      meeting.service = nextService;
      meeting.title = nextTitle;
      meeting.liveRegion = nextLiveRegion;
      meeting.liveTime = nextLiveTime;
      meeting.trainer = nextTrainer;
	      meeting.duration = nextDuration;
	      meeting.rotationEnabled = nextRotationEnabled;
	      meeting.regions = nextRegions;
	      meeting.startDate = startDate ? new Date(startDate) : singleClassLocalTime;
	      meeting.localTime = singleClassLocalTime;
	      // Intentionally do not update series recurrence settings from child updates.
	      await meeting.save();

	      return res.json({
	        success: true,
	        data: {
	          meeting,
	          message:
	            `Single class "${meeting.title}" updated successfully on both Zoom and database.`,
	        },
	      });
	    }

	    const effectiveLocalTime = localTime ?? meeting.localTime;
    const inputStartDateTime = new Date(effectiveLocalTime);
    const alignedStartDateTime = nextRecurringClass && nextRecurrenceType
      ? alignRecurringStartDate({
          startAt: inputStartDateTime,
          recurrenceType: nextRecurrenceType as
            | "weekly"
            | "monthly"
            | "custom"
            | "bi-weekly",
          customDays: nextCustomDays,
          timeZone: meetingTimeZone,
        })
      : inputStartDateTime;

    // Update meeting fields
    meeting.service = nextService;
    meeting.title = nextTitle;
    meeting.liveRegion = nextLiveRegion;
    meeting.liveTime = nextLiveTime;
    meeting.trainer = nextTrainer;
    meeting.duration = nextDuration;
    meeting.rotationEnabled = nextRotationEnabled;
    meeting.startDate = nextRecurringClass
      ? alignedStartDateTime
      : startDate
      ? new Date(startDate)
      : meeting.startDate;
    meeting.localTime = alignedStartDateTime;
    meeting.regions = nextRegions;

    // Update recurring class fields
    meeting.recurringClass = nextRecurringClass;
    meeting.recurrenceType = nextRecurringClass ? nextRecurrenceType : null;
    meeting.customDays =
      nextRecurringClass &&
      (nextRecurrenceType === "custom" || nextRecurrenceType === "bi-weekly")
        ? nextCustomDays
        : [];
    meeting.weeklyEndDate = nextWeeklyEndDate;
    meeting.isRecurring = nextRecurringClass;
    if (status !== undefined) {
      const normalizedStatus = String(status || "")
        .trim()
        .toLowerCase();
      if (["pending", "completed", "failed"].includes(normalizedStatus)) {
        meeting.status = normalizedStatus as "pending" | "completed" | "failed";
        const occurrenceId = String((meeting as any).occurrenceId || "").trim();
        const localTimeMs = new Date(meeting.localTime).getTime();
        const slotWindowMs = 60 * 1000;
        const statusSyncFilter: any = {
          zoomMeetingId: meeting.zoomMeetingId,
          _id: { $ne: meeting._id },
        };

        if (occurrenceId) {
          statusSyncFilter.occurrenceId = occurrenceId;
        } else if (!Number.isNaN(localTimeMs)) {
          statusSyncFilter.localTime = {
            $gte: new Date(localTimeMs - slotWindowMs),
            $lte: new Date(localTimeMs + slotWindowMs),
          };
        }

        await Meeting.updateMany(statusSyncFilter, {
          $set: { status: normalizedStatus },
        });
      }
    }

    // Update Zoom meeting settings
    try {
      const token = await getZoomAccessToken();
      const meetingTopic = `${meeting.title} - Live Class`;

      const startDateTime = alignedStartDateTime;

      // Get weekday for Zoom (1–7, where 1 = Monday, 7 = Sunday)
      const zoomWeekDay = getZoomWeekdayInTimezone(startDateTime, meetingTimeZone);

      // Format time as HH:MM for Zoom API
      const hours = String(startDateTime.getUTCHours()).padStart(2, "0");
      const minutes = String(startDateTime.getUTCMinutes()).padStart(2, "0");
      const startTimeForZoom = `${hours}:${minutes}`;

      // Build recurrence object based on settings
      let recurrenceSettings: any = null;

      if (nextRecurringClass) {
        if (nextRecurrenceType === "weekly") {
          recurrenceSettings = {
            type: 2, // Weekly
            repeat_interval: 1,
            weekly_days: toZoomApiWeekday(zoomWeekDay),
          };
        } else if (nextRecurrenceType === "monthly") {
          const dayOfMonth = getDatePartsInTimezone(
            startDateTime,
            meetingTimeZone,
          ).day;
          recurrenceSettings = {
            type: 3, // Monthly
            repeat_interval: 1,
            monthly_day: dayOfMonth,
          };
        } else if (nextRecurrenceType === "custom") {
          recurrenceSettings = {
            type: 2, // Weekly
            repeat_interval: 1,
            weekly_days: toZoomApiWeeklyDaysCsv(nextCustomDays),
          };
        } else if (nextRecurrenceType === "bi-weekly") {
          recurrenceSettings = {
            type: 2, // Weekly
            repeat_interval: 2,
            weekly_days: toZoomApiWeeklyDaysCsv(nextCustomDays),
          };
        }

        // Add end date
        if (nextWeeklyEndDate) {
          if (nextRecurrenceType === "monthly") {
            recurrenceSettings.end_times = countMonthlyOccurrencesInRange(
              startDateTime,
              nextWeeklyEndDate,
              meetingTimeZone,
            );
          } else if (
            nextRecurrenceType === "weekly" ||
            nextRecurrenceType === "custom" ||
            nextRecurrenceType === "bi-weekly"
          ) {
            const endTimes = countType2OccurrencesInRange({
              startAt: startDateTime,
              endAt: nextWeeklyEndDate,
              recurrenceType: nextRecurrenceType,
              customDays: nextCustomDays,
              timeZone: meetingTimeZone,
            });
            if (endTimes <= 60) {
              recurrenceSettings.end_times = endTimes;
            } else {
              recurrenceSettings.end_date_time = toZoomEndDateTime(nextWeeklyEndDate);
            }
          } else {
            recurrenceSettings.end_date_time = toZoomEndDateTime(nextWeeklyEndDate);
          }
        }
      }

      // Determine meeting type
      const meetingType = nextRecurringClass ? 8 : 2; // 8 = recurring, 2 = scheduled

      const zoomPayload: any = {
        topic: meetingTopic,
        type: meetingType,
        start_time: toZoomLocalDateTime(startDateTime, meetingTimeZone),
        duration: nextDuration,
        timezone: meetingTimeZone,
        settings: {
          mute_upon_entry: true,
          allow_multiple_audio_unmute: false,
          allow_participants_to_unmute_themselves: false,
          allow_participants_to_unmute: false,
          auto_recording: autoRecording ? "cloud" : "none",
          host_video: true,
          participant_video: true,
          join_before_host: false,
          waiting_room: false,
        },
      };

      // Only add recurrence if it's a recurring meeting
      if (nextRecurringClass && recurrenceSettings) {
        zoomPayload.recurrence = recurrenceSettings;
      }

      console.log("📋 [UpdateMeeting] Zoom API payload:", {
        topic: meetingTopic,
        type: meetingType,
        start_time: toZoomLocalDateTime(startDateTime, meetingTimeZone),
        duration: nextDuration,
        recurrence: recurrenceSettings,
        timezone: meetingTimeZone,
      });

      try {
        const fetchZoomMeeting = async (accessToken: string) =>
          axios.get(`https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          });

        // 1) Force-sync title first so class name always reflects on Zoom.
        await axios.patch(
          `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
          { topic: meetingTopic },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );
        console.log("✅ [UpdateMeeting] Zoom topic synced successfully");

        // Verify topic really changed on Zoom (some accounts/meeting types can ignore updates).
        const verifyResp = await fetchZoomMeeting(token);
        const zoomTopicAfterSync = String(verifyResp?.data?.topic || "").trim();
        if (zoomTopicAfterSync !== meetingTopic) {
          throw new Error(
            `Zoom topic verification failed. Expected "${meetingTopic}", got "${zoomTopicAfterSync}"`,
          );
        }
        console.log("✅ [UpdateMeeting] Zoom topic verification passed");

        // 2) Then attempt full meeting update (time/recurrence/settings).
        await axios.patch(
          `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
          zoomPayload,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        console.log("✅ [UpdateMeeting] Zoom meeting fully updated successfully");

        // Verify final state once more after full update to avoid false success.
        let verified = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const finalVerifyResp = await fetchZoomMeeting(token);
          const finalTopic = String(finalVerifyResp?.data?.topic || "").trim();
          if (finalTopic === meetingTopic) {
            verified = true;
            break;
          }
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
        if (!verified) {
          throw new Error(
            `Zoom final verification failed. Meeting ${meeting.zoomMeetingId} did not reflect topic "${meetingTopic}".`,
          );
        }
      } catch (fullUpdateError: any) {
        // If full update fails, trigger outer fallback (recreate + relink)
        // so recurrence/time/range changes are not silently ignored.
        throw fullUpdateError;
      }
    } catch (zoomError: any) {
      console.error(
        "⚠️ [UpdateMeeting] Error updating Zoom meeting:",
        zoomError?.response?.data || zoomError?.message,
      );

      // Zoom code 4711 = token/scope issue. Try once with a fresh token in case
      // backend still holds an older cached token after scope changes.
      const zoomErrorCode = zoomError?.response?.data?.code;
      if (zoomErrorCode === 4711) {
        try {
          const retryMeetingTimeZone = resolveMeetingTimezone(
            nextRegions,
            nextLiveRegion,
          );
          const retryInputStartDateTime = new Date(localTime ?? meeting.localTime);
          const retryStartDateTime = nextRecurringClass && nextRecurrenceType
            ? alignRecurringStartDate({
                startAt: retryInputStartDateTime,
                recurrenceType: nextRecurrenceType as
                  | "weekly"
                  | "monthly"
                  | "custom"
                  | "bi-weekly",
                customDays: nextCustomDays,
                timeZone: retryMeetingTimeZone,
              })
            : retryInputStartDateTime;
          const retryZoomWeekDay = getZoomWeekdayInTimezone(
            retryStartDateTime,
            retryMeetingTimeZone,
          );
          let retryRecurrence: any = null;

          if (nextRecurringClass) {
            if (nextRecurrenceType === "weekly") {
              retryRecurrence = {
                type: 2,
                repeat_interval: 1,
                weekly_days: toZoomApiWeekday(retryZoomWeekDay),
              };
            } else if (nextRecurrenceType === "monthly") {
              const retryMonthDay = getDatePartsInTimezone(
                retryStartDateTime,
                retryMeetingTimeZone,
              ).day;
              retryRecurrence = {
                type: 3,
                repeat_interval: 1,
                monthly_day: retryMonthDay,
              };
            } else if (nextRecurrenceType === "custom") {
              retryRecurrence = {
                type: 2,
                repeat_interval: 1,
                weekly_days: toZoomApiWeeklyDaysCsv(nextCustomDays),
              };
            } else if (nextRecurrenceType === "bi-weekly") {
              retryRecurrence = {
                type: 2,
                repeat_interval: 2,
                weekly_days: toZoomApiWeeklyDaysCsv(nextCustomDays),
              };
            }
            if (nextWeeklyEndDate) {
              if (nextRecurrenceType === "monthly") {
                retryRecurrence.end_times = countMonthlyOccurrencesInRange(
                  retryStartDateTime,
                  nextWeeklyEndDate,
                  retryMeetingTimeZone,
                );
              } else if (
                nextRecurrenceType === "weekly" ||
                nextRecurrenceType === "custom" ||
                nextRecurrenceType === "bi-weekly"
              ) {
                const endTimes = countType2OccurrencesInRange({
                  startAt: retryStartDateTime,
                  endAt: nextWeeklyEndDate,
                  recurrenceType: nextRecurrenceType,
                  customDays: nextCustomDays,
                  timeZone: retryMeetingTimeZone,
                });
                if (endTimes <= 60) {
                  retryRecurrence.end_times = endTimes;
                } else {
                  retryRecurrence.end_date_time = toZoomEndDateTime(nextWeeklyEndDate);
                }
              } else {
                retryRecurrence.end_date_time = toZoomEndDateTime(nextWeeklyEndDate);
              }
            }
          }

          const retryZoomPayload: any = {
            topic: `${meeting.title} - Live Class`,
            type: nextRecurringClass ? 8 : 2,
            start_time: toZoomLocalDateTime(
              retryStartDateTime,
              retryMeetingTimeZone,
            ),
            duration: nextDuration,
            timezone: retryMeetingTimeZone,
            settings: {
              mute_upon_entry: true,
              allow_multiple_audio_unmute: false,
              allow_participants_to_unmute_themselves: false,
              allow_participants_to_unmute: false,
              auto_recording: autoRecording ? "cloud" : "none",
              host_video: true,
              participant_video: true,
              join_before_host: false,
              waiting_room: false,
            },
          };
          if (nextRecurringClass && retryRecurrence) {
            retryZoomPayload.recurrence = retryRecurrence;
          }

          clearZoomTokenCache();
          const freshToken = await getZoomAccessToken({ forceRefresh: true });
          await axios.patch(
            `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
            retryZoomPayload,
            {
              headers: {
                Authorization: `Bearer ${freshToken}`,
                "Content-Type": "application/json",
              },
            },
          );
          console.log(
            "✅ [UpdateMeeting] Zoom meeting updated successfully after forced token refresh",
          );
        } catch (retryErr: any) {
          const retryErrorBody = retryErr?.response?.data;
          const retryMessage = String(retryErrorBody?.message || retryErr?.message || "");
          const missingScopesMatch = retryMessage.match(/scopes:\[(.*?)\]/);
          const missingScopes = missingScopesMatch?.[1] || "";

          return res.status(502).json({
            success: false,
            message:
              "Zoom token is missing update scope. Enable required Zoom scopes and retry.",
            error: retryErrorBody || retryErr?.message,
            requiredScopes: missingScopes || "meeting:update:meeting or meeting:update:meeting:admin",
          });
        }
      } else {
        // Do not recreate a new Zoom meeting on edit.
        // If Zoom update fails, return error so existing meeting stays intact.
        return res.status(502).json({
          success: false,
          message:
            "Failed to update existing Zoom meeting. No new meeting was created.",
          error: zoomError?.response?.data || zoomError?.message,
        });
      }

      // If retry succeeded, continue normal flow.
    }

    // Save the meeting
    await meeting.save();

    // Sync recurring child instances from Zoom occurrences.
    // This ensures range extension creates additional classes in DB.
    if (meeting.recurringClass) {
      try {
        const syncToken = await getZoomAccessToken();
        const zoomMeetingResp = await axios.get(
          `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
          {
            headers: {
              Authorization: `Bearer ${syncToken}`,
              "Content-Type": "application/json",
            },
            params: {
              show_previous_occurrences: true,
            },
          },
        );

        const zoomOccurrences: any[] = Array.isArray(zoomMeetingResp?.data?.occurrences)
          ? zoomMeetingResp.data.occurrences
          : [];
        const rangeEnd = meeting.weeklyEndDate
          ? new Date(toZoomEndDateTime(meeting.weeklyEndDate))
          : null;

        const inRangeZoomOccurrences = zoomOccurrences.filter((occ: any) => {
          const start = new Date(occ?.start_time);
          if (isNaN(start.getTime())) return false;
          if (!rangeEnd) return true;
          return start.getTime() <= rangeEnd.getTime();
        });

        type NormalizedOccurrence = {
          occurrenceId: string;
          startTime: Date;
        };

        const normalizedByStart = new Map<number, NormalizedOccurrence>();
        const parentStart = new Date(meeting.localTime);
        for (const occ of inRangeZoomOccurrences) {
          const occurrenceId = String(occ?.occurrence_id || "");
          const startTime = new Date(occ?.start_time);
          if (!occurrenceId || isNaN(startTime.getTime())) continue;
          if (isSameSlot(startTime, parentStart)) continue;
          normalizedByStart.set(startTime.getTime(), { occurrenceId, startTime });
        }

        const targetOccurrences: NormalizedOccurrence[] = [];
        const seenOccurrenceIds = new Set<string>();

        // Always keep valid Zoom-provided occurrences.
        for (const [, item] of normalizedByStart.entries()) {
          if (!seenOccurrenceIds.has(item.occurrenceId)) {
            seenOccurrenceIds.add(item.occurrenceId);
            targetOccurrences.push(item);
          }
        }

        // Fallback generation for missing future instances in extended ranges.
        if (
          rangeEnd &&
          meeting.recurrenceType &&
          ["weekly", "monthly", "custom", "bi-weekly"].includes(meeting.recurrenceType)
        ) {
          const generatedDates = generateRecurringDatesInRange({
            startAt: new Date(meeting.localTime),
            endAt: rangeEnd,
            recurrenceType: meeting.recurrenceType as
              | "weekly"
              | "monthly"
              | "custom"
              | "bi-weekly",
            customDays: Array.isArray(meeting.customDays) ? meeting.customDays : [],
            timeZone: resolveMeetingTimezone(meeting.regions as any[], meeting.liveRegion),
          });

          for (const generatedDate of generatedDates) {
            if (isSameSlot(generatedDate, parentStart)) continue;
            const matchedZoom = normalizedByStart.get(generatedDate.getTime());
            const generatedOccurrenceId =
              matchedZoom?.occurrenceId || `local-${generatedDate.toISOString()}`;
            if (seenOccurrenceIds.has(generatedOccurrenceId)) continue;
            seenOccurrenceIds.add(generatedOccurrenceId);
            targetOccurrences.push({
              occurrenceId: generatedOccurrenceId,
              startTime: generatedDate,
            });
          }
        }

        const existingInstances = await Meeting.find({
          parentMeetingId: meeting._id,
        }).select("_id occurrenceId");

        const existingByOccurrence = new Map<string, string>();
        for (const instance of existingInstances) {
          if (instance.occurrenceId) {
            existingByOccurrence.set(
              String(instance.occurrenceId),
              String(instance._id),
            );
          }
        }

        const keepOccurrenceIds = new Set<string>();
        for (const occ of targetOccurrences) {
          const occurrenceId = String(occ?.occurrenceId || "");
          const occurrenceStart = new Date(occ?.startTime);
          if (!occurrenceId || isNaN(occurrenceStart.getTime())) continue;

          keepOccurrenceIds.add(occurrenceId);

          const instancePayload: any = {
            service: meeting.service,
            title: meeting.title,
            regions: meeting.regions,
            liveRegion: meeting.liveRegion,
            liveTime: meeting.liveTime,
            trainer: meeting.trainer,
            duration: meeting.duration,
            recurringClass: false,
            recurrenceType: null,
            customDays: [],
            rotationEnabled: false,
            isRecurring: false,
            isLive: true,
            startDate: occurrenceStart,
            localTime: occurrenceStart,
            joinUrl: meeting.joinUrl,
            startUrl: meeting.startUrl,
            recordingUrl: meeting.recordingUrl || "",
            createdBy: meeting.createdBy,
          };

          const existingId = existingByOccurrence.get(occurrenceId);
          if (existingId) {
            await Meeting.findByIdAndUpdate(existingId, instancePayload);
          } else {
            await Meeting.create({
              ...instancePayload,
              zoomMeetingId: meeting.zoomMeetingId,
              occurrenceId,
              parentMeetingId: meeting._id,
            });
          }
        }

        // Remove instances no longer present in Zoom occurrence list (for this range/config).
        if (targetOccurrences.length > 0) {
          await Meeting.deleteMany({
            parentMeetingId: meeting._id,
            occurrenceId: { $nin: Array.from(keepOccurrenceIds) },
          });
        }
      } catch (syncErr: any) {
        console.warn(
          "⚠️ [UpdateMeeting] Recurring instance sync skipped:",
          syncErr?.response?.data || syncErr?.message,
        );
      }
    } else {
      // Non-recurring: clear any previously generated recurring children.
      await Meeting.deleteMany({ parentMeetingId: meeting._id });
    }

    // Keep all instances of the same Zoom meeting in sync (recurring copies).
    await Meeting.updateMany(
      {
        zoomMeetingId: meeting.zoomMeetingId,
        _id: { $ne: meeting._id },
      },
      { $set: { title: meeting.title } },
    );

    // Enforce recurrence range for all generated child instances.
    if (meeting.recurringClass && meeting.weeklyEndDate) {
      const recurrenceRangeEnd = new Date(toZoomEndDateTime(meeting.weeklyEndDate));
      const cleanup = await Meeting.deleteMany({
        zoomMeetingId: meeting.zoomMeetingId,
        parentMeetingId: { $ne: null },
        localTime: { $gt: recurrenceRangeEnd },
      });
      if (cleanup.deletedCount) {
        console.log(
          `🧹 [UpdateMeeting] Removed ${cleanup.deletedCount} out-of-range recurring instances`,
        );
      }
    }

    console.log("✅ [UpdateMeeting] Meeting saved to database");
    console.log("📊 [UpdateMeeting] Updated meeting:", {
      id: meeting._id,
      title: meeting.title,
      recurringClass: meeting.recurringClass,
      recurrenceType: meeting.recurrenceType,
      regionsCount: meeting.regions.length,
      weeklyEndDate: meeting.weeklyEndDate,
    });

    const responseMessage = `Meeting "${meeting.title}" updated successfully. ${
      meeting.recurringClass
        ? `${meeting.recurrenceType} recurring class with live session for ${meeting.liveRegion}.`
        : `Live session for ${meeting.liveRegion}.`
    }`;

    const hasRescheduleChange =
      previousMeetingSnapshot.title !== String(meeting.title || "") ||
      previousMeetingSnapshot.liveRegion !== String(meeting.liveRegion || "") ||
      previousMeetingSnapshot.localTime.getTime() !== new Date(meeting.localTime).getTime();

    if (hasRescheduleChange) {
      PushNotificationService.sendMeetingLifecycleToRegion({
        action: "rescheduled",
        meetingId: String(meeting._id),
        meetingTitle: meeting.title,
        region: meeting.liveRegion,
        localTime: new Date(meeting.localTime),
      }).catch((error: any) => {
        console.error("❌ Failed to send meeting-rescheduled region push notification:", error?.message || error);
      });

      PushNotificationService.sendMeetingLifecycleToParticipants({
        action: "rescheduled",
        meetingId: String(meeting._id),
        meetingTitle: meeting.title,
        localTime: new Date(meeting.localTime),
      }).catch((error: any) => {
        console.error("❌ Failed to send meeting-rescheduled participant push notification:", error?.message || error);
      });
    }

    return res.json({
      success: true,
      data: {
        meeting,
        message: responseMessage,
      },
    });
  } catch (error: any) {
    console.error("❌ [UpdateMeeting] ERROR CAUGHT");
    console.error("📍 [UpdateMeeting] Error type:", error.constructor.name);
    console.error("📝 [UpdateMeeting] Error message:", error.message);
    console.error("🔍 [UpdateMeeting] Error details:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Error updating meeting",
      error: error.response?.data,
    });
  }
}

  static async DeleteMeeting(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const deleteScope = String(req.query.scope || "").toLowerCase();

      // Validate MongoDB ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid meeting ID",
        });
      }

      const meeting = await Meeting.findById(id);

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      const isRecurringParent = Boolean(meeting.recurringClass && !meeting.parentMeetingId);
      const isChildOccurrenceRecord = Boolean(meeting.parentMeetingId);
      const shouldDeleteSeries = isRecurringParent && deleteScope === "series";
      let attemptedOccurrenceDelete = false;

      // Delete from Zoom first so DB and Zoom stay in sync.
      try {
        const token = await getZoomAccessToken();
        const zoomDeleteConfig: any = {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        };

        let occurrenceIdToDelete: string | null = meeting.occurrenceId
          ? String(meeting.occurrenceId)
          : null;

        // For recurring parent records, default behavior is deleting full series.
        // Pass ?scope=single to delete only one class occurrence.
        if (!occurrenceIdToDelete && isRecurringParent && !shouldDeleteSeries) {
          const zoomMeetingResp = await axios.get(
            `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              params: {
                show_previous_occurrences: true,
              },
            },
          );

          const zoomOccurrences: any[] = Array.isArray(zoomMeetingResp?.data?.occurrences)
            ? zoomMeetingResp.data.occurrences
            : [];
          const meetingStart = new Date(meeting.localTime);

          const matched = zoomOccurrences.find((occ: any) => {
            const start = new Date(occ?.start_time);
            return !isNaN(start.getTime()) && isSameSlot(start, meetingStart);
          });

          if (matched?.occurrence_id) {
            occurrenceIdToDelete = String(matched.occurrence_id);
          } else {
            return res.status(409).json({
              success: false,
              message:
                "Could not resolve recurring occurrence for this class. Series delete is blocked to avoid removing all classes.",
            });
          }
        }

        // If occurrence is known, delete only that occurrence from Zoom.
        // Otherwise, Zoom deletes the full meeting/series.
        if (occurrenceIdToDelete) {
          attemptedOccurrenceDelete = true;
          zoomDeleteConfig.params = { occurrence_id: occurrenceIdToDelete };
        }

        await axios.delete(
          `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
          zoomDeleteConfig,
        );
      } catch (zoomError: any) {
        const status = zoomError?.response?.status;
        const zoomCode = zoomError?.response?.data?.code;
        const zoomMessage = String(zoomError?.response?.data?.message || "").toLowerCase();
        const invalidOccurrenceParam =
          status === 400 &&
          zoomCode === 300 &&
          zoomMessage.includes("occurrence_id");

        if (attemptedOccurrenceDelete && invalidOccurrenceParam) {
          // Stale/invalid occurrence id. Never escalate to full-series delete
          // unless the request explicitly asked for scope=series.
          if (shouldDeleteSeries) {
            try {
              const token = await getZoomAccessToken();
              await axios.delete(
                `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
                {
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                },
              );
            } catch (retryError: any) {
              const retryStatus = retryError?.response?.status;
              if (retryStatus !== 404) {
                console.error(
                  "❌ [DeleteMeeting] Zoom retry delete failed:",
                  retryError?.response?.data || retryError?.message,
                );
                return res.status(502).json({
                  success: false,
                  message: "Failed to delete meeting on Zoom. Local record not deleted.",
                  error: retryError?.response?.data || retryError?.message,
                });
              }
            }
          } else {
            console.warn(
              "⚠️ [DeleteMeeting] Invalid occurrence_id during single-class delete; continuing with local cleanup only.",
            );
          }
        } else {
        // Already deleted remotely; continue DB cleanup.
          if (status !== 404) {
            console.error(
              "❌ [DeleteMeeting] Zoom delete failed:",
              zoomError?.response?.data || zoomError?.message,
            );
            return res.status(502).json({
              success: false,
              message: "Failed to delete meeting on Zoom. Local record not deleted.",
              error: zoomError?.response?.data || zoomError?.message,
            });
          }
          console.error(
            "⚠️ [DeleteMeeting] Zoom meeting already deleted remotely:",
            zoomError?.response?.data || zoomError?.message,
          );
        }
      }

      const deletedMeetingIds: Types.ObjectId[] = [];
      if (shouldDeleteSeries) {
        const seriesMeetings = await Meeting.find(
          {
            $or: [{ _id: meeting._id }, { parentMeetingId: meeting._id }],
          },
          { _id: 1 },
        ).lean();
        deletedMeetingIds.push(
          ...seriesMeetings.map((item: any) => item._id as Types.ObjectId),
        );
        await Meeting.deleteMany({
          $or: [{ _id: meeting._id }, { parentMeetingId: meeting._id }],
        });
      } else {
        deletedMeetingIds.push(meeting._id as Types.ObjectId);
        await Meeting.findByIdAndDelete(id);
      }

      if (deletedMeetingIds.length > 0) {
        PushNotificationService.sendMeetingLifecycleToParticipants({
          action: "cancelled",
          meetingId: String(meeting._id),
          meetingTitle: meeting.title,
          localTime: new Date(meeting.localTime),
        }).catch((error: any) => {
          console.error("❌ Failed to send meeting-cancelled participant push notification:", error?.message || error);
        });

        PushNotificationService.sendMeetingLifecycleToRegion({
          action: "cancelled",
          meetingId: String(meeting._id),
          meetingTitle: meeting.title,
          region: meeting.liveRegion,
          localTime: new Date(meeting.localTime),
        }).catch((error: any) => {
          console.error("❌ Failed to send meeting-cancelled region push notification:", error?.message || error);
        });

        await Promise.all([
          MeetingAttendance.deleteMany({ meeting: { $in: deletedMeetingIds } }),
          MeetingParticipant.deleteMany({ meetingId: { $in: deletedMeetingIds } }),
        ]);
      }

      return res.json({
        success: true,
        message: shouldDeleteSeries
          ? "Meeting series deleted successfully"
          : "Meeting deleted successfully",
        data: {
          meetingId: id,
          deletedCount: deletedMeetingIds.length,
          scope: shouldDeleteSeries ? "series" : "single",
        },
      });
    } catch (error: any) {
      console.error("❌ [DeleteMeeting] ERROR CAUGHT");
      console.error("📝 [DeleteMeeting] Error message:", error.message);

      return res.status(500).json({
        success: false,
        message: error.message || "Error deleting meeting",
      });
    }
  }

static async GetAllTrainerMeetings(req: Request, res: Response) {
  try {
    const {
      search = "",
      page = 1,
      limit = 10,
      sortBy = "localTime",
      sortOrder = "asc",
      service,
      isLive,
      isRecurring,
      startDate,
      endDate,
    } = req?.query;

    const userId = req.user?.id;

    console.log("📍 [GetAllTrainerMeetings] Fetching meetings for user:") ;

    if (!userId) {
      console.warn("⚠️ [GetAllTrainerMeetings] User not authenticated");
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Fetch user to get their trainer reference
    const user = await User.findById(userId).select("_id firstName lastName email trainer");

    if (!user) {
      console.warn("⚠️ [GetAllTrainerMeetings] User not found:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get trainer ID from user's trainer reference
    const trainerId = user.trainer;

    if (!trainerId) {
      console.warn(
        "⚠️ [GetAllTrainerMeetings] No trainer assigned to user:",
        userId,
      );
      return res.status(400).json({
        success: false,
        message: "No trainer assigned to this user",
      });
    }

    // Fetch trainer details
    const trainer = await TrainerModel.findById(trainerId).select(
      "_id name email image",
    );

    if (!trainer) {
      console.warn("⚠️ [GetAllTrainerMeetings] Trainer not found:", trainerId);
      return res.status(404).json({
        success: false,
        message: "Assigned trainer not found",
      });
    }

    // Build filter object
    const filter: any = {};

    // Filter by trainer (get only assigned trainer's meetings)
    filter.trainer = trainerId;

    // Search by title
    if (search) {
      filter.title = { $regex: search, $options: "i" };
    }

    // Filter by service if provided
    if (service) {
      filter.service = service;
    }

    // Filter by isLive status
    if (isLive !== undefined) {
      filter.isLive = isLive === "true";
    }

    // Filter by isRecurring status
    if (isRecurring !== undefined) {
      filter.isRecurring = isRecurring === "true";
    }

    // Filter by date range
    if (startDate || endDate) {
      filter.localTime = {};
      if (startDate) {
        filter.localTime.$gte = new Date(startDate as string);
      }
      if (endDate) {
        filter.localTime.$lte = new Date(endDate as string);
      }
    }

    // Parse pagination
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 10, 100); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    // Build sort object
    const sortObj: any = {};
    const sortField = sortBy || "localTime";
    const sortDir = sortOrder === "desc" ? -1 : 1;
    sortObj[sortField as string] = sortDir;

    // Execute query with pagination
    const [meetings, totalCount] = await Promise.all([
      Meeting.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .populate("service", "title name image _id description")
        .populate("trainer", "name email image _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean(),
      Meeting.countDocuments(filter),
    ]);

    // ✅ FIXED: Determine status based on both meeting.status and localTime
    // Meetings show as "completed" 1 hour AFTER they end
    const now = new Date();
    
    const enrichedMeetings = meetings.map((meeting: any) => {
      let status: "upcoming" | "completed" | "failed" = "upcoming";

      // First check if meeting has explicit status from Zoom
      if (meeting.status === "completed") {
        status = "completed";
      } else if (meeting.status === "failed") {
        status = "failed";
      } else if (meeting.status === "pending") {
        // For pending meetings, check if meeting end time (start time + duration + 1 hour buffer) has passed
        const meetingTime = new Date(meeting.localTime);
        const meetingDurationMs = (meeting.duration || 0) * 60 * 1000; // Convert minutes to milliseconds
        const oneHourMs = 60 * 60 * 1000; // 1 hour in milliseconds
        
        // Calculate when meeting should be marked as completed
        // = meeting start time + duration + 1 hour buffer
        const meetingCompletionTime = new Date(meetingTime.getTime() + meetingDurationMs + oneHourMs);
        
        if (now >= meetingCompletionTime) {
          // Current time has passed meeting end time + 1 hour buffer
          status = "completed";
        } else {
          status = "upcoming";
        }
      }

      return {
        ...meeting,
        status, // Add computed status to response
        trainer: {
          _id: meeting.trainer?._id,
          name: meeting.trainer?.name?.trim() || "Unknown Trainer",
          email: meeting.trainer?.email,
          profileImage: meeting.trainer?.image,
        },
      };
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      data: {
        meetings: enrichedMeetings,
        pagination: {
          currentPage: pageNum,
          totalPages,
          limit: limitNum,
          total: totalCount,
          hasNextPage,
          hasPrevPage,
        },
        user: {
          id: user._id,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        },
        trainer: {
          id: trainer._id,
          name: trainer.name?.trim() || "Unknown Trainer",
          email: trainer.email,
          profileImage: trainer.image,
        },
        filters: {
          search: search || null,
          service: service || null,
          isLive: isLive || null,
          isRecurring: isRecurring || null,
          dateRange: startDate || endDate ? { startDate, endDate } : null,
        },
      },
    });
  } catch (error: any) {
    console.error("❌ [GetAllTrainerMeetings] ERROR CAUGHT");
    console.error("📝 [GetAllTrainerMeetings] Error message:", error.message);
    console.error("📊 [GetAllTrainerMeetings] Full error object:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Error fetching meetings",
    });
  }
}

  /**
   * Get weekly meetings for all 7 days
   * Filters by user plan and returns meetings grouped by day
   */
  static async GetWeeklyMeetings(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Fetch user with their plan
      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Determine service titles based on plan
      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      // Fetch service IDs based on titles
      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      // Calculate current week (Sunday to Saturday)
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = now.getDate() - dayOfWeek;
      const weekStart = new Date(now.setDate(diff));
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      weekEnd.setHours(23, 59, 59, 999);

      // Fetch all meetings for the week
      const meetings = await Meeting.find({
        localTime: {
          $gte: weekStart,
          $lte: weekEnd,
        },
        service: { $in: serviceIds },
        status: { $in: ["pending", "completed"] },
      })
        .sort({ localTime: 1 })
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      // Group meetings by day
      const groupedByDay: { [key: number]: any[] } = {};

      for (let i = 0; i < 7; i++) {
        groupedByDay[i] = [];
      }

      meetings.forEach((meeting) => {
        const meetingDate = new Date(meeting.localTime);
        const dayIndex = meetingDate.getDay();
        groupedByDay[dayIndex].push(meeting);
      });

      // Flatten back to array for response
      const allMeetings = meetings;

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: allMeetings.length,
        meetings: allMeetings,
        userPlan: user.plan,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching weekly meetings:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching weekly meetings",
      });
    }
  }

  /**
   * Get meetings for a specific day of the week (0-6, where 0 is Sunday)
   */
  static async GetMeetingsByDay(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { dayIndex } = req.params;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      if (
        isNaN(Number(dayIndex)) ||
        Number(dayIndex) < 0 ||
        Number(dayIndex) > 6
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid day index. Must be between 0 and 6.",
        });
      }

      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Determine service titles based on plan
      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      // Calculate the specific day of current week
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = now.getDate() - dayOfWeek + Number(dayIndex);

      const dayStart = new Date(now.setDate(diff));
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const meetings = await Meeting.find({
        localTime: {
          $gte: dayStart,
          $lte: dayEnd,
        },
        service: { $in: serviceIds },
        status: { $in: ["pending", "completed"] },
      })
        .sort({ localTime: 1 })
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: meetings.length,
        meetings,
        userPlan: user.plan,
      });
    } catch (error: any) {
      console.error("Error fetching meetings by day:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching meetings by day",
      });
    }
  }
}