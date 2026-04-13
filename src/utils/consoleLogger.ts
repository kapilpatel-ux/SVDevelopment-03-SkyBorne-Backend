import fs from "fs";
import path from "path";

let initialized = false;

const formatArg = (arg: unknown): string => {
  if (arg instanceof Error) {
    return arg.stack || arg.message || "Error";
  }
  if (typeof arg === "string") {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch (error) {
    return String(arg);
  }
};

export const initConsoleErrorLogger = () => {
  if (initialized) return;
  initialized = true;

  const logDir = path.resolve(process.cwd(), "logs");
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (error) {
    // If we cannot create the directory, keep console output only.
  }

  const logPath = path.join(logDir, "error.log");
  const stream = fs.createWriteStream(logPath, { flags: "a" });

  const originalError = console.error.bind(console);

  console.error = (...args: unknown[]) => {
    try {
      const message = args.map(formatArg).join(" ");
      const timestamp = new Date().toISOString();
      stream.write(`[${timestamp}] error: ${message}\n`);
    } catch (error) {
      // Swallow logging errors to avoid crashing the app.
    }
    originalError(...args);
  };

  process.on("exit", () => {
    try {
      stream.end();
    } catch (error) {
      // Ignore shutdown errors.
    }
  });
};
