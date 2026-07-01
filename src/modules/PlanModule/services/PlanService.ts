import PlanRepository from "../repository/PlanRepository";
import { IPlan } from "../interfaces/plan.interface";

const _planRepo = new PlanRepository();

export default class PlanServices {
  async getPublicPlans() {
    return _planRepo.getPublicPlans();
  }

  async getAdminPlans(search = "", page = 1, limit = 10) {
    return _planRepo.getAdminPlans(search, page, limit);
  }

  async getPlanById(planId: string) {
    return _planRepo.getOneModel(planId);
  }

  async createPlan(payload: Partial<IPlan>) {
    return _planRepo.createModel(payload);
  }

  async updatePlan(planId: string, payload: Partial<IPlan>) {
    return _planRepo.updateModel(planId, payload);
  }

  async findByName(name: string, excludePlanId?: string) {
    return _planRepo.findByName(name, excludePlanId);
  }
}
