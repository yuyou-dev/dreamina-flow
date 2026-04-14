import type { FlowEdge, NodeDefinition } from "./types.js";

type OrderedEdgeLike = FlowEdge & {
  data?: {
    order?: number;
  };
};

function edgeOrder(edge: OrderedEdgeLike): number | undefined {
  return typeof edge.data?.order === "number" ? edge.data.order : edge.order;
}

export function sortInputEdges<T extends OrderedEdgeLike>(edges: T[]): T[] {
  return edges
    .map((edge, index) => ({ edge, index }))
    .sort((left, right) => {
      const leftOrder = edgeOrder(left.edge);
      const rightOrder = edgeOrder(right.edge);
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

export function buildRuntimeEdges<T extends OrderedEdgeLike>(
  edges: T[],
  nodes: Array<{ id: string; data: { nodeType: string } }>,
  definitions: Record<string, NodeDefinition>,
): FlowEdge[] {
  const nodeTypeById = new Map(nodes.map((node) => [node.id, node.data.nodeType]));
  const multipleAssignments = new Map<T, number>();
  const grouped = new Map<string, T[]>();

  edges.forEach((edge) => {
    const key = `${edge.target}:${edge.targetHandle ?? ""}`;
    const list = grouped.get(key) ?? [];
    list.push(edge);
    grouped.set(key, list);
  });

  grouped.forEach((groupEdges, key) => {
    const [targetId, targetHandle] = key.split(":");
    const targetNodeType = nodeTypeById.get(targetId);
    const targetDef = targetNodeType ? definitions[targetNodeType] : undefined;
    const input = targetDef?.inputs.find((entry) => entry.id === targetHandle);
    if (!input?.multiple) {
      return;
    }
    sortInputEdges(groupEdges).forEach((edge, index) => {
      multipleAssignments.set(edge, index);
    });
  });

  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    order: multipleAssignments.get(edge),
  }));
}
