import * as winston from "winston";
import "winston-daily-rotate-file";

const { combine, timestamp, printf, align, colorize } = winston.format;

const getLogFormat = (includeLevel = true) =>
  includeLevel
    ? printf(
        ({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`
      )
    : printf(({ timestamp, message }) => `${timestamp}, ${message}`);

const consoleTransport = new winston.transports.Console({
  format: colorize({ all: true }),
});

const createFileTransport = (
  path: string,
  retention: string,
  level: string = "debug"
) =>
  new winston.transports.DailyRotateFile({
    filename: path,
    datePattern: "YYYY-MM-DD",
    maxFiles: retention,
    level,
  });

const createLogger = (
  filePath: string,
  retention: string,
  includeLevel = false
) =>
  winston.createLogger({
    level: "info",
    format: combine(
      timestamp({
        format: "YYYY-MM-DD hh:mm:ss A",
      }),
      includeLevel ? align() : winston.format((info) => info)(),
      getLogFormat(includeLevel)
    ),
    transports: [consoleTransport, createFileTransport(filePath, retention, "debug")],
  });

// const logger = winston.createLogger({
//   level: 'info',
//   format: combine(
//     timestamp({
//       format: 'YYYY-MM-DD hh:mm:ss.SSS A',
//     }),
//     align(),
//     printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`)
//   ),
//   transports: [
//     new winston.transports.Console({
//       format: colorize({ all: true }),
//     }),
//     new winston.transports.DailyRotateFile({
//       filename: 'logs/%DATE%.log',
//       datePattern: 'YYYY-MM-DD',
//       maxFiles: '14d',
//       level: 'debug',
//     }),
//   ],
// });

const logger = createLogger("logs/%DATE%.log", "14d", true);

const logAuthEvent = (data: {
  userId?: string;
  email?: string;
  event:
    | "signup"
    | "login"
    | "logout"
    | "password_reset"
    | "otp_sent"
    | "social_login"
    | "otp_verified";
  success: boolean;
  ip?: string;
  userAgent?: string;
  error?: string;
}) => {
  logger.info("Auth Event", JSON.stringify(data));
};

export { logger, logAuthEvent };
