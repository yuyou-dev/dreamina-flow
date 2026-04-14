import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AdapterStatus, Artifact, NodeCatalogResponse, NodeDefinition, WrapperCommandResponse } from "@workflow-studio/workflow-core";
import { buildNodeCatalog, buildProcessorDefinitions } from "./catalog.js";
import { getDreaminaAuthStatus } from "./auth.js";
import { runCli, tryRunCli } from "./cli.js";
import { ADAPTER_NAME, DREAMINA_SCRIPTS_DIR, LOGS_DIR, REPO_ROOT, ensureRuntimeDirs, runNodeDir, runtimeUrlForPath } from "./runtime.js";

const wrapperListScript = resolve(DREAMINA_SCRIPTS_DIR, "list_capabilities.py");

type WrapperCapabilitySnapshot = {
  wrapper_version: number;
  commands: Array<{
    name: string;
    description: string;
    output_mode: string;
    parameters: Array<{
      key: string;
      multiple: boolean;
      required: boolean;
      value_type: string;
      choices: string[];
      min_value: number | null;
      max_value: number | null;
      path_mode: "file" | "dir" | null;
    }>;
  }>;
};

type AdapterSnapshot = {
  cliPath: string | null;
  cliVersion: string | null;
  wrapperVersion: number | null;
  processorNodes: NodeDefinition[];
  rawHelpByCommand: Record<string, string>;
  catalog: NodeCatalogResponse;
};

let adapterCache: AdapterSnapshot | null = null;

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function wrapperCapabilities(): Promise<WrapperCapabilitySnapshot> {
  const { stdout } = await runCli("python3", [wrapperListScript, "--format", "json"]);
  const parsed = tryParseJson<WrapperCapabilitySnapshot>(stdout);
  if (!parsed) {
    throw new Error("Unable to parse wrapper capability JSON.");
  }
  return parsed;
}

async function findCliPath(): Promise<string | null> {
  const response = await tryRunCli("which", ["dreamina"]);
  return response.ok ? response.stdout || null : null;
}

async function cliVersion(): Promise<string | null> {
  const response = await tryRunCli("dreamina", ["version"]);
  if (!response.ok) {
    return null;
  }
  const parsed = tryParseJson<{ version?: string }>(response.stdout);
  return parsed?.version ?? response.stdout ?? null;
}

async function getRawHelp(command: string): Promise<string> {
  const response = await tryRunCli("dreamina", [command, "-h"]);
  return response.stdout || response.stderr;
}

function toFlagName(key: string): string {
  return `--${key.replace(/_/g, "-")}`;
}

function appendArgs(args: string[], key: string, value: unknown): void {
  if (value === undefined || value === null || value === "" || value === false) {
    return;
  }
  if (typeof value === "boolean") {
    if (value) {
      args.push(toFlagName(key));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => appendArgs(args, key, item));
    return;
  }
  args.push(toFlagName(key), String(value));
}

function normalizeWrapperResponse(command: string, stdout: string, stderr: string): WrapperCommandResponse {
  const parsed = tryParseJson<WrapperCommandResponse>(stdout);
  if (parsed) {
    return parsed;
  }
  return {
    ok: false,
    command,
    error: "Wrapper did not return JSON.",
    details: [stdout, stderr].filter(Boolean),
  };
}

function normalizeRawResponse(command: string, args: string[], stdout: string, stderr: string, ok: boolean): WrapperCommandResponse {
  const parsed = tryParseJson<unknown>(stdout);
  if (ok) {
    return {
      ok: true,
      command,
      cliArgs: ["dreamina", command, ...args],
      data: parsed ?? { stdout, stderr },
    };
  }
  return {
    ok: false,
    command,
    cliArgs: ["dreamina", command, ...args],
    error: stderr || stdout || "Raw dreamina command failed.",
    details: [stdout, stderr].filter(Boolean),
  };
}

export async function discoverNodeDefinitions(forceRefresh = false): Promise<NodeCatalogResponse> {
  const snapshot = await getAdapterSnapshot(forceRefresh);
  return snapshot.catalog;
}

