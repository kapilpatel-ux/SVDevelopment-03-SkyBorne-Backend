import mongoose, { Document, Schema } from "mongoose";

export type PushPlatform = "ios" | "android" | "web";

export interface IDeviceToken extends Document {
  userId: mongoose.Types.ObjectId;
  token: string;
  platform: PushPlatform;
  deviceId?: string;
  isActive: boolean;
  optInBroadcast: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceTokenSchema = new Schema<IDeviceToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android", "web"],
      required: true,
    },
    deviceId: {
      type: String,
      trim: true,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    optInBroadcast: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

DeviceTokenSchema.index({ userId: 1, token: 1 });

export default mongoose.model<IDeviceToken>("DeviceToken", DeviceTokenSchema);
