import { app } from "electron";
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function logCrash(type: string, error: unknown): string | null {
  try {
    const logDir = app.getPath("userData");
    const logPath = join(logDir, "crash.log");
    mkdirSync(logDir, { recursive: true });
    appendFileSync(
      logPath,
      `[${new Date().toISOString()}] [${type}] ${errorText(error)}\n\n`,
      "utf8",
    );
    return logPath;
  } catch (writeError) {
    console.error("Failed to write crash log", writeError);
    return null;
  }
}
