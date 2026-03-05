// backend/types/user.types.ts
export type PlanType = 'gold-yoga' | 'gold-zumba' | 'gold-mixed' | 'diamond' | 'platinum';

export type UserRole = 'admin' | 'user' | 'member';

export type SubscriptionStatus = 'active' | 'expired' | 'inactive' | 'suspended' | 'cancelled';

export interface IClassCredits {
  yoga: number;
  zumba: number;
  specialty: number;
}

export interface ISubscription {
  startDate: Date | null;
  endDate: Date | null;
  status: SubscriptionStatus;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
  expiryReminderSentFor?: Date | null;
}

export interface IUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  country: string;
  location?: string;
  plan?: PlanType;
  classCredits: IClassCredits;
  subscription: ISubscription;
  createdAt: string;
  updatedAt: string;
  role: UserRole;
  isActive: boolean;
}

export interface UpdateUserPayload {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  country?: string;
  location?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}
