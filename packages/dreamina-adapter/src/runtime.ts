import { mkdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_DIR = resolve(currentDir, "..");

export const REPO_ROOT = resolve(currentDir, "../../..");
export const ADAPTER_NAME = "dreamina";
export const RUNTIME_DIR = resolve(REPO_ROOT, ".runtime");
export const UPLOADS_DIR = resolve(RUNTIME_DIR, "uploads");
export const RUNS_DIR = resolve(RUNTIME_DIR, "runs");
export const LOGS_DIR = resolve(REPO_ROOT, "logs");
export const DREAMINA_SCRIPTS_DIR = resolve(PACKAGE_DIR, "scripts");

export function ensureRuntimeDirs(): void {
  [RUNTIME_DIR, UPLOADS_DIR, RUNS_DIR, LOGS_DIR].forEach((directory) => {
    mkdirSync(directory, { recursive: true });
  });
}

export function runtimeUrlForPath(absolutePath: string): string {
  const relativePath = relative(RUNTIME_DIR, absolutePath).split("\\").join("/");
  return `/runtime/${relativePath}`;
}

export function uploadScopeDir(scopeId: string): string {
  return resolve(UPLOADS_DIR, scopeId);
}

export function runNodeDir(runId: string, nodeId: string): string {
  return resolve(RUNS_DIR, runId, nodeId);
}
