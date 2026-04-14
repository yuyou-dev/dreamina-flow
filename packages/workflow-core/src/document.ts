import type {
  AdapterStatus,
  FlowEdge,
  FlowNode,
  NodeDefinition,
  WorkflowDocumentPreparation,
  WorkflowDownloadPayload,
  WorkflowGroup,
  WorkflowImportResult,
  WorkflowMeta,
  WorkflowViewport,
} from "./types.js";
import {
  buildStarterWorkflow,
  compareWorkflowCompatibility,
  sanitizeImportedWorkflow,
  serializeWorkflow,
} from "./workflow.js";

function mergePreparationWarnings(
  preparation: WorkflowDocumentPreparation,
  warnings: string[],
): WorkflowDocumentPreparation {
  if (warnings.length === 0) {
    return preparation;
  }

  if (preparation.ok === false) {
    return {
      ok: false,
      error: preparation.error,
      warnings: [...warnings, ...preparation.warnings],
    };
  }

  return {
    ok: true,
    workflow: {
      ...preparation.workflow,
      warnings: [...warnings, ...preparation.workflow.warnings],
    },
  };
}

function finalizePreparation(
  result: WorkflowImportResult,
  definitions: Record<string, NodeDefinition>,
  status?: AdapterStatus | null,
): WorkflowDocumentPreparation {
  if (result.errors.length > 0) {
    return {
      ok: false,
      error: result.errors.join(" "),
      warnings: result.warnings,
    };
  }

  return {
    ok: true,
    workflow: {
      warnings: [...result.warnings, ...compareWorkflowCompatibility(result.meta, status ?? null, definitions)],
      meta: result.meta,
      groups: result.groups,
      nodes: result.nodes,
      edges: result.edges,
      viewport: result.viewport,
    },
  };
}

export function prepareWorkflowDocumentImport(
  payload: unknown,
  definitions: Record<string, NodeDefinition>,
  status?: AdapterStatus | null,
): WorkflowDocumentPreparation {
  return finalizePreparation(sanitizeImportedWorkflow(payload, definitions), definitions, status);
}

export function prepareStarterWorkflowDocument(
  definitions: Record<string, NodeDefinition>,
  status?: AdapterStatus | null,
): WorkflowDocumentPreparation {
  const starterWorkflow = buildStarterWorkflow(definitions, status);
  return prepareWorkflowDocumentImport(starterWorkflow, definitions, status);
}

export function parseWorkflowDocumentText(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export function buildWorkflowDownloadPayload({
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
}): WorkflowDownloadPayload {
  const document = serializeWorkflow({
    nodes,
    edges,
    meta,
    groups,
    viewport,
    definitions,
    status,
  });

  return {
    document,
    json: JSON.stringify(document, null, 2),
    filename: `${(document.meta.id || "workflow").replace(/[^a-zA-Z0-9_-]/g, "-")}.workflow.json`,
  };
}

export function withPreparationWarnings(
  preparation: WorkflowDocumentPreparation,
  warnings: string[],
): WorkflowDocumentPreparation {
  return mergePreparationWarnings(preparation, warnings);
}
