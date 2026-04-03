import PlanController from "../controllers/PlanController";
import { cacheResponse } from "../../../middlewares/cache.middleware";
import type { AppRouteDefinition } from "../../../routes/route.types";

const planCache = cacheResponse({ keyPrefix: "plans", ttlSeconds: 300 });

export const PlanRoute: AppRouteDefinition[] = [
  {
    path: "/plans",
    request: null,
    action: PlanController.getAllPlans,
    method: "get",
    cache: planCache,
  },
  {
    path: "/admin/plans",
    request: null,
    action: PlanController.getAdminPlans,
    method: "get",
    roles: ["admin"],
  },
  {
    path: "/admin/plans/:planId",
    request: null,
    action: PlanController.getPlanById,
    method: "get",
    roles: ["admin"],
  },
  {
    path: "/admin/plans",
    request: null,
    action: PlanController.createPlan,
    method: "post",
    roles: ["admin"],
  },
  {
    path: "/admin/plans/:planId",
    request: null,
    action: PlanController.updatePlan,
    method: "put",
    roles: ["admin"],
  },
  {
    path: "/admin/plans/:planId/status",
    request: null,
    action: PlanController.updatePlanStatus,
    method: "patch",
    roles: ["admin"],
  },
];