export async function getAdapterSnapshot(forceRefresh = false): Promise<AdapterSnapshot> {
  if (adapterCache && !forceRefresh) {
    return adapterCache;
  }

  ensureRuntimeDirs();

  const [cliPath, cliVersionValue, wrapperSnapshot] = await Promise.all([
    findCliPath(),
    cliVersion(),
    wrapperCapabilities(),
  ]);

  const commandNames = [...new Set(wrapperSnapshot.commands.map((command) => command.name))];
  const rawHelpEntries = await Promise.all(
    commandNames.map(async (commandName) => [commandName, await getRawHelp(commandName)] as const),
  );
  const rawHelpByCommand = Object.fromEntries(rawHelpEntries);
  const processorNodes = buildProcessorDefinitions(wrapperSnapshot.commands, rawHelpByCommand);
  const catalog = buildNodeCatalog(processorNodes);

  adapterCache = {
    cliPath,
    cliVersion: cliVersionValue,
    wrapperVersion: wrapperSnapshot.wrapper_version ?? null,
    processorNodes,
    rawHelpByCommand,
    catalog,
  };

  return adapterCache;
}

export async function getAdapterStatus(forceRefresh = false): Promise<AdapterStatus> {
  const [snapshot, auth] = await Promise.all([
    getAdapterSnapshot(forceRefresh),
    getDreaminaAuthStatus(forceRefresh),
  ]);
  return {
    backendReady: true,
    cliFound: Boolean(snapshot.cliPath),
    cliPath: snapshot.cliPath,
    cliVersion: snapshot.cliVersion,
    wrapperVersion: snapshot.wrapperVersion,
    adapterName: ADAPTER_NAME,
    logDirectory: LOGS_DIR,
    auth,
  };
}

export async function runNode(
  command: string,
  params: Record<string, unknown>,
  options: { stdinText?: string } = {},
): Promise<WrapperCommandResponse> {
  const args: string[] = [];
  Object.entries(params).forEach(([key, value]) => appendArgs(args, key, value));

  const scriptPath = resolve(DREAMINA_SCRIPTS_DIR, `${command}.py`);
  try {
    await access(scriptPath, constants.F_OK);
  } catch {
    const response = await tryRunCli("dreamina", [command, ...args], options.stdinText);
    return normalizeRawResponse(command, args, response.stdout, response.stderr, response.ok);
  }

  const wrapperArgs = [scriptPath];
  Object.entries(params).forEach(([key, value]) => appendArgs(wrapperArgs, key, value));
  const response = await tryRunCli("python3", wrapperArgs, options.stdinText);
  return normalizeWrapperResponse(command, response.stdout, response.stderr);
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(absolutePath);
      }
      return absolutePath;
    }),
  );
  return nested.flat();
}

function inferKindFromExtension(filename: string): Artifact["kind"] {
  const extension = extname(filename).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(extension)) {
    return "image";
  }
  if ([".mp4", ".mov", ".webm", ".mkv"].includes(extension)) {
    return "video";
  }
  if ([".mp3", ".wav", ".aac", ".m4a"].includes(extension)) {
    return "audio";
  }
  return "text";
}

function inferMimeType(kind: Artifact["kind"], filename: string): string {
  const extension = extname(filename).toLowerCase();
  if (kind === "image" && extension === ".png") {
    return "image/png";
  }
  if (kind === "image") {
    return "image/jpeg";
  }
  if (kind === "video") {
    return "video/mp4";
  }
  if (kind === "audio") {
    return "audio/mpeg";
  }
  return "text/plain";
}

export async function collectArtifacts(directory: string, source: Artifact["source"]): Promise<Artifact[]> {
  const files = await collectFiles(directory);
  const artifacts: Array<Artifact | null> = await Promise.all(files.map(async (filePath) => {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    const kind = inferKindFromExtension(filePath);
    return {
      assetId: randomUUID(),
      kind,
      filename: basename(filePath),
      localPath: filePath,
      previewUrl: runtimeUrlForPath(filePath),
      mimeType: inferMimeType(kind, filePath),
      source,
    } satisfies Artifact;
  }));
  return artifacts.filter((item): item is Artifact => item !== null);
}

export async function materializeTaskArtifacts(submitId: string, runId: string, nodeId: string) {
  const directory = runNodeDir(runId, nodeId);
  ensureRuntimeDirs();
  const queryResult = await runNode("query_result", {
    submit_id: submitId,
    download_dir: directory,
  });
  const artifacts = await collectArtifacts(directory, "result");
  return {
    queryResult,
    artifacts,
  };
}

export async function queryRunResult(submitId: string, runId: string, nodeId: string) {
  return materializeTaskArtifacts(submitId, runId, nodeId);
}

export async function warmCapabilityCache() {
  await getAdapterSnapshot();
}
