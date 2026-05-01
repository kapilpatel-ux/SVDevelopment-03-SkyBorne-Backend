import mongoose from "mongoose";

export interface ICountryRegionHistory {
  _id: mongoose.Types.ObjectId;
  country: mongoose.Types.ObjectId;
  region?: mongoose.Types.ObjectId | null;
  fromDate: Date;
  toDate?: Date | null;
  changedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const countryRegionHistorySchema = new mongoose.Schema(
  {
    country: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Country",
      required: true,
      index: true,
    },
    region: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      default: null,
      index: true,
    },
    fromDate: {
      type: Date,
      required: true,
      index: true,
    },
    toDate: {
      type: Date,
      default: null,
      index: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

// Query pattern: country + (toDate null) or date ranges
countryRegionHistorySchema.index({ country: 1, fromDate: -1 });
countryRegionHistorySchema.index({ country: 1, toDate: 1 });

export default mongoose.model<ICountryRegionHistory>(
  "CountryRegionHistory",
  countryRegionHistorySchema,
);

