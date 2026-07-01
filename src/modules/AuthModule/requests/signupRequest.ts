import * as yup from "yup";

const RegisterValidationSchema = yup.object({
  body: yup.object({
    // FIRST NAME
    firstName: yup
      .string()
      .trim()
      .min(2, "First name must be at least 2 characters")
      .required("First name is required"),

    // LAST NAME
    lastName: yup
      .string()
      .trim().notRequired(),

    // EMAIL
    email: yup
      .string()
      .email("Invalid email format")
      .required("Email address is required"),

    authProvider: yup
      .string()
      .oneOf(["email", "google", "apple"])
      .required("Auth provider is required"),

    // PASSWORD
    // password (required only for email signup)
    password: yup.string().when("authProvider", {
      is: "email",
      then: (schema) =>
        schema
          .min(6, "Password must be at least 6 characters")
          .required("Password is required"),
      otherwise: (schema) => schema.notRequired().nullable(),
    }),

    // COUNTRY / LOCATION
    // country: yup.string().required("Country is required"),
    state: yup.string().trim().notRequired(),
    city: yup.string().trim().notRequired(),

    // PHONE NUMBER
    phoneNumber: yup
      .string()
      .matches(/^[0-9+\-()\s]+$/, "Invalid phone number format"),
    // Uncomment for otp
    // OTP
    otp: yup
      .string()
      .matches(/^\d{6}$/, "OTP must be a 6-digit number"),

    // TEMP USER ID
    tempUserId: yup.string().required("Temporary user ID is required"),

    // AGE GROUP
    // ageGroup: yup
    //   .string()
    //   .oneOf(["1", "2", "3", "4", "5"], "Invalid age group")
    //   .required("Age group is required"),

    // WELLNESS ROLE
    // wellnessRole: yup
    //   .string()
    //   .oneOf(["1", "2", "3"], "Invalid wellness role")
    //   .required("Wellness role is required"),

    // GOAL
    goal: yup.string().required("Goal is required"),

    // MOTIVATION (OPTIONAL)
    motivation: yup.string().trim().nullable().notRequired(),

    // TERMS & CONDITIONS
    // agreeTerms: yup
    //   .boolean()
    //   .oneOf([true], "You must agree to the terms & conditions"),
  }),
});

export const RefreshTokenValidationSchema = yup.object({
  body: yup.object({
    // FIRST NAME
    refreshToken: yup.string().required("Refresh token is required"),
  }),
});

export const resetPasswordSchema = yup.object({
  body: yup.object({
    email: yup
      .string()
      .email("Invalid email format")
      .required("Email is required"),

    newPassword: yup
      .string()
      .min(8, "Password must be at least 6 characters")
      .required("New password is required"),
  }),
});

export default RegisterValidationSchema;
