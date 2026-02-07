import { Schema, model, Document, Types } from "mongoose";
import autopopulate from "mongoose-autopopulate";

// -----------------------------
// Meeting Interface
// -----------------------------
export interface IRegionEntry {
  region: string; // e.g. "Gulf"
  localTime: string; // e.g. "10:00 AM"
  timezone: string; // e.g. "Asia/Dubai"
  mode: "live" | "replay"; // tells frontend live or replay
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
  occurrenceId?: string;

  // NEW FIELD: dynamic region grid
  regions: IRegionEntry[];

  liveRegion: string;
  liveTime: string;

  startDate: Date;
  localTime: Date;

  trainer: Types.ObjectId;
  duration: number;

  autoRecording: boolean;
  rotationEnabled: boolean;

  isLive: boolean;

  joinUrl: string;
  startUrl: string;

  // NEW FIELD: recording cloud URL from Zoom
  recordingUrl: string;

  status: "pending" | "completed" | "failed";

  isRecurring?: boolean;
  recurringType?: "weekly" | "monthly" | "custom";
  recurringDays?: number;
  weeklyEndDate?: Date;
  parentMeetingId?: Types.ObjectId;

  createdBy: Types.ObjectId;
}

// -----------------------------
// Meeting Schema
// -----------------------------
const MeetingSchema = new Schema<IMeeting>(
  {
    zoomMeetingId: {
      type: Number,
      required: true,
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

    // -----------------------------
    // NEW: Store all regions from frontend
    // -----------------------------
    regions: [
      {
        region: { type: String, required: true },
        localTime: { type: String, required: true },
        timezone: { type: String, required: true },
        mode: { type: String, enum: ["live", "replay"], required: true },
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

    autoRecording: {
      type: Boolean,
      default: true,
    },

    rotationEnabled: {
      type: Boolean,
      default: true,
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

    // NEW FIELD
    recordingUrl: {
      type: String,
      default: "",
    },

    isRecurring: {
      type: Boolean,
      default: false,
      index: true,
    },

    recurringType: {
      type: String,
      enum: ["weekly", "monthly", "custom"],
      default: null,
    },

    recurringDays: {
      type: Number,
      min: 1,
      max: 30,
      default: null,
    },

    weeklyEndDate: {
      type: Date,
      default: null,
    },

    parentMeetingId: {
      type: Schema.Types.ObjectId,
      ref: "Meeting",
      default: null,
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      autopopulate: true,
    },
  },
  { timestamps: true },
);

// Plugin
MeetingSchema.plugin(autopopulate);

// -----------------------------
// Export Model
// -----------------------------
export default model<IMeeting>("Meeting", MeetingSchema);
