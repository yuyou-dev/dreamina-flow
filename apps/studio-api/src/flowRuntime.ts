import { isInputNode } from "./catalog.js";
import type { FlowEdge, FlowNode, NodeDefinition, ResolvedInputValue } from "./types.js";

type RawFlowEdge = FlowEdge & {
  data?: {
    order?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFlowEdge(value: unknown): FlowEdge | null {
  if (!isRecord(value) || typeof value.source !== "string" || typeof value.target !== "string") {
    return null;
  }

  const raw = value as unknown as RawFlowEdge;
  const nestedOrder = isRecord(raw.data) && typeof raw.data.order === "number" ? raw.data.order : undefined;

  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    source: raw.source,
    sourceHandle: typeof raw.sourceHandle === "string" ? raw.sourceHandle : null,
    target: raw.target,
    targetHandle: typeof raw.targetHandle === "string" ? raw.targetHandle : null,
    order: typeof raw.order === "number" ? raw.order : nestedOrder,
  };
}

export function normalizeFlowEdges(edges: unknown): FlowEdge[] {
  if (!Array.isArray(edges)) {
    return [];
  }
  return edges
    .map((edge) => normalizeFlowEdge(edge))
    .filter((edge): edge is FlowEdge => edge !== null);
}

export function sortEdgesForInput(edges: FlowEdge[]): FlowEdge[] {
  return edges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftOrder = left.edge.order;
      const rightOrder = right.edge.order;
      if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (leftOrder !== undefined && rightOrder === undefined) {
        return -1;
      }
      if (leftOrder === undefined && rightOrder !== undefined) {
        return 1;
      }
      return left.index - right.index;
    })
    .map(({ edge }) => edge);
}

function selectedArtifactInput(sourceNode: FlowNode, expectedKind: Exclude<ResolvedInputValue["kind"], "text">): ResolvedInputValue[] {
  const selectedId = sourceNode.data.values?.selectedArtifactId;
  const artifacts = sourceNode.data.execution?.artifacts ?? [];
  const matches = artifacts.filter((artifact) => artifact.kind === expectedKind);
  const artifact = (typeof selectedId === "string" ? matches.find((item) => item.assetId === selectedId) : undefined) ?? matches[0];
  if (!artifact) {
    return [];
  }
  return [{
    kind: expectedKind,
    assetId: artifact.assetId,
    localPath: artifact.localPath,
    previewUrl: artifact.previewUrl,
    filename: artifact.filename,
  }];
}

export function resolveFlowNodeInputs(
  nodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  command: NodeDefinition,
): Record<string, ResolvedInputValue[]> {
  const currentNodesById = new Map(nodes.map((node) => [node.id, node]));
  const resolvedInputs: Record<string, ResolvedInputValue[]> = {};

  command.inputs.forEach((input) => {
    const matchingEdges = sortEdgesForInput(edges.filter((edge) => edge.target === nodeId && edge.targetHandle === input.id));
    resolvedInputs[input.id] = matchingEdges.flatMap((edge) => {
      const sourceNode = currentNodesById.get(edge.source);
      if (!sourceNode) {
        return [];
      }

      if (isInputNode(sourceNode.data.nodeType)) {
        if (sourceNode.data.nodeType === "input_text") {
          const text = String(sourceNode.data.values?.text ?? "").trim();
          return text ? [{ kind: "text", text }] : [];
        }
        const asset = sourceNode.data.values?.asset;
        return asset && typeof asset === "object" ? [asset as ResolvedInputValue] : [];
      }

      if (input.type === "text") {
        return [];
      }

      return selectedArtifactInput(sourceNode, input.type);
    });
  });

  return resolvedInputs;
}
