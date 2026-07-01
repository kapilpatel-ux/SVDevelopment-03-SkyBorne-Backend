import mongoose from "mongoose";
import FAQModel from "../modules/FAQModule/FAQModel";
import dotenv from "dotenv";

dotenv.config();

export const contentData = [
  {
    question: "How do I sign up?",
    answer:
      "Create an account using your email and phone number, verify it with the OTP, choose your wellness plan, and your account will be activated.",
    videoUrl: "https://skyborne-images.s3.ap-south-1.amazonaws.com/signup.mp4",
  },
  {
    question: "How do I subscribe?",
    answer:
      "After logging in, open the Packages section, choose a package, and complete the payment.",
  },
  {
    question: "How can I change or reset my password?",
    answer:
      "On the login screen, click the “Forgot Password” option and follow the steps to reset your password.",
    videoUrl:
      "https://skyborne-images.s3.ap-south-1.amazonaws.com/forgot-password2.mp4",
  },

  // FAQs shared by client (exact text)

  {
    question: "What types of packages do you offer?",
    answer:
      "We offer various monthly subscription plans tailored to your wellness goals. These packages cover scheduled online sessions for Yoga and Zumba.",
  },
  {
    question:
      "How long are the classes, and how many sessions are included?",
    answer:
      "Classes generally range from 30 to 60 minutes in duration. The total number of sessions included depends on the specific plan you select during checkout.",
  },
  {
    question: "Do you offer refunds if I cancel mid-subscription?",
    answer:
      "Our refund eligibility is governed by our formal Refund Policy. We encourage all members to review the policy details on our website regarding cancellations and prorated credits.",
  },
  {
    question:
      "How can I cancel my subscription, and when does it take effect?",
    answer:
      "You may request a cancellation by writing to our support team. Please note that cancellations are effective from the start of the next billing cycle. You will retain access to your current sessions until your existing subscription period expires.",
  },
  {
    question: "How is my payment processed?",
    answer:
      "Payments are processed through highly secure, encrypted networks provided by industry-leading service providers.",
  },
  {
    question: "Do you store my credit card or personal data?",
    answer:
      "Skyborne Drop does not store credit card details on our servers. All sensitive payment information is handled directly by our PCI-compliant service providers. We only maintain the basic contact information required to manage your account.",
  },
  {
    question: "Who conducts the classes?",
    answer:
      "Classes are led by trained professionals. While we aim to provide a consistent experience with specific instructors, Skyborne Drop reserves the right to change trainers at any time based on scheduling and availability.",
  },
  {
    question: "How will the classes be delivered?",
    answer:
      "All sessions are delivered online via a professional live-streaming tool. User can have access the recording of the sessions for a certain period.",
  },
  {
    question: "How do I reach out for help?",
    answer:
      'If you have any questions or require assistance, please feel free to reach out to us through the "Contact Us" section of our website.',
  },
  {
    question: "What is the Health & Liability Disclaimer?",
    answer:
      "Physical Readiness & Liability By participating in Skyborne Drop sessions, you acknowledge that physical exercise involves inherent risks of injury. You are responsible for ensuring you are in a safe environment and physically fit to participate. We strongly recommend consulting a physician before starting any new fitness program. Skyborne Drop and its instructors are not liable for any injuries, health complications, or damages resulting from participation in our online classes.",
  },
];


const start = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI!);
    await FAQModel.deleteMany();
    await FAQModel.insertMany(contentData);

    process.exit();
  } catch (error) {
    console.log("❌ Seeder Error:", error);
    process.exit(1);
  }
};

start();
