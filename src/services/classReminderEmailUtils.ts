// src/services/classReminderEmailUtils.ts

import { getCode } from "country-list";
import {
  COUNTRY_TIMEZONE_MAP,
  COUNTRY_TIMEZONE_MAP_ALL,
} from "../constants/countryTimezoneMap";

const TIMEZONE_ABBREVIATION_MAP: Record<string, string> = {
  "Asia/Kolkata": "IST",
  "Asia/Dubai": "GST",
  UTC: "UTC",
};

const hasExplicitUtcOffset = (value: string): boolean =>
  /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value);

const normalizeUtcDateString = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return trimmed;

  if (hasExplicitUtcOffset(trimmed)) {
    return trimmed;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return `${trimmed}Z`;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed)) {
    return `${trimmed.replace(" ", "T")}Z`;
  }

  return trimmed;
};

const isValidTimeZone = (timezone: string): boolean => {
  if (!timezone) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const resolveUserCountryCode = (user: any): string => {
  const rawCountry = String(user?.country || "").trim();
  const rawCode = String(user?.countryCode || "")
    .trim()
    .toUpperCase();

  if (rawCountry) {
    if (/^[A-Za-z]{2}$/.test(rawCountry)) {
      return rawCountry.toUpperCase();
    }

    const fromName = getCode(rawCountry);
    if (fromName) {
      return fromName.toUpperCase();
    }
  }

  return rawCode;
};

export const getTimezoneDisplayLabel = (timezone: string): string => {
  const normalizedTimeZone = String(timezone || "").trim() || "UTC";
  const mappedAbbreviation = TIMEZONE_ABBREVIATION_MAP[normalizedTimeZone];
  if (mappedAbbreviation) {
    return `${normalizedTimeZone} (${mappedAbbreviation})`;
  }

  try {
    const shortOffset = new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;

    if (shortOffset) {
      return `${normalizedTimeZone} (${shortOffset})`;
    }
  } catch {
    // Fallback to plain timezone text below.
  }

  return normalizedTimeZone;
};

export const resolveUserTimeZone = (user: any): string => {
  const explicitTimeZone = String(
    user?.timeZone || user?.timezone || "",
  ).trim();
  if (isValidTimeZone(explicitTimeZone)) {
    return explicitTimeZone;
  }

  const countryCode = resolveUserCountryCode(user);
  if (countryCode && COUNTRY_TIMEZONE_MAP[countryCode]) {
    return COUNTRY_TIMEZONE_MAP[countryCode];
  }

  return "UTC";
};

const resolveUserTimeZones = (user: any): string[] => {
  const explicitTimeZone = String(user?.timeZone || user?.timezone || "").trim();
  const hasExplicit = isValidTimeZone(explicitTimeZone);

  const countryCode = resolveUserCountryCode(user);
  const fromMap = countryCode ? COUNTRY_TIMEZONE_MAP_ALL[countryCode] : undefined;
  if (Array.isArray(fromMap) && fromMap.length) {
    const cleaned = fromMap.filter((timezone) => isValidTimeZone(timezone));
    if (!hasExplicit) return cleaned;
    return [
      explicitTimeZone,
      ...cleaned.filter((timezone) => timezone !== explicitTimeZone),
    ];
  }

  if (hasExplicit) {
    return [explicitTimeZone];
  }

  return ["UTC"];
};

const BASE_CAMP_TIMEZONE = "Asia/Dubai";

export const resolveMeetingStartDate = (...candidates: any[]): Date => {
  for (const candidate of candidates) {
    if (!candidate) continue;

    if (candidate instanceof Date) {
      if (!Number.isNaN(candidate.getTime())) {
        return new Date(candidate.getTime());
      }
      continue;
    }

    if (typeof candidate === "number") {
      const parsedFromNumber = new Date(candidate);
      if (!Number.isNaN(parsedFromNumber.getTime())) {
        return parsedFromNumber;
      }
      continue;
    }

    const normalized = normalizeUtcDateString(String(candidate));
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(NaN);
};

export const formatMeetingDateTimeForUser = (
  meetingStartDate: Date,
  user: any,
): {
  timezone: string;
  timezoneDisplay: string;
  localTime: string;
  localDate: string;
  timezonesDisplayHtml: string;
} => {
  const userTimezones = resolveUserTimeZones(user);
  const baseCampTimeZone = isValidTimeZone(BASE_CAMP_TIMEZONE)
    ? BASE_CAMP_TIMEZONE
    : "UTC";

  const userPrimaryTimeZone =
    userTimezones[0] || resolveUserTimeZone(user) || "UTC";
  const safeUserPrimaryTimeZone = isValidTimeZone(userPrimaryTimeZone)
    ? userPrimaryTimeZone
    : "UTC";

  const timezones = [
    baseCampTimeZone,
    ...userTimezones.filter((timezone) => timezone !== baseCampTimeZone),
  ];

  const safePrimaryTimeZone = safeUserPrimaryTimeZone;
  const timezoneDisplay = getTimezoneDisplayLabel(safePrimaryTimeZone);

  let localTime = "TBD";
  let localDate = "TBD";

  if (!Number.isNaN(meetingStartDate.getTime())) {
    try {
      localTime = meetingStartDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: safePrimaryTimeZone,
      });
      localDate = meetingStartDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: safePrimaryTimeZone,
      });
    } catch {
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

  const timezoneLines: string[] = [];
  const primaryDateForComparison = localDate;

  for (const timeZone of timezones.length ? timezones : [safePrimaryTimeZone]) {
    const safeTimeZone = isValidTimeZone(timeZone) ? timeZone : null;
    if (!safeTimeZone) continue;

    let timeText = "TBD";
    let dateText = "TBD";
    if (!Number.isNaN(meetingStartDate.getTime())) {
      try {
        timeText = meetingStartDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: safeTimeZone,
        });
        dateText = meetingStartDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: safeTimeZone,
        });
      } catch {
        // Ignore and keep TBD.
      }
    }

    const displayLabel = getTimezoneDisplayLabel(safeTimeZone);
    const prefix =
      dateText !== "TBD" &&
      primaryDateForComparison !== "TBD" &&
      dateText !== primaryDateForComparison
        ? `${dateText} ${timeText}`
        : timeText;

    const labelPrefix =
      safeTimeZone === baseCampTimeZone
        ? `<strong>UAE Time</strong>: `
        : "";

    timezoneLines.push(
      `<div style="margin:2px 0;">${labelPrefix}${prefix} (${displayLabel})</div>`,
    );
  }

  const timezonesDisplayHtml =
    timezoneLines.join("") ||
    `<div style="margin:2px 0;">${localTime} (${timezoneDisplay})</div>`;

  return {
    timezone: safePrimaryTimeZone,
    timezoneDisplay,
    localTime,
    localDate,
    timezonesDisplayHtml,
  };
};

