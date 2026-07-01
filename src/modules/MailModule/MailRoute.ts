import MailController from "./MailController";

export const MailRoutes = [
  {
    path: "/mail-management/logs",
    request: null,
    action: MailController.GetAllMailLogs,
    method: "get",
  },
  {
    path: "/mail-management/error-log",
    request: null,
    action: MailController.GetErrorLog,
    method: "get",
  },
];
