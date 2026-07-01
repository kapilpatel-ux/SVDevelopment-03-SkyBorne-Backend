// src/controllers/ClassReminderController.ts
import { Request, Response, NextFunction } from "express";
import { ClassReminderService } from "../../services/classReminderService"; 

export class ClassReminderController {
  /**
   * Send class reminder manually from the admin panel
   * POST /api/meetings/:meetingId/send-reminder
   */
  static async SendClassReminder(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { meetingId } = req.params;

      if (!meetingId) {
        return res.status(400).json({
          success: false,
          message: "Meeting ID is required",
        });
      }

      const result = await ClassReminderService.sendImmediateClassReminder(
        meetingId
      );

      return res.status(result.success ? 200 : 400).json({
        success: result.success,
        message: result.message,
        emailsSent: result.emailsSent,
      });
    } catch (error) {
      console.error("❌ Error in SendClassReminder:", error);
      next(error);
    }
  }

  /**
   * Get users in a specific region (for testing/debugging)
   * GET /api/meetings/region/:region/users
   */
  static async GetUsersByRegion(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { region } = req.params;

      if (!region) {
        return res.status(400).json({
          success: false,
          message: "Region is required",
        });
      }

      const users = await ClassReminderService.getUsersByRegion(region);

      return res.status(200).json({
        success: true,
        data: {
          region,
          userCount: users.length,
          users: users.map((user: any) => ({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            countryCode: user.countryCode,
          })),
        },
      });
    } catch (error) {
      console.error("❌ Error in GetUsersByRegion:", error);
      next(error);
    }
  }

  /**
   * Get countries in a specific region (for testing/debugging)
   * GET /api/meetings/region/:region/countries
   */
  static async GetCountriesByRegion(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { region } = req.params;

      if (!region) {
        return res.status(400).json({
          success: false,
          message: "Region is required",
        });
      }

      const countries = await ClassReminderService.getCountriesByRegion(region);

      return res.status(200).json({
        success: true,
        data: {
          region,
          countryCount: countries.length,
          countries: countries.map((c: any) => ({
            code: c.code,
            name: c.name,
          })),
        },
      });
    } catch (error) {
      console.error("❌ Error in GetCountriesByRegion:", error);
      next(error);
    }
  }
}

export default ClassReminderController;