// =====================================
// src/server.ts
// =====================================

import dotenv from "dotenv";
dotenv.config();

import http from "http";
import connectDB from "./config/db"; // Your Mongo connection file
import { connectRedis } from "./config/redis"; // Your Redis connection file
import app from "./app"; // Imported Express app
import { initializeSocket, setIOInstance } from "./config/socket";
import { startCurrencyCron } from "./modules/CurrencyModule/CurrencyCron";
import { initializeEmailServices } from "./services/initializeEmailService"; 
import { startRecurringFailureSubscriptionInactiveCron } from "./cron/RecurringFailureSubscriptionInactiveCron";
import { initConsoleErrorLogger } from "./utils/consoleLogger";

const PORT = process.env.PORT || 8000;

const startServer = async () => {
  try {
    console.log("🚀 Starting latest server...");
    initConsoleErrorLogger();

    /** 1. Connect MongoDB */
    await connectDB();

    /** 2. Connect Redis */
    await connectRedis();
    initializeEmailServices();

    /** 3. Create HTTP server */
    const server = http.createServer(app);

    const io = initializeSocket(server);
    setIOInstance(io);

    /** 4. Start listening */
    server.listen(
      {
        port: PORT,
        host: "0.0.0.0",
      },
      () => {
        console.log(`🌐 Server running on port ${PORT}`);
        startCurrencyCron();
        startRecurringFailureSubscriptionInactiveCron();
      },
    );

    /** 5. Handle uncaught exceptions */
    process.on("uncaughtException", (err) => {
      console.error("💥 Uncaught Exception:", err);
    });

    process.on("unhandledRejection", (reason) => {
      console.error("💥 Unhandled Rejection:", reason);
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  }
};

startServer();
