import RepositoryAbstract from "../../../abstracts/RepositoryAbstract";
import { IPlanDocument } from "../interfaces/plan.interface";
import PlanModel from "../models/Plan";

export default class PlanRepository extends RepositoryAbstract<IPlanDocument> {
  constructor() {
    super(PlanModel, "Plan");
  }

  async getPublicPlans() {
    return PlanModel.find({ isActive: true }).sort({ order: 1, createdAt: -1 });
  }

  async getAdminPlans(search = "", page = 1, limit = 10) {
    const query = search
      ? {
          name: { $regex: search, $options: "i" },
        }
      : {};
    const skip = (page - 1) * limit;

    const [plans, total] = await Promise.all([
      PlanModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      PlanModel.countDocuments(query),
    ]);

    return {
      plans,
      pagination: {
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        total,
        limit,
      },
    };
  }

  async findByName(name: string, excludePlanId?: string) {
    const query: Record<string, unknown> = {
      name: { $regex: `^${name}$`, $options: "i" },
    };

    if (excludePlanId) {
      query._id = { $ne: excludePlanId };
    }

    return PlanModel.findOne(query);
  }
}
