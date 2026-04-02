import mongoose, { Schema } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { IServiceDocument } from "../interfaces/service.interface";

const ServiceSchema = new Schema<IServiceDocument>(
  {
    uuid: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: false,
    },

    image: {
      type: String, // URL of the service image (S3, Cloudinary, etc.)
      required: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 1, // for sorting on UI
    },
  },
  { timestamps: true }
);

ServiceSchema.index({ isActive: 1, order: 1 });
ServiceSchema.index({ title: 1 });

const ServiceModel = mongoose.model("Service", ServiceSchema);

export default ServiceModel;
