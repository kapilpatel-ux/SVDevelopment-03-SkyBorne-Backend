export const ClassReminderRoutes = [
  {
    path: "/meetings/:meetingId/send-reminder",
    request: null,
    action: "ClassReminderController.SendClassReminder",
    method: "post",
    description: "Send class reminder emails to all users in the meeting's region",
  },
  {
    path: "/meetings/region/:region/users",
    request: null,
    action: "ClassReminderController.GetUsersByRegion",
    method: "get",
    description: "Get all active users in a specific region",
  },
  {
    path: "/meetings/region/:region/countries",
    request: null,
    action: "ClassReminderController.GetCountriesByRegion",
    method: "get",
    description: "Get all countries in a specific region",
  },
];