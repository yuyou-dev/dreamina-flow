import { appendFile, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { LOGS_DIR } from "./runtime.js";

type LogLevel = "info" | "warn" | "error";

function now() {
  return new Date();
}

function dayStamp(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function runtimeLogFileForDate(date = now()) {
  return resolve(LOGS_DIR, `runtime-${dayStamp(date)}.jsonl`);
}

function safePayload(payload: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(payload));
}

export async function writeRuntimeLog(level: LogLevel, event: string, payload: Record<string, unknown> = {}) {
  const timestamp = now();
  const entry = {
    ts: timestamp.toISOString(),
    level,
    event,
    ...safePayload(payload),
  };
  const filePath = runtimeLogFileForDate(timestamp);
  await mkdir(LOGS_DIR, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  return filePath;
}

export function shortLogFileName(filePath: string | undefined) {
  return filePath ? basename(filePath) : undefined;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
