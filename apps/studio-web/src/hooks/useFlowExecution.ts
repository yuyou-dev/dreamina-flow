import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import { isAuthRequiredApiError, queryTask, runCommand, runFlow, uploadAsset, validateCommand } from "../lib/api";
import {
  decidePendingFlowAction,
  mergeFlowRunNodeResults,
  nextPendingFlowState,
  type PendingFlowState,
} from "../lib/flowExecution";
import { resolveNodeInputs } from "../lib/flow";
import { buildRuntimeEdges } from "../lib/runtimeEdges";
import type {
  AdapterStatus,
  NodeDefinition,
  NodeExecution,
  PendingResumeAction,
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
  WorkflowRunActionOptions,
} from "../types";

type SetNodes = Dispatch<SetStateAction<WorkflowCanvasNode[]>>;

function createLocalRunId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now()}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useFlowExecution({
  nodes,
  edges,
  definitions,
  setNodes,
  setNodeExecution,
  updateNodeValues,
  refreshRuntimeStatus,
  onError,
  onAuthRequired,
}: {
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  definitions: Record<string, NodeDefinition>;
  setNodes: SetNodes;
  setNodeExecution: (nodeId: string, execution: Partial<NodeExecution>) => void;
  updateNodeValues: (nodeId: string, values: Record<string, unknown>) => void;
  refreshRuntimeStatus: () => Promise<AdapterStatus | null>;
  onError: (message: string) => void;
  onAuthRequired: (action: PendingResumeAction) => Promise<void>;
}) {
  const [pendingFlow, setPendingFlow] = useState<PendingFlowState | null>(null);

  const uploadNodeAsset = useCallback(async (nodeId: string, file: File) => {
    try {
      const asset = await uploadAsset(file, nodeId);
      updateNodeValues(nodeId, { asset });
    } catch (error) {
      setNodeExecution(nodeId, {
        status: "fail",
        error: errorMessage(error, "Upload failed."),
      });
    }
  }, [setNodeExecution, updateNodeValues]);

  const runNode = useCallback(async (nodeId: string, options: WorkflowRunActionOptions = {}) => {
    const node = nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      return;
    }

    const definition = definitions[node.data.nodeType];
    if (!definition) {
      return;
    }

    try {
      setNodeExecution(nodeId, { status: "validating", error: "" });
      const resolvedInputs = resolveNodeInputs(nodeId, nodes, edges, definitions);
      await validateCommand(definition.name, {
        params: node.data.params,
        resolvedInputs,
      });
      setNodeExecution(nodeId, { status: "running", error: "" });
      const result = await runCommand(definition.name, {
        nodeId,
        params: node.data.params,
        resolvedInputs,
      });
      setNodeExecution(nodeId, result.execution);
      await refreshRuntimeStatus();
    } catch (error) {
      if (isAuthRequiredApiError(error)) {
        if (options.resumeAttempted) {
          const message = error.body?.error ?? error.message;
          setNodeExecution(nodeId, {
            status: "fail",
            error: message,
          });
          onError(message);
          return;
        }

        await onAuthRequired({ kind: "runNode", nodeId });
        setNodeExecution(nodeId, {
          status: "idle",
          error: "",
          artifacts: [],
        });
        return;
      }

      setNodeExecution(nodeId, {
        status: "fail",
        error: errorMessage(error, "Node execution failed."),
      });
    }
  }, [definitions, edges, nodes, onAuthRequired, onError, refreshRuntimeStatus, setNodeExecution]);

  const refreshNodeResult = useCallback(async (nodeId: string) => {
    const node = nodes.find((entry) => entry.id === nodeId);
    const submitId = node?.data.execution.submitId;
    const runId = node?.data.execution.runId;
    if (!submitId || !runId) {
      return;
    }

    try {
      const result = await queryTask(submitId, runId, nodeId);
      setNodeExecution(nodeId, result.execution);
      await refreshRuntimeStatus();
    } catch (error) {
      const message = errorMessage(error, "Result refresh failed.");
      if (node?.data.execution.status === "querying") {
        setNodeExecution(nodeId, {
          status: "querying",
          error: "",
          health: {
            ...node.data.execution.health,
            pendingReason: message,
            lastUpdatedAt: new Date().toISOString(),
          },
        });
        onError(message);
        return;
      }

      setNodeExecution(nodeId, {
        status: "fail",
        error: message,
      });
    }
  }, [nodes, onError, refreshRuntimeStatus, setNodeExecution]);

  const runChainInternal = useCallback(async (nodeId: string, existingRunId?: string, options: WorkflowRunActionOptions = {}) => {
    try {
      const runId = existingRunId ?? createLocalRunId("flow");
      setNodeExecution(nodeId, { status: "running", error: "" });
      const result = await runFlow({
        targetNodeId: nodeId,
        runId,
        nodes,
        edges: buildRuntimeEdges(edges, nodes, definitions),
      });

      setNodes((currentNodes) => mergeFlowRunNodeResults(currentNodes, result.nodeResults));
      setPendingFlow((currentPendingFlow) => nextPendingFlowState(currentPendingFlow, result, nodeId));
      await refreshRuntimeStatus();
    } catch (error) {
      if (isAuthRequiredApiError(error)) {
        if (options.resumeAttempted) {
          const message = error.body?.error ?? error.message;
          setPendingFlow(null);
          onError(message);
          setNodeExecution(nodeId, {
            status: "fail",
            error: message,
          });
          return;
        }

        setPendingFlow(null);
        await onAuthRequired({ kind: "runChain", nodeId });
        setNodeExecution(nodeId, {
          status: "idle",
          error: "",
          artifacts: [],
        });
        return;
      }

      setPendingFlow(null);
      const message = errorMessage(error, "Chain execution failed.");
      onError(message);
      setNodeExecution(nodeId, {
        status: "fail",
        error: message,
      });
    }
  }, [definitions, edges, nodes, onAuthRequired, onError, refreshRuntimeStatus, setNodeExecution, setNodes]);

  useEffect(() => {
    const decision = decidePendingFlowAction(pendingFlow, nodes);
    if (decision.type === "stop") {
      onError(decision.error);
      setPendingFlow(null);
      return;
    }

    if (decision.type === "resume") {
      setPendingFlow(null);
      void runChainInternal(decision.targetNodeId, decision.runId);
    }
  }, [nodes, onError, pendingFlow, runChainInternal]);

  const runChain = useCallback(async (nodeId: string, options: WorkflowRunActionOptions = {}) => {
    await runChainInternal(nodeId, undefined, options);
  }, [runChainInternal]);

  return {
    pendingFlow,
    uploadNodeAsset,
    runNode,
    refreshNodeResult,
    runChain,
  };
}
