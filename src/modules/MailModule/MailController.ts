import { Request, Response } from "express";
import MailLog from "./MailModel";

export default class MailController {
  static async GetAllMailLogs(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
      const limit = Math.max(parseInt(String(req.query.limit || "10"), 10), 1);
      const search = String(req.query.search || "").trim();
      const skip = (page - 1) * limit;

      const query: any = {};
      if (search) {
        query.meetingTitle = { $regex: search, $options: "i" };
      }

      const [logs, totalCount] = await Promise.all([
        MailLog.find(query)
          .sort({ sentAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        MailLog.countDocuments(query),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return res.status(200).json({
        success: true,
        data: logs.map((log: any) => ({
          _id: log._id,
          meetingTitle: log.meetingTitle,
          meetingTime: log.meetingTime,
          sentAt: log.sentAt,
          totalUsers: log.totalUsers,
          status: log.status || "success",
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error: any) {
      console.error("Error fetching mail logs:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch mail logs",
      });
    }
  }
}
