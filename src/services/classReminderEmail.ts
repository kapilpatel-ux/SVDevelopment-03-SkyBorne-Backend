// src/services/email/classReminderEmail.ts
import dotenv from "dotenv";
dotenv.config();

import { classReminderEmailQueue } from "./queues/classReminderEmailQueue";
import { initConsoleErrorLogger } from "../utils/consoleLogger";

initConsoleErrorLogger();

classReminderEmailQueue.on("completed", (job: any) =>
  console.log(`🎉 Class reminder email job ${job.id} completed`),
);

classReminderEmailQueue.on("failed", (job: any, err: any) =>
  console.error(`🔥 Class reminder email job ${job.id} failed: ${err.message}`),
);
