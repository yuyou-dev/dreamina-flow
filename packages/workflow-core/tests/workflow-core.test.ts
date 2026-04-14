import { describe, expect, it } from "vitest";
import {
  WORKFLOW_SCHEMA,
  buildWorkflowDownloadPayload,
  prepareStarterWorkflowDocument,
  prepareWorkflowDocumentImport,
  type AdapterStatus,
  type NodeDefinition,
} from "../src/index.js";

const definitions: Record<string, NodeDefinition> = {
  input_text: {
    name: "input_text",
    title: "Input: Text",
    category: "input",
    description: "Text input.",
    inputs: [],
    outputs: [{ id: "text", label: "Text", type: "text" }],
    params: [],
    defaults: {},
    outputMode: "text",
    wrapperAvailable: false,
    rawCliAvailable: false,
    constraints: {},
    warnings: [],
  },
  text2image: {
    name: "text2image",
    title: "Text to Image",
    category: "processor",
    description: "Processor node.",
    inputs: [{ id: "prompt", label: "Prompt", type: "text", required: true }],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    params: [
      { key: "ratio", label: "Ratio", type: "select", choices: ["1:1", "16:9"], default: "1:1" },
      { key: "resolution_type", label: "Resolution", type: "select", choices: ["1k", "2k"], default: "2k" },
      { key: "model_version", label: "Model", type: "select", choices: ["3.0", "3.1"], default: "3.1" },
      { key: "poll", label: "Poll", type: "number", default: 300 },
    ],
    defaults: { ratio: "1:1", resolution_type: "2k", model_version: "3.1", poll: 300 },
    outputMode: "json",
    wrapperAvailable: true,
    rawCliAvailable: true,
    constraints: {
      resolutionRules: {
        "1k": ["3.0", "3.1"],
        "2k": ["3.0", "3.1"],
      },
    },
    warnings: [],
  },
  output_image: {
    name: "output_image",
    title: "Display: Image",
    category: "output",
    description: "Image output.",
    inputs: [{ id: "image", label: "Image", type: "image", required: true }],
    outputs: [],
    params: [],
    defaults: {},
    outputMode: "image",
    wrapperAvailable: false,
    rawCliAvailable: false,
    constraints: {},
    warnings: [],
  },
};

const status: AdapterStatus = {
  backendReady: true,
  cliFound: true,
  cliPath: "/usr/local/bin/dreamina",
  cliVersion: "1.0.0",
  wrapperVersion: 42,
  adapterName: "dreamina",
  logDirectory: "/tmp/logs",
  auth: {
    loggedIn: true,
    credits: {
      vipCredit: 0,
      giftCredit: 100,
      purchaseCredit: 0,
      totalCredit: 100,
    },
    lastCheckedAt: "2026-04-13T00:00:00.000Z",
    message: null,
  },
};
const LEGACY_SCHEMA = ["dreamina", "workflow/v1alpha1"].join(".");

describe("workflow-core", () => {
  it("boots a starter workflow and round-trips through export/import", () => {
    const starter = prepareStarterWorkflowDocument(definitions, status);
    expect(starter.ok).toBe(true);
    if (!starter.ok) {
      return;
    }

    const payload = buildWorkflowDownloadPayload({
      nodes: starter.workflow.nodes,
      edges: starter.workflow.edges,
      meta: starter.workflow.meta,
      groups: starter.workflow.groups,
      viewport: starter.workflow.viewport,
      definitions,
      status,
    });

    expect(payload.document.schema).toBe(WORKFLOW_SCHEMA);
    expect(payload.filename).toBe("starter-text-to-image.workflow.json");

    const imported = prepareWorkflowDocumentImport(JSON.parse(payload.json), definitions, status);
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }

    expect(imported.workflow.nodes.map((node) => node.data.nodeType)).toEqual(["input_text", "text2image", "output_image"]);
  });

  it("rejects the legacy workflow schema", () => {
    const imported = prepareWorkflowDocumentImport(
      {
        schema: LEGACY_SCHEMA,
        version: 1,
        nodes: [],
        edges: [],
      },
      definitions,
      status,
    );

    expect(imported.ok).toBe(false);
    if (imported.ok) {
      return;
    }
    expect(imported.error).toContain("Unsupported workflow schema");
  });
});
