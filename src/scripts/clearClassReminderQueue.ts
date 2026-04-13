import "dotenv/config";
import Queue from "bull";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const getRedisConfig = () => ({
  tls: REDIS_URL.startsWith("rediss://") ? {} : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const classReminderQueue = new Queue("class-reminder-emails", REDIS_URL, {
  redis: getRedisConfig(),
});

const welcomeQueue = new Queue("welcome-emails", REDIS_URL, {
  redis: getRedisConfig(),
});

const invoiceQueue = new Queue("invoice-emails", REDIS_URL, {
  redis: getRedisConfig(),
});

const run = async () => {
  try {
    console.log("🔥 Clearing ALL queues...");

    await classReminderQueue.obliterate({ force: true });
    console.log("✅ Cleared class-reminder-emails");

    await welcomeQueue.obliterate({ force: true });
    console.log("✅ Cleared welcome-emails");

    await invoiceQueue.obliterate({ force: true });
    console.log("✅ Cleared invoice-emails");

  } catch (error) {
    console.error("❌ Failed to clear queues:", error);
    process.exitCode = 1;
  } finally {
    await classReminderQueue.close();
    await welcomeQueue.close();
    await invoiceQueue.close();
  }
};

run();