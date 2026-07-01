import { Request, Response } from "express";
import PlanServices from "../services/PlanService";
import { IPlan, IServiceClassCount } from "../interfaces/plan.interface";
import ServiceModel from "../../ServiceModule/models/Service";

const planService = new PlanServices();

export default class PlanController {
  private static async getServiceTitleMap() {
    const services = await ServiceModel.find({}, { title: 1 }).lean();
    const serviceTitleMap = new Map<string, string>();

    services.forEach((service) => {
      const normalized = service.title.trim().toLowerCase();
      if (normalized) {
        serviceTitleMap.set(normalized, service.title.trim());
      }
    });

    return serviceTitleMap;
  }

  private static normalizeServices(
    services: unknown,
    serviceTitleMap: Map<string, string>,
  ): string[] {
    if (!Array.isArray(services) || services.length === 0) {
      return [];
    }

    const normalizedIncoming = Array.from(
      new Set(
        services.map((service) => String(service).trim().toLowerCase()),
      ),
    ).filter(Boolean);

    const hasInvalidService = normalizedIncoming.some(
      (service) => !serviceTitleMap.has(service),
    );
    if (hasInvalidService) {
      return [];
    }

    return normalizedIncoming
      .map((service) => serviceTitleMap.get(service))
      .filter((service): service is string => Boolean(service));
  }

  private static distributeServiceClassCounts(
    services: string[],
    totalClassCount: number,
  ): IServiceClassCount[] {
    if (!Array.isArray(services) || services.length === 0) {
      return [];
    }

    const validTotal = Math.max(0, Math.floor(totalClassCount || 0));
    const baseCount = Math.floor(validTotal / services.length);
    let remainder = validTotal % services.length;

    return services.map((service) => {
      const classCountPerMonth = baseCount + (remainder > 0 ? 1 : 0);
      if (remainder > 0) {
        remainder -= 1;
      }
      return {
        service,
        classCountPerMonth,
      };
    });
  }

  private static normalizeServiceClassCounts(
    rawServiceClassCounts: unknown,
    services: string[],
    serviceTitleMap: Map<string, string>,
  ): IServiceClassCount[] | null {
    if (!Array.isArray(rawServiceClassCounts)) {
      return null;
    }

    const normalizedServicesSet = new Set(services);
    const classCountMap = new Map<string, number>();

    for (const item of rawServiceClassCounts) {
      const serviceRaw =
        typeof item === "object" && item !== null ? (item as { service?: unknown }).service : "";
      const classCountRaw =
        typeof item === "object" && item !== null
          ? (item as { classCountPerMonth?: unknown }).classCountPerMonth
          : undefined;

      const normalizedService = String(serviceRaw || "").trim().toLowerCase();
      const canonicalService = serviceTitleMap.get(normalizedService);
      const classCount = Number(classCountRaw);

      if (!canonicalService || !normalizedServicesSet.has(canonicalService)) {
        return null;
      }

      if (!Number.isFinite(classCount) || classCount < 0) {
        return null;
      }

      classCountMap.set(canonicalService, Math.floor(classCount));
    }

    if (classCountMap.size !== services.length) {
      return null;
    }

    return services.map((service) => ({
      service,
      classCountPerMonth: classCountMap.get(service) || 0,
    }));
  }

  private static getTotalClassCount(
    serviceClassCounts: IServiceClassCount[],
  ): number {
    return serviceClassCounts.reduce(
      (sum, item) => sum + Math.max(0, Math.floor(Number(item.classCountPerMonth || 0))),
      0,
    );
  }

  static async getAllPlans(req: Request, res: Response) {
    const plans = await planService.getPublicPlans();
    return res.status(200).json({
      success: true,
      message: "Plans fetched successfully",
      data: plans,
    });
  }

  static async getAdminPlans(req: Request, res: Response) {
    const search = (req.query.search as string) || "";
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Number(req.query.limit) || 10);
    const data = await planService.getAdminPlans(search, page, limit);

