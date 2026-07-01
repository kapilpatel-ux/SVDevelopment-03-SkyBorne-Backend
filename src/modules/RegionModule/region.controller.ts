import { Request, Response, NextFunction } from "express";
import RegionRepository from "./region.repository";
import { IRegion } from "./region.model";

const regionRepository = new RegionRepository();

export class RegionController {
  /**
   * Get all regions with pagination and search
   */
  async getAllRegions(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || "";

      // Calculate skip
      const skip = (page - 1) * limit;

      // Fetch regions with search, pagination, and sorting
      const regions = await regionRepository.searchModels({
        search,
        skip,
        limit,
      });

      // Get total count for pagination info
      const totalCount = await regionRepository.countDocuments(
        search
          ? {
              $or: [
                { name: { $regex: search, $options: "i" } },
                { code: { $regex: search, $options: "i" } },
                { displayLabel: { $regex: search, $options: "i" } },
                { timezone: { $regex: search, $options: "i" } },
              ],
            }
          : {}
      );

      const totalPages = Math.ceil((totalCount as number) / limit);

      return res.json({
        success: true,
        data: {
          regions,
          pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all active regions (for dropdowns, no pagination)
   */
  async getAllActiveRegions(req: Request, res: Response, next: NextFunction) {
    try {
      const regions = await regionRepository.getAllActiveRegions();

      return res.json({
        success: true,
        data: regions,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get region by ID
   */
  async getRegionById(req: Request, res: Response, next: NextFunction) {
    try {
      const { regionId } = req.params;

      const region = await regionRepository.getOneModel(regionId);

      return res.json({
        success: true,
        data: region,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create new region with duplicate prevention
   */
  async createRegion(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        name,
        code,
        status = "active",
      } = req.body;

      // Validate required fields
      if (!name || !code ) {
        return res.status(400).json({
          success: false,
          message:
            "Name and code are required",
        });
      }

      // Check if region name already exists
      const existingByName = await regionRepository.searchModel({
        name: { $regex: `^${name}$`, $options: "i" },
      });

      if (existingByName) {
        return res.status(409).json({
          success: false,
          message: "Region name already exists",
        });
      }

      // Check if region code already exists
      const existingByCode = await regionRepository.searchModel({
        code: code.toUpperCase(),
      } as Partial<IRegion>);

      if (existingByCode) {
        return res.status(409).json({
          success: false,
          message: "Region code already exists",
        });
      }

      const regionData: Partial<IRegion> = {
        name: name.trim(),
        code: code.toUpperCase(),
        // timezone: timezone.trim(),
        // displayLabel: name.trim(),
        // replayTime: replayTime.trim(),
        status: status as "active" | "inactive",
      };

      const region = await regionRepository.createModel(regionData);

      return res.status(201).json({
        success: true,
        message: "Region created successfully",
        data: region,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update region (full update with duplicate prevention)
   */
  async updateRegion(req: Request, res: Response, next: NextFunction) {
    try {
      const { regionId } = req.params;
      const { name, code, timezone, displayLabel, replayTime, status } =
        req.body;

      // Validate input
      if (!name && !code && !timezone && !displayLabel && !replayTime && !status) {
        return res.status(400).json({
          success: false,
          message:
            "At least one field (name, code, timezone, displayLabel, replayTime, or status) is required",
        });
      }

      // Validate status if provided
      if (status && !["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      // Validate replayTime format if provided
      if (replayTime) {
        const timeRegex = /^(0?[1-9]|1[0-2]):[0-5][0-9]\s(AM|PM)$/i;
        if (!timeRegex.test(replayTime)) {
          return res.status(400).json({
            success: false,
            message: "Replay time must be in format HH:MM AM/PM",
          });
        }
      }

      // Get current region
      const currentRegion: any = await regionRepository.getOneModel(regionId);

      // Check for duplicate name if being updated
      if (name && name !== currentRegion.name) {
        const duplicateName = await regionRepository.searchModel({
          name: { $regex: `^${name}$`, $options: "i" },
          _id: { $ne: regionId },
        } as any);

        if (duplicateName) {
          return res.status(409).json({
            success: false,
            message: "Region name already exists",
          });
        }
      }

      // Check for duplicate code if being updated
      if (code && code.toUpperCase() !== currentRegion.code) {
        const duplicateCode = await regionRepository.searchModel({
          code: code.toUpperCase(),
          _id: { $ne: regionId },
        } as any);

        if (duplicateCode) {
          return res.status(409).json({
            success: false,
            message: "Region code already exists",
          });
        }
      }

      // Build update payload
      const updateData: Partial<IRegion> = {};
      if (name) updateData.name = name.trim();
      if (code) updateData.code = code.toUpperCase();
      if (timezone) updateData.timezone = timezone.trim();
      if (displayLabel) updateData.displayLabel = displayLabel.trim();
      if (replayTime) updateData.replayTime = replayTime.trim();
      if (status) updateData.status = status as "active" | "inactive";

      const updatedRegion = await regionRepository.updateModel(
        regionId,
        updateData
      );

      return res.json({
        success: true,
        message: "Region updated successfully",
        data: updatedRegion,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update region status only
   */
  async updateRegionStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { regionId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required",
        });
      }

      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Status must be 'active' or 'inactive'",
        });
      }

      const region = await regionRepository.updateModel(regionId, {
        status: status as "active" | "inactive",
      } as Partial<IRegion>);

      return res.json({
        success: true,
        message: `Region status updated to ${status}`,
        data: region,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete region
   */
  async deleteRegion(req: Request, res: Response, next: NextFunction) {
    try {
      const { regionId } = req.params;

      await regionRepository.deleteModel(regionId);

      return res.json({
        success: true,
        message: "Region deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }
}