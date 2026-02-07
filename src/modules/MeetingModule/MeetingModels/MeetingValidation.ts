import * as Yup from "yup";

// -----------------------------------------
// CREATE MEETING VALIDATION SCHEMA
// -----------------------------------------
export const CreateMeetingSchema = Yup.object({
  body:Yup.object({
      service: Yup.string()
    .required("Service ID is required")
    .trim(),
  
  liveRegion: Yup.string()
    .required("Live region is required"),
  
  liveTime: Yup.string()
    .required("Live time is required")
    .matches(
      /^(0?[1-9]|1[0-2]):[0-5][0-9]\s(AM|PM)$/,
      "Invalid time format. Use HH:MM AM/PM"
    ),
  
  trainer: Yup.string()
    .required("Trainer ID is required")
    .trim(),

  title: Yup.string()
    .required("Title is required")
    .trim(),

  duration: Yup.number()
    .required("Duration is required")
    .min(30, "Duration must be at least 30 minutes")
    .max(480, "Duration cannot exceed 8 hours"),
  
  rotationEnabled: Yup.boolean(),

  startDate: Yup.string()
    .required("Start date is required")
    .typeError("Start date must be a valid ISO date string"),
  
  localTime: Yup.string()
    .required("Local time is required")
    .typeError("Local time must be a valid ISO datetime"),
  
  adminId: Yup.string()
    .required("Admin ID is required")
    .trim(),
  })

});

// -----------------------------------------
// JOIN MEETING VALIDATION SCHEMA
// -----------------------------------------
export const JoinMeetingSchema = Yup.object().shape({
    body:Yup.object({
  meetingId: Yup.string()
    .required("Meeting ID is required")
    .trim(),
  
  userId: Yup.string()
    .required("User ID is required")
    .trim()
    })
});

// -----------------------------------------
// LEAVE MEETING VALIDATION SCHEMA
// -----------------------------------------
export const LeaveMeetingSchema = Yup.object().shape({
  meetingId: Yup.string()
    .required("Meeting ID is required")
    .trim(),
  
  userId: Yup.string()
    .required("User ID is required")
    .trim(),
});

// -----------------------------------------
// UPCOMING MEETINGS VALIDATION SCHEMA
// -----------------------------------------
export const UpcomingMeetingsSchema = Yup.object().shape({
  limit: Yup.number()
    .default(10)
    .min(1, "Limit must be at least 1"),
  
  offset: Yup.number()
    .default(0)
    .min(0, "Offset cannot be negative"),
});