import { INPUT_NODE_DEFS, OUTPUT_NODE_DEFS } from "@workflow-studio/workflow-core";
import type { DataType, NodeDefinition } from "../types";

export const STATIC_NODE_DEFS: NodeDefinition[] = [...INPUT_NODE_DEFS, ...OUTPUT_NODE_DEFS];

export const DATA_TYPE_COLORS: Record<DataType, string> = {
  image: "#ff00ff",
  video: "#00f0ff",
  audio: "#ff8c00",
  text: "#d4ff32",
};

export const STATUS_COLORS: Record<string, string> = {
  idle: "text-gray-600",
  validating: "text-amber-600",
  running: "text-blue-600",
  querying: "text-sky-600",
  success: "text-green-600",
  fail: "text-red-600",
};