export const getClassReminderEmailSubject = (
  meetingTitle: string,
  reminderOffsetMinutes: number,
): string =>
  `⏰ Reminder: ${meetingTitle} starts in ${
    reminderOffsetMinutes >= 60
      ? `${Math.round(reminderOffsetMinutes / 60)} hours`
      : `${reminderOffsetMinutes} minutes`
  }!`;

const DEFAULT_DASHBOARD_URL = (process.env.DASHBOARD_URL || process.env.WEBSITE_URL)
  ? `${String(process.env.DASHBOARD_URL || process.env.WEBSITE_URL).replace(/\/$/, "")}/dashboard`
  : "https://sky-borne.vercel.app/dashboard";
export const CLASS_REMINDER_TEMPLATE_VERSION = "v2026-04-30";

const normalizeDashboardPath = (pathname: string): string => {
  const trimmedPath = String(pathname || "").trim();
  const normalizedBasePath = trimmedPath
    .replace(/(?:\/dashboard)+\/?$/i, "")
    .replace(/\/+$/, "");

  const safeBasePath = normalizedBasePath
    ? normalizedBasePath.startsWith("/")
      ? normalizedBasePath
      : `/${normalizedBasePath}`
    : "";

  return `${safeBasePath}/dashboard`;
};

const getClassReminderDashboardUrl = (): string => {
  const rawDashboardUrl = String(process.env.DASHBOARD_URL || process.env.WEBSITE_URL || "").trim();
  if (!rawDashboardUrl) {
    return DEFAULT_DASHBOARD_URL;
  }
  try {
    const parsedDashboardUrl = new URL(rawDashboardUrl);
    parsedDashboardUrl.pathname = normalizeDashboardPath(parsedDashboardUrl.pathname);
    parsedDashboardUrl.search = "";
    parsedDashboardUrl.hash = "";
    return parsedDashboardUrl.toString();
  } catch {
    const sanitizedDashboardUrl = rawDashboardUrl.replace(/\/+$/, "");
    const normalizedBaseUrl = sanitizedDashboardUrl
      .replace(/(?:\/dashboard)+\/?$/i, "")
      .replace(/\/+$/, "");
    return `${normalizedBaseUrl || "https://sky-borne.vercel.app"}/dashboard`;
  }
};

