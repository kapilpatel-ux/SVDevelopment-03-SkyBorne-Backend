import RepositoryAbstract from "../../abstracts/RepositoryAbstract";
import ecomCategoryModel, { IEcomCategory } from "./ecomCategory.model";

interface SearchOptions {
  search?: string;
  skip?: number;
  limit?: number;
  status?: "active" | "inactive";
}

export default class EcomCategoryRepository extends RepositoryAbstract<IEcomCategory> {
  constructor() {
    super(ecomCategoryModel, "EcomCategory");
  }

  async searchCategories(options: SearchOptions): Promise<IEcomCategory[]> {
    const { search = "", skip = 0, limit = 10, status } = options;

    const query: any = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (status) {
      query.status = status;
    }

    return this.model
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async countCategories(options: { search?: string; status?: "active" | "inactive" }): Promise<number> {
    const { search = "", status } = options;

    const query: any = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (status) {
      query.status = status;
    }

    return this.model.countDocuments(query).exec();
  }

  async getAllActiveCategories(): Promise<IEcomCategory[]> {
    return this.model.find({ status: "active" }).sort({ createdAt: 1 }).exec();
  }
}
