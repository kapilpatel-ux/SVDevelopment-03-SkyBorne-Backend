import mongoose from "mongoose";

export interface IRegion {
  _id: mongoose.Types.ObjectId;
  name: string;
  code: string;
  timezone?: string;
  displayLabel?: string;
  replayTime?: string;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const regionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    timezone: {
      type: String,
      required: false,
      trim: true,
      // Example: "Asia/Dubai", "America/New_York", etc.
    },
    displayLabel: {
      type: String,
      required: false,
      trim: true,
      // Example: "Gulf (UAE, Saudi Arabia)", "Canada / USA"
    },
    replayTime: {
      type: String,
      required: false,
      trim: true,
      // Example: "10:00 AM", "2:00 PM"
      match: /^(0?[1-9]|1[0-2]):[0-5][0-9]\s(AM|PM)$/i,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IRegion>("Region", regionSchema);