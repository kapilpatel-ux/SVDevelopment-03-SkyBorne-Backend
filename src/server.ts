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
import { startUserPurgeCron } from "./services/userPurgeService";

const PORT = process.env.PORT || 8000;

const startServer = async () => {
  try {
    console.log("🚀 Starting server...");

    /** 1. Connect MongoDB */
    await connectDB();

    /** 2. Connect Redis */
    await connectRedis();

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
        // Start user purge cron (default retention: 30 days)
        startUserPurgeCron(Number(process.env.USER_PURGE_DAYS) || 30);
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
