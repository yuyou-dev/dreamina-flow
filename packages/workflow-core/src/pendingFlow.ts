import type { FlowNode, NodeExecution, WorkflowRunResult } from "./types.js";

export interface PendingFlowState {
  targetNodeId: string;
  runId: string;
  pendingNodeIds: string[];
}

export type PendingFlowDecision =
  | { type: "wait" }
  | { type: "resume"; targetNodeId: string; runId: string }
  | { type: "stop"; error: string; failedNodeId?: string };

export function mergeWorkflowRunNodeResults(
  nodes: FlowNode[],
  nodeResults: Record<string, NodeExecution>,
): FlowNode[] {
  return nodes.map((node) =>
    nodeResults[node.id]
      ? {
          ...node,
          data: {
            ...node.data,
            execution: {
              ...node.data.execution,
              ...nodeResults[node.id],
            },
          },
        }
      : node,
  );
}

export function nextPendingFlowState(
  currentPendingFlow: PendingFlowState | null,
  result: WorkflowRunResult,
  targetNodeId: string,
): PendingFlowState | null {
  if (result.pendingNodeIds?.length) {
    return {
      targetNodeId,
      runId: result.runId,
      pendingNodeIds: result.pendingNodeIds,
    };
  }

  return currentPendingFlow?.runId === result.runId ? null : currentPendingFlow;
}

function pendingFlowStopMessage(nodeId?: string): string {
  return `Flow auto-resume stopped because node ${nodeId ?? "unknown"} failed. Check the node log and retry from that node.`;
}

export function decidePendingFlowAction(
  pendingFlow: PendingFlowState | null,
  nodes: FlowNode[],
): PendingFlowDecision {
  if (!pendingFlow) {
    return { type: "wait" };
  }

  const pendingExecutions = pendingFlow.pendingNodeIds
    .map((nodeId) => ({ nodeId, execution: nodes.find((node) => node.id === nodeId)?.data.execution }))
    .filter((entry) => entry.execution);

  const failedNode = pendingExecutions.find((entry) => entry.execution?.status === "fail");
  if (failedNode) {
    return {
      type: "stop",
      failedNodeId: failedNode.nodeId,
      error: pendingFlowStopMessage(failedNode.nodeId),
    };
  }

  if (
    pendingExecutions.length === pendingFlow.pendingNodeIds.length
    && pendingExecutions.length > 0
    && pendingExecutions.every((entry) => entry.execution?.status === "success")
  ) {
    return {
      type: "resume",
      targetNodeId: pendingFlow.targetNodeId,
      runId: pendingFlow.runId,
    };
  }

  return { type: "wait" };
}
