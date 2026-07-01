// src/config/socket.ts
import { Server as HTTPServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import { getAllowedOrigins, isOriginAllowed } from "../utils/cors";

// Store user socket connections
export const userSocketMap = new Map<string, string>(); // userId -> socketId

export function initializeSocket(httpServer: HTTPServer) {
  const allowedOrigins = getAllowedOrigins();

  const io = new SocketServer(httpServer, {
    cors: {
      // For mobile apps, allow all origins or specific app schemes
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, allowedOrigins)) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Optimize for mobile connections
    transports: ["websocket", "polling"], // Polling fallback for unstable connections
    pingInterval: 25000, // Keep-alive heartbeat
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6, // 1MB max message size
  });

  io.on("connection", (socket: Socket) => {

    // Register user socket on connection
    socket.on("register-user", (userId: string) => {
      if (!userId) {
        console.warn("⚠️ User registration without userId");
        socket.emit("error", { message: "userId is required" });
        return;
      }

      // Remove previous socket if user reconnects
      const existingSocketId = userSocketMap.get(userId);
      if (existingSocketId && existingSocketId !== socket.id) {
        io.to(existingSocketId).emit("session-replaced", {
          message: "Your session was connected from another device",
        });
      }

      userSocketMap.set(userId, socket.id);
      socket.join(`user-${userId}`); // Join room specific to user
      
      socket.emit("registration-success", { 
        message: "You are now connected",
        socketId: socket.id 
      });
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      
      for (const [userId, socketId] of userSocketMap.entries()) {
        if (socketId === socket.id) {
          userSocketMap.delete(userId);
          break;
        }
      }
    });

    // Handle connection errors
    socket.on("error", (error) => {
      console.error(`❌ Socket error for ${socket.id}:`, error);
    });
  });

  // Handle namespace errors
  io.on("error", (error) => {
    console.error("❌ Socket.io server error:", error);
  });

  return io;
}

// Export function to get socket instance globally
let ioInstance: SocketServer;

export function setIOInstance(io: SocketServer) {
  ioInstance = io;
}

export function getIO() {
  if (!ioInstance) {
    console.warn("⚠️ Socket.io not initialized - getIO() called before setIOInstance()");
    return null;
  }
  return ioInstance;
}

export function getUserSocketId(userId: string): string | undefined {
  return userSocketMap.get(userId);
}

export function isUserConnected(userId: string): boolean {
  return userSocketMap.has(userId);
}
