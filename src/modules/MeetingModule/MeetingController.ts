import { NextFunction, Request, Response } from "express";
import axios from "axios";
import Meeting, { IMeeting, IService } from "./MeetingModels/Meeting";
import MeetingAttendance from "./MeetingModels/MeetingAttendance";
import { getZoomAccessToken } from "../../utils/zoomAuth";
import mongoose, { Types } from "mongoose";
import MeetingParticipant from "./MeetingModels/MeetingParticipant";
import User from "../UserModule/models/User";
import Service from "../ServiceModule/models/Service";
import { ServiceType } from "../UserModule/interface/userInterface";
import CountryRepository from "../CountryModule/country.repository";
import { ICountry } from "../CountryModule/country.model";
import TrainerModel from "../TrainerModule/TrainerModel";

const _countryRepository = new CountryRepository();

export default class MeetingController {
  static async CreateMeeting(req: Request, res: Response) {
    console.log("🚀 [CreateMeeting] Request received with body:", req.body); 
    try {
      const token = await getZoomAccessToken();
      const {
        service,
        title,
        liveRegion,
        liveTime,
        trainer,
        duration,
        autoRecording=true,
        isRecurring,
        recurringType,
        recurringDays,
        rotationEnabled,
        startDate,
        localTime,
        regions,
        adminId,
        weeklyEndDate,
      } = req.body;

      // Validate required fields
      if (
        !service ||
        !title ||
        !liveRegion ||
        !liveTime ||
        !trainer ||
        !duration ||
        !startDate ||
        !localTime ||
        !regions ||
        !adminId
      ) {
        console.warn(
          "⚠️ [CreateMeeting] Validation failed - Missing required fields",
        );
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      // Generate meeting topic
      const topic = `${title} - Live Class`;

      const startDateTime = new Date(localTime);

      // Get weekday for Zoom (1–7, where 1 = Monday, 7 = Sunday)
      const jsWeekDay = startDateTime.getUTCDay();
      const zoomWeekDay = jsWeekDay === 0 ? 7 : jsWeekDay;

      // Format time as HH:MM for Zoom API
      const hours = String(startDateTime.getUTCHours()).padStart(2, "0");
      const minutes = String(startDateTime.getUTCMinutes()).padStart(2, "0");
      const startTimeForZoom = `${hours}:${minutes}`;

      // console.log("⏰ [CreateMeeting] Recurrence settings:", {
      //   zoomWeekDay,
      //   startTimeForZoom,
      //   weeklyEndDate: weeklyEndDate || "No end date (unlimited)",
      // });

      // Build recurrence object
      // const recurrenceSettings: any = {
      //   type: 2,
      //   repeat_interval: 1,
      //   weekly_days: zoomWeekDay,
      // };
      
      let recurrenceSettings: any = {};

      if (isRecurring) {
        if (recurringType === "weekly") {
          recurrenceSettings = {
            type: 2, // WEEKLY
            repeat_interval: 1,
            weekly_days: zoomWeekDay,
          };
        }

        if (recurringType === "monthly") {
          recurrenceSettings = {
            type: 3, // MONTHLY
            repeat_interval: 1,
            monthly_day: startDateTime.getUTCDate(), // same date every month
          };
        }

        if (recurringType === "custom") {
          recurrenceSettings = {
            type: 1, // DAILY
            repeat_interval: Math.min(Math.max(recurringDays ?? 1, 1), 30),
          };
        }

        // common end date
        const endDate = weeklyEndDate
          ? new Date(weeklyEndDate)
          : new Date(new Date(startDateTime).setFullYear(startDateTime.getFullYear() + 1));

        recurrenceSettings.end_date_time = endDate
          .toISOString()
          .split("T")[0];
      }

      // if (weeklyEndDate) {
      //   const endDate = new Date(weeklyEndDate);
      //   const endDateString = endDate.toISOString().split("T")[0];
      //   recurrenceSettings.end_date_time = endDateString;
      // } else {
      //   const defaultEndDate = new Date(startDateTime);
      //   defaultEndDate.setFullYear(defaultEndDate.getFullYear() + 1);
      //   const endDateString = defaultEndDate.toISOString().split("T")[0];
      //   recurrenceSettings.end_date_time = endDateString;
      // }

      const zoomResponse = await axios.post(
        "https://api.zoom.us/v2/users/me/meetings",
        {
          topic,
          type: isRecurring ? 8 : 2,
          start_time: localTime,
          duration,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(isRecurring && { recurrence: recurrenceSettings }),
          settings: {
            mute_upon_entry: true,
            allow_multiple_audio_unmute: false,
            allow_participants_to_unmute_themselves: false,
            allow_participants_to_unmute: false,
            auto_recording: "cloud",
            host_video: true,
            participant_video: true,
            waiting_room: true,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      const meetingId = zoomResponse.data.id;
      const password = zoomResponse.data.password;
      const occurrences = zoomResponse.data.occurrences;

      // Web client URLs
      const webJoinUrl = `https://app.zoom.us/wc/${meetingId}/join?pwd=${password}&browser=1`;
      const webStartUrl = `https://app.zoom.us/wc/${meetingId}/start?pwd=${password}&browser=1`;

      const meetingRecord = await Meeting.create({
        zoomMeetingId: meetingId,

        service,
        title,
        regions,
        liveRegion,
        liveTime,
        trainer,
        duration,
        autoRecording,
        rotationEnabled: false,
        isRecurring: isRecurring,
        recurringType: isRecurring ? recurringType : null,
        recurringDays:
          isRecurring && recurringType === "custom"
            ? recurringDays
            : null,
        weeklyEndDate: isRecurring && weeklyEndDate
          ? new Date(weeklyEndDate)
          : null,
        isLive: true,
        startDate: new Date(startDate),
        localTime: new Date(localTime),
        joinUrl: webJoinUrl,
        startUrl: webStartUrl,
        recordingUrl: "",
        createdBy: adminId,
      });

      // console.log("✅ [CreateMeeting] Parent meeting saved to DB:", {
      //   id: meetingRecord._id,
      //   zoomMeetingId: meetingRecord.zoomMeetingId,
      //   isLive: meetingRecord.isLive,
      //   regionsCount: meetingRecord.regions.length,
      //   title: meetingRecord.title,
      // });

      // Store all recurring instances in database
      // console.log("📦 [CreateMeeting] Storing recurring instances...");
      const storedInstances: any[] = [];

      if (isRecurring && occurrences && occurrences.length > 0) {
        for (const occurrence of occurrences) {
          try {
            const instanceRecord = await Meeting.create({
              zoomMeetingId: meetingId,
              occurrenceId: occurrence.occurrence_id,
              service,
              title,
              regions,
              liveRegion,
              liveTime,
              trainer,
              duration,
              autoRecording,
              rotationEnabled: false,
              isRecurring: false, // Individual instances are not recurring
              isLive: true,
              startDate: new Date(occurrence.start_time),
              localTime: new Date(occurrence.start_time),
              joinUrl: webJoinUrl,
              startUrl: webStartUrl,
              recordingUrl: "",
              createdBy: adminId,
              parentMeetingId: meetingRecord._id,
            });

            storedInstances.push({
              _id: instanceRecord._id,
              occurrenceId: occurrence.occurrence_id,
              startTime: occurrence.start_time,
            });

            // console.log(`  ✅ Instance saved: ${occurrence.occurrence_id} - ${occurrence.start_time}`);
          } catch (error: any) {
            console.error(
              `  ❌ Error saving instance ${occurrence.occurrence_id}:`,
              error.message,
            );
          }
        }
      }

      // meetingRecord.regions.forEach((region) => {
      //   console.log(`  - ${region.region}: ${region.mode}`);
      // });

      const responseMessage = `Weekly recurring meeting "${title}" created successfully. Live session for ${liveRegion}. Recording available for other regions.`;

      // console.log("📊 [CreateMeeting] Response summary:", {
      //   meetingId: meetingRecord._id,
      //   title: meetingRecord.title,
      //   regionsCount: meetingRecord.regions.length,
      //   isRecurring: true,
      //   nextOccurrences: occurrences?.length || 0,
      //   storedInstances: storedInstances.length,
      //   message: responseMessage,
      // });

      return res.json({
        success: true,
        data: {
          meeting: meetingRecord,
          message: responseMessage,
          occurrences: occurrences,
          storedInstances: storedInstances,
          totalInstancesStored: storedInstances.length,
        },
      });
    } catch (error: any) {
      console.error("❌ [CreateMeeting] ERROR CAUGHT");
      console.error("📍 [CreateMeeting] Error type:", error.constructor.name);
      console.error("📝 [CreateMeeting] Error message:", error.message);
      console.error(
        "🔍 [CreateMeeting] Zoom API error data:",
        error.response?.data,
      );
      console.error("📊 [CreateMeeting] Full error object:", error);

      return res.status(500).json({
        success: false,
        message: error.message || "Error creating meeting",
        error: error.response?.data,
      });
    }
  }

  static async GetUpcomingMeetings(req: Request, res: Response) {
    try {
      const { search = "", skip = 0, limit = 10 } = req?.query;
      const skipNum = parseInt(skip as string) || 0;
      const limitNum = parseInt(limit as string) || 10;

      // console.log("search:", search, "skip:", skipNum, "limit:", limitNum);

      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const now = new Date();
      //const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);


      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      // Get total count
      const totalCount = await Meeting.countDocuments({
        localTime: { $gte: oneHourAgo },
        title: { $regex: search, $options: "i" },
        service: { $in: serviceIds },
      });

      // Fetch paginated meetings
      const meetings = await Meeting.find({
        localTime: { $gte: oneHourAgo },
        title: { $regex: search, $options: "i" },
        service: { $in: serviceIds },
      })
        .sort({ localTime: 1 })
        .skip(skipNum)
        .limit(limitNum)
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: meetings?.length,
        totalCount,
        hasMore: skipNum + limitNum < totalCount,
        meetings,
        userPlan: user.plan,
      });
    } catch (error: any) {
      console.error("Error fetching upcoming meetings:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching upcoming meetings",
      });
    }
  }

  static async GetAllMeetings(req: Request, res: Response) {
  try {
    const { search = "", skip = 0, limit = 10 } = req?.query;
    const skipNum = parseInt(skip as string) || 0;
    const limitNum = parseInt(limit as string) || 10;

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const user = await User.findById(userId).select(
      "plan country countryCode",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    let serviceTitles: string[] = [];

    if (user.plan === "gold-yoga") {
      serviceTitles = ["Yoga"];
    } else if (user.plan === "gold-zumba") {
      serviceTitles = ["Zumba Dance"];
    } else if (user.plan === "gold-mixed") {
      serviceTitles = ["Yoga", "Zumba Dance"];
    } else if (user.plan === "diamond" || user.plan === "platinum") {
      serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
    }

    const services = await Service.find({
      title: { $in: serviceTitles },
    }).select("_id");

    const serviceIds = services.map((service) => service._id);

    // Get total count - no time filter, includes all meetings
    const totalCount = await Meeting.countDocuments({
      title: { $regex: search, $options: "i" },
      service: { $in: serviceIds },
    });

    // Fetch paginated meetings - no time filter, includes all meetings
    const meetings = await Meeting.find({
      title: { $regex: search, $options: "i" },
      service: { $in: serviceIds },
    })
      .sort({ localTime: -1 }) // Sort by most recent first
      .skip(skipNum)
      .limit(limitNum)
      .populate("service", "title name _id")
      .populate("trainer", "name email _id")
      .populate("createdBy", "firstName lastName email _id")
      .lean();

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      count: meetings?.length,
      totalCount,
      hasMore: skipNum + limitNum < totalCount,
      meetings,
      userPlan: user.plan,
    });
  } catch (error: any) {
    console.error("Error fetching all meetings:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Error fetching all meetings",
    });
  }
}
  static async GetMeetingRecording(req: Request, res: Response) {
    try {
      const meeting = await Meeting.findById(req.params.id);
      if (!meeting) return res.status(404).send("Meeting not found");

      const token = await getZoomAccessToken();

      // STEP 1: Ask Zoom for real recording files
      const { data } = await axios.get(
        `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}/recordings`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const file = data.recording_files.find((f: any) => f.file_type === "MP4");

      if (!file) return res.status(404).send("Recording file not found");

      // STEP 2: This URL works with header
      const videoStream = await axios.get(file.download_url, {
        responseType: "stream",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      res.setHeader("Content-Type", "video/mp4");
      videoStream.data.pipe(res);
    } catch (e) {
      console.log("Recording error", e);
      res.status(500).send("Error streaming recording");
    }
  }

  static async GetTodaysMeetings(req: Request, res: Response) {
    try {
      const { search = "" } = req?.query;

      const userId = req.user?.id; // Assuming user is attached to request

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Fetch user with their plan
      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Get today's date range (start of day to end of day)
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );

      // Determine which service titles to filter based on plan
      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        // Diamond and Platinum can see all classes
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      // Fetch service IDs based on titles
      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      const meetings = await Meeting.find({
        localTime: {
          $gte: startOfDay,
          $lt: endOfDay,
        },
        title: { $regex: search, $options: "i" },
        service: { $in: serviceIds },
      })
        .sort({ localTime: 1 })
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: meetings?.length,
        meetings,
        userPlan: user.plan,
      });
    } catch (error: any) {
      console.error("Error fetching today's meetings:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching today's meetings",
      });
    }
  }

  /**
   * Get past/completed sessions for the current user
   * Shows sessions that have already occurred (localTime is in the past)
   * Supports pagination and search
   */
  static async GetPastSessions(req: Request, res: Response) {
    try {
      const { search = "", skip = 0, limit = 10 } = req?.query;
      const skipNum = parseInt(skip as string) || 0;
      const limitNum = parseInt(limit as string) || 10;

      // console.log("search:", search, "skip:", skipNum, "limit:", limitNum);

      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Get user with plan info
      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Determine services based on user plan
      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      // Get current time - only show sessions that have already completed
      const now = new Date();

      // Build search query
      const searchQuery: any = {
        // Sessions that have occurred (localTime is in the past)
        localTime: { $lt: now },
        service: { $in: serviceIds },
        // Only show completed sessions or sessions with attendance
        status: { $in: ["completed", "pending"] },
      };

      // Add search filter if provided
      if (search && (search as string)?.trim()) {
        searchQuery.$or = [
          { title: { $regex: search, $options: "i" } },
          { "service.title": { $regex: search, $options: "i" } },
          { "trainer.name": { $regex: search, $options: "i" } },
        ];
      }

      // Get total count for pagination
      const totalCount = await Meeting.countDocuments(searchQuery);

      // Fetch paginated meetings sorted by most recent first
      const meetings = await Meeting.find(searchQuery)
        .sort({ localTime: -1 }) // Most recent first
        .skip(skipNum)
        .limit(limitNum)
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      // For each meeting, fetch attendance data if available
      const enrichedMeetings = await Promise.all(
        meetings.map(async (meeting) => {
          const attendance = await MeetingAttendance.findOne({
            meeting: meeting._id,
            user: userId,
          }).lean();

          return {
            ...meeting,
            attendance: attendance || {
              totalDuration: 0,
              status: "missed",
            },
          };
        }),
      );

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: enrichedMeetings?.length,
        totalCount,
        hasMore: skipNum + limitNum < totalCount,
        meetings: enrichedMeetings,
        userPlan: user.plan,
      });
    } catch (error: any) {
      console.error("Error fetching past sessions:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching past sessions",
      });
    }
  }

  static async GetTrainerUpcomingMeetings(req: Request, res: Response) {
    try {
      const userId = req.user?.id; // User ID from auth
      const { search = "", date } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Fetch user and get their trainer ID
      const user = await User.findById(userId).select("trainer");

      if (!user || !user.trainer) {
        return res.status(400).json({
          success: false,
          message: "User is not associated with a trainer profile",
        });
      }

      const trainerId = user.trainer;

      // Get today's date at midnight
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get tomorrow at midnight
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // If specific date is provided, use that
      let startTime = today;
      let endTime = tomorrow;

      if (date) {
        const specifiedDate = new Date(date as string);
        specifiedDate.setHours(0, 0, 0, 0);
        startTime = specifiedDate;
        endTime = new Date(specifiedDate);
        endTime.setDate(endTime.getDate() + 1);
      }

      // Find meetings where this trainer is assigned
      const meetings = await Meeting.find({
        trainer: trainerId, // Filter by trainer
        localTime: {
          $gte: startTime,
          $lt: endTime,
        },
        title: { $regex: search || "", $options: "i" },
      })
        .sort({ localTime: 1 })
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      // Transform response to include region info
      const formattedMeetings = meetings.map((meeting: any) => ({
        ...meeting,
        regions: [
          {
            region: meeting.region || "IN",
            mode: meeting.isLive ? "live" : "recorded",
          },
        ],
      }));

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: formattedMeetings.length,
        meetings: formattedMeetings,
        date: date || today.toISOString().split("T")[0],
      });
    } catch (error: any) {
      console.error("Error fetching trainer upcoming meetings:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching upcoming meetings",
      });
    }
  }

  static async getWeeklyActivity(req: Request, res: Response) {
    try {
      const userId = req.user?.id || req.params.userId;

      if (!userId) {
        return res.status(400).json({ message: "User ID required" });
      }

      // Get start & end of current week (Mon - Sun)
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Fetch attendance records for this week
      const attendances = await MeetingAttendance.find({
        user: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startOfWeek, $lte: endOfWeek },
      }).lean();

      // Prepare week map
      const weekDays = ["M", "T", "W", "T", "F", "S", "S"];
      const activityMap: Record<number, boolean> = {
        0: false,
        1: false,
        2: false,
        3: false,
        4: false,
        5: false,
        6: false,
      };

      // Mark active days
      attendances.forEach((attendance) => {
        attendance.sessions?.forEach((session) => {
          const dayIndex = (new Date(session.joinTime).getDay() + 6) % 7;
          activityMap[dayIndex] = true;
        });

        if (attendance.status === "completed" && attendance.completedAt) {
          const dayIndex = (new Date(attendance.completedAt).getDay() + 6) % 7;
          activityMap[dayIndex] = true;
        }
      });

      const days = weekDays.map((day, index) => ({
        day,
        completed: activityMap[index],
      }));

      const completedDays = days.filter((d) => d.completed).length;
      const progressPercent = Math.round((completedDays / 7) * 100);

      res.json({
        totalDays: 7,
        completedDays,
        progressPercent,
        days,
      });
    } catch (error) {
      console.error("Weekly activity error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }

  static async JoinMeeting(req: Request, res: Response) {
    try {
      const { meetingId, userId, region } = req.body;
      const user = req.user;

      const userData = await User.findById(userId);
      if (!userData) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Find the meeting
      const meeting = await Meeting.findById(meetingId).populate(
        "createdBy",
        "_id",
      );

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      console.log("meeting", meeting);

      // Check if user is a trainer or admin
      const isTrainer = userData.trainer ? true : false;
      const isAdmin = userData.role === "admin" ? true : false;
      const isTrainerOrAdmin = isTrainer || isAdmin;

      // Determine service type
      const serviceType =
        (meeting?.service as IService)?.title?.toLowerCase() == "zumba dance"
          ? "zumba"
          : (meeting?.service as IService)?.title?.toLowerCase();

      // Check class credits only for regular participants (not trainers or admins)
      if (!isTrainerOrAdmin) {
        const credits: any =
          userData.classCredits?.[serviceType as ServiceType] || 0;

        if (credits <= 0) {
          return res.status(403).json({
            success: false,
            message: `You do not have enough ${serviceType} credits to join this session`,
          });
        }
      }

      // Find the region entry for this specific region
      const regionEntry = meeting.regions.find(
        (r) => r.region.toLowerCase() === region.toLowerCase(),
      );

      if (!regionEntry) {
        return res.status(404).json({
          success: false,
          message: `Region "${region}" not found in this meeting`,
        });
      }

      // Check if meeting has ended
      const meetingEndTime =
        new Date(meeting.localTime).getTime() + meeting.duration * 60000;
      const currentTime = Date.now();

      // if (currentTime > meetingEndTime) {
      //   return res.status(400).json({
      //     success: false,
      //     expired: true,
      //     message: "Meeting has already ended",
      //   });
      // }

      // Determine the URL based on region mode
      let accessUrl: string;
      const recordUrl = `${process.env.API_BASE_URL}/meetings/${meeting?._id}/recording`;
      const isLiveMode = regionEntry.mode === "live";

      if (isLiveMode) {
        // For live mode, use the joinUrl (meeting is currently happening)
        accessUrl = meeting?.joinUrl;
      } else {
        // For replay mode, use the recordingUrl
        // Check if recording is available
        if (!meeting?.recordingUrl) {
          return res.status(400).json({
            success: false,
            message:
              "Recording not yet available. Meeting may still be in progress or processing.",
            canRetry: true,
          });
        }
        // accessUrl = meeting?.recordingUrl;
        accessUrl = `${process.env.API_BASE_URL}/meetings/${meeting?._id}/recording`;
      }

      // console.log("meeting id", meeting.zoomMeetingId);

      const participantRecord = await MeetingParticipant.create({
        meetingId,
        zoomMeetingId: meeting.zoomMeetingId,
        userId: user!.id,
        email: user!.email,
        // zoomParticipantId will be filled when webhook fires
      });

      // Find or create attendance record
      let attendance = await MeetingAttendance.findOne({
        meeting: meetingId,
        user: userId,
      });

      if (!attendance) {
        attendance = await MeetingAttendance.create({
          meeting: meetingId,
          user: userId,
          region, // Store which region user is accessing from
          joinedAt: new Date(),
          sessions: [{ joinTime: new Date(), mode: regionEntry.mode }],
        });
      } else {
        // Add new session entry with mode info
        attendance.sessions.push({
          joinTime: new Date(),
          mode: regionEntry.mode,
        });
        await attendance.save();
      }

      return res.json({
        success: true,
        data: {
          accessUrl, // Returns joinUrl for live, recordingUrl for replay
          mode: regionEntry.mode,
          recordUrl,
          attendanceId: attendance._id,
          role: isTrainerOrAdmin ? 1 : 0,
          meetingDetails: {
            meetingId: meeting._id,
            region: regionEntry.region,
            timezone: regionEntry.timezone,
            localTime: regionEntry.localTime,
            service: meeting.service,
            trainer: meeting.trainer,
            liveRegion: meeting.liveRegion,
            duration: meeting.duration,
          },
        },
      });
    } catch (error: any) {
      console.error("Error joining meeting:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error joining meeting",
      });
    }
  }
  // -----------------------------------------
  // LEAVE MEETING
  // -----------------------------------------
  static async LeaveMeeting(req: Request, res: Response) {
    try {
      const { attendanceId, userId } = req.body;

      const attendance = await MeetingAttendance.findById(attendanceId);
      if (!attendance) {
        return res.status(404).json({
          success: false,
          message: "Attendance record not found",
        });
      }

      // Update the last session with leave time
      if (attendance.sessions.length > 0) {
        const lastSession = attendance.sessions[attendance.sessions.length - 1];
        lastSession.leaveTime = new Date();

        // Calculate session duration in minutes
        const duration =
          (lastSession.leaveTime.getTime() - lastSession.joinTime.getTime()) /
          60000;
        lastSession.duration = Math.round(duration);
      }

      await attendance.save();

      return res.json({
        success: true,
        message: "Left meeting successfully",
        data: {
          attendanceId: attendance._id,
        },
      });
    } catch (error: any) {
      console.error("Error leaving meeting:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error leaving meeting",
      });
    }
  }

  static async getSessionsWithPagination(req: Request, res: Response) {
    const { userId, status, page, limit } = req.query as {
      userId: string;
      status?: "registered" | "joined" | "completed" | "missed";
      page?: string;
      limit?: string;
    };

    try {
      const skip = (Number(page) - 1) * Number(limit);

      // Build filter object - only add status if provided
      const filter: any = {
        user: new Types.ObjectId(userId),
      };

      if (status) {
        filter.status = status;
      }

      const [data, total] = await Promise.all([
        MeetingAttendance.find(filter, {
          meeting: 1,
          user: 1,
          sessions: 1,
          totalDuration: 1,
          totalSessions: 1,
          completedAt: 1,
          joinedAt: 1,
          region: 1,
          progress: 1,
          status: 1,
        })
          .populate("meeting", "title description startTime duration")
          .sort({ completedAt: -1, joinedAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        MeetingAttendance.countDocuments(filter),
      ]);

      return res.json({
        success: true,
        data,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error(`Error fetching sessions with status ${status}:`, error);
      throw error;
    }
  }

  // Add this to your MeetingController

  static async GetMonthlyAttendance(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      const { period = "6months" } = req.query;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Get current date and calculate back based on period
      const now = new Date();
      let monthsBack = 5; // default 6 months (including current)

      if (period === "3months") {
        monthsBack = 2; // 3 months including current
      } else if (period === "1year") {
        monthsBack = 11; // 12 months including current
      }

      const periodAgo = new Date(now);
      periodAgo.setMonth(periodAgo.getMonth() - monthsBack);

      // Aggregate attendance by month
      const monthlyData = await MeetingAttendance.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            status: { $in: ["joined", "completed"] },
            createdAt: {
              $gte: periodAgo,
            },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        {
          $sort: {
            "_id.year": 1,
            "_id.month": 1,
          },
        },
      ]);

      // Format the response with month names
      const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];

      // Create an array of all months in the selected period
      const allMonths = [];
      for (let i = monthsBack; i >= 0; i--) {
        const date = new Date(now);
        date.setMonth(date.getMonth() - i);
        allMonths.push({
          month: monthNames[date.getMonth()],
          year: date.getFullYear(),
          monthNum: date.getMonth() + 1,
        });
      }

      // Map aggregated data to include all months with 0 count if no data
      const formattedData = allMonths.map((monthObj) => {
        const found = monthlyData.find(
          (item) =>
            item._id.month === monthObj.monthNum &&
            item._id.year === monthObj.year,
        );
        return {
          month: monthObj.month,
          count: found ? found.count : 0,
        };
      });

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        data: formattedData,
      });
    } catch (error: any) {
      console.error("Error fetching monthly attendance:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching monthly attendance",
      });
    }
  }

  static async getAllMeetings(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || "";
      const status = (req.query.status as string) || "";
      const filter = (req.query.filter as string) || "";

      // Calculate skip for pagination
      const skip = (page - 1) * limit;

      // Build search query
      const searchQuery: any = {};

      if (search) {
        searchQuery.$or = [
          { title: { $regex: search, $options: "i" } },
          { "trainer.name": { $regex: search, $options: "i" } },
          { liveRegion: { $regex: search, $options: "i" } },
        ];
      }

      // Add status filter if provided
      if (status) {
        searchQuery.isLive = status === "live" ? true : false;
      }

      // Add service filter (ObjectId)
      if (filter) {
        const filterIds = filter.split(",").map((id) => id.trim());
        searchQuery.service = { $in: filterIds };
      }

      // Fetch meetings with pagination and populate references
      const meetings = await Meeting.find(searchQuery)
        .populate("service")
        .populate("trainer")
        .populate("createdBy")
        .sort({ startDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Get total count for pagination info
      const totalCount = await Meeting.countDocuments(searchQuery);
      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        success: true,
        data: {
          meetings,
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
    } catch (error: any) {
      console.error("Error fetching monthly attendance:", error.message);
      next();
    }
  }

  static async GetMeetingById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Validate MongoDB ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid meeting ID",
        });
      }

      const meeting = await Meeting.findById(id)
        .populate("service", "_id title description image isActive")
        .populate("trainer", "_id name email")
        .populate("createdBy", "_id firstName lastName email")
        .lean();

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      return res.json({
        success: true,
        data: meeting,
      });
    } catch (error: any) {
      console.error("Error fetching meeting:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching meeting",
      });
    }
  }

  static async UpdateMeeting(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Validate MongoDB ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid meeting ID",
        });
      }

      const {
        service,
        title,
        liveRegion,
        liveTime,
        trainer,
        duration,
        autoRecording=true,
        rotationEnabled = false,
        startDate,
        localTime,
        regions,
        isRecurring,
        recurringType,
        recurringDays,
        weeklyEndDate,
      } = req.body;

      // Validate required fields
      if (
        !service ||
        !title ||
        !liveRegion ||
        !liveTime ||
        !trainer ||
        !duration ||
        !startDate ||
        !localTime ||
        !regions
      ) {
        console.warn(
          "⚠️ [UpdateMeeting] Validation failed - Missing required fields",
        );
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      // Find the meeting
      const meeting = await Meeting.findById(id);

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      // console.log("✅ [UpdateMeeting] Meeting found, updating fields...");

      // Update meeting fields
      meeting.service = service;
      meeting.title = title;
      meeting.liveRegion = liveRegion;
      meeting.liveTime = liveTime;
      meeting.trainer = trainer;
      meeting.duration = duration;
      meeting.autoRecording = autoRecording;
      meeting.rotationEnabled = rotationEnabled;
      meeting.startDate = new Date(startDate);
      meeting.localTime = new Date(localTime);
      meeting.regions = regions; // Update all regions

      meeting.isRecurring = isRecurring ?? false;
      meeting.recurringType = isRecurring ? recurringType : null;
      meeting.recurringDays = isRecurring && recurringType === "custom" ? recurringDays : null;
      meeting.weeklyEndDate = isRecurring && weeklyEndDate ? new Date(weeklyEndDate) : undefined;

      // Update Zoom meeting settings if needed
      try {
        const token = await getZoomAccessToken();
        const meetingTopic = `${title} - Live Class`;

        await axios.patch(
          `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
          {
            topic: meetingTopic,
            start_time: localTime,
            duration,
            settings: {
              mute_upon_entry: true,
              allow_multiple_audio_unmute: false,
              allow_participants_to_unmute_themselves: false,
              allow_participants_to_unmute: false,
              auto_recording: autoRecording ? "cloud" : "none",
              host_video: true,
              participant_video: true,
              waiting_room: true,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );
      } catch (zoomError: any) {
        console.error(
          "⚠️ [UpdateMeeting] Error updating Zoom meeting:",
          zoomError.message,
        );
        // Don't fail the entire request if Zoom update fails
      }

      // Save the meeting
      await meeting.save();

      // console.log(
      //   "📊 [UpdateMeeting] Updated regions count:",
      //   meeting.regions.length
      // );

      const responseMessage = `Meeting "${title}" updated successfully. Live session for ${liveRegion}.`;

      return res.json({
        success: true,
        data: {
          meeting,
          message: responseMessage,
        },
      });
    } catch (error: any) {
      console.error("❌ [UpdateMeeting] ERROR CAUGHT");
      console.error("📝 [UpdateMeeting] Error message:", error.message);
      console.error("🔍 [UpdateMeeting] Error details:", error);

      return res.status(500).json({
        success: false,
        message: error.message || "Error updating meeting",
        error: error.response?.data,
      });
    }
  }

  static async DeleteMeeting(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Validate MongoDB ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid meeting ID",
        });
      }

      const meeting = await Meeting.findByIdAndDelete(id);

      if (!meeting) {
        return res.status(404).json({
          success: false,
          message: "Meeting not found",
        });
      }

      // Try to delete from Zoom
      try {
        const token = await getZoomAccessToken();
        await axios.delete(
          `https://api.zoom.us/v2/meetings/${meeting.zoomMeetingId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
      } catch (zoomError: any) {
        console.error(
          "⚠️ [DeleteMeeting] Error deleting Zoom meeting:",
          zoomError.message,
        );
        // Don't fail if Zoom deletion fails
      }

      return res.json({
        success: true,
        message: "Meeting deleted successfully",
        data: { meetingId: id },
      });
    } catch (error: any) {
      console.error("❌ [DeleteMeeting] ERROR CAUGHT");
      console.error("📝 [DeleteMeeting] Error message:", error.message);

      return res.status(500).json({
        success: false,
        message: error.message || "Error deleting meeting",
      });
    }
  }

  static async GetAllTrainerMeetings(req: Request, res: Response) {
    try {
      const {
        search = "",
        page = 1,
        limit = 10,
        sortBy = "localTime",
        sortOrder = "asc",
        service,
        isLive,
        isRecurring,
        startDate,
        endDate,
      } = req?.query;

      const userId = req.user?.id;

      if (!userId) {
        console.warn("⚠️ [GetAllMeetings] User not authenticated");
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Fetch user to get their trainer reference
      const user = await User.findById(userId).select("_id name email trainer");

      if (!user) {
        console.warn("⚠️ [GetAllMeetings] User not found:", userId);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // console.log("✅ [GetAllMeetings] User fetched:", {
      //   id: user._id,
      //   name: user.firstName,
      // });

      // Get trainer ID from user's trainer reference
      const trainerId = user.trainer;

      if (!trainerId) {
        console.warn(
          "⚠️ [GetAllMeetings] No trainer assigned to user:",
          userId,
        );
        return res.status(400).json({
          success: false,
          message: "No trainer assigned to this user",
        });
      }

      // Fetch trainer details
      const trainer = await TrainerModel.findById(trainerId).select(
        "_id name email profileImage",
      );

      if (!trainer) {
        console.warn("⚠️ [GetAllMeetings] Trainer not found:", trainerId);
        return res.status(404).json({
          success: false,
          message: "Assigned trainer not found",
        });
      }

      // console.log("✅ [GetAllMeetings] Trainer fetched:", {
      //   id: trainer._id,
      //   name: trainer.firstName,
      // });

      // Build filter object
      const filter: any = {};

      // Filter by trainer (get only assigned trainer's meetings)
      filter.trainer = trainerId;

      // Search by title
      if (search) {
        filter.title = { $regex: search, $options: "i" };
      }

      // Filter by service if provided
      if (service) {
        filter.service = service;
      }

      // Filter by isLive status
      if (isLive !== undefined) {
        filter.isLive = isLive === "true";
      }

      // Filter by isRecurring status
      if (isRecurring !== undefined) {
        filter.isRecurring = isRecurring === "true";
      }

      // Filter by date range
      if (startDate || endDate) {
        filter.localTime = {};
        if (startDate) {
          filter.localTime.$gte = new Date(startDate as string);
        }
        if (endDate) {
          filter.localTime.$lte = new Date(endDate as string);
        }
      }

      // Parse pagination
      const pageNum = parseInt(page as string) || 1;
      const limitNum = Math.min(parseInt(limit as string) || 10, 100); // Max 100 per page
      const skip = (pageNum - 1) * limitNum;

      // console.log("📄 [GetAllMeetings] Pagination:", {
      //   page: pageNum,
      //   limit: limitNum,
      //   skip,
      // });

      // Build sort object
      const sortObj: any = {};
      const sortField = sortBy || "localTime";
      const sortDir = sortOrder === "desc" ? -1 : 1;
      sortObj[sortField as string] = sortDir;

      // console.log(
      //   "📊 [GetAllMeetings] Final filter object:",
      //   JSON.stringify(filter, null, 2)
      // );

      // Execute query with pagination
      const [meetings, totalCount] = await Promise.all([
        Meeting.find(filter)
          .sort(sortObj)
          .skip(skip)
          .limit(limitNum)
          .populate("service", "title name image _id description")
          .populate("trainer", "name email profileImage _id")
          .populate("createdBy", "firstName lastName email _id")
          .lean(),
        Meeting.countDocuments(filter),
      ]);

      // console.log("✅ [GetAllMeetings] Meetings fetched:", {
      //   returned: meetings.length,
      //   total: totalCount,
      //   page: pageNum,
      // });

      // Calculate pagination metadata
      const totalPages = Math.ceil(totalCount / limitNum);
      const hasNextPage = pageNum < totalPages;
      const hasPrevPage = pageNum > 1;

      // console.log("📊 [GetAllMeetings] Pagination metadata:", {
      //   totalPages,
      //   hasNextPage,
      //   hasPrevPage,
      //   currentPage: pageNum,
      // });

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        data: {
          meetings,
          pagination: {
            currentPage: pageNum,
            totalPages,
            limit: limitNum,
            total: totalCount,
            hasNextPage,
            hasPrevPage,
          },
          user: {
            id: user._id,
            name: user.firstName + " " + user.lastName,
          },
          trainer: {
            id: trainer._id,
            name: trainer.firstName + " " + trainer.lastName,
            email: trainer.email,
          },
          filters: {
            search: search || null,
            service: service || null,
            isLive: isLive || null,
            isRecurring: isRecurring || null,
            dateRange: startDate || endDate ? { startDate, endDate } : null,
          },
        },
      });
    } catch (error: any) {
      console.error("❌ [GetAllMeetings] ERROR CAUGHT");
      console.error("📝 [GetAllMeetings] Error message:", error.message);
      console.error("📊 [GetAllMeetings] Full error object:", error);

      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching meetings",
      });
    }
  }

  /**
   * Get weekly meetings for all 7 days
   * Filters by user plan and returns meetings grouped by day
   */
  static async GetWeeklyMeetings(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      // Fetch user with their plan
      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Determine service titles based on plan
      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      // Fetch service IDs based on titles
      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      // Calculate current week (Sunday to Saturday)
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = now.getDate() - dayOfWeek;
      const weekStart = new Date(now.setDate(diff));
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      weekEnd.setHours(23, 59, 59, 999);

      // Fetch all meetings for the week
      const meetings = await Meeting.find({
        localTime: {
          $gte: weekStart,
          $lte: weekEnd,
        },
        service: { $in: serviceIds },
        status: { $in: ["pending", "completed"] },
      })
        .sort({ localTime: 1 })
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      // Group meetings by day
      const groupedByDay: { [key: number]: any[] } = {};

      for (let i = 0; i < 7; i++) {
        groupedByDay[i] = [];
      }

      meetings.forEach((meeting) => {
        const meetingDate = new Date(meeting.localTime);
        const dayIndex = meetingDate.getDay();
        groupedByDay[dayIndex].push(meeting);
      });

      // Flatten back to array for response
      const allMeetings = meetings;

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: allMeetings.length,
        meetings: allMeetings,
        userPlan: user.plan,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching weekly meetings:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching weekly meetings",
      });
    }
  }

  /**
   * Get meetings for a specific day of the week (0-6, where 0 is Sunday)
   */
  static async GetMeetingsByDay(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { dayIndex } = req.params;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated",
        });
      }

      if (
        isNaN(Number(dayIndex)) ||
        Number(dayIndex) < 0 ||
        Number(dayIndex) > 6
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid day index. Must be between 0 and 6.",
        });
      }

      const user = await User.findById(userId).select(
        "plan country countryCode",
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Determine service titles based on plan
      let serviceTitles: string[] = [];

      if (user.plan === "gold-yoga") {
        serviceTitles = ["Yoga"];
      } else if (user.plan === "gold-zumba") {
        serviceTitles = ["Zumba Dance"];
      } else if (user.plan === "gold-mixed") {
        serviceTitles = ["Yoga", "Zumba Dance"];
      } else if (user.plan === "diamond" || user.plan === "platinum") {
        serviceTitles = ["Yoga", "Zumba Dance", "Diet & Nutrition"];
      }

      const services = await Service.find({
        title: { $in: serviceTitles },
      }).select("_id");

      const serviceIds = services.map((service) => service._id);

      // Calculate the specific day of current week
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = now.getDate() - dayOfWeek + Number(dayIndex);

      const dayStart = new Date(now.setDate(diff));
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const meetings = await Meeting.find({
        localTime: {
          $gte: dayStart,
          $lte: dayEnd,
        },
        service: { $in: serviceIds },
        status: { $in: ["pending", "completed"] },
      })
        .sort({ localTime: 1 })
        .populate("service", "title name _id")
        .populate("trainer", "name email _id")
        .populate("createdBy", "firstName lastName email _id")
        .lean();

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        count: meetings.length,
        meetings,
        userPlan: user.plan,
      });
    } catch (error: any) {
      console.error("Error fetching meetings by day:", error.message);
      return res.status(500).json({
        success: false,
        message: error.message || "Error fetching meetings by day",
      });
    }
  }
}
