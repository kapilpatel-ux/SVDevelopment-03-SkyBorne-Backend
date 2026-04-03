import MailController from "./MailController";
import type { AppRouteDefinition } from "../../routes/route.types";

export const MailRoutes: AppRouteDefinition[] = [
  {
    path: "/mail-management/logs",
    request: null,
    action: MailController.GetAllMailLogs,
    method: "get",
  },
];
