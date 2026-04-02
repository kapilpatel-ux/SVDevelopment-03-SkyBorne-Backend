import { Request, Response } from "express";
import ServiceServices from "../services/ServiceServices";
import { invalidateCacheByPrefix } from "../../../middlewares/cache.middleware";

const serviceService = new ServiceServices();

export default class ServiceController {
  // GET ALL
  static async getAllServices(req: Request, res: Response) {
 const { search = "" } = req.query;

  const filter: any = {};

  if (search) {
    filter.title = {
      $regex: search,
      $options: "i", 
    };
  }    const services = await serviceService.getAllServices(filter);
    return res.status(200).json({
      success: true,
      message: "Services fetched successfully",
      data: services,
    });
  }

  // GET ONLY ACTIVE SERVICES
  static async getActiveServices(req: Request, res: Response) {
    const services = await serviceService.getActiveServices();
    return res.status(200).json({
      success: true,
      message: "Active services fetched successfully",
      data: services,
    });
  }

  // CREATE
  static async createService(req: Request, res: Response) {
    const service = await serviceService.createService(req.body);
    await invalidateCacheByPrefix("services");
    return res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: service,
    });
  }

  // UPDATE SERVICE
  static async updateService(req: Request, res: Response) {
    const { serviceId } = req.params;
    const service = await serviceService.updateService(serviceId, req.body);
    await invalidateCacheByPrefix("services");

    return res.status(200).json({
      success: true,
      message: "Service updated successfully",
      data: service,
    });
  }

  // UPDATE STATUS (isActive)
  static async updateServiceStatus(req: Request, res: Response) {
    const { serviceId } = req.params;
    const { isActive } = req.body;

    const service = await serviceService.updateServiceStatus(
      serviceId,
      isActive
    );
    await invalidateCacheByPrefix("services");

    return res.status(200).json({
      success: true,
      message: "Service status updated successfully",
      data: service,
    });
  }

  // DELETE
  static async deleteService(req: Request, res: Response) {
    const { serviceId } = req.params;
    await serviceService.deleteService(serviceId);
    await invalidateCacheByPrefix("services");

    return res.status(200).json({
      success: true,
      message: "Service deleted successfully",
    });
  }
}
