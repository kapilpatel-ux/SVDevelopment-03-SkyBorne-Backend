import mongoose, { Schema, Types } from "mongoose";
import { Document } from "mongoose";

export interface ICoach extends Document {
  name: string;
  specialization?: Types.ObjectId | any;
  experience?: number;
  image?: string;
  email: string;
  phoneNumber?: string;
  charges: number;
  status : 'active' | 'inactive';
}

const CoachesSchema = new Schema<ICoach>(
  {
    name: {
      type: String,
      required: true, 
      trim: true,
    },
    specialization: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: false,
      autopopulate: {
        select: "_id title",
      },
    },
    experience: {
      type: Number,
      default: 0,
      min: 0,
    },
    image: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please use a valid email address"],
    },

    phoneNumber: {
      type: String,
      trim: true,
      match: [
        /^\+?[0-9]{7,18}$/,
        "Phone number must be between 7–18 digits and may start with +",
      ],
    },
    status:{
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    
    charges: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true }
);

// Prevent model overwrite issue in Next.js (important!)
export default mongoose.models.Coach ||
  mongoose.model<ICoach>("Coach", CoachesSchema);
