import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type {
  AdapterLoginMode,
  AdapterLoginSession,
  AdapterStatus,
  NodeDefinition,
  PendingResumeAction,
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
  WorkflowRunActionOptions,
} from "../types";

export interface WorkflowStudioContextValue {
  definitions: Record<string, NodeDefinition>;
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  runtimeStatus: AdapterStatus | null;
  runNode: (nodeId: string, options?: WorkflowRunActionOptions) => Promise<void>;
  runChain: (nodeId: string, options?: WorkflowRunActionOptions) => Promise<void>;
  refreshNodeResult: (nodeId: string) => Promise<void>;
  uploadNodeAsset: (nodeId: string, file: File) => Promise<void>;
  updateNodeParams: (nodeId: string, key: string, value: unknown) => void;
  updateNodeValues: (nodeId: string, values: Record<string, unknown>) => void;
  deleteNode: (nodeId: string) => void;
  isSystemStatusOpen: boolean;
  openSystemStatus: () => void;
  closeSystemStatus: () => void;
  startAdapterLogin: (mode: AdapterLoginMode) => Promise<void>;
  adapterLoginSession: AdapterLoginSession | null;
  pendingResumeAction: PendingResumeAction | null;
}

const WorkflowStudioContext = createContext<WorkflowStudioContextValue | null>(null);

export function WorkflowStudioProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: WorkflowStudioContextValue;
}) {
  return <WorkflowStudioContext.Provider value={value}>{children}</WorkflowStudioContext.Provider>;
}

export function useWorkflowStudioContext(): WorkflowStudioContextValue {
  const context = useContext(WorkflowStudioContext);
  if (!context) {
    throw new Error("WorkflowStudioContext is not available.");
  }
  return context;
}
