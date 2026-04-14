import { materializeTaskArtifacts, runAdapterNode } from "./adapter.js";
import { errorMessage, shortLogFileName, writeRuntimeLog } from "./logger.js";
import type { Artifact, NodeExecution, WrapperCommandResponse } from "./types.js";

const SUBMIT_ATTEMPTS = 5;
const SUBMIT_RETRY_DELAY_MS = 8000;
const INITIAL_QUERY_ATTEMPTS = 12;
const INITIAL_QUERY_RETRY_DELAY_MS = 10000;

const RECOVERABLE_ERROR_PATTERNS = [
  "timeout",
  "timed out",
  "deadline",
  "temporarily unavailable",
  "temporary failure",
  "still processing",
  "not ready",
  "querying",
  "queue",
  "queued",
  "try again",
  "retry",
  "eof",
  "connection reset",
  "connection refused",
  "network",
  "upload phase",
  "no file upload",
  "multipart",
];

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function responseText(result: WrapperCommandResponse | undefined) {
  return [result?.error ?? "", ...(result?.details ?? [])].join(" ").toLowerCase();
}

function hasRecoverableErrorText(result: WrapperCommandResponse | undefined): boolean {
  const text = responseText(result);
  return RECOVERABLE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

function queryStatus(result: WrapperCommandResponse | undefined): string | null {
  if (!result?.data || typeof result.data !== "object") {
    return null;
  }
  return typeof (result.data as Record<string, unknown>).gen_status === "string"
    ? String((result.data as Record<string, unknown>).gen_status)
    : null;
}

export function isRecoverableQueryResult(result: WrapperCommandResponse | undefined): boolean {
  if (!result) {
    return false;
  }

  const status = queryStatus(result);
  if (status === "querying") {
    return true;
  }

  if (result.ok) {
    return false;
  }

  return hasRecoverableErrorText(result);
}

export function isRecoverableSubmitResult(result: WrapperCommandResponse | undefined): boolean {
  if (!result || result.ok) {
    return false;
  }
  return hasRecoverableErrorText(result);
}

export async function submitCommandWithRetry({
  commandName,
  params,
  runId,
  nodeId,
}: {
  commandName: string;
  params: Record<string, unknown>;
  runId: string;
  nodeId: string;
}): Promise<{
  result: WrapperCommandResponse;
  submitAttempts: number;
  submitRecovered: boolean;
}> {
  let latestResult: WrapperCommandResponse | undefined;
  let recovered = false;

  for (let attempt = 1; attempt <= SUBMIT_ATTEMPTS; attempt += 1) {
    latestResult = await runAdapterNode(commandName, params);
    await writeRuntimeLog(latestResult.ok ? "info" : "warn", "adapter.submit.attempt", {
      command: commandName,
      runId,
      nodeId,
      attempt,
      ok: latestResult.ok,
      error: latestResult.error,
    });

    if (latestResult.ok) {
      return {
        result: latestResult,
        submitAttempts: attempt,
        submitRecovered: recovered,
      };
    }

    if (!isRecoverableSubmitResult(latestResult) || attempt >= SUBMIT_ATTEMPTS) {
      break;
    }

    recovered = true;
    await sleep(SUBMIT_RETRY_DELAY_MS);
  }

  return {
    result: latestResult ?? {
      ok: false,
      command: commandName,
      error: "Node submission did not return a response.",
    },
    submitAttempts: SUBMIT_ATTEMPTS,
    submitRecovered: recovered,
  };
}

function toPendingExecution(
  submitId: string,
  runId: string,
  queryResult: WrapperCommandResponse | undefined,
  queryAttempts: number,
  logFile: string | undefined,
  submitHealth?: { submitAttempts: number; submitRecovered: boolean },
): NodeExecution {
  return {
    status: "querying",
    submitId,
    runId,
    artifacts: [],
    result: queryResult?.data,
    cliArgs: queryResult?.cliArgs ?? queryResult?.cli_args,
    health: {
      queryAttempts,
      submitAttempts: submitHealth?.submitAttempts,
      submitRecovered: submitHealth?.submitRecovered ?? Boolean(queryResult && !queryResult.ok),
      pendingReason: queryResult?.error || "Task is still processing and can be refreshed later by submit_id.",
      lastUpdatedAt: new Date().toISOString(),
      logFile: shortLogFileName(logFile),
    },
  };
}

export async function settleSubmittedExecution({
  submitId,
  runId,
  nodeId,
  initialResult,
  submitHealth,
}: {
  submitId: string;
  runId: string;
  nodeId: string;
  initialResult: WrapperCommandResponse;
  submitHealth?: { submitAttempts: number; submitRecovered: boolean };
}): Promise<{
  execution: NodeExecution;
  artifacts: Artifact[];
  queryResult: WrapperCommandResponse | undefined;
  pending: boolean;
}> {
  let latestQueryResult: WrapperCommandResponse | undefined;
  let latestArtifacts: Artifact[] = [];
  let latestLogFile: string | undefined;

  for (let attempt = 1; attempt <= INITIAL_QUERY_ATTEMPTS; attempt += 1) {
    const materialized = await materializeTaskArtifacts(submitId, runId, nodeId);
    latestQueryResult = materialized.queryResult;
    latestArtifacts = materialized.artifacts;
    latestLogFile = await writeRuntimeLog("info", "adapter.query_result.attempt", {
      submitId,
      runId,
      nodeId,
      attempt,
      ok: latestQueryResult.ok,
      queryStatus: queryStatus(latestQueryResult),
      artifactCount: latestArtifacts.length,
      error: latestQueryResult.error,
    });

    const status = queryStatus(latestQueryResult);
    if (latestQueryResult.ok && status === "success") {
      return {
        execution: {
          status: "success",
          submitId,
          runId,
          artifacts: latestArtifacts,
          result: latestQueryResult.data ?? initialResult.data,
          cliArgs: latestQueryResult.cliArgs ?? latestQueryResult.cli_args ?? initialResult.cliArgs ?? initialResult.cli_args,
          health: {
            submitAttempts: submitHealth?.submitAttempts,
            submitRecovered: submitHealth?.submitRecovered,
            queryAttempts: attempt,
            lastUpdatedAt: new Date().toISOString(),
            logFile: shortLogFileName(latestLogFile),
          },
        },
        artifacts: latestArtifacts,
        queryResult: latestQueryResult,
        pending: false,
      };
    }

    if (attempt < INITIAL_QUERY_ATTEMPTS && isRecoverableQueryResult(latestQueryResult)) {
      await sleep(INITIAL_QUERY_RETRY_DELAY_MS);
      continue;
    }

    if (isRecoverableQueryResult(latestQueryResult)) {
      return {
        execution: toPendingExecution(submitId, runId, latestQueryResult, attempt, latestLogFile, submitHealth),
        artifacts: latestArtifacts,
        queryResult: latestQueryResult,
        pending: true,
      };
    }

    return {
      execution: {
        status: "fail",
        submitId,
        runId,
        artifacts: latestArtifacts,
        result: latestQueryResult?.data ?? initialResult.data,
        error: latestQueryResult?.error || "Task refresh failed.",
        cliArgs: latestQueryResult?.cliArgs ?? latestQueryResult?.cli_args ?? initialResult.cliArgs ?? initialResult.cli_args,
        health: {
          submitAttempts: submitHealth?.submitAttempts,
          submitRecovered: submitHealth?.submitRecovered,
          queryAttempts: attempt,
          lastUpdatedAt: new Date().toISOString(),
          logFile: shortLogFileName(latestLogFile),
        },
      },
      artifacts: latestArtifacts,
      queryResult: latestQueryResult,
      pending: false,
    };
  }

  return {
    execution: toPendingExecution(submitId, runId, latestQueryResult, INITIAL_QUERY_ATTEMPTS, latestLogFile, submitHealth),
    artifacts: latestArtifacts,
    queryResult: latestQueryResult,
    pending: true,
  };
}

export async function logExecutionFailure(event: string, payload: Record<string, unknown>, error: unknown) {
  return writeRuntimeLog("error", event, {
    ...payload,
    error: errorMessage(error),
  });
}
