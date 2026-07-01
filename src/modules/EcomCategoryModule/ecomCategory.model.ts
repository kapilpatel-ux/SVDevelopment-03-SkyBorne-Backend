import mongoose from "mongoose";

export interface IEcomCategory {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const ecomCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IEcomCategory>("EcomCategory", ecomCategorySchema);
