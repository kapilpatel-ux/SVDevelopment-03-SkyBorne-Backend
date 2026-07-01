import { Schema, model, Document, Types } from "mongoose";
import autopopulate from "mongoose-autopopulate";
import { boolean } from "yup";

// -----------------------------
// Meeting Interface
// -----------------------------
export interface IRegionEntry {
  region?: string; // e.g. "Gulf"
  localTime?: string; // e.g. "10:00 AM"
  timezone?: string; // e.g. "Asia/Dubai"
  mode?: "live" | "replay"; // tells frontend live or replay
  date?: string; // date for this region
}

export interface IService {
  _id: Types.ObjectId;
  title: string;
  description: string;
  image: string;
  isActive: boolean;
}

export interface IMeeting extends Document {
  zoomMeetingId: number;
  service: Types.ObjectId | IService;
  title: string;
  reminderSent?: boolean; // Track if reminder email has been sent
  reminder30MinSent?: boolean;
  reminder10MinSent?: boolean;
  reminder24HourSent?: boolean;
  reminderOnEventSent?: boolean;
  occurrenceId?: string;

  // Dynamic region grid
  regions: IRegionEntry[];

  liveRegion: string;
  liveTime: string;

  startDate: Date;
  localTime: Date;
  weeklyEndDate?: Date | null;

  trainer: Types.ObjectId;
  duration: number;

  // NEW: Recurring class settings
  recurringClass: boolean;
  recurrenceType?: "weekly" | "monthly" | "custom" | "bi-weekly" | null;
  customDays?: number[]; // Array of weekday numbers (1-7) for custom recurrence

  rotationEnabled: boolean;
  isRecurring: boolean;
  isLive: boolean;

  joinUrl: string;
  startUrl: string;

  // Recording cloud URL from Zoom
  recordingUrl: string;

  status: "pending" | "completed" | "failed";

  createdBy: Types.ObjectId;
  parentMeetingId?: Types.ObjectId; // Reference to parent recurring meeting
}

export interface IPopulatedMeeting extends IMeeting {
  trainer: {
    name: string;
    _id?: any;
  } | any;
  service: {
    title: string;
    _id?: any;
  } | any;
}

// -----------------------------
// Meeting Schema
// -----------------------------
const MeetingSchema = new Schema<IPopulatedMeeting>(
  {
    zoomMeetingId: {
      type: Number,
      required: true,
    },
    reminderSent: {
      type: Boolean,
      required: false,
      default: false,
    },
    reminder30MinSent: {
      type: Boolean,
      required: false,
      default: false,
    },
    reminder10MinSent: {
      type: Boolean,
      required: false,
      default: false,
    },
    reminder24HourSent: {
      type: Boolean,
      required: false,
      default: false,
    },
    reminderOnEventSent: {
      type: Boolean,
      required: false,
      default: false,
    },
    occurrenceId: {
      type: String,
      default: null,
      required: false,
      index: true,
    },
    service: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: true,
      autopopulate: true,
    },

    title: {
      type: String,
      required: true,
    },

    // Store all regions from frontend
    regions: [
      {
        region: { type: String, required: false },
        localTime: { type: String, required: false },
        timezone: { type: String, required: false },
        mode: { type: String, enum: ["live", "replay"], required: false },
        date: { type: String, required: false },
      },
    ],

    liveRegion: {
      type: String,
      required: true,
    },

    liveTime: {
      type: String,
      required: true,
    },

    startDate: {
      type: Date,
      required: true,
      index: true,
    },

    localTime: {
      type: Date,
      required: true,
    },

    weeklyEndDate: {
      type: Date,
      default: null,
      required: false,
    },

    trainer: {
      type: Schema.Types.ObjectId,
      ref: "Coach",
      required: true,
      autopopulate: true,
    },

    duration: {
      type: Number,
      required: true,
      min: 30,
      max: 480,
    },

    // NEW: Recurring class fields
    recurringClass: {
      type: Boolean,
      default: false,
    },

    recurrenceType: {
      type: String,
      enum: ["weekly", "monthly", "custom", "bi-weekly", null],
      default: null,
    },

    customDays: {
      type: [Number],
      default: [],
      validate: {
        validator: function(days: number[]) {
          return days.every(day => day >= 1 && day <= 7);
        },
        message: "Custom days must be between 1 (Monday) and 7 (Sunday)"
      }
    },

    rotationEnabled: {
      type: Boolean,
      default: true,
    },

    isRecurring: {
      type: Boolean,
      default: false,
    },

    isLive: {
      type: Boolean,
      default: true,
    },

    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
      index: true,
    },

    joinUrl: {
      type: String,
      required: true,
    },

    startUrl: {
      type: String,
      default: "",
    },

    recordingUrl: {
      type: String,
      default: "",
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      autopopulate: true,
    },

    parentMeetingId: {
      type: Schema.Types.ObjectId,
      ref: "Meeting",
      default: null,
      required: false,
    },
  },
  { timestamps: true },
);

// Add index for efficient queries
MeetingSchema.index({ recurringClass: 1, recurrenceType: 1 });
MeetingSchema.index({ parentMeetingId: 1 });

// Plugin
MeetingSchema.plugin(autopopulate);

// -----------------------------
// Export Model
// -----------------------------
export default model<IPopulatedMeeting>("Meeting", MeetingSchema);