import cors from "cors";
import express from "express";
import multer from "multer";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  getCapabilitySnapshot,
  getAdapterAuthStatus,
  getAdapterRuntimeStatus,
  getAdapterLoginSession,
  getNodeCatalogResponse,
  logoutAdapter,
  startAdapterLoginSession,
  warmCapabilityCache,
} from "./adapter.js";
import { settleSubmittedExecution, submitCommandWithRetry } from "./executionHealth.js";
import { processorChainForTarget } from "./flow.js";
import { normalizeFlowEdges, resolveFlowNodeInputs } from "./flowRuntime.js";
import { shortLogFileName, writeRuntimeLog } from "./logger.js";
import { failApiRequestLog, finishApiRequestLog, startApiRequestLog } from "./requestLogging.js";
import { RUNTIME_DIR, ensureRuntimeDirs, runtimeUrlForPath, uploadScopeDir } from "./runtime.js";
import { validateCommand } from "./validate.js";
import type {
  Artifact,
  NodeDefinition,
  FlowEdge,
  FlowNode,
  FlowRunResult,
  NodeExecution,
  ResolvedInputValue,
  UploadAssetResponse,
} from "./types.js";

const upload = multer({ storage: multer.memoryStorage() });
const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/runtime", express.static(RUNTIME_DIR));

function processorCommandMap(commands: NodeDefinition[]): Record<string, NodeDefinition> {
  return Object.fromEntries(commands.map((command) => [command.name, command]));
}

function inferKindFromMime(mimeType: string): Artifact["kind"] {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  return "text";
}

function commandResponseCliArgs(result: unknown): string[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const payload = result as { cli_args?: string[]; cliArgs?: string[] };
  return payload.cliArgs ?? payload.cli_args ?? [];
}

async function resolveRuntimeCapabilities() {
  const snapshot = await getCapabilitySnapshot();
  return processorCommandMap(snapshot.processorNodes);
}

function normalizeResolvedInputs(input: unknown): Record<string, ResolvedInputValue[]> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => {
      if (!Array.isArray(value)) {
        return [key, []];
      }
      return [key, value as ResolvedInputValue[]];
    }),
  );
}

function syntheticQueryResult(submitId: string, result: unknown) {
  return {
    ok: true as const,
    command: "query_result",
    data: {
      submit_id: submitId,
      gen_status: "querying",
      ...(result && typeof result === "object" ? (result as Record<string, unknown>) : {}),
    },
  };
}

function authRequiredResponse(auth: Awaited<ReturnType<typeof getAdapterAuthStatus>>, context: Record<string, unknown> = {}) {
  return {
    ok: false as const,
    authRequired: true as const,
    error: auth.message ?? "Dreamina login is required before running this workflow.",
    auth,
    ...context,
  };
}

app.get("/api/adapter/status", async (_request, response) => {
  const status = await getAdapterRuntimeStatus();
  const auth = status.auth ?? (await getAdapterAuthStatus());
  response.json({
    ...status,
    auth,
  });
});

app.post("/api/adapter/login", async (request, response) => {
  const mode = request.body?.mode === "relogin" ? "relogin" : "login";
  const session = await startAdapterLoginSession(mode);
  response.status(202).json(session);
});

app.get("/api/adapter/login/:sessionId", async (request, response) => {
  const session = await getAdapterLoginSession(request.params.sessionId);
  if (!session) {
    response.status(404).json({ ok: false, error: `Unknown login session: ${request.params.sessionId}.` });
    return;
  }
  response.json(session);
});

app.post("/api/adapter/logout", async (_request, response) => {
  const auth = await logoutAdapter();
  const status = await getAdapterRuntimeStatus(true);
  response.json({
    ...status,
    auth,
  });
});

app.get("/api/capabilities", async (_request, response) => {
  response.json(await getNodeCatalogResponse());
});

app.post("/api/assets/upload", upload.single("file"), async (request, response) => {
  const file = request.file;
  if (!file) {
    response.status(400).json({ ok: false, error: "Missing upload file." });
    return;
  }

  const scopeId = String(request.body.scopeId || "manual");
  const assetId = randomUUID();
  const directory = uploadScopeDir(scopeId);
  await mkdir(directory, { recursive: true });

  const filename = `${assetId}-${basename(file.originalname)}`;
  const absolutePath = resolve(directory, filename);
  await writeFile(absolutePath, file.buffer);

  const kind = inferKindFromMime(file.mimetype);
  const payload: UploadAssetResponse = {
    assetId,
    kind,
    filename,
    localPath: absolutePath,
    previewUrl: runtimeUrlForPath(absolutePath),
    mimeType: file.mimetype,
    source: "upload",
    mediaMeta: {},
  };
  await writeRuntimeLog("info", "asset.uploaded", {
    scopeId,
    assetId,
    kind,
    filename,
  });
  response.json(payload);
});

app.post("/api/nodes/:type/validate", async (request, response) => {
  const commands = await resolveRuntimeCapabilities();
  const command = commands[request.params.type];
  if (!command) {
    response.status(404).json({ ok: false, errors: [`Unknown processor node: ${request.params.type}.`] });
    return;
  }
  const result = validateCommand(command, request.body?.params ?? {}, normalizeResolvedInputs(request.body?.resolvedInputs));
  response.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/nodes/:type/run", async (request, response) => {
  const requestId = randomUUID();
  const requestedNodeId = request.body?.nodeId ? String(request.body.nodeId) : undefined;
  const requestedRunId = request.body?.runId ? String(request.body.runId) : undefined;
  const requestLog = await startApiRequestLog({
    requestId,
    route: "/api/nodes/:type/run",
    method: "POST",
    meta: { command: request.params.type, nodeId: requestedNodeId, runId: requestedRunId },
  });

  try {
    const runtimeStatus = await getAdapterRuntimeStatus(true);
    if (!runtimeStatus.auth.loggedIn) {
      const payload = authRequiredResponse(runtimeStatus.auth, {
        command: request.params.type,
        nodeId: requestedNodeId,
        runId: requestedRunId,
      });
      await finishApiRequestLog(requestLog, 401, {
        command: request.params.type,
        nodeId: requestedNodeId,
        runId: requestedRunId,
        authRequired: true,
      });
      response.status(401).json(payload);
      return;
    }

    const commands = await resolveRuntimeCapabilities();
    const command = commands[request.params.type];
    if (!command) {
      await finishApiRequestLog(requestLog, 404);
      response.status(404).json({ ok: false, error: `Unknown processor node: ${request.params.type}.` });
      return;
    }

    const validation = validateCommand(command, request.body?.params ?? {}, normalizeResolvedInputs(request.body?.resolvedInputs));
    if (!validation.ok) {
      await finishApiRequestLog(requestLog, 400, { validationErrors: validation.errors });
      response.status(400).json(validation);
      return;
    }

    const nodeId = String(request.body?.nodeId || command.name);
    const runId = String(request.body?.runId || randomUUID());
    const submitLogFile = await writeRuntimeLog("info", "node.run.started", {
      requestId,
      command: command.name,
      nodeId,
      runId,
    });
    const submit = await submitCommandWithRetry({
      commandName: command.name,
      params: validation.normalizedParams,
      runId,
      nodeId,
    });
    const result = submit.result;
    const execution: NodeExecution = {
      status: result.ok ? "running" : "fail",
      runId,
      error: result.error,
      cliArgs: commandResponseCliArgs(result),
      result: result.data,
      artifacts: [],
    };

    const submitId = result.ok && result.data && typeof result.data === "object" && "submit_id" in (result.data as Record<string, unknown>)
      ? String((result.data as Record<string, unknown>).submit_id)
      : undefined;

    if (submitId) {
      const settled = await settleSubmittedExecution({
        submitId,
        runId,
        nodeId,
        initialResult: result,
        submitHealth: {
          submitAttempts: submit.submitAttempts,
          submitRecovered: submit.submitRecovered,
        },
      });
      execution.submitId = submitId;
      execution.status = settled.execution.status;
      execution.artifacts = settled.execution.artifacts;
      execution.result = settled.execution.result ?? result.data;
      execution.error = settled.execution.error;
      execution.health = {
        ...settled.execution.health,
        logFile: settled.execution.health?.logFile ?? shortLogFileName(submitLogFile),
      };
    } else {
      execution.health = {
        submitAttempts: submit.submitAttempts,
        submitRecovered: submit.submitRecovered,
        lastUpdatedAt: new Date().toISOString(),
        logFile: shortLogFileName(submitLogFile),
      };
    }

    const status = execution.status === "fail" ? 400 : 200;
    await finishApiRequestLog(requestLog, status, {
      command: command.name,
      nodeId,
      runId,
      submitId,
      executionStatus: execution.status,
    });
    response.status(status).json({
      ...result,
      runId,
      nodeId,
      submitId,
      artifacts: execution.artifacts ?? [],
      execution,
    });
  } catch (error) {
    await failApiRequestLog(requestLog, error);
    response.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Node run failed." });
  }
});

app.get("/api/tasks/:submitId", async (request, response) => {
  const runId = String(request.query.runId ?? request.params.submitId);
  const nodeId = String(request.query.nodeId ?? "query_result");
  const settled = await settleSubmittedExecution({
    submitId: request.params.submitId,
    runId,
    nodeId,
    initialResult: syntheticQueryResult(request.params.submitId, {}),
  });
  response.status(200).json({
    ...settled.queryResult,
    runId,
    nodeId,
    artifacts: settled.artifacts,
    execution: settled.execution,
  });
});

app.post("/api/flows/run", async (request, response) => {
  const requestId = randomUUID();
  const targetNodeId = String(request.body?.targetNodeId || "");
  const requestedRunId = request.body?.runId ? String(request.body.runId) : undefined;
  const requestLog = await startApiRequestLog({
    requestId,
    route: "/api/flows/run",
    method: "POST",
    meta: { targetNodeId, runId: requestedRunId },
  });

  try {
    const runtimeStatus = await getAdapterRuntimeStatus(true);
    if (!runtimeStatus.auth.loggedIn) {
      const payload = authRequiredResponse(runtimeStatus.auth, {
        runId: requestedRunId ?? "",
        targetNodeId,
        executedNodeIds: [],
        nodeResults: {},
      });
      await finishApiRequestLog(requestLog, 401, {
        runId: requestedRunId,
        targetNodeId,
        authRequired: true,
      });
      response.status(401).json(payload);
      return;
    }

    const payloadNodes = Array.isArray(request.body?.nodes) ? (request.body.nodes as FlowNode[]) : [];
    const payloadEdges = normalizeFlowEdges(request.body?.edges);
    const commands = await resolveRuntimeCapabilities();
    const chain = processorChainForTarget(targetNodeId, payloadNodes, payloadEdges);

    if (chain.length === 0) {
      await finishApiRequestLog(requestLog, 400, { targetNodeId });
      response.status(400).json({
        ok: false,
        runId: "",
        targetNodeId,
        nodeResults: {},
        executedNodeIds: [],
        error: "Target node is not a valid processor node or has no executable chain.",
      } satisfies FlowRunResult);
      return;
    }

    const runId = String(request.body?.runId || randomUUID());
    const nodeResults: Record<string, NodeExecution> = {};

    const currentNodes = payloadNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        execution: node.data.execution ?? { status: "idle", artifacts: [] },
      },
    }));

    for (const batch of chain) {
      await writeRuntimeLog("info", "flow.batch.started", {
        requestId,
        runId,
        targetNodeId,
        batchNodeIds: batch,
      });
      const batchResults: Array<
        | { ok: false; nodeId: string; error: string }
        | { ok: true; nodeId: string; execution: NodeExecution }
      > = [];

      for (const nodeId of batch) {
        const node = currentNodes.find((entry) => entry.id === nodeId);
        if (!node) {
          batchResults.push({ ok: false, nodeId, error: "Node not found during flow execution." });
          continue;
        }

        const command = commands[node.data.nodeType];
        if (!command) {
          batchResults.push({ ok: false, nodeId, error: `Unknown processor node: ${node.data.nodeType}.` });
          continue;
        }

        const resolvedInputs = resolveFlowNodeInputs(nodeId, currentNodes, payloadEdges as FlowEdge[], command);
        const validation = validateCommand(command, node.data.params ?? {}, resolvedInputs);
        if (!validation.ok) {
          batchResults.push({ ok: false, nodeId, error: validation.errors.join(" ") });
          continue;
        }

        try {
          if (node.data.execution?.runId === runId && node.data.execution.status === "success") {
            batchResults.push({ ok: true, nodeId, execution: node.data.execution });
            continue;
          }

          if (node.data.execution?.runId === runId && node.data.execution.status === "querying" && node.data.execution.submitId) {
            const settled = await settleSubmittedExecution({
              submitId: node.data.execution.submitId,
              runId,
              nodeId,
              initialResult: syntheticQueryResult(node.data.execution.submitId, node.data.execution.result),
              submitHealth: {
                submitAttempts: node.data.execution.health?.submitAttempts ?? 1,
                submitRecovered: Boolean(node.data.execution.health?.submitRecovered),
              },
            });
            batchResults.push({
              ok: true,
              nodeId,
              execution: {
                ...settled.execution,
                submitId: node.data.execution.submitId,
              },
            });
            continue;
          }

          const submit = await submitCommandWithRetry({
            commandName: command.name,
            params: validation.normalizedParams,
            runId,
            nodeId,
          });
          const result = submit.result;
          const execution: NodeExecution = {
            status: result.ok ? "running" : "fail",
            runId,
            error: result.error,
            cliArgs: commandResponseCliArgs(result),
            result: result.data,
            artifacts: [],
          };

          const submitId = result.ok && result.data && typeof result.data === "object" && "submit_id" in (result.data as Record<string, unknown>)
            ? String((result.data as Record<string, unknown>).submit_id)
            : undefined;

          if (submitId) {
            const settled = await settleSubmittedExecution({
              submitId,
              runId,
              nodeId,
              initialResult: result,
              submitHealth: {
                submitAttempts: submit.submitAttempts,
                submitRecovered: submit.submitRecovered,
              },
            });
            execution.submitId = submitId;
            execution.artifacts = settled.execution.artifacts;
            execution.result = settled.execution.result ?? result.data;
            execution.status = settled.execution.status;
            execution.error = settled.execution.error;
            execution.health = settled.execution.health;
          } else {
            execution.health = {
              submitAttempts: submit.submitAttempts,
              submitRecovered: submit.submitRecovered,
              lastUpdatedAt: new Date().toISOString(),
            };
          }

          batchResults.push({ ok: true, nodeId, execution });
        } catch (error) {
          batchResults.push({ ok: false, nodeId, error: error instanceof Error ? error.message : String(error) });
        }
      }

      let batchFailed = false;
      let batchPending = false;
      let fallbackError = "";
      const pendingNodeIds: string[] = [];

      for (const result of batchResults) {
        if (!result.ok) {
          batchFailed = true;
          fallbackError = fallbackError || result.error || "Batch execution failed.";
          nodeResults[result.nodeId] = { status: "fail", runId, error: result.error, artifacts: [] };
        } else {
          nodeResults[result.nodeId] = result.execution;
          const node = currentNodes.find((entry) => entry.id === result.nodeId);
          if (node) {
            node.data.execution = result.execution;
          }
          if (result.execution.status === "querying") {
            batchPending = true;
            pendingNodeIds.push(result.nodeId);
          }
        }
      }

      if (batchFailed) {
        await writeRuntimeLog("warn", "flow.batch.failed", {
          requestId,
          runId,
          targetNodeId,
          fallbackError,
        });
        await finishApiRequestLog(requestLog, 400, {
          runId,
          targetNodeId,
          executedNodeIds: Object.keys(nodeResults),
          error: fallbackError,
        });
        response.status(400).json({
          ok: false,
          runId,
          targetNodeId,
          executedNodeIds: Object.keys(nodeResults),
          nodeResults,
          error: fallbackError,
        } satisfies FlowRunResult);
        return;
      }

      if (batchPending) {
        await writeRuntimeLog("info", "flow.batch.pending", {
          requestId,
          runId,
          targetNodeId,
          pendingNodeIds,
        });
        await finishApiRequestLog(requestLog, 200, {
          runId,
          targetNodeId,
          executedNodeIds: Object.keys(nodeResults),
          pendingNodeIds,
        });
        response.json({
          ok: true,
          runId,
          targetNodeId,
          nodeResults,
          executedNodeIds: Object.keys(nodeResults),
          pendingNodeIds,
        } satisfies FlowRunResult);
        return;
      }
    }

    await writeRuntimeLog("info", "flow.completed", {
      requestId,
      runId,
      targetNodeId,
      executedNodeIds: Object.keys(nodeResults),
    });
    await finishApiRequestLog(requestLog, 200, {
      runId,
      targetNodeId,
      executedNodeIds: Object.keys(nodeResults),
    });
    response.json({
      ok: true,
      runId,
      targetNodeId,
      nodeResults,
      executedNodeIds: Object.keys(nodeResults),
    } satisfies FlowRunResult);
  } catch (error) {
    await failApiRequestLog(requestLog, error, { targetNodeId, runId: requestedRunId });
    response.status(500).json({
      ok: false,
      runId: requestedRunId ?? "",
      targetNodeId,
      nodeResults: {},
      executedNodeIds: [],
      error: error instanceof Error ? error.message : "Flow run failed.",
    } satisfies FlowRunResult);
  }
});

export async function createApp() {
  ensureRuntimeDirs();
  await warmCapabilityCache();
  return app;
}
