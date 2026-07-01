export enum UserRole {
  ADMIN = "admin",
  MEMBER = "user",
  TRAINER = "trainer",
}

export enum AuthProvider {
  EMAIL = "email",
  GOOGLE = "google",
  APPLE = "apple",
}

export interface IUser extends Document {
  // Step 2: Account Creation
  firstName: string;
  lastName?: string;
  email: string;
  totalClassCredits?: number;
  gateway?: "stripe" | "ngenius";
  ngeniusCustomerId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  lastPaymentGateway?: "stripe" | "ngenius";
  password?: string;
  country: string;
  state?: string;
  city?: string;
  billingType?: string;
  countryCode: string;
  dialingCode: string;
  trainer?: string;
  timeZone?:string;
  localNumber: string;
  fitnessLevel?: string;
  habits?: {
    waterIntake?: number | null;
    sleepQuality?: number | null;
    exerciseFrequency?: number | null;
  };

  // OAuth
  authProvider: AuthProvider;
  googleId?: string;
  appleId?: string;

  // Step 3 & 4: Security
  phoneNumber?: string;

  // Step 5: Profile
  ageGroup?: string;
  wellnessRole?: string;
  agreeTerms: boolean;

  // Step 1: Motivation
  motivation?: string;

  // Step 6: Goals
  firstGoal?: string;

  // Step 7: Plan Selection
  plan?: string;
  pendingPlan?: string | null;
  pendingBillingType?: "monthly" | "yearly" | null;
  pendingEffectiveDate?: Date | null;

  // Class Credits
  classCredits: {
    yoga: number;
    zumba: number;
    specialty: number;
  };
    overAllclassCredits?: {
    yoga: number;
    zumba: number;
    specialty: number;
  };

  // Subscription
  subscription: {
    startDate: Date | null;
    endDate: Date | null;
    status: "active" | "expired" | "inactive" | "suspended" | "cancelled";
    suspendedAt?: Date | null;
    cancelledAt?: Date | null;
  };

  // System
  role: UserRole;
  isActive: boolean;
  isEmailVerified: boolean;
  onboardingCompleted: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;

  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  generateOTP(): string;
  verifyOTP(otp: string): boolean;
}

export type PlanType =
  | "gold-yoga"
  | "gold-zumba"
  | "gold-mixed"
  | "diamond"
  | "platinum";

export type ServiceType = "yoga" | "zumba" | "specialty";
