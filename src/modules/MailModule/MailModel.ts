import { Document, Schema, model } from "mongoose";

export type MailLogStatus = "success" | "failed";

export interface IMailLog extends Document {
  meetingId?: string;
  meetingTitle: string;
  meetingTime: Date;
  sentAt: Date;
  totalUsers: number;
  status: MailLogStatus;
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
  },
  { timestamps: true },
);

export default model<IMailLog>("MailLog", MailLogSchema);
