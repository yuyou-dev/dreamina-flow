import { normalizeNodeParams } from "./paramRules.js";
import { sortInputEdges } from "./runtimeEdges.js";
import type { FlowEdge, FlowNode, NodeDefinition, NodeExecution, ResolvedInputValue } from "./types.js";

export function definitionMap(definitions: NodeDefinition[]): Record<string, NodeDefinition> {
  return Object.fromEntries(definitions.map((definition) => [definition.name, definition]));
}

export function createDefaultParams(definition: NodeDefinition): Record<string, unknown> {
  const rawDefaults = definition.params.reduce<Record<string, unknown>>((accumulator, parameter) => {
    if (parameter.default !== undefined) {
      accumulator[parameter.key] = parameter.default;
    } else if (definition.defaults[parameter.key] !== undefined) {
      accumulator[parameter.key] = definition.defaults[parameter.key];
    } else if (parameter.choices && parameter.choices.length > 0) {
      accumulator[parameter.key] = parameter.choices[0];
    } else if (parameter.multiple) {
      accumulator[parameter.key] = [];
    }
    return accumulator;
  }, {});
  return normalizeNodeParams(definition, rawDefaults);
}

export function resolveNodeInputs(
  nodeId: string,
  nodes: FlowNode[],
  edges: Array<FlowEdge & { data?: { order?: number } }>,
  definitions: Record<string, NodeDefinition>,
): Record<string, ResolvedInputValue[]> {
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return {};
  }
  const definition = definitions[node.data.nodeType];
  if (!definition) {
    return {};
  }

  return Object.fromEntries(
    definition.inputs.map((input) => {
      const values: ResolvedInputValue[] = sortInputEdges(
        edges.filter((edge) => edge.target === nodeId && edge.targetHandle === input.id),
      )
        .flatMap((edge) => {
          const sourceNode = nodes.find((entry) => entry.id === edge.source);
          if (!sourceNode) {
            return [];
          }
          switch (sourceNode.data.nodeType) {
            case "input_text": {
              const text = String(sourceNode.data.values.text ?? "").trim();
              return text ? [{ kind: "text" as const, text }] : [];
            }
            case "input_image":
            case "input_video":
            case "input_audio": {
              const asset = sourceNode.data.values.asset;
              return asset && typeof asset === "object" ? [asset as ResolvedInputValue] : [];
            }
            default: {
              const selectedId = sourceNode.data.values.selectedArtifactId as string | undefined;
              const allArtifacts = sourceNode.data.execution?.artifacts ?? [];
              const typeMatched = allArtifacts.filter((artifact) => artifact.kind === input.type);
              const targetArtifact = typeMatched.find((item) => item.assetId === selectedId) || typeMatched[0];
              const resolved = targetArtifact ? [targetArtifact] : [];
              return resolved.map((artifact) => ({
                kind: artifact.kind,
                assetId: artifact.assetId,
                localPath: artifact.localPath,
                previewUrl: artifact.previewUrl,
                filename: artifact.filename,
              }) as ResolvedInputValue);
            }
          }
        });
      return [input.id, values];
    }),
  ) as Record<string, ResolvedInputValue[]>;
}

export function mergeExecution(
  nodes: FlowNode[],
  nodeId: string,
  execution: NodeExecution,
): FlowNode[] {
  return nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            execution: {
              ...node.data.execution,
              ...execution,
            },
          },
        }
      : node,
  );
}