export const getClassReminderEmailHTML = (
  firstName: string,
  meetingTitle: string,
  region: string,
  localTime: string,
  localDate: string,
  timezone: string,
  trainerName: string,
  duration: number,
  reminderOffsetMinutes: number,
  timezonesDisplayHtml?: string,
  meetingId?: string,
): string => {
  const webLink = getClassReminderDashboardUrl();
  const safeMeetingId = String(meetingId || "").trim();
  // Universal/App Link fallback (use WEBSITE_URL or DASHBOARD_URL env if available)
  const baseWebUrl = (process.env.WEBSITE_URL || process.env.DASHBOARD_URL || "https://sky-borne.vercel.app").replace(/\/$/, "");
  const universalAppLink = safeMeetingId
    ? `${baseWebUrl}/class/${encodeURIComponent(safeMeetingId)}`
    : webLink;
  // Custom scheme for deep linking
  const appLink = safeMeetingId
    ? `skybornedrop://class/${encodeURIComponent(safeMeetingId)}`
    : "";
  const timeUntilClass =
    reminderOffsetMinutes >= 60
      ? `${Math.round(reminderOffsetMinutes / 60)} hours`
      : `${reminderOffsetMinutes} minutes`;
  const safeFirstName = String(firstName || "").trim() || "there";
  const safeMeetingTitle = String(meetingTitle || "").trim() || "Your class";
  const safeTrainerName = String(trainerName || "").trim() || "Your Trainer";
  const safeRegion = String(region || "").trim().toUpperCase() || "N/A";
  const safeLocalDate = String(localDate || "").trim() || "TBD";
  const safeLocalTime = String(localTime || "").trim() || "TBD";
  const safeTimezone = String(timezone || "").trim() || "UTC";
  const safeTimezonesDisplayHtml =
    String(timezonesDisplayHtml || "").trim() ||
    `<div style="margin:2px 0;">${safeLocalTime} (${safeTimezone})</div>`;
  const safeDuration =
    Number.isFinite(Number(duration)) && Number(duration) > 0
      ? `${Number(duration)} minutes`
      : "TBD";


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

        .details-table {
            width: 100%;
            border-collapse: collapse;
        }

        .details-table td {
            padding: 10px 0;
            font-size: 15px;
            vertical-align: top;
        }

        .detail-label {
            color: #777;
            font-weight: 500;
            width: 36%;
        }

        .detail-value {
            color: #000;
            font-weight: 600;
            text-align: right;
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

        .cta-button--secondary {
            background-color: #ffffff !important;
            color: #c94a7f !important;
            border: 2px solid #c94a7f !important;
            cursor: pointer !important;
        }

        .cta-button--secondary:hover {
            background-color: #fff6fa !important;
            color: #b03a6f !important;
            border-color: #b03a6f !important;
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

            .details-table td,
            .details-table tr {
                display: block;
                width: 100%;
            }

            .detail-label,
            .detail-value {
                text-align: left;
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
    <span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden;">
        SKYBORNE_CLASS_REMINDER_TEMPLATE=${CLASS_REMINDER_TEMPLATE_VERSION}
    </span>
    <div class="container">
        <div class="header">
            <h1>CLASS REMINDER</h1>
            <p>Your class is starting soon!</p>
        </div>

        <div class="content">
            <p class="greeting">
                Hi <strong>${safeFirstName}</strong>,
            </p>

            <p class="greeting">
                Your fitness class <strong>${safeMeetingTitle}</strong> is starting in approximately <strong>${timeUntilClass}</strong>.
                We have it scheduled for <strong>${safeLocalDate}</strong> at <strong>${safeLocalTime}</strong> (${safeTimezone}).
            </p>

            <div class="class-details">
                <table role="presentation" class="details-table" cellpadding="0" cellspacing="0">
                    <tr>
                        <td class="detail-label">Class Title</td>
                        <td class="detail-value">${safeMeetingTitle}</td>
                    </tr>
                    <tr><td colspan="2"><div class="divider"></div></td></tr>
                    <tr>
                        <td class="detail-label">Date</td>
                        <td class="detail-value">${safeLocalDate}</td>
                    </tr>
                    <tr>
                        <td class="detail-label">Time</td>
                        <td class="detail-value">${safeTimezonesDisplayHtml}</td>
                    </tr>
                    <tr>
                        <td class="detail-label">Trainer</td>
                        <td class="detail-value">${safeTrainerName}</td>
                    </tr>
                    <tr>
                        <td class="detail-label">Region</td>
                        <td class="detail-value">${safeRegion}</td>
                    </tr>
                    <tr>
                        <td class="detail-label">Duration</td>
                        <td class="detail-value">${safeDuration}</td>
                    </tr>
                </table>
            </div>

            <div class="reminder-box">
                Make sure to join 5 minutes before the class starts!
            </div>


            <div class="cta-section">
                <a href="${universalAppLink}" class="cta-button">
                    View Class
                </a>
                ${
                  appLink
                    ? `<div style=\"height: 12px; line-height: 12px;\">&nbsp;</div>
                    <a href=\"${appLink}\" style=\"display: inline-block; padding: 14px 40px; background-color: #ffffff; color: #c94a7f; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; border: 2px solid #c94a7f; cursor: pointer; -webkit-appearance: button; -webkit-text-size-adjust: 100%; margin-top: 12px;\">Open in App</a>`
                    : ""
                }
            <p class="greeting" style="font-size: 14px; color: #777; text-align: center;">
              Open your dashboard to review the class and join on time. If you need anything, our support team is here to help.
            </p>
        </div>

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
