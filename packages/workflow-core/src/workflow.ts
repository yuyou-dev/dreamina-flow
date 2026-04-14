import { createDefaultParams } from "./flow.js";
import { normalizeNodesForDefinitions } from "./paramRules.js";
import { buildRuntimeEdges } from "./runtimeEdges.js";
import { WORKFLOW_SCHEMA, WORKFLOW_SCHEMA_VERSION } from "./types.js";
import type {
  AdapterStatus,
  Artifact,
  FlowEdge,
  FlowNode,
  NodeDefinition,
  WorkflowAssetRef,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowImportResult,
  WorkflowMeta,
  WorkflowNode,
  WorkflowViewport,
} from "./types.js";

const APP_NAME = "Vibe Workflow Studio";
const MEDIA_INPUT_NODE_TYPES = new Set(["input_image", "input_video", "input_audio"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowAssetRef(value: unknown): value is WorkflowAssetRef {
  return isRecord(value) && typeof value.kind === "string" && typeof value.source === "string" && typeof value.name === "string";
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function createIdleExecution() {
  return { status: "idle" as const, artifacts: [] };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "workflow";
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeViewport(value: unknown): WorkflowViewport {
  if (!isRecord(value)) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const x = typeof value.x === "number" ? value.x : 0;
  const y = typeof value.y === "number" ? value.y : 0;
  const zoom = typeof value.zoom === "number" && Number.isFinite(value.zoom) ? value.zoom : 1;
  return { x, y, zoom };
}

export function defaultWorkflowMeta(status?: AdapterStatus | null): WorkflowMeta {
  return {
    id: "starter-text-to-image",
    title: "Starter Text To Image",
    summary: "Minimal starter graph with a prompt, one image generator, and one image output.",
    tags: ["starter", "text2image"],
    difficulty: "starter",
    intendedShowcase: "Minimal authoring example",
    createdWith: {
      app: APP_NAME,
      cliVersion: status?.cliVersion ?? null,
      wrapperVersion: status?.wrapperVersion ?? null,
    },
    requirements: {
      nodeTypes: ["input_text", "text2image", "output_image"],
      cliVersion: status?.cliVersion ?? null,
      wrapperVersion: status?.wrapperVersion ?? null,
    },
  };
}

function requirementNodeTypes(nodes: Array<{ nodeType: string }>): string[] {
  return [...new Set(nodes.map((node) => node.nodeType))].sort();
}

function assetToWorkflowAssetRef(asset: Artifact): WorkflowAssetRef {
  return {
    kind: asset.kind as WorkflowAssetRef["kind"],
    source: asset.source === "upload" ? "upload" : "generated",
    name: asset.filename,
    mimeType: asset.mimeType,
    assetId: asset.assetId,
    localPath: asset.localPath,
    previewUrl: asset.previewUrl,
  };
}

function assetRefToArtifact(assetRef: WorkflowAssetRef): Artifact | null {
  if (!assetRef.assetId || !assetRef.localPath || !assetRef.previewUrl) {
    return null;
  }
  return {
    assetId: assetRef.assetId,
    kind: assetRef.kind,
    filename: assetRef.name,
    localPath: assetRef.localPath,
    previewUrl: assetRef.previewUrl,
    mimeType: assetRef.mimeType ?? `${assetRef.kind}/*`,
    source: assetRef.source === "upload" ? "upload" : "result",
  };
}

function normalizeNodeValuesForSave(node: FlowNode): Record<string, unknown> {
  const values = cloneRecord(node.data.values);
  if (!MEDIA_INPUT_NODE_TYPES.has(node.data.nodeType)) {
    return values;
  }
  const asset = values.asset;
  const assetRef = isWorkflowAssetRef(values.assetRef) ? values.assetRef : undefined;
  delete values.asset;
  if (asset && isRecord(asset) && typeof asset.assetId === "string" && typeof asset.localPath === "string" && typeof asset.previewUrl === "string" && typeof asset.filename === "string" && typeof asset.kind === "string" && typeof asset.mimeType === "string") {
    values.assetRef = assetToWorkflowAssetRef(asset as unknown as Artifact);
    return values;
  }
  if (assetRef) {
    values.assetRef = assetRef;
  }
  return values;
}

export function normalizeWorkflowMeta(meta: WorkflowMeta | null, nodes: Array<{ nodeType: string }>, status?: AdapterStatus | null): WorkflowMeta {
  const fallback = defaultWorkflowMeta(status);
  const title = meta?.title?.trim() || fallback.title;
  return {
    id: meta?.id?.trim() || slugify(title),
    title,
    summary: meta?.summary?.trim() || fallback.summary,
    tags: meta?.tags?.length ? [...meta.tags] : fallback.tags,
    difficulty: meta?.difficulty ?? fallback.difficulty,
    intendedShowcase: meta?.intendedShowcase ?? fallback.intendedShowcase,
    createdWith: {
      app: APP_NAME,
      cliVersion: status?.cliVersion ?? meta?.createdWith?.cliVersion ?? null,
      wrapperVersion: status?.wrapperVersion ?? meta?.createdWith?.wrapperVersion ?? null,
    },
    requirements: {
      nodeTypes: requirementNodeTypes(nodes),
      cliVersion: status?.cliVersion ?? meta?.requirements?.cliVersion ?? null,
      wrapperVersion: status?.wrapperVersion ?? meta?.requirements?.wrapperVersion ?? null,
    },
  };
}

export function buildStarterWorkflow(definitions: Record<string, NodeDefinition>, status?: AdapterStatus | null): WorkflowDocument {
  if (!definitions.text2image) {
    return {
      schema: WORKFLOW_SCHEMA,
      version: WORKFLOW_SCHEMA_VERSION,
      meta: defaultWorkflowMeta(status),
      viewport: { x: 0, y: 0, zoom: 1 },
      groups: [],
      nodes: [],
      edges: [],
    };
  }

  const nodes = [
    {
      id: "n1",
      nodeType: "input_text",
      position: { x: 60, y: 100 },
      label: "Prompt Source",
      note: "Edit this prompt to drive the starter workflow.",
      params: {},
      values: { text: "A cinematic product shot of a silver ring on a clean studio stage." },
    },
    {
      id: "n2",
      nodeType: "text2image",
      position: { x: 430, y: 100 },
      label: "Primary Generation",
      note: "Starter image generator.",
      params: createDefaultParams(definitions.text2image),
      values: {},
    },
    {
      id: "n3",
      nodeType: "output_image",
      position: { x: 800, y: 100 },
      label: "Image Preview",
      note: "Preview the generated result.",
      params: {},
      values: {},
    },
  ];

  return {
    schema: WORKFLOW_SCHEMA,
    version: WORKFLOW_SCHEMA_VERSION,
    meta: normalizeWorkflowMeta(defaultWorkflowMeta(status), nodes, status),
    viewport: { x: 0, y: 0, zoom: 1 },
    groups: [
      { id: "starter-sources", label: "Sources", nodeIds: ["n1"] },
      { id: "starter-processing", label: "Processing", nodeIds: ["n2"] },
      { id: "starter-output", label: "Outputs", nodeIds: ["n3"] },
    ],
    nodes,
    edges: [
      { id: "e1", source: "n1", sourceHandle: "text", target: "n2", targetHandle: "prompt" },
      { id: "e2", source: "n2", sourceHandle: "image", target: "n3", targetHandle: "image" },
    ],
  };
}

export function serializeWorkflow({
  nodes,
  edges,
  meta,
  groups,
  viewport,
  definitions,
  status,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  meta: WorkflowMeta | null;
  groups: WorkflowGroup[];
  viewport: WorkflowViewport;
  definitions: Record<string, NodeDefinition>;
  status?: AdapterStatus | null;
}): WorkflowDocument {
  const runtimeNodes: WorkflowNode[] = nodes.map((node) => ({
    id: node.id,
    nodeType: node.data.nodeType,
    position: node.position ?? { x: 0, y: 0 },
    label: node.data.label,
    note: node.data.note,
    params: { ...node.data.params },
    values: normalizeNodeValuesForSave(node),
  }));

  const runtimeEdges = buildRuntimeEdges(edges, nodes, definitions);
  const workflowEdges: WorkflowEdge[] = edges.map((edge, index) => {
    const runtimeEdge = runtimeEdges[index];
    return {
      id: edge.id ?? `edge_${index}`,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      order: runtimeEdge?.order,
      label: edge.label,
    };
  });

  return {
    schema: WORKFLOW_SCHEMA,
    version: WORKFLOW_SCHEMA_VERSION,
    meta: normalizeWorkflowMeta(meta, runtimeNodes, status),
    viewport,
    groups,
    nodes: runtimeNodes,
    edges: workflowEdges,
  };
}

function collectKnownMetaKeys(meta: Record<string, unknown>, warnings: string[]) {
  const knownKeys = new Set(["id", "title", "summary", "tags", "difficulty", "intendedShowcase", "createdWith", "requirements"]);
  Object.keys(meta)
    .filter((key) => !knownKeys.has(key))
    .forEach((key) => warnings.push(`Unknown workflow meta field ignored: ${key}.`));
}

function buildWorkflowMeta(value: unknown): WorkflowMeta {
  if (!isRecord(value)) {
    return defaultWorkflowMeta();
  }
  return {
    id: typeof value.id === "string" ? value.id : "imported-workflow",
    title: typeof value.title === "string" ? value.title : "Imported Workflow",
    summary: typeof value.summary === "string" ? value.summary : "Imported workflow.",
    tags: safeStringArray(value.tags),
    difficulty: value.difficulty === "starter" || value.difficulty === "intermediate" || value.difficulty === "advanced" ? value.difficulty : "starter",
    intendedShowcase: typeof value.intendedShowcase === "string" ? value.intendedShowcase : undefined,
    createdWith: isRecord(value.createdWith)
      ? {
        app: typeof value.createdWith.app === "string" ? value.createdWith.app : APP_NAME,
        cliVersion: typeof value.createdWith.cliVersion === "string" ? value.createdWith.cliVersion : null,
        wrapperVersion: typeof value.createdWith.wrapperVersion === "number" ? value.createdWith.wrapperVersion : null,
      }
      : { app: APP_NAME, cliVersion: null, wrapperVersion: null },
    requirements: isRecord(value.requirements)
      ? {
        nodeTypes: safeStringArray(value.requirements.nodeTypes),
        cliVersion: typeof value.requirements.cliVersion === "string" ? value.requirements.cliVersion : null,
        wrapperVersion: typeof value.requirements.wrapperVersion === "number" ? value.requirements.wrapperVersion : null,
      }
      : { nodeTypes: [] },
  };
}

export function sanitizeImportedWorkflow(document: unknown, definitions: Record<string, NodeDefinition>): WorkflowImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const emptyResult: WorkflowImportResult = {
    errors,
    warnings,
    meta: defaultWorkflowMeta(),
    viewport: { x: 0, y: 0, zoom: 1 },
    groups: [],
    nodes: [],
    edges: [],
  };

  if (!isRecord(document)) {
    errors.push("Workflow file must be a JSON object.");
    return emptyResult;
  }

  if (document.schema !== WORKFLOW_SCHEMA) {
    errors.push(`Unsupported workflow schema: ${String(document.schema ?? "missing")}.`);
  }
  if (document.version !== WORKFLOW_SCHEMA_VERSION) {
    errors.push(`Unsupported workflow version: ${String(document.version ?? "missing")}.`);
  }

  const meta = buildWorkflowMeta(document.meta);
  if (isRecord(document.meta)) {
    collectKnownMetaKeys(document.meta, warnings);
  }
  const viewport = normalizeViewport(document.viewport);

  const rawNodes = Array.isArray(document.nodes) ? document.nodes : [];
  const rawEdges = Array.isArray(document.edges) ? document.edges : [];
  const groups = Array.isArray(document.groups)
    ? document.groups
      .filter(isRecord)
      .map((group) => ({
        id: typeof group.id === "string" ? group.id : `group_${Math.random().toString(36).slice(2, 8)}`,
        label: typeof group.label === "string" ? group.label : "Group",
        nodeIds: safeStringArray(group.nodeIds),
        note: typeof group.note === "string" ? group.note : undefined,
        color: typeof group.color === "string" ? group.color : undefined,
      }))
    : [];

  if (!Array.isArray(document.nodes) || rawNodes.length === 0) {
    errors.push("Workflow file must include a non-empty nodes array.");
  }
  if (!Array.isArray(document.edges)) {
    errors.push("Workflow file must include an edges array.");
  }

  const workflowNodes = rawNodes
    .filter(isRecord)
    .map((node) => ({
      id: typeof node.id === "string" ? node.id : "",
      nodeType: typeof node.nodeType === "string" ? node.nodeType : "",
      position: isRecord(node.position)
        ? {
          x: typeof node.position.x === "number" ? node.position.x : 0,
          y: typeof node.position.y === "number" ? node.position.y : 0,
        }
        : { x: 0, y: 0 },
      label: typeof node.label === "string" ? node.label : undefined,
      note: typeof node.note === "string" ? node.note : undefined,
      params: cloneRecord(node.params),
      values: cloneRecord(node.values),
    }));

  const nodesById = new Map(workflowNodes.map((node) => [node.id, node]));

  workflowNodes.forEach((node) => {
    if (!node.id) {
      errors.push("Workflow node is missing id.");
      return;
    }
    if (!node.nodeType) {
      errors.push(`Workflow node ${node.id} is missing nodeType.`);
      return;
    }
    if (!definitions[node.nodeType]) {
      errors.push(`Unknown nodeType in workflow: ${node.nodeType}.`);
    }
    if (MEDIA_INPUT_NODE_TYPES.has(node.nodeType)) {
      const assetRef = node.values.assetRef;
      if (assetRef !== undefined && !isWorkflowAssetRef(assetRef)) {
        errors.push(`Media input node ${node.id} has invalid assetRef.`);
      }
    }
  });

  const workflowEdges = rawEdges
    .filter(isRecord)
    .map((edge, index) => ({
      id: typeof edge.id === "string" ? edge.id : `edge_${index}`,
      source: typeof edge.source === "string" ? edge.source : "",
      sourceHandle: typeof edge.sourceHandle === "string" ? edge.sourceHandle : null,
      target: typeof edge.target === "string" ? edge.target : "",
      targetHandle: typeof edge.targetHandle === "string" ? edge.targetHandle : null,
      order: typeof edge.order === "number" ? edge.order : undefined,
      label: typeof edge.label === "string" ? edge.label : undefined,
    }));

  workflowEdges.forEach((edge) => {
    if (!edge.source || !nodesById.has(edge.source)) {
      errors.push(`Workflow edge ${edge.id} references unknown source node.`);
      return;
    }
    if (!edge.target || !nodesById.has(edge.target)) {
      errors.push(`Workflow edge ${edge.id} references unknown target node.`);
      return;
    }
    const sourceNode = nodesById.get(edge.source)!;
    const targetNode = nodesById.get(edge.target)!;
    const sourceDef = definitions[sourceNode.nodeType];
    const targetDef = definitions[targetNode.nodeType];
    const sourceOutput = sourceDef?.outputs.find((output) => output.id === edge.sourceHandle);
    const targetInput = targetDef?.inputs.find((input) => input.id === edge.targetHandle);
    if (!sourceOutput) {
      errors.push(`Workflow edge ${edge.id} references invalid source handle ${String(edge.sourceHandle)}.`);
      return;
    }
    if (!targetInput) {
      errors.push(`Workflow edge ${edge.id} references invalid target handle ${String(edge.targetHandle)}.`);
      return;
    }
    if (sourceOutput.type !== targetInput.type) {
      errors.push(`Workflow edge ${edge.id} connects incompatible data types.`);
    }
  });

  const incomingByHandle = new Map<string, WorkflowEdge[]>();
  workflowEdges.forEach((edge) => {
    const key = `${edge.target}:${edge.targetHandle ?? ""}`;
    const items = incomingByHandle.get(key) ?? [];
    items.push(edge);
    incomingByHandle.set(key, items);
  });

  incomingByHandle.forEach((incomingEdges, key) => {
    const [targetId, targetHandle] = key.split(":");
    const targetNode = nodesById.get(targetId);
    const targetDef = targetNode ? definitions[targetNode.nodeType] : undefined;
    const input = targetDef?.inputs.find((entry) => entry.id === targetHandle);
    if (!input) {
      return;
    }
    if (!input.multiple && incomingEdges.length > 1) {
      errors.push(`Input ${targetHandle} on node ${targetId} does not accept multiple connections.`);
      return;
    }
    if (input.multiple && incomingEdges.length > 1) {
      const orders = incomingEdges.map((edge) => edge.order);
      if (orders.some((order) => order === undefined)) {
        errors.push(`Input ${targetHandle} on node ${targetId} requires explicit order for every incoming edge.`);
        return;
      }
      const uniqueOrders = new Set(orders);
      if (uniqueOrders.size !== incomingEdges.length) {
        errors.push(`Input ${targetHandle} on node ${targetId} has duplicate edge order values.`);
      }
    }
  });

  workflowNodes.forEach((node) => {
    if (node.nodeType !== "multiframe2video") {
      return;
    }
    const imageEdges = incomingByHandle.get(`${node.id}:images`) ?? [];
    const transitionEdges = incomingByHandle.get(`${node.id}:transition_prompt`) ?? [];
    const transitionDurations = Array.isArray(node.params.transition_duration)
      ? node.params.transition_duration.filter((value) => typeof value === "number")
      : [];

    if (imageEdges.length >= 3 && transitionEdges.length !== imageEdges.length - 1) {
      errors.push(`multiframe2video node ${node.id} requires ${imageEdges.length - 1} transition_prompt inputs for ${imageEdges.length} images.`);
    }
    if (imageEdges.length >= 3 && transitionDurations.length > 0 && transitionDurations.length !== imageEdges.length - 1) {
      errors.push(`multiframe2video node ${node.id} requires either 0 or ${imageEdges.length - 1} transition_duration values.`);
    }
  });

  if (errors.length > 0) {
    return {
      errors,
      warnings,
      meta,
      viewport,
      groups,
      nodes: [],
      edges: [],
    };
  }

  const importedNodes: FlowNode[] = workflowNodes.map((node) => {
    const values = { ...node.values };
    if (MEDIA_INPUT_NODE_TYPES.has(node.nodeType) && isWorkflowAssetRef(values.assetRef)) {
      const hydrated = assetRefToArtifact(values.assetRef);
      if (hydrated) {
        values.asset = hydrated;
      } else {
        warnings.push(`Input node ${node.label ?? node.id} references a media asset placeholder. Re-upload the file before running this workflow.`);
      }
    }
    return {
      id: node.id,
      type: "studio",
      position: node.position,
      data: {
        nodeType: node.nodeType,
        label: node.label,
        note: node.note,
        params: { ...node.params },
        values,
        execution: createIdleExecution(),
      },
    };
  });

  const normalized = normalizeNodesForDefinitions(importedNodes, definitions);
  warnings.push(...normalized.warnings);

  return {
    errors,
    warnings,
    meta: normalizeWorkflowMeta(meta, workflowNodes),
    viewport,
    groups,
    nodes: normalized.nodes,
    edges: workflowEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      order: edge.order,
      label: edge.label,
    })),
  };
}

export function compareWorkflowCompatibility(
  meta: WorkflowMeta,
  status: AdapterStatus | null,
  definitions?: Record<string, NodeDefinition>,
): string[] {
  const warnings: string[] = [];
  if (status?.cliVersion && meta.createdWith.cliVersion && status.cliVersion !== meta.createdWith.cliVersion) {
    warnings.push(`Workflow was authored with CLI ${meta.createdWith.cliVersion}, current runtime reports ${status.cliVersion}.`);
  }
  if (status?.wrapperVersion != null && meta.createdWith.wrapperVersion != null && status.wrapperVersion !== meta.createdWith.wrapperVersion) {
    warnings.push(`Workflow was authored with wrapper ${meta.createdWith.wrapperVersion}, current runtime reports ${status.wrapperVersion}.`);
  }
  if (definitions) {
    const missingNodeTypes = meta.requirements.nodeTypes.filter((nodeType) => !definitions[nodeType]);
    if (missingNodeTypes.length > 0) {
      warnings.push(`Workflow references unavailable capability types: ${missingNodeTypes.join(", ")}.`);
    }
  }
  return warnings;
}
