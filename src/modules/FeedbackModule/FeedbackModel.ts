// models/Feedback.ts
import mongoose, { Schema, Document, Types } from "mongoose";

export interface IFeedback extends Document {
  userId: Types.ObjectId;
  rating: number;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

const FeedbackSchema: Schema<IFeedback> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      autopopulate: {
        select: "firstName lastName email",
        options: { lean: true },
      },
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: (value: number) => value >= 1 && value <= 5,
        message: "Rating must be between 1 and 5",
      },
    },
    comment: {
      type: String,
      required: true,
      minlength: 10,
      maxlength: 500,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Feedback =
  mongoose.models.Feedback ||
  mongoose.model<IFeedback>("Feedback", FeedbackSchema);
