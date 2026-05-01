import { Request, Response, NextFunction } from "express";
import CountryRepository from "./country.repository";
import { ICountry } from "./country.model"; 
import CountryRegionHistoryRepository from "./countryRegionHistory.repository";
import countryModel from "./country.model";
import countryRegionHistoryModel from "./countryRegionHistory.model";

const countryRepository = new CountryRepository();
const countryRegionHistoryRepository = new CountryRegionHistoryRepository();

export class CountryController {
  // Get all countries with pagination
  async getAllCountries(req: Request, res: Response, next: NextFunction) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";

    // Calculate skip
    const skip = (page - 1) * limit;

    // Fetch countries with search, pagination, sorting, and populate region
  // In controller
const countries = await countryRepository.searchCountriesWithRegion({
  search,
  skip,
  limit,
});


    // Get total count for pagination info
    const totalCount = await countryRepository.countDocuments(
      search
        ? {
            $or: [
              { name: { $regex: search, $options: "i" } },
              { code: { $regex: search, $options: "i" } },
            ],
          }
        : {}
    );

    const totalPages = Math.ceil(totalCount as number / limit);

    return res.json({
      success: true,
      data: {
        countries,
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
  }

  // Create new country with duplicate prevention
  async createCountry(req: Request, res: Response, next: NextFunction) {
    const { name, code, region = null, status = "active" } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: "Country name and code are required",
      });
    }

    // Check if country already exists by name
    const existingByName = await countryRepository.searchModel({
      name: { $regex: `^${name}$`, $options: "i" },
    });

    if (existingByName) {
      return res.status(409).json({
        success: false,
        message: "Country name already exists",
      });
    }

    // Check if country already exists by code
    const existingByCode = await countryRepository.searchModel({
      code: code.toUpperCase(),
    } as Partial<ICountry>);

    if (existingByCode) {
      return res.status(409).json({
        success: false,
        message: "Country code already exists",
      });
    }

    const countryData: Partial<ICountry> = {
      name,
      code: code.toUpperCase(),
      region: region || null,
      status: status as "active" | "inactive",
    };

    const country = await countryRepository.createModel(countryData);

    // Track initial region mapping (if provided)
    try {
      if (country?.region) {
        await countryRegionHistoryRepository.createModel({
          country: (country as any)._id,
          region: (country as any).region,
          fromDate: (country as any).createdAt || new Date(),
          toDate: null,
          changedBy: (req as any)?.user?.id || null,
        } as any);
      }
    } catch (e) {
      // Don't fail country creation if history tracking fails
    }

