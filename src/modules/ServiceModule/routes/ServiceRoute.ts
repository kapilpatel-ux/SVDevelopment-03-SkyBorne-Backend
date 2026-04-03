import ServiceController from "../controllers/ServiceController";
import { cacheResponse } from "../../../middlewares/cache.middleware";
import type { AppRouteDefinition } from "../../../routes/route.types";

const serviceCache = cacheResponse({ keyPrefix: "services", ttlSeconds: 300 });

export const ServiceRoute: AppRouteDefinition[] = [
    // UPDATE STATUS (isActive) - Must be before generic :serviceId routes
  {
    path: "/services/:serviceId/status",
    request: null,
    action: ServiceController.updateServiceStatus,
    method: "patch",
  roles:["admin"]
  },
  // CREATE SERVICE
  {
    path: "/services",
    request: null,
    action: ServiceController.createService,
    method: "post",
    roles:["admin"]
  },

  // GET ALL SERVICES (Admin)
  {
    path: "/services",
    request: null,
    action: ServiceController.getAllServices,
    method: "get",
    cache: serviceCache,
  },

  // GET ONLY ACTIVE SERVICES (Public / Frontend)
  {
    path: "/services/active",
    request: null,
    action: ServiceController.getActiveServices,
    method: "get",
    cache: serviceCache,
  },

  // UPDATE SERVICE
  {
    path: "/services/:serviceId",
    request: null,
    action: ServiceController.updateService,
    method: "put",
    roles:["admin"]
  },

  // DELETE SERVICE
  {
    path: "/services/:serviceId",
    request: null,
    action: ServiceController.deleteService,
    method: "delete",
    roles:["admin"]
  },
];
