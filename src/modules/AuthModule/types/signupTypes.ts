export interface SignupTypes {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  country: string;
  state?: string;
  city?: string;
  role?: string;
  motivation?: string | null;
  ip: string;
  userAgent: string;
  countryCode: string;
  dialingCode: string;
  localNumber: string;
  agreeTerms?: boolean;
  phoneNumber?: string;
  otp?: string;
  tempUserId?: string;
  ageGroup?: string;
  wellnessRole?: string;
  goal?: string;
}
