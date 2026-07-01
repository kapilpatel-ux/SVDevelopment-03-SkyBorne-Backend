import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";
import { AuthProvider, IUser, UserRole } from "../interface/userInterface";
import { string } from "yup";

const userSchema = new Schema<IUser>(
  {
    // Step 2: Account Creation
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    timeZone: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    fitnessLevel: {
      type: Number,
      default: null,
    },

    // Habits
    habits: {
      type: {
        waterIntake: { type: Number, default: null },
        sleepQuality: { type: Number, default: null },
        exerciseFrequency: { type: Number, default: null },
      },
      default: {
        waterIntake: null,
        sleepQuality: null,
        exerciseFrequency: null,
      },
    },

    password: {
      type: String,
      select: false,
      validate: {
        validator: function (value: string) {
          if (!value) return true;

          return value.length >= 8;
        },
        message: "Password must be at least 8 characters",
      },
    },

    country: {
      type: String,
      required: true,
    },
    countryCode: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    localNumber: {
      type: String,
    },
    dialingCode: {
      type: String,
    },

    trainer: {
      type: Schema.Types.ObjectId,
      ref: "Trainer",
    },

    // OAuth
    authProvider: {
      type: String,
      enum: Object.values(AuthProvider),
      default: AuthProvider.EMAIL,
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
    },
    appleId: {
      type: String,
      sparse: true,
      unique: true,
    },

    // Step 3 & 4: Security
    phoneNumber: {
      type: String,
      sparse: true,
      unique: true,
    },

    // Step 5: Profile
    ageGroup: {
      type: String,
    },
    wellnessRole: {
      type: String,
    },

    // Step 1: Motivation
    motivation: {
      type: String,
    },

    // Step 6: Goals
    firstGoal: {
      type: String,
    },
    agreeTerms: {
      type: Boolean,
      required: true,
      default: false,
    },

    // Step 7: Plan
    plan: {
      type: String,
    },
    pendingPlan: {
      type: String,
      default: null,
    },
    pendingBillingType: {
      type: String,
      enum: ["monthly", "yearly"],
      default: null,
    },
    pendingEffectiveDate: {
      type: Date,
      default: null,
    },

    classCredits: {
      type: {
        yoga: { type: Number, default: 0 },
        zumba: { type: Number, default: 0 },
        specialty: { type: Number, default: 0 },
      },
      default: {
        yoga: 0,
        zumba: 0,
        specialty: 0,
      },
    },

    overAllclassCredits: {
      type: {
        yoga: { type: Number, default: 0 },
        zumba: { type: Number, default: 0 },
        specialty: { type: Number, default: 0 },
      },
      default: {
        yoga: 0,
        zumba: 0,
        specialty: 0,
      },
    },

    totalClassCredits: {
      type: Number,
      default: 0,
    },

    subscription: {
      type: {
        startDate: { type: Date },
        endDate: { type: Date },
        status: {
          type: String,
          enum: ["active", "expired", "inactive", "suspended", "cancelled"],
          default: "active",
        },
        suspendedAt: {
          type: Date,
          required: false,
        },
        cancelledAt: {
          type: Date,
          required: false,
        },
      },
      default: {
        startDate: null,
        endDate: null,
        status: "inactive",
        suspendedAt: null,
      },
    },

    gateway: {
      type: String,
      enum: ["ngenius", "stripe"],
      default: "ngenius", // Will be set based on country on first payment
      index: true,
    },

    // nGenius customer reference
    ngeniusCustomerId: {
      type: String,
      sparse: true,
      unique: true,
    },
    lastPaymentGateway: {
      type: String,
      enum: ["ngenius", "stripe"],
      sparse: true,
    },

    // Stripe customer reference
    stripeCustomerId: {
      type: String,
      sparse: true,
      unique: true,
    },

    // Stripe subscription ID
    stripeSubscriptionId: {
      type: String,
      sparse: true,
    },
    
    billingType:{
      type: String,
      enum: ["monthly", "yearly"],
      default: "monthly",
    },  


    // System
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.MEMBER,
    },

    isActive: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  // If password is undefined (not selected), DO NOT hash
  if (this.password === undefined) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.password) return false;

  return bcrypt.compare(candidatePassword, this.password);
};

// Method to generate OTP
userSchema.methods.generateOTP = function (): string {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = otp;
  this.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  return otp;
};

// Method to verify OTP
userSchema.methods.verifyOTP = function (otp: string): boolean {
  if (!this.otp || !this.otpExpiry) return false;
  if (new Date() > this.otpExpiry) return false;
  return this.otp === otp;
};

export default mongoose.model<IUser>("User", userSchema);
