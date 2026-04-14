import dagre from "dagre";
import type { WorkflowCanvasEdge, WorkflowCanvasNode } from "../types";

const FALLBACK_NODE_WIDTH = 260;
const FALLBACK_NODE_HEIGHT = 316;
const BASE_MARGIN = 40;

type MeasuredNode = {
  node: WorkflowCanvasNode;
  width: number;
  height: number;
  layoutX: number;
  layoutY: number;
};

function readNodeDimension(node: WorkflowCanvasNode, key: "width" | "height", fallback: number) {
  const measured = (node as WorkflowCanvasNode & { measured?: { width?: number; height?: number } }).measured;
  const direct = typeof node[key] === "number" ? node[key] : undefined;
  const measuredValue = typeof measured?.[key] === "number" ? measured[key] : undefined;
  return measuredValue ?? direct ?? fallback;
}

function handleDensity(node: WorkflowCanvasNode) {
  const definition = node.data;
  const paramCount = Object.keys(definition.params ?? {}).length;
  const valueCount = Object.keys(definition.values ?? {}).length;
  return Math.max(0, paramCount + valueCount);
}

function degreeByNode(edges: WorkflowCanvasEdge[]) {
  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  });
  return degree;
}

function createMeasuredNodes(nodes: WorkflowCanvasNode[], edges: WorkflowCanvasEdge[], direction: "LR" | "TB"): MeasuredNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 56,
    ranksep: 96,
    marginx: BASE_MARGIN,
    marginy: BASE_MARGIN,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: readNodeDimension(node, "width", FALLBACK_NODE_WIDTH),
      height: readNodeDimension(node, "height", FALLBACK_NODE_HEIGHT),
    });
  });
  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });
  dagre.layout(graph);

  return nodes.map((node) => {
    const graphNode = graph.node(node.id);
    const width = readNodeDimension(node, "width", FALLBACK_NODE_WIDTH);
    const height = readNodeDimension(node, "height", FALLBACK_NODE_HEIGHT);
    return {
      node,
      width,
      height,
      layoutX: graphNode?.x ?? BASE_MARGIN + width / 2,
      layoutY: graphNode?.y ?? BASE_MARGIN + height / 2,
    };
  });
}

function compactHorizontalLayout(nodes: WorkflowCanvasNode[], edges: WorkflowCanvasEdge[]) {
  const measuredNodes = createMeasuredNodes(nodes, edges, "LR");
  const columns = new Map<string, MeasuredNode[]>();
  const degree = degreeByNode(edges);

  measuredNodes.forEach((entry) => {
    const key = String(Math.round(entry.layoutX));
    if (!columns.has(key)) {
      columns.set(key, []);
    }
    columns.get(key)?.push(entry);
  });

  const orderedColumns = [...columns.entries()]
    .map(([key, entries]) => ({
      key: Number(key),
      entries: entries.sort((left, right) => left.layoutY - right.layoutY),
    }))
    .sort((left, right) => left.key - right.key);

  let cursorX = BASE_MARGIN;
  const nextPositions = new Map<string, { x: number; y: number }>();

  orderedColumns.forEach(({ entries }) => {
    const maxWidth = Math.max(...entries.map((entry) => entry.width));
    const edgeLoad = entries.reduce((total, entry) => total + (degree.get(entry.node.id) ?? 0), 0);
    let cursorY = BASE_MARGIN;

    entries.forEach((entry, index) => {
      const localDensity = handleDensity(entry.node);
      const verticalGap = index === 0 ? 0 : 24 + Math.min(28, localDensity * 2);
      cursorY += verticalGap;
      nextPositions.set(entry.node.id, {
        x: cursorX + (maxWidth - entry.width) / 2,
        y: cursorY,
      });
      cursorY += entry.height;
    });

    const columnGap = 54 + Math.ceil(maxWidth * 0.12) + Math.min(42, edgeLoad * 4);
    cursorX += maxWidth + columnGap;
  });

  return nodes.map((node) => ({
    ...node,
    position: nextPositions.get(node.id) ?? node.position,
  }));
}

export function getLayoutedElements(
  nodes: WorkflowCanvasNode[],
  edges: WorkflowCanvasEdge[],
  direction: "LR" | "TB" = "LR",
): { nodes: WorkflowCanvasNode[]; edges: WorkflowCanvasEdge[] } {
  if (nodes.length === 0) {
    return { nodes, edges };
  }

  if (direction === "LR") {
    return {
      nodes: compactHorizontalLayout(nodes, edges),
      edges,
    };
  }

  const measuredNodes = createMeasuredNodes(nodes, edges, "TB");
  return {
    nodes: measuredNodes.map((entry) => ({
      ...entry.node,
      position: {
        x: entry.layoutX - entry.width / 2,
        y: entry.layoutY - entry.height / 2,
      },
    })),
    edges,
  };
}
