// ============================================================================
// Backend: RepositoryAbstract.ts (Updated)
// ============================================================================
import {
  ConflictError,
  InternalServerError,
  NotFoundError,
} from "./../handlers/httpError.handler";
import { Document } from "mongodb";
import { Model, Error, FilterQuery } from "mongoose";
import { logger } from "../utils/winston.utils";

export interface IPagination {
  page?: number;
  limit?: number;
  sort?: object | string;
  offset?: number;
  pagination?: boolean;
  customFind?: string;
  populate?: string;
  pagingOptions?: object;
  search?: string;
  skip?: number;
}

export default class RepositoryAbstract<T extends Document> {
  protected model: Model<T>;
  private modelName: string;

  constructor(model: Model<T>, modelName: string) {
    this.model = model;
    this.modelName = modelName;
  }

  async getAllModels(payload: Partial<T>) {
    return this.model
      .find(payload)
      .then((data) => data)
      .catch((err) => this.handleErrorMessage(err));
  }

  async countDocuments(payload: FilterQuery<T> = {}) {
    return this.model
      .countDocuments(payload)
      .then((data) => data)
      .catch((err) => this.handleErrorMessage(err));
  }

  async createModel(payload: Partial<T>) {
    const newModel = new this.model(payload);

    return newModel
      .save()
      .then((data) => data)
      .catch((err) => this.handleErrorMessage(err));
  }

  async getOneModel(uuid: string) {
    return this.model
      .findById(uuid)
      .orFail()
      .then((data) => data)
      .catch((err) => this.handleErrorMessage(err));
  }

  async updateModel(uuid: string, payload: Partial<T>) {
    return this.model
      .findByIdAndUpdate(uuid, { ...payload }, { new: true })
      .orFail()
      .then((data) => data)
      .catch((err) => this.handleErrorMessage(err));
  }

  async deleteModel(uuid: string) {
    return this.model
      .findByIdAndDelete(uuid)
      .orFail()
      .then((data) => data)
      .catch((err) => this.handleErrorMessage(err));
  }

  async searchModel(payload:any) {
    return this.model
      .findOne(payload)
      .then((data) => data)
      .catch((err) => this.handleErrorMessage(err));
  }

async searchModels(payload: any) {
  const { search, skip = 0, limit = 10, filter,isActive=false } = payload;

  // Build base query object
  const query: any = {};
  if(isActive){   
    query.status = 'active';
  }

  // Handle search
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { "specialization.title": { $regex: search, $options: "i" } },
    ];
  }

  // Handle specialization filter (ObjectId)
  if (filter) {
    const filterIds = filter.split(",").map((id:string) => id.trim());
    query.specialization = { $in: filterIds };
  }

  return this.model
    .find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .then((data) => data)
    .catch((err) => this.handleErrorMessage(err));
}

// In countryRepository
async searchCountriesWithRegion(payload: any) {
  const { search, skip = 0, limit = 10, filter, isActive = false } = payload;

  const query: any = {};
  if (isActive) {   
    query.status = 'active';
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } },
    ];
  }

  if (filter) {
    const filterIds = filter.split(",").map((id: string) => id.trim());
    query.region = { $in: filterIds };
  }

  return this.model
    .find(query)
    .populate('region') // ✅ Add populate here
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .then((data) => data)
    .catch((err) => this.handleErrorMessage(err));
}


async getAll(payload: {
  search?: string;
  skip: number;
  limit: number;
  filter?: string;
}) {
  const { search, skip, limit, filter } = payload;

  // Build count query
  const countQuery: any = {};

  if (search) {
    countQuery.$or = [
      { name: { $regex: search, $options: "i" } },
      { "specialization.title": { $regex: search, $options: "i" } },
    ];
  }

  if (filter) {
    const filterIds = filter.split(",").map((id) => id.trim());
    countQuery.specialization = { $in: filterIds };
  }

  const trainers = await this.searchModels(payload);
  const total = await this.model.countDocuments(countQuery);

  return { trainers, total };
}

  protected handleErrorMessage(err: Error) {
    if (err instanceof Error.DocumentNotFoundError)
      throw new NotFoundError(`${this.modelName} not found`);

    if (typeof err === "string") throw new InternalServerError(err);

    const mongoError = JSON.parse(JSON.stringify(err));
    if (mongoError.code === 11000) {
      throw new ConflictError(
        `${Object.keys(mongoError.keyValue)[0]} is taken`
      );
    }

    if (err.message.includes("validation failed")) {
      throw new Error(err.message);
    }

    logger.error(
      `Error occurred while processing ${this.modelName.toLowerCase()}:`,
      err
    );
    throw new InternalServerError(
      `Unknown error occurred while processing ${this.modelName.toLowerCase()}`
    );
  }

  async getModelCountByDateRange(dateFilter: object) {
    const result = await this.model.aggregate([
      {
        $match: {
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
      },
      { $count: "count" },
    ]);
    return result[0]?.count || 0;
  }
}
