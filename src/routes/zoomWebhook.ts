import crypto from "crypto";
import express from "express";
import MeetingAttendance from "../modules/MeetingModule/MeetingModels/MeetingAttendance";
import type { ISession } from "../modules/MeetingModule/MeetingModels/MeetingAttendance";
import Meeting from "../modules/MeetingModule/MeetingModels/Meeting";
import User from "../modules/UserModule/models/User";
import MeetingParticipant from "../modules/MeetingModule/MeetingModels/MeetingParticipant"; // New model
import Service from "../modules/ServiceModule/models/Service";
import { PushNotificationService } from "../services/pushNotification.service";

type TitleType = "yoga" | "zumba" | "specialty";
const router = express.Router();
const ZOOM_SECRET_TOKEN = process.env.ZOOM_SECRET_TOKEN!;

const getCreditBucketFromServiceTitle = (title: string): TitleType => {
  const normalized = String(title || "").toLowerCase();
  if (normalized.includes("zumba")) return "zumba";
  if (normalized.includes("diet") || normalized.includes("special")) {
    return "specialty";
  }
  return "yoga";
};

const findUserByEmail = async (email: string) => {
  if (!email) return null;
  return User.findOne({
    email: {
      $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      $options: "i",
    },
  });
};

router.use(express.json());