    return res.status(201).json({
      success: true,
      message: "Country created successfully",
      data: country,
    });
  }

  // Get country by ID
  async getCountryById(req: Request, res: Response, next: NextFunction) {
    const { countryId } = req.params;

    const country = await countryRepository.getOneModel(countryId);

    return res.json({
      success: true,
      data: country,
    });
  }

  // Update country (full update with duplicate prevention)
  async updateCountry(req: Request, res: Response, next: NextFunction) {
    const { countryId } = req.params;
    const { name, code, region, status } = req.body;

    // Validate input
    // if (!name && !code && region === undefined && !status) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "At least one field (name, code, region, or status) is required",
    //   });
    // }

    // Validate status if provided
    if (status && !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'active' or 'inactive'",
      });
    }

    // Get current country
    const currentCountry: any = await countryRepository.getOneModel(countryId);

    if (!currentCountry) {
      return res.status(404).json({
        success: false,
        message: "Country not found",
      });
    }

    // Check for duplicate name if being updated
    if (name && name !== currentCountry.name) {
      const duplicateName = await countryRepository.searchModel({
        name: { $regex: `^${name}$`, $options: "i" },
        _id: { $ne: countryId },
      } as any);

      if (duplicateName) {
        return res.status(409).json({
          success: false,
          message: "Country name already exists",
        });
      }
    }

    // Check for duplicate code if being updated
    if (code && code.toUpperCase() !== currentCountry.code) {
      const duplicateCode = await countryRepository.searchModel({
        code: code.toUpperCase(),
        _id: { $ne: countryId },
      } as any);

      if (duplicateCode) {
        return res.status(409).json({
          success: false,
          message: "Country code already exists",
        });
      }
    }

    // Build update payload
    const updateData: Partial<ICountry> = {};
    if (name) updateData.name = name;
    if (code) updateData.code = code.toUpperCase();
    const regionWasProvided = region !== undefined;
    const nextRegion = regionWasProvided ? (region || null) : undefined;
    const prevRegion = currentCountry?.region ?? null;
    const regionChanged =
      regionWasProvided && String(nextRegion) !== String(prevRegion);

    if (regionWasProvided) updateData.region = nextRegion as any;
    if (status) updateData.status = status as "active" | "inactive";

    // If region changed, close previous mapping window and create a new one
    if (regionChanged) {
      const now = new Date();
      const changedBy = (req as any)?.user?.id || null;

      try {
        const existingCount = await (countryRegionHistoryModel as any).countDocuments(
          { country: currentCountry._id },
        );

        // If no history exists yet, backfill previous region from country creation time
        if (!existingCount && prevRegion) {
          await countryRegionHistoryRepository.createModel({
            country: currentCountry._id,
            region: prevRegion,
            fromDate: currentCountry.createdAt || now,
            toDate: now,
            changedBy,
          } as any);
        } else {
          // Close any active window
          await (countryRegionHistoryModel as any).updateMany(
            { country: currentCountry._id, toDate: null },
            { $set: { toDate: now, changedBy } },
          );
        }

        // Create new active window (even if region set to null, keep audit trail)
        await countryRegionHistoryRepository.createModel({
          country: currentCountry._id,
          region: nextRegion,
          fromDate: now,
          toDate: null,
          changedBy,
        } as any);
      } catch (e) {
        // Don't fail main update if history tracking fails
      }
    }

    const updatedCountry = await countryRepository.updateModel(
      countryId,
      updateData
    );

    return res.json({
      success: true,
      message: "Country updated successfully",
      data: updatedCountry,
    });
  }

  // Update country status only
  async updateCountryStatus(req: Request, res: Response, next: NextFunction) {
    const { countryId } = req.params;
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

    const country = await countryRepository.updateModel(countryId, {
      status: status as "active" | "inactive",
    } as Partial<ICountry>);

    return res.json({
      success: true,
      message: `Country status updated to ${status}`,
      data: country,
    });
  }

  // Delete country
  async deleteCountry(req: Request, res: Response, next: NextFunction) {
    const { countryId } = req.params;

    await countryRepository.deleteModel(countryId);

    return res.json({
      success: true,
      message: "Country deleted successfully",
    });
  }

  // Get current user's country region history (date windows)
  async getMyRegionHistory(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any)?.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Lazy import to avoid circular deps
    const User = (await import("../UserModule/models/User")).default;
    const user = await User.findById(userId).select("countryCode country");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const countryCode = String(user.countryCode || "").trim().toUpperCase();
    if (!countryCode) {
      return res.json({ success: true, data: { countryCode: null, history: [] } });
    }

    const country = await (countryModel as any)
      .findOne({ code: countryCode })
      .select("_id code name region createdAt")
      .populate("region")
      .lean();

    if (!country) {
      return res.json({
        success: true,
        data: { countryCode, history: [] },
      });
    }

    const history = await (countryRegionHistoryModel as any)
      .find({ country: country._id })
      .sort({ fromDate: 1 })
      .populate("region")
      .lean();

    // Fallback: if no history exists, expose current mapping as a single open window
    const normalizedHistory =
      Array.isArray(history) && history.length
        ? history
        : [
            {
              _id: null,
              country: country._id,
              region: country.region || null,
              fromDate: country.createdAt || null,
              toDate: null,
              changedBy: null,
            },
          ];

    return res.json({
      success: true,
      data: {
        countryCode,
        countryName: country.name,
        history: normalizedHistory,
      },
    });
  }
}
