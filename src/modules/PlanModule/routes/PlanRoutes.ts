import PlanController from "../controllers/PlanController";

export const PlanRoute = [
  {
    path: "/plans",
    request: null,
    action: PlanController.getAllPlans,
    method: "get",
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
