import mongoose, { Schema, Document } from "mongoose";
import { IFaq } from "./FAQInterface";



// 2️⃣ Create Schema with Generics
const faqSchema = new Schema<IFaq>(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    videoUrl: {
      type: String,
      required: false,
      trim: true,
    },
  },
  { timestamps: true }
);

faqSchema.index({ question: 1 });

// 3️⃣ Export Model
export default mongoose.model<IFaq>("Faq", faqSchema);
