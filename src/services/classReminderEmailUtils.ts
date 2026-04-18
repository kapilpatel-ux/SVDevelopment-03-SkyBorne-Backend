import { getCode } from "country-list";
import { COUNTRY_TIMEZONE_MAP } from "../constants/countryTimezoneMap";

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
  const countryCode = resolveUserCountryCode(user);
  if (countryCode && COUNTRY_TIMEZONE_MAP[countryCode]) {
    return COUNTRY_TIMEZONE_MAP[countryCode];
  }

  const explicitTimeZone = String(
    user?.timeZone || user?.timezone || "",
  ).trim();
  if (isValidTimeZone(explicitTimeZone)) {
    return explicitTimeZone;
  }

  return "UTC";
};

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
} => {
  const timezone = resolveUserTimeZone(user);
  const safeTimeZone = isValidTimeZone(timezone) ? timezone : "UTC";
  const timezoneDisplay = getTimezoneDisplayLabel(safeTimeZone);

  let localTime = "TBD";
  let localDate = "TBD";

  if (!Number.isNaN(meetingStartDate.getTime())) {
    try {
      localTime = meetingStartDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: safeTimeZone,
      });
      localDate = meetingStartDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: safeTimeZone,
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

  return {
    timezone: safeTimeZone,
    timezoneDisplay,
    localTime,
    localDate,
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
        <div class="header">
            <h1>CLASS REMINDER</h1>
            <p>Your class is starting soon!</p>
        </div>

        <div class="content">
            <p class="greeting">
                Hi <strong>${firstName}</strong>,
            </p>

            <p class="greeting">
                Your fitness class is starting in approximately <strong>${timeUntilClass}</strong>. Do not miss it!
            </p>

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

            <div class="cta-section">
                <a href="${webLink}" class="cta-button">
                    View Class Details
                </a>
            </div>

            <p class="greeting" style="font-size: 14px; color: #777; text-align: center;">
                If you have any questions, feel free to contact our support team.
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
