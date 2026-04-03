import TestimonialController from "../controllers/TestimonialController";
import type { AppRouteDefinition } from "../../../routes/route.types";

export const TestimonialRoute: AppRouteDefinition[] = [
  {
    path: "/testimonials",
    request: null,
    action: TestimonialController.getAllPlans,
    method: "get",
  },
];