    return res.status(200).json({
      success: true,
      message: "Plans fetched successfully",
      data,
    });
  }

  static async getPlanById(req: Request, res: Response) {
    const { planId } = req.params;
    const plan = await planService.getPlanById(planId);

    return res.status(200).json({
      success: true,
      message: "Plan fetched successfully",
      data: plan,
    });
  }

  static async createPlan(req: Request, res: Response) {
    const {
      name,
      services,
      price,
      classCountPerMonth,
      serviceClassCounts,
      description = "",
      image = "/images/basic-plan.svg",
      features = [],
      order = 1,
      isActive = true,
    } = req.body as Partial<IPlan>;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Plan name is required",
      });
    }

    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one service is required",
      });
    }
    const serviceTitleMap = await PlanController.getServiceTitleMap();
    if (serviceTitleMap.size === 0) {
      return res.status(400).json({
        success: false,
        message: "No services available. Please add services first.",
      });
    }
    const normalizedServices = PlanController.normalizeServices(
      services,
      serviceTitleMap,
    );
    if (normalizedServices.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid service selected",
      });
    }

    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a number greater than or equal to 0",
      });
    }

    const parsedClassCountPerMonth = Number(classCountPerMonth);
    if (
      classCountPerMonth !== undefined &&
      (!Number.isFinite(parsedClassCountPerMonth) || parsedClassCountPerMonth < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Class count/month must be a number greater than or equal to 0",
      });
    }

    const normalizedServiceClassCounts =
      PlanController.normalizeServiceClassCounts(
        serviceClassCounts,
        normalizedServices,
        serviceTitleMap,
      ) ||
      PlanController.distributeServiceClassCounts(
        normalizedServices,
        parsedClassCountPerMonth || 0,
      );

    if (normalizedServiceClassCounts.length !== normalizedServices.length) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide valid class count/month for each selected service",
      });
    }

    const totalClassCount = PlanController.getTotalClassCount(
      normalizedServiceClassCounts,
    );

    const existingPlan = await planService.findByName(name.trim());
    if (existingPlan) {
      return res.status(409).json({
        success: false,
        message: "Plan name already exists",
      });
    }

    const plan = await planService.createPlan({
      name: name.trim(),
      services: normalizedServices,
      price,
      serviceClassCounts: normalizedServiceClassCounts,
      classCountPerMonth: totalClassCount,
      description,
      image,
      features,
      order,
      isActive,
    });

    return res.status(201).json({
      success: true,
      message: "Plan created successfully",
      data: plan,
    });
  }

  static async updatePlan(req: Request, res: Response) {
    const { planId } = req.params;
    const payload = req.body as Partial<IPlan>;
    const existingPlan = await planService.getPlanById(planId);

    if (payload.name && payload.name.trim()) {
      const duplicatePlan = await planService.findByName(
        payload.name.trim(),
        planId,
      );
      if (duplicatePlan) {
        return res.status(409).json({
          success: false,
          message: "Plan name already exists",
        });
      }
      payload.name = payload.name.trim();
    }

    if (payload.price !== undefined && (typeof payload.price !== "number" || payload.price < 0)) {
      return res.status(400).json({
        success: false,
        message: "Price must be a number greater than or equal to 0",
      });
    }

    const parsedClassCountPerMonth =
      payload.classCountPerMonth !== undefined
        ? Number(payload.classCountPerMonth)
        : undefined;
    if (
      parsedClassCountPerMonth !== undefined &&
      (!Number.isFinite(parsedClassCountPerMonth) || parsedClassCountPerMonth < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Class count/month must be a number greater than or equal to 0",
      });
    }

    if (payload.services !== undefined && (!Array.isArray(payload.services) || payload.services.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "At least one service is required",
      });
    }
    const serviceTitleMap = await PlanController.getServiceTitleMap();
    if (serviceTitleMap.size === 0) {
      return res.status(400).json({
        success: false,
        message: "No services available. Please add services first.",
      });
    }

    if (payload.services) {
      const normalizedServices = PlanController.normalizeServices(
        payload.services,
        serviceTitleMap,
      );
      if (normalizedServices.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid service selected",
        });
      }

      payload.services = normalizedServices;
    }

    const nextServices = Array.isArray(payload.services)
      ? payload.services
      : Array.isArray(existingPlan?.services)
        ? existingPlan.services
        : [];

    let nextServiceClassCounts: IServiceClassCount[] | null =
      PlanController.normalizeServiceClassCounts(
        payload.serviceClassCounts,
        nextServices,
        serviceTitleMap,
      );

    if (!nextServiceClassCounts) {
      if (parsedClassCountPerMonth !== undefined) {
        nextServiceClassCounts = PlanController.distributeServiceClassCounts(
          nextServices,
          parsedClassCountPerMonth,
        );
      } else if (payload.services !== undefined) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide class count/month for each selected service",
        });
      } else {
        nextServiceClassCounts = PlanController.normalizeServiceClassCounts(
          existingPlan?.serviceClassCounts,
          nextServices,
          serviceTitleMap,
        );
      }
    }

    if (!nextServiceClassCounts || nextServiceClassCounts.length !== nextServices.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid service wise class count data",
      });
    }

    payload.serviceClassCounts = nextServiceClassCounts;
    payload.classCountPerMonth =
      PlanController.getTotalClassCount(nextServiceClassCounts);

    const updatedPlan = await planService.updatePlan(planId, payload);

    return res.status(200).json({
      success: true,
      message: "Plan updated successfully",
      data: updatedPlan,
    });
  }

  static async updatePlanStatus(req: Request, res: Response) {
    const { planId } = req.params;
    const { isActive } = req.body as { isActive?: boolean };

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be boolean",
      });
    }

    const plan = await planService.updatePlan(planId, { isActive });

    return res.status(200).json({
      success: true,
      message: "Plan status updated successfully",
      data: plan,
    });
  }
}
