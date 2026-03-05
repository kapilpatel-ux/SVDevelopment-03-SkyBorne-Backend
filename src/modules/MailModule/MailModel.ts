import { Document, Schema, model } from "mongoose";

export interface IMailLog extends Document {
  meetingId?: string;
  meetingTitle: string;
  meetingTime: Date;
  sentAt: Date;
  totalUsers: number;
  status: "success" | "failed";
  failureReason?: string;
}

const MailLogSchema = new Schema<IMailLog>(
  {
    meetingId: {
      type: String,
      required: false,
      trim: true,
    },
    meetingTitle: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    meetingTime: {
      type: Date,
      required: true,
    },
    sentAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    totalUsers: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ["success", "failed"],
      required: true,
      default: "success",
      index: true,
    },
    failureReason: {
      type: String,
      required: false,
      trim: true,
      default: null,
    },
  },
  { timestamps: true },
);

export default model<IMailLog>("MailLog", MailLogSchema);
