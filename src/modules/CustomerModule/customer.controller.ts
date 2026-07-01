import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Customer from "./customer.model";
import User from "../UserModule/models/User";

export class CustomerController {
  /**
   * Get my customer profile
   * (Only exists if user has placed at least one order)
   */
  async getMyCustomerProfile(req: Request, res: Response, next: NextFunction) {
    try {
      console.log("🔵 [GetMyCustomerProfile] Request received");
      const userId = (req as any)?.user?.id;

      console.log("🔵 [GetMyCustomerProfile] userId:", userId);

      const customer = await Customer.findOne({
        userId,
        totalOrders: { $gt: 0 },
      })
        .populate("wishlist", "name price image")
        .populate("userId", "firstName lastName email")
        .lean();

      if (!customer) {
        console.warn("🟡 [GetMyCustomerProfile] Customer profile not found");
        return res.status(404).json({
          success: false,
          message: "Customer profile not found",
        });
      }

      console.log("✅ [GetMyCustomerProfile] Customer found:", customer._id);

      return res.json({
        success: true,
        data: customer,
      });
    } catch (error) {
      console.error("❌ [GetMyCustomerProfile] Error:", error);
      next(error);
    }
  }

  /**
   * Admin: Get single customer by id
   * GET /customers/:customerId
   */
  async getCustomerById(req: Request, res: Response, next: NextFunction) {
    try {
      console.log("🔵 [GetCustomerById] Request received");
      const { customerId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        console.warn("🟡 [GetCustomerById] Invalid customer ID:", customerId);
        return res.status(400).json({
          success: false,
          message: "Invalid customer ID",
        });
      }

      const customer = await Customer.findById(customerId)
        .populate("wishlist", "name price image")
        .populate("userId", "firstName lastName email")
        .lean();

      if (!customer) {
        console.warn("🟡 [GetCustomerById] Customer not found:", customerId);
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      console.log("✅ [GetCustomerById] Customer found:", customerId);

      return res.json({
        success: true,
        data: customer,
      });
    } catch (error) {
      console.error("❌ [GetCustomerById] Error:", error);
      next(error);
    }
  }

  /**
   * Add address
   */
  async addAddress(req: Request, res: Response, next: NextFunction) {
    try {
      console.log("🔵 [AddAddress] Request received");
      const userId = (req as any)?.user?.id;
      const address = req.body;

      if (!address?.addressLine1 || !address?.city || !address?.country) {
        console.warn("🟡 [AddAddress] Required address fields missing");
        return res.status(400).json({
          success: false,
          message: "Required address fields missing",
        });
      }

      const customer = await Customer.findOne({
        userId,
        totalOrders: { $gt: 0 },
      });

      if (!customer) {
        console.warn("🟡 [AddAddress] Customer not found");
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      if (address.isDefault) {
        customer.addresses.forEach((a) => (a.isDefault = false));
      }

      customer.addresses.push(address);
      await customer.save();

      console.log("✅ [AddAddress] Address added successfully");

      return res.json({
        success: true,
        message: "Address added successfully",
        data: customer.addresses,
      });
    } catch (error) {
      console.error("❌ [AddAddress] Error:", error);
      next(error);
    }
  }

  /**
   * Remove address
   */
  async removeAddress(req: Request, res: Response, next: NextFunction) {
    try {
      console.log("🔵 [RemoveAddress] Request received");
      const userId = (req as any)?.user?.id;
      const { addressId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(addressId)) {
        console.warn("🟡 [RemoveAddress] Invalid address ID");
        return res.status(400).json({
          success: false,
          message: "Invalid address ID",
        });
      }

      const customer = await Customer.findOne({
        userId,
        totalOrders: { $gt: 0 },
      });

      if (!customer) {
        console.warn("🟡 [RemoveAddress] Customer not found");
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      customer.addresses = customer.addresses.filter(
        (addr: any) => addr._id.toString() !== addressId
      );

      await customer.save();

      console.log("✅ [RemoveAddress] Address removed successfully");

      return res.json({
        success: true,
        message: "Address removed successfully",
        data: customer.addresses,
      });
    } catch (error) {
      console.error("❌ [RemoveAddress] Error:", error);
      next(error);
    }
  }

  /**
   * Admin: Get customers list (ONLY who purchased) with search and pagination
   */
  async getAllCustomers(req: Request, res: Response, next: NextFunction) {
    try {
      console.log("🔵 [GetAllCustomers] Admin request received");

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const search = ((req.query.search as string) || "").trim();

      const skip = (page - 1) * limit;

      console.log("🔵 [GetAllCustomers] Pagination - Page:", page, "Limit:", limit, "Skip:", skip);
      console.log("🔵 [GetAllCustomers] Search:", search);

      // Base filter: only customers with at least one order
      const filter: any = {
        totalOrders: { $gt: 0 },
      };

      // Search is on User collection fields (firstName, lastName, email),
      // then mapped back to Customer.userId for pagination-safe filtering.
      if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const searchRegex = new RegExp(escapedSearch, "i");

        const matchedUsers = await User.find({
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { email: searchRegex },
          ],
        })
          .select("_id")
          .lean();

        const matchedUserIds = matchedUsers.map((user: any) => user._id);

        // No matching users -> return empty page quickly
        if (!matchedUserIds.length) {
          return res.json({
            success: true,
            data: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPrevPage: page > 1,
            },
          });
        }

        filter.userId = { $in: matchedUserIds };
      }

      console.log("🔵 [GetAllCustomers] Applied filters:", JSON.stringify(filter));

      const [customers, total] = await Promise.all([
        Customer.find(filter)
          .populate("userId", "firstName lastName email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Customer.countDocuments(filter),
      ]);

      console.log("✅ [GetAllCustomers] Customers found:", customers.length);
      console.log("✅ [GetAllCustomers] Total count:", total);

      return res.json({
        success: true,
        data: customers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("❌ [GetAllCustomers] Error:", error);
      next(error);
    }
  }
}
