import {
  collectArtifacts,
  discoverNodeDefinitions,
  getAdapterSnapshot,
  getAdapterStatus,
  getDreaminaAuthStatus,
  getDreaminaLoginSession,
  logoutDreamina,
  queryRunResult,
  runNode,
  startDreaminaLoginSession,
  warmCapabilityCache,
} from "@workflow-studio/dreamina-adapter";
import type {
  AdapterLoginSession,
  AdapterStatus,
  Artifact,
  NodeCatalogResponse,
  NodeDefinition,
  WrapperCommandResponse,
} from "./types.js";

type AdapterSnapshot = {
  cliPath: string | null;
  cliVersion: string | null;
  wrapperVersion: number | null;
  processorNodes: NodeDefinition[];
  rawHelpByCommand: Record<string, string>;
};

export async function getCapabilitySnapshot(forceRefresh = false): Promise<AdapterSnapshot> {
  const snapshot = await getAdapterSnapshot(forceRefresh);
  return {
    cliPath: snapshot.cliPath,
    cliVersion: snapshot.cliVersion,
    wrapperVersion: snapshot.wrapperVersion,
    processorNodes: snapshot.processorNodes as NodeDefinition[],
    rawHelpByCommand: snapshot.rawHelpByCommand,
  };
}

export async function getNodeCatalogResponse(forceRefresh = false): Promise<NodeCatalogResponse> {
  return discoverNodeDefinitions(forceRefresh) as Promise<NodeCatalogResponse>;
}

export async function getAdapterRuntimeStatus(forceRefresh = false): Promise<AdapterStatus> {
  const status = await getAdapterStatus(forceRefresh);
  return {
    ...status,
    auth: status.auth ?? (await getDreaminaAuthStatus(forceRefresh)),
  };
}

export async function getAdapterAuthStatus(forceRefresh = false) {
  return getDreaminaAuthStatus(forceRefresh);
}

export async function startAdapterLoginSession(mode: "login" | "relogin") {
  return startDreaminaLoginSession(mode);
}

export async function getAdapterLoginSession(sessionId: string): Promise<AdapterLoginSession | null> {
  return getDreaminaLoginSession(sessionId);
}

export async function logoutAdapter() {
  return logoutDreamina();
}

export async function runAdapterNode(
  command: string,
  params: Record<string, unknown>,
  options: { stdinText?: string } = {},
): Promise<WrapperCommandResponse> {
  return runNode(command, params, options);
}

export async function collectArtifactsFromDirectory(directory: string, source: Artifact["source"]): Promise<Artifact[]> {
  return collectArtifacts(directory, source);
}

export async function materializeTaskArtifacts(submitId: string, runId: string, nodeId: string) {
  return queryRunResult(submitId, runId, nodeId);
}

export { warmCapabilityCache };
