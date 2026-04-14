export type DataType = "image" | "video" | "audio" | "text";
export type NodeCategory = "input" | "processor" | "output";
export type NodeParamType = "string" | "number" | "boolean" | "select";
export type ExecutionStatus = "idle" | "validating" | "running" | "querying" | "success" | "fail";
export type WorkflowDifficulty = "starter" | "intermediate" | "advanced";

export const WORKFLOW_SCHEMA = "workflow.document/v1alpha1";
export const WORKFLOW_SCHEMA_VERSION = 1;

export interface NodePort {
  id: string;
  label: string;
  type: DataType;
  multiple?: boolean;
  required?: boolean;
}

export interface NodeParamDefinition {
  key: string;
  label: string;
  type: NodeParamType;
  required?: boolean;
  multiple?: boolean;
  choices?: string[];
  min?: number;
  max?: number;
  default?: unknown;
  pathMode?: "file" | "dir" | null;
}

export interface NodeDefinition {
  name: string;
  title: string;
  category: NodeCategory;
  description: string;
  inputs: NodePort[];
  outputs: NodePort[];
  params: NodeParamDefinition[];
  defaults: Record<string, unknown>;
  outputMode: string;
  wrapperAvailable: boolean;
  rawCliAvailable: boolean;
  constraints: Record<string, unknown>;
  warnings: string[];
  rawHelp?: string;
}

export interface AdapterStatus {
  backendReady: boolean;
  cliFound: boolean;
  cliPath: string | null;
  cliVersion: string | null;
  wrapperVersion: number | null;
  adapterName: string;
  logDirectory?: string | null;
  auth: AdapterAuthStatus;
}

export interface AdapterCredits {
  vipCredit: number;
  giftCredit: number;
  purchaseCredit: number;
  totalCredit: number;
}

export interface AdapterAuthStatus {
  loggedIn: boolean;
  credits: AdapterCredits | null;
  lastCheckedAt?: string | null;
  message?: string | null;
}

export type AdapterLoginMode = "login" | "relogin";
export type AdapterLoginPhase = "pending" | "success" | "fail";

export interface AdapterLoginSession {
  sessionId: string;
  mode: AdapterLoginMode;
  phase: AdapterLoginPhase;
  qrText: string | null;
  qrImageDataUrl?: string | null;
  message: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface Artifact {
  assetId: string;
  kind: DataType;
  filename: string;
  localPath: string;
  previewUrl: string;
  mimeType: string;
  source: "upload" | "result";
  width?: number;
  height?: number;
  duration?: number;
}

export interface ResolvedTextInput {
  kind: "text";
  text: string;
}

export interface ResolvedMediaInput {
  kind: Exclude<DataType, "text">;
  assetId?: string;
  localPath: string;
  previewUrl?: string;
  filename?: string;
}

export type ResolvedInputValue = ResolvedTextInput | ResolvedMediaInput;

export interface ExecutionHealth {
  submitAttempts?: number;
  queryAttempts?: number;
  submitRecovered?: boolean;
  pendingReason?: string;
  lastUpdatedAt?: string;
  logFile?: string;
}

export interface NodeExecution {
  status: ExecutionStatus;
  submitId?: string;
  runId?: string;
  artifacts?: Artifact[];
  error?: string;
  cliArgs?: string[];
  result?: unknown;
  health?: ExecutionHealth;
}

export interface FlowNodeData extends Record<string, unknown> {
  nodeType: string;
  label?: string;
  note?: string;
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  execution?: NodeExecution;
}

export interface FlowNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id?: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  order?: number;
  label?: string;
}

export interface ValidationResult {
  ok: boolean;
  normalizedParams: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

export interface WorkflowRunResult {
  ok: boolean;
  runId: string;
  targetNodeId: string;
  nodeResults: Record<string, NodeExecution>;
  executedNodeIds: string[];
  pendingNodeIds?: string[];
  error?: string;
}

export interface WrapperCommandResponse<T = unknown> {
  ok: boolean;
  command: string;
  cli_args?: string[];
  cliArgs?: string[];
  data?: T;
  error?: string;
  details?: string[];
  dry_run?: boolean;
}

export interface UploadAssetResponse extends Artifact {
  mediaMeta: {
    width?: number;
    height?: number;
    duration?: number;
  };
}

export interface WorkflowAssetRef {
  kind: Exclude<DataType, "text">;
  source: "upload" | "file" | "remote" | "generated";
  name: string;
  mimeType?: string;
  assetId?: string;
  localPath?: string;
  previewUrl?: string;
  note?: string;
}

export interface WorkflowRequirements {
  nodeTypes: string[];
  cliVersion?: string | null;
  wrapperVersion?: number | null;
}

export interface WorkflowMeta {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  difficulty: WorkflowDifficulty;
  intendedShowcase?: string;
  createdWith: {
    app: string;
    cliVersion?: string | null;
    wrapperVersion?: number | null;
  };
  requirements: WorkflowRequirements;
}

export interface WorkflowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkflowGroup {
  id: string;
  label: string;
  nodeIds: string[];
  note?: string;
  color?: string;
}

export interface WorkflowNode {
  id: string;
  nodeType: string;
  position: { x: number; y: number };
  label?: string;
  note?: string;
  params: Record<string, unknown>;
  values: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  order?: number;
  label?: string;
}

export interface WorkflowDocument {
  schema: typeof WORKFLOW_SCHEMA;
  version: typeof WORKFLOW_SCHEMA_VERSION;
  meta: WorkflowMeta;
  viewport: WorkflowViewport;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
}

export interface WorkflowTemplateSummary {
  id: string;
  title: string;
  summary: string;
  filename: string;
  url: string;
}

export interface WorkflowImportResult {
  errors: string[];
  warnings: string[];
  meta: WorkflowMeta;
  viewport: WorkflowViewport;
  groups: WorkflowGroup[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface PreparedWorkflowDocument {
  warnings: string[];
  meta: WorkflowMeta;
  groups: WorkflowGroup[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: WorkflowViewport;
}

export interface SuccessfulWorkflowDocumentPreparation {
  ok: true;
  workflow: PreparedWorkflowDocument;
}

export interface FailedWorkflowDocumentPreparation {
  ok: false;
  error: string;
  warnings: string[];
}

export type WorkflowDocumentPreparation = SuccessfulWorkflowDocumentPreparation | FailedWorkflowDocumentPreparation;

export interface WorkflowDownloadPayload {
  filename: string;
  json: string;
  document: WorkflowDocument;
}

export interface NodeCatalogResponse {
  nodes: NodeDefinition[];
  canvasNodes: {
    input: NodeDefinition[];
    processor: NodeDefinition[];
    output: NodeDefinition[];
  };
}

export interface NodeRunResponse {
  ok: boolean;
  command: string;
  data?: unknown;
  error?: string;
  details?: string[];
  runId: string;
  nodeId: string;
  submitId?: string;
  artifacts: Artifact[];
  execution: NodeExecution;
}
