import { RegionController } from "./region.controller";
import type { AppRouteDefinition } from "../../routes/route.types";

const _regionController = new RegionController();

export const RegionRoute: AppRouteDefinition[] = [
  // Get all regions with pagination and search
  {
    path: "/regions",
    request: null,
    action: _regionController.getAllRegions,
    method: "get",
  },

  // Get all active regions (for dropdowns, no pagination)
  {
    path: "/regions/active",
    request: null,
    action: _regionController.getAllActiveRegions,
    method: "get",
  },

  // Get single region by ID
  {
    path: "/regions/:regionId",
    request: null,
    action: _regionController.getRegionById,
    method: "get",
  },

  // Create new region
  {
    path: "/create-region",
    request: null,
    action: _regionController.createRegion,
    method: "post",
  },

  // Update region (full update)
  {
    path: "/update-region/:regionId",
    request: null,
    action: _regionController.updateRegion,
    method: "put",
  },

  // Update region status only
  {
    path: "/update-region-status/:regionId",
    request: null,
    action: _regionController.updateRegionStatus,
    method: "patch",
  },

  // Delete region
  {
    path: "/delete-region/:regionId",
    request: null,
    action: _regionController.deleteRegion,
    method: "delete",
  },
];