// ======================================================
// URL VALIDATION (FIRST TIME ONLY)
// ======================================================
router.post("/zoom-webhook", async (req, res) => {
  const { event, payload } = req.body;

  // ---------------- URL VALIDATION ----------------
  if (event === "endpoint.url_validation") {
    const plainToken = payload?.plainToken;

    const encryptedToken = crypto
      .createHmac("sha256", ZOOM_SECRET_TOKEN)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({ plainToken, encryptedToken });
  }

  const zoomMeetingId = payload?.object?.id;
  const normalizedZoomMeetingId = Number(zoomMeetingId);
  const occurrenceId = payload?.object?.occurrence_id || null;
  const zoomParticipantId = payload?.object?.participant?.id;
  const participantEmail = String(
    payload?.object?.participant?.user_email || payload?.object?.participant?.email || "",
  )
    .trim()
    .toLowerCase();

  if (!zoomMeetingId) return res.status(200).send("OK");

  // ⭐⭐⭐ FIND CORRECT MEETING INSTANCE ⭐⭐⭐
  const meetingIdForQuery = Number.isFinite(normalizedZoomMeetingId)
    ? normalizedZoomMeetingId
    : zoomMeetingId;

  let meetingDoc =
    (await Meeting.findOne(
      occurrenceId
        ? { zoomMeetingId: meetingIdForQuery, occurrenceId }
        : { zoomMeetingId: meetingIdForQuery, occurrenceId: null }
    )) ||
    (await Meeting.findOne({
      zoomMeetingId: meetingIdForQuery,
    }).sort({ localTime: -1 }));

  if (!meetingDoc) return res.status(200).send("OK");

  // ======================================================
  // RECORDING COMPLETED
  // ======================================================
  if (event === "recording.completed") {
    try {
      const files = payload?.object?.recording_files || [];

      const mp4File = files.find((f: any) => f.file_type === "MP4");
      if (!mp4File?.download_url) return res.status(200).send("OK");

      const updatedMeeting = await Meeting.findByIdAndUpdate(
        meetingDoc._id,
        {
          recordingUrl: mp4File.download_url,
          status: "completed",
          isLive: false,
        },
        { new: true }
      );

      // Send push notification that recording is available to participants
      if (updatedMeeting) {
        try {
          const participants = await MeetingParticipant.find({ meetingId: updatedMeeting._id }).select(
            "userId",
          );

          const userIds = Array.from(
            new Set(
              participants
                .map((p: any) => (p.userId ? String(p.userId) : null))
                .filter((id): id is string => Boolean(id)),
            ),
          );

          if (userIds.length) {
            await PushNotificationService.sendSessionRecordingAvailable(userIds, {
              meetingId: String(updatedMeeting._id),
              meetingTitle: updatedMeeting.title,
              recordingUrl: mp4File.download_url,
            });
          } else if (updatedMeeting.trainer) {
            // Fallback: notify trainer if no participant userIds found
            await PushNotificationService.sendSessionRecordingAvailable([String(updatedMeeting.trainer)], {
              meetingId: String(updatedMeeting._id),
              meetingTitle: updatedMeeting.title,
              recordingUrl: mp4File.download_url,
            });
          }
        } catch (error: any) {
          console.error("❌ Failed to send recording available push notification:", error?.message || error);
        }
      }

      return res.status(200).send("OK");
    } catch {
      return res.status(200).send("OK");
    }
  }

  // ======================================================
  // PARTICIPANT JOINED
  // ======================================================
  if (event === "meeting.participant_joined") {
    const now = new Date();
    let participantRecord = null;

    if (participantEmail) {
      participantRecord = await MeetingParticipant.findOne({
        meetingId: meetingDoc._id,
        email: {
          $regex: `^${participantEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
      }).sort({ createdAt: -1 });
    }

    if (!participantRecord && zoomParticipantId) {
      participantRecord = await MeetingParticipant.findOne({
        meetingId: meetingDoc._id,
        zoomParticipantId,
      });
    }

    if (!participantRecord) {
      participantRecord = await MeetingParticipant.findOne({
        meetingId: meetingDoc._id,
        zoomParticipantId: null,
        leftAt: null,
      }).sort({ createdAt: -1 });
    }

    if (!participantRecord && participantEmail) {
      const mappedUser = await findUserByEmail(participantEmail);
      if (mappedUser?._id) {
        participantRecord = await MeetingParticipant.create({
          meetingId: meetingDoc._id,
          userId: mappedUser._id,
          email: participantEmail,
          joinedAt: now,
          zoomParticipantId: zoomParticipantId || undefined,
        });
      }
    }

    if (participantRecord) {
      participantRecord.zoomParticipantId =
        zoomParticipantId || participantRecord.zoomParticipantId;
      participantRecord.joinedAt = participantRecord.joinedAt || now;
      if (participantEmail) participantRecord.email = participantEmail;
      await participantRecord.save();

      let attendance = await MeetingAttendance.findOne({
        meeting: meetingDoc._id,
        user: participantRecord.userId,
      });

      if (!attendance) {
        attendance = await MeetingAttendance.create({
          meeting: meetingDoc._id,
          user: participantRecord.userId,
          sessions: [
            {
              joinTime: participantRecord.joinedAt || now,
              leaveTime: null,
              duration: 0,
              progress: 0,
              mode: "live",
              region: null,
              zoomParticipantId: zoomParticipantId || undefined,
            },
          ],
          status: "joined",
          joinedAt: participantRecord.joinedAt || now,
          totalDuration: 0,
          progress: 0,
        });
      } else {
        const lastSession = attendance.sessions[attendance.sessions.length - 1];

        if (
          !lastSession ||
          lastSession.leaveTime ||
          (zoomParticipantId &&
            String(lastSession.zoomParticipantId || "") !==
              String(zoomParticipantId))
        ) {
          attendance.sessions.push({
            joinTime: participantRecord.joinedAt || now,
            leaveTime: null,
            duration: 0,
            progress: 0,
            mode: "live",
            region: null,
            zoomParticipantId: zoomParticipantId || undefined,
          } as any);
        } else if (!lastSession.zoomParticipantId && zoomParticipantId) {
          lastSession.zoomParticipantId = zoomParticipantId || undefined;
        }

        if (!attendance.joinedAt) {
          attendance.joinedAt = participantRecord.joinedAt || now;
        }
        if (attendance.status === "registered" || attendance.status === "missed") {
          attendance.status = "joined";
        }
        await attendance.save();
      }
    }

    return res.status(200).send("OK");
  }

  // ======================================================
  // PARTICIPANT LEFT
  // ======================================================
  if (event === "meeting.participant_left") {
    const participantRecord =
      (await MeetingParticipant.findOne({
        zoomParticipantId,
        meetingId: meetingDoc._id,
      })) ||
      (participantEmail
        ? await MeetingParticipant.findOne({
            meetingId: meetingDoc._id,
            email: {
              $regex: `^${participantEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              $options: "i",
            },
          }).sort({ createdAt: -1 })
        : null);

    let resolvedUserId: any = participantRecord?.userId || null;
    if (!resolvedUserId && participantEmail) {
      const emailUser = await findUserByEmail(participantEmail);
      resolvedUserId = emailUser?._id || null;
    }

    let attendanceByParticipantId: any = null;
    if (!resolvedUserId && zoomParticipantId) {
      attendanceByParticipantId = await MeetingAttendance.findOne({
        meeting: meetingDoc._id,
        sessions: {
          $elemMatch: {
            zoomParticipantId: String(zoomParticipantId),
            leaveTime: null,
          },
        },
      }).sort({ updatedAt: -1 });
      resolvedUserId = attendanceByParticipantId?.user || null;
    }

    if (!resolvedUserId) return res.status(200).send("OK");

    if (participantRecord && !participantRecord.leftAt) {
      participantRecord.leftAt = new Date();
      await participantRecord.save();
    }

    const user = await User.findById(resolvedUserId);
    if (!user) return res.status(200).send("OK");

    let attendance = attendanceByParticipantId || (await MeetingAttendance.findOne({
      meeting: meetingDoc._id,
      user: user._id,
    }));

    if (!attendance) {
      attendance = await MeetingAttendance.create({
        meeting: meetingDoc._id,
        user: user._id,
        sessions: [],
        status: "joined",
        totalDuration: 0,
        progress: 0,
        joinedAt: participantRecord?.joinedAt || new Date(),
      });
    }

    const now = new Date();
    let updatedExistingSession = false;

    for (let i = attendance.sessions.length - 1; i >= 0; i--) {
      const session = attendance.sessions[i];
      const isSameParticipant = zoomParticipantId
        ? String(session.zoomParticipantId || "") === String(zoomParticipantId)
        : true;

      if (!session.leaveTime && isSameParticipant) {
        session.leaveTime = now;
        session.duration = Math.max(
          0,
          Math.round(
            (session.leaveTime.getTime() - new Date(session.joinTime).getTime()) /
              60000,
          ),
        );
        updatedExistingSession = true;
        break;
      }
    }

    if (!updatedExistingSession) {
      const joinTime = participantRecord?.joinedAt || now;
      attendance.sessions.push({
        joinTime,
        leaveTime: now,
        duration: Math.max(
          0,
          Math.round((now.getTime() - new Date(joinTime).getTime()) / 60000),
        ),
        zoomParticipantId: zoomParticipantId || undefined,
      });
    }

    attendance.totalDuration = attendance.sessions.reduce(
      (total: number, session: ISession) => total + Number(session.duration || 0),
      0,
    );
    if (!attendance.joinedAt && attendance.sessions[0]?.joinTime) {
      attendance.joinedAt = attendance.sessions[0].joinTime;
    }
    if (attendance.status === "registered") {
      attendance.status = "joined";
    }

    const hasClosedSession = attendance.sessions.some(
      (session: ISession) => !!session.leaveTime,
    );

    if (attendance.status !== "completed" && hasClosedSession) {
      attendance.status = "completed";
      attendance.completedAt = now;
      attendance.totalSessions = (attendance.totalSessions || 0) + 1;

      let serviceTitle = "";
      const meetingService: any = meetingDoc.service;

      if (meetingService?.title) {
        serviceTitle = String(meetingService.title);
      } else if (meetingService) {
        const serviceDoc = await Service.findById(meetingService)
          .select("title")
          .lean();
        serviceTitle = String(serviceDoc?.title || "");
      }

      const bucket = getCreditBucketFromServiceTitle(serviceTitle);
      const currentCredits = Number(user.classCredits?.[bucket] || 0);
      if (currentCredits > 0) {
        user.classCredits[bucket] = currentCredits - 1;
      }
      if (!user.overAllclassCredits) {
        user.overAllclassCredits = { yoga: 0, zumba: 0, specialty: 0 };
      }
      const currentOverallCredits = Number(user.overAllclassCredits?.[bucket] || 0);
      if (currentOverallCredits > 0) {
        user.overAllclassCredits[bucket] = currentOverallCredits - 1;
      }
      await user.save();
    }

    await attendance.save();

    return res.status(200).send("OK");
  }

  // ======================================================
  // MEETING STARTED
  // ======================================================
  if (event === "meeting.started") {
    await Meeting.findByIdAndUpdate(meetingDoc._id, {
      status: "pending",
      isLive: true,
    });

    return res.status(200).send("OK");
  }

  // ======================================================
  // MEETING ENDED
  // ======================================================
  if (event === "meeting.ended") {
    await Meeting.findByIdAndUpdate(meetingDoc._id, {
      status: "completed",
      isLive: false,
    });

    return res.status(200).send("OK");
  }

  return res.status(200).send("OK");
});

export default router;
