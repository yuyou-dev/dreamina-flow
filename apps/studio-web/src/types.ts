import type { Edge, Node } from "@xyflow/react";
import type {
  AdapterStatus,
  FlowNodeData,
  NodeCatalogResponse,
  NodeDefinition,
  NodeExecution,
  NodeRunResponse,
  NodeParamDefinition,
  WorkflowGroup,
  WorkflowMeta,
  WorkflowViewport,
} from "@workflow-studio/workflow-core";

export * from "@workflow-studio/workflow-core";

export type WorkflowCanvasNodeData = FlowNodeData & {
  execution: NodeExecution;
};

export type WorkflowCanvasNode = Node<WorkflowCanvasNodeData>;

export interface WorkflowCanvasEdgeData extends Record<string, unknown> {
  order?: number;
  workflowLabel?: string;
}

export type WorkflowCanvasEdge = Edge<WorkflowCanvasEdgeData>;

export interface WorkflowRunActionOptions {
  resumeAttempted?: boolean;
}

export interface PendingResumeAction {
  kind: "runNode" | "runChain";
  nodeId: string;
}

export interface WorkflowImportResult {
  errors: string[];
  warnings: string[];
  meta: WorkflowMeta;
  viewport: WorkflowViewport;
  groups: WorkflowGroup[];
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
}

export type WorkflowValidationResult = import("@workflow-studio/workflow-core").ValidationResult;
