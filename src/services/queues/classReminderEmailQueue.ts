// src/services/queues/classReminderEmailQueue.ts
import Queue from "bull";

export interface ClassReminderEmailJob {
  meetingId: string;
  meetingTitle: string;
  region: string;
  reminderOffsetMinutes: number;
  liveTime: string;
  classStartAt: Date;
  startDate?: Date;
  regionTimeZone?: string;
  regionLocalTime?: string;
  regionLocalDate?: string;
  duration: number;
  trainerName: string;
  userEmails: Array<{
    email: string;
    firstName: string;
    country?: string;
    countryCode?: string;
    timeZone?: string;
  }>;
}

export const classReminderEmailQueue = new Queue<ClassReminderEmailJob>(
  "class-reminder-emails",
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  {
    redis: {
      tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      maxRetriesPerRequest: null,
    },
  }
);

const buildClassReminderJobId = (jobData: ClassReminderEmailJob) => {
  const meetingId = String(jobData.meetingId || "").trim() || "unknown";
  const reminderOffset =
    typeof jobData.reminderOffsetMinutes === "number"
      ? jobData.reminderOffsetMinutes
      : Number(jobData.reminderOffsetMinutes) || 0;
  return `class-reminder:${meetingId}:${reminderOffset}`;
};

// =====================
// QUEUE EVENT DEBUGGING
// =====================

classReminderEmailQueue.on("error", (err) => {
  console.error("❌ [CLASS REMINDER QUEUE ERROR] Redis connection failed:", err);
});

classReminderEmailQueue.on("waiting", (jobId) => {
  console.log("⏳ Class reminder job waiting in queue:", jobId);
});

classReminderEmailQueue.on("active", (job) => {
  console.log("⚡ Class reminder job started:", job.id);
});

classReminderEmailQueue.on("completed", (job, result) => {
  console.log("🎉 Class reminder job completed:", job.id);
});

classReminderEmailQueue.on("failed", (job, err) => {
  console.error("🔥 Class reminder job failed:", job.id, err);
});

// ==========================
// FUNCTION TO ADD NEW JOB
// ==========================

export const addClassReminderEmailJob = async (
  jobData: ClassReminderEmailJob
) => {
  try {
    const jobId = buildClassReminderJobId(jobData);

    const existingJob = await classReminderEmailQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "active") {
        console.warn(
          `⚠️ Class reminder job ${jobId} is already active. Keeping existing job.`,
        );
        return existingJob;
      }

      await existingJob.remove();
      console.log(
        `♻️ Replaced existing class reminder job ${jobId} (previous state: ${state})`,
      );
    }

    const job = await classReminderEmailQueue.add(jobData, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
      delay: 0, // Process immediately, b ut can be scheduled
    });

    return job;
  } catch (error) {
    const jobId = buildClassReminderJobId(jobData);
    const existingJob = await classReminderEmailQueue.getJob(jobId);
    if (existingJob) {
      return existingJob;
    }
    console.error("❌ Error adding class reminder job to queue:", error);
    throw error;
  }
};
