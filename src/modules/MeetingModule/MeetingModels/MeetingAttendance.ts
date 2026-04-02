import { Schema, model, Document, Types } from "mongoose";
import { IMeeting } from "./Meeting";

export interface ISession {
  joinTime: Date;
  progress?: number;
  leaveTime?: Date | null;
  duration?: number; // Duration in minutes
  zoomParticipantId?: string;
  mode?: "live" | "replay"; // NEW: Track which mode user accessed
  region?: string; // NEW: Track which region user joined from
}

export interface IMeetingAttendance extends Document {
  meeting: IMeeting | Types.ObjectId;
  zoomParticipantId?:string;
  user: Types.ObjectId;
  region?: string; // Region user is accessing from
  progress?: number;
  sessions: ISession[];
  totalDuration: number; // Total duration in minutes across all sessions
  totalSessions: number; // Total number of sessions attended
  status: "registered" | "joined" | "completed" | "missed";
  joinedAt?: Date; // First join time
  completedAt?: Date; // When fully completed
  correlationToken?: string; // Used to verify identity from Zoom webhook
  createdAt?: Date;
  updatedAt?: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    joinTime: {
      type: Date,
      required: true,
      index: true,
    },
    leaveTime: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number,
      default: 0,
    },
    progress: {
      type: Number,
      default: 0,
    },
    zoomParticipantId: {
      type: String,
      index: true,
    },
    // NEW: Mode (live or replay)
    mode: {
      type: String,
      enum: ["live", "replay"],
      default: "live",
    },
    // NEW: Region user joined from
    region: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const MeetingAttendanceSchema = new Schema<IMeetingAttendance>(
  {
    meeting: {
      type: Schema.Types.ObjectId,
      ref: "Meeting",
      required: true,
      autopopulate: true,
    },

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      autopopulate: true,
    },

    // NEW: Track which region user is from
    region: {
      type: String,
      default: null,
    },

    sessions: {
      type: [SessionSchema],
      default: [],
    },

    totalDuration: {
      type: Number,
      default: 0,
      description: "Total duration in minutes across all sessions",
    },
    progress: {
      type: Number,
      default: 0,
      description: "Total progress",
    },

    totalSessions: {
      type: Number,
      default: 0,
      description: "Total number of sessions attended",
    },
      zoomParticipantId: {
    type: String,
    required: false,
  },

    status: {
      type: String,
      enum: ["registered", "joined", "completed", "missed"],
      default: "registered",
      index: true,
    },

    joinedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    correlationToken: {
      type: String,
      index: true,
      sparse: true, // Only index when present
    },
  },
  { timestamps: true }
);


export default model<IMeetingAttendance>(
  "MeetingAttendance",
  MeetingAttendanceSchema
);
