import { ConsultationController } from "./ConsultationController";
import { consultationSchema } from "./ConsultationRequest";
import type { AppRouteDefinition } from "../../routes/route.types";

export const ConsultationRoute: AppRouteDefinition[] = [
  {
    path: "/consultation",
    request: consultationSchema,
    action: ConsultationController.createConsultation,
    method: "post",
  },
  {
    path: "/consultation",
    request: null,
    action: ConsultationController.getConsultation,
    method: "post",
  },
];
