import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterAuthStatus, AdapterLoginSession, NodeDefinition } from "./types.js";

const text2image: NodeDefinition = {
  name: "text2image",
  title: "Text to Image",
  category: "processor",
  description: "Text to image.",
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
};

const defaultAuthStatus: AdapterAuthStatus = {
  loggedIn: true,
  credits: {
    vipCredit: 0,
    giftCredit: 500737,
    purchaseCredit: 0,
    totalCredit: 500737,
  },
  lastCheckedAt: "2026-04-13T00:00:00.000Z",
  message: null,
};

const defaultAdapterStatus = {
  backendReady: true,
  cliFound: true,
  cliPath: "/usr/local/bin/dreamina",
  cliVersion: "1.0.0",
  wrapperVersion: 42,
  adapterName: "dreamina",
  logDirectory: "/tmp/logs",
  auth: defaultAuthStatus,
};

let adapterStatusValue = structuredClone(defaultAdapterStatus);
let authStatusValue = structuredClone(defaultAuthStatus);
let loginSessionCounter = 0;
const loginSessions = new Map<string, AdapterLoginSession>();

vi.mock("./adapter.js", () => ({
  getNodeCatalogResponse: vi.fn(async () => ({
    nodes: [
      {
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
      text2image,
    ],
    canvasNodes: {
      input: [
        {
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
      ],
      processor: [text2image],
      output: [],
    },
  })),
  getCapabilitySnapshot: vi.fn(async () => ({
    cliPath: "/usr/local/bin/dreamina",
    cliVersion: "1.0.0",
    wrapperVersion: 42,
    processorNodes: [text2image],
    rawHelpByCommand: {},
  })),
  getAdapterRuntimeStatus: vi.fn(async () => adapterStatusValue),
  getAdapterAuthStatus: vi.fn(async () => authStatusValue),
  startAdapterLoginSession: vi.fn(async (mode: "login" | "relogin") => {
    const session: AdapterLoginSession = {
      sessionId: `login-session-${++loginSessionCounter}`,
      mode,
      phase: "pending",
      qrText: "QR::TEST::PAYLOAD",
      qrImageDataUrl: "data:image/png;base64,TEST",
      message: "Waiting for Dreamina headless login to complete.",
      startedAt: "2026-04-13T00:00:00.000Z",
      finishedAt: null,
    };
    loginSessions.set(session.sessionId, session);
    return session;
  }),
  getAdapterLoginSession: vi.fn((sessionId: string) => loginSessions.get(sessionId) ?? null),
  logoutAdapter: vi.fn(async () => {
    authStatusValue = {
      loggedIn: false,
      credits: null,
      lastCheckedAt: "2026-04-14T00:00:00.000Z",
      message: "Dreamina logout completed.",
    };
    adapterStatusValue = {
      ...adapterStatusValue,
      auth: authStatusValue,
    };
    return authStatusValue;
  }),
  warmCapabilityCache: vi.fn(async () => undefined),
}));

vi.mock("./executionHealth.js", () => ({
  submitCommandWithRetry: vi.fn(async () => ({
    result: {
      ok: true,
      command: "text2image",
      data: { submit_id: "submit-123" },
      cliArgs: ["dreamina", "text2image"],
    },
    submitAttempts: 1,
    submitRecovered: false,
  })),
  settleSubmittedExecution: vi.fn(async ({ submitId, runId, nodeId }: { submitId: string; runId: string; nodeId: string }) => ({
    execution: {
      status: "success",
      submitId,
      runId,
      artifacts: [],
      result: { submit_id: submitId, gen_status: "success" },
      health: { submitAttempts: 1, queryAttempts: 1 },
    },
    artifacts: [],
    queryResult: {
      ok: true,
      command: "query_result",
      data: { submit_id: submitId, gen_status: "success" },
    },
    pending: false,
  })),
}));

async function startServer() {
  const { createApp } = await import("./app.js");
  const app = await createApp();
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe("studio-api", () => {
  afterEach(() => {
    vi.clearAllMocks();
    adapterStatusValue = structuredClone(defaultAdapterStatus);
    authStatusValue = structuredClone(defaultAuthStatus);
    loginSessionCounter = 0;
    loginSessions.clear();
  });

  it("serves capabilities and adapter status", async () => {
    const { server, baseUrl } = await startServer();
    try {
      const [capabilities, status] = await Promise.all([
        fetch(`${baseUrl}/api/capabilities`).then((response) => response.json()),
        fetch(`${baseUrl}/api/adapter/status`).then((response) => response.json()),
      ]);

      expect(capabilities.canvasNodes.processor).toHaveLength(1);
      expect(status.adapterName).toBe("dreamina");
      expect(status.auth.loggedIn).toBe(true);
      expect(status.auth.credits.totalCredit).toBe(500737);
    } finally {
      server.close();
    }
  });

  it("creates and polls login sessions", async () => {
    const { server, baseUrl } = await startServer();
    try {
      const created = await fetch(`${baseUrl}/api/adapter/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "relogin" }),
      }).then((response) => response.json());

      expect(created.mode).toBe("relogin");
      expect(created.phase).toBe("pending");
      expect(created.qrText).toContain("QR::TEST::PAYLOAD");
      expect(created.qrImageDataUrl).toContain("data:image/png");

      const fetched = await fetch(`${baseUrl}/api/adapter/login/${created.sessionId}`).then((response) => response.json());
      expect(fetched.sessionId).toBe(created.sessionId);
      expect(fetched.mode).toBe("relogin");
      expect(fetched.phase).toBe("pending");
    } finally {
      server.close();
    }
  });

  it("logs out and returns a refreshed adapter status", async () => {
    const { server, baseUrl } = await startServer();
    try {
      const payload = await fetch(`${baseUrl}/api/adapter/logout`, {
        method: "POST",
      }).then((response) => response.json());

      expect(payload.auth.loggedIn).toBe(false);
      expect(payload.auth.credits).toBeNull();
      expect(payload.auth.message).toContain("logout");
    } finally {
      server.close();
    }
  });

  it("returns authRequired when login is missing for node and flow runs", async () => {
    authStatusValue = {
      loggedIn: false,
      credits: null,
      lastCheckedAt: "2026-04-13T00:00:00.000Z",
      message: "Dreamina login required.",
    };
    adapterStatusValue = {
      ...defaultAdapterStatus,
      auth: authStatusValue,
    };

    const { server, baseUrl } = await startServer();
    try {
      const nodeResponse = await fetch(`${baseUrl}/api/nodes/text2image/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: "processor-1",
          params: { ratio: "1:1", resolution_type: "2k", model_version: "3.1" },
          resolvedInputs: {
            prompt: [{ kind: "text", text: "A silver ring on a clean studio stage." }],
          },
        }),
      });

      expect(nodeResponse.status).toBe(401);
      const nodeBody = await nodeResponse.json();
      expect(nodeBody.authRequired).toBe(true);
      expect(nodeBody.auth.loggedIn).toBe(false);

      const flowResponse = await fetch(`${baseUrl}/api/flows/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "flow-1",
          targetNodeId: "processor-1",
          nodes: [
            {
              id: "input-1",
              data: {
                nodeType: "input_text",
                params: {},
                values: { text: "A silver ring on a clean studio stage." },
                execution: { status: "idle", artifacts: [] },
              },
            },
            {
              id: "processor-1",
              data: {
                nodeType: "text2image",
                params: { ratio: "1:1", resolution_type: "2k", model_version: "3.1", poll: 300 },
                values: {},
                execution: { status: "idle", artifacts: [] },
              },
            },
          ],
          edges: [
            {
              id: "edge-1",
              source: "input-1",
              sourceHandle: "text",
              target: "processor-1",
              targetHandle: "prompt",
            },
          ],
        }),
      });

      expect(flowResponse.status).toBe(401);
      const flowBody = await flowResponse.json();
      expect(flowBody.authRequired).toBe(true);
      expect(flowBody.targetNodeId).toBe("processor-1");
    } finally {
      server.close();
    }
  });

  it("runs validate and flow endpoints against the slim API surface", async () => {
    const { server, baseUrl } = await startServer();
    try {
      const validateResponse = await fetch(`${baseUrl}/api/nodes/text2image/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          params: { ratio: "1:1", resolution_type: "2k", model_version: "3.1" },
          resolvedInputs: {
            prompt: [{ kind: "text", text: "A silver ring on a clean studio stage." }],
          },
        }),
      }).then((response) => response.json());

      expect(validateResponse.ok).toBe(true);

      const flowResponse = await fetch(`${baseUrl}/api/flows/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "flow-1",
          targetNodeId: "processor-1",
          nodes: [
            {
              id: "input-1",
              data: {
                nodeType: "input_text",
                params: {},
                values: { text: "A silver ring on a clean studio stage." },
                execution: { status: "idle", artifacts: [] },
              },
            },
            {
              id: "processor-1",
              data: {
                nodeType: "text2image",
                params: { ratio: "1:1", resolution_type: "2k", model_version: "3.1", poll: 300 },
                values: {},
                execution: { status: "idle", artifacts: [] },
              },
            },
          ],
          edges: [
            {
              id: "edge-1",
              source: "input-1",
              sourceHandle: "text",
              target: "processor-1",
              targetHandle: "prompt",
            },
          ],
        }),
      }).then((response) => response.json());

      expect(flowResponse.ok).toBe(true);
      expect(flowResponse.nodeResults["processor-1"].status).toBe("success");
    } finally {
      server.close();
    }
  });
});
