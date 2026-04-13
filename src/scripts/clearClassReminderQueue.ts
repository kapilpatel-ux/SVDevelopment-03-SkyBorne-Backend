import "dotenv/config";
import Queue from "bull";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const classReminderEmailQueue = new Queue("class-reminder-emails", REDIS_URL, {
  redis: {
    tls: REDIS_URL.startsWith("rediss://") ? {} : undefined,
    maxRetriesPerRequest: null,
  },
});

const run = async () => {
  try {
    await classReminderEmailQueue.obliterate({ force: true });
    console.log("✅ Cleared class-reminder-emails queue");
  } catch (error) {
    console.error("❌ Failed to clear class-reminder-emails queue:", error);
    process.exitCode = 1;
  } finally {
    await classReminderEmailQueue.close();
  }
};

run();
