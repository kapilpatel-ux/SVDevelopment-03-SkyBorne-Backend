import mongoose, { Document, Schema } from "mongoose";

export interface IPushNotificationLog extends Document {
  userId?: mongoose.Types.ObjectId;
  eventType: string;
  category:
    | "transactional"
    | "reminder"
    | "lifecycle"
    | "broadcast"
    | "security";
  title: string;
  body: string;
  tokenCount: number;
  successCount: number;
  failureCount: number;
  dedupeKey?: string;
  metadata?: Record<string, any>;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PushNotificationLogSchema = new Schema<IPushNotificationLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      enum: ["transactional", "reminder", "lifecycle", "broadcast", "security"],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    tokenCount: {
      type: Number,
      default: 0,
    },
    successCount: {
      type: Number,
      default: 0,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    dedupeKey: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true },
);

export default mongoose.model<IPushNotificationLog>(
  "PushNotificationLog",
  PushNotificationLogSchema,
);
