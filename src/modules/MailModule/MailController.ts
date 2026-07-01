import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { logger } from "../../utils/winston.utils";
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
      if (req.query.status && req.query.status !== "all") {
        const normalizedStatus = String(req.query.status).trim().toLowerCase();
        if (!["success", "failed"].includes(normalizedStatus)) {
          return res.status(400).json({
            success: false,
            message: "status must be success, failed, or all",
          });
        }
        query.status = normalizedStatus;
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

  static async GetErrorLog(req: Request, res: Response) {
    try {
      const raw = String(req.query.raw || "").trim() === "1";
      const requestedLines = parseInt(String(req.query.lines || "200"), 10);
      const maxLines = 2000;
      const lines =
        Number.isFinite(requestedLines) && requestedLines > 0
          ? Math.min(requestedLines, maxLines)
          : 200;

      const logPath = path.resolve(process.cwd(), "logs", "error.log");
      const stat = await fs.promises.stat(logPath);

      if (stat.size === 0) {
        if (raw) {
          return res.type("text/plain").send("");
        }
        return res.status(200).json({
          success: true,
          data: {
            lines: [],
            total: 0,
            fileSize: 0,
            truncated: false,
          },
        });
      }

      const maxBytes = 2 * 1024 * 1024;
      const bytesToRead = Math.min(stat.size, maxBytes);
      const start = Math.max(0, stat.size - bytesToRead);
      const buffer = Buffer.alloc(bytesToRead);

      const handle = await fs.promises.open(logPath, "r");
      try {
        await handle.read(buffer, 0, bytesToRead, start);
      } finally {
        await handle.close();
      }

      let content = buffer.toString("utf8");
      if (start > 0) {
        const firstNewline = content.indexOf("\n");
        if (firstNewline !== -1) {
          content = content.slice(firstNewline + 1);
        }
      }

      const allLines = content.split(/\r?\n/);
      const tailLines = allLines.slice(-lines).filter((line) => line.length > 0);

      if (raw) {
        return res.type("text/plain").send(tailLines.join("\n"));
      }

      return res.status(200).json({
        success: true,
        data: {
          lines: tailLines,
          total: tailLines.length,
          fileSize: stat.size,
          truncated: stat.size > maxBytes,
        },
      });
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return res.status(404).json({
          success: false,
          message: "error.log not found",
        });
      }
      logger.error(`GetErrorLog failed: ${error?.message || error}`);
      return res.status(500).json({
        success: false,
        message: "Failed to read error log",
      });
    }
  }
}
