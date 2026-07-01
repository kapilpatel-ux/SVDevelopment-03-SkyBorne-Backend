import mongoose from "mongoose";

export interface ICountry {
  _id: mongoose.Types.ObjectId;
  name: string;
  code: string;
  region?: mongoose.Types.ObjectId | null; // Can be null or reference to Region
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const countrySchema = new mongoose.Schema(
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
    region: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      default: null,
      sparse: true, // Allows multiple null values for unique constraints
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

export default mongoose.model<ICountry>("Country", countrySchema);