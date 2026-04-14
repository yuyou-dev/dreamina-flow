import { isProcessorNode } from "./catalog.js";
import type { FlowEdge, FlowNode } from "./types.js";

function nodeById(nodes: FlowNode[], nodeId: string): FlowNode | undefined {
  return nodes.find((node) => node.id === nodeId);
}

export function processorChainForTarget(targetNodeId: string, nodes: FlowNode[], edges: FlowEdge[]): string[][] {
  const targetNode = nodeById(nodes, targetNodeId);
  if (!targetNode || !isProcessorNode(targetNode.data.nodeType)) {
    return [];
  }

  const relevantNodes = new Set<string>();
  
  function collect(id: string) {
    if (relevantNodes.has(id)) {
      return;
    }
    relevantNodes.add(id);
    const upstream = edges
      .filter((edge) => edge.target === id)
      .map((edge) => nodeById(nodes, edge.source))
      .filter((candidate): candidate is FlowNode => {
        return !!candidate && isProcessorNode(candidate.data.nodeType);
      });
    upstream.forEach((n) => collect(n.id));
  }

  collect(targetNodeId);

  const inDegree: Record<string, number> = {};
  const graph: Record<string, string[]> = {};

  for (const id of relevantNodes) {
    inDegree[id] = 0;
    graph[id] = [];
  }

  for (const id of relevantNodes) {
    const upstream = edges
      .filter((edge) => edge.target === id)
      .map((edge) => edge.source)
      .filter((sourceId) => relevantNodes.has(sourceId));
    
    for (const depId of upstream) {
      if (!graph[depId]) graph[depId] = [];
      graph[depId].push(id);
      inDegree[id]++;
    }
  }

  const batches: string[][] = [];
  let currentBatch = Object.keys(inDegree).filter((id) => inDegree[id] === 0);

  while (currentBatch.length > 0) {
    batches.push(currentBatch);
    const nextBatch: string[] = [];
    for (const node of currentBatch) {
      for (const child of graph[node] || []) {
        inDegree[child]--;
        if (inDegree[child] === 0) {
          nextBatch.push(child);
        }
      }
    }
    currentBatch = nextBatch;
  }

  return batches;
}
