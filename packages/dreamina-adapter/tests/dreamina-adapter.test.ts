import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildNodeCatalog, buildProcessorDefinitions, validateNodeRun } from "../src/index.js";
import { createDreaminaAuthService } from "../src/auth.js";
import { normalizeTerminalOutput } from "../src/cli.js";

const wrapperCommands = [
  {
    name: "text2image",
    description: "Text to image.",
    output_mode: "json",
    parameters: [
      { key: "prompt", multiple: false, required: true, value_type: "string", choices: [], min_value: null, max_value: null, path_mode: null },
      { key: "ratio", multiple: false, required: false, value_type: "string", choices: ["1:1", "16:9"], min_value: null, max_value: null, path_mode: null },
      { key: "resolution_type", multiple: false, required: false, value_type: "string", choices: ["1k", "2k"], min_value: null, max_value: null, path_mode: null },
      { key: "model_version", multiple: false, required: false, value_type: "string", choices: ["3.0", "3.1"], min_value: null, max_value: null, path_mode: null },
      { key: "session", multiple: false, required: false, value_type: "int", choices: [], min_value: 0, max_value: null, path_mode: null },
      { key: "poll", multiple: false, required: false, value_type: "int", choices: [], min_value: 1, max_value: 1800, path_mode: null },
    ],
  },
];

describe("dreamina-adapter", () => {
  it("builds processor definitions into a neutral node catalog", () => {
    const processors = buildProcessorDefinitions(wrapperCommands, { text2image: "help" });
    const catalog = buildNodeCatalog(processors);

    expect(catalog.canvasNodes.processor).toHaveLength(1);
    expect(catalog.canvasNodes.processor[0]?.category).toBe("processor");
    expect(catalog.nodes.some((node) => node.name === "input_text")).toBe(true);
    expect(catalog.canvasNodes.processor[0]?.params.find((param) => param.key === "session")).toMatchObject({
      label: "Session",
      type: "number",
      min: 0,
    });
  });

  it("validates normalized processor inputs", () => {
    const processor = buildProcessorDefinitions(wrapperCommands, { text2image: "help" })[0];
    expect(processor).toBeDefined();
    if (!processor) {
      return;
    }

    const result = validateNodeRun(
      processor,
      {
        resolution_type: "1k",
        model_version: "3.1",
      },
      {
        prompt: [{ kind: "text", text: "A studio photograph of a silver ring." }],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.normalizedParams.prompt).toContain("silver ring");
  });

  it("validates generic numeric parameter ranges for wrapper-defined params", () => {
    const processor = buildProcessorDefinitions(wrapperCommands, { text2image: "help" })[0];
    expect(processor).toBeDefined();
    if (!processor) {
      return;
    }

    const result = validateNodeRun(
      processor,
      {
        session: -1,
      },
      {
        prompt: [{ kind: "text", text: "A studio photograph of a silver ring." }],
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Session must be >= 0.");
  });

  it("accepts aliased image2video model values and normalizes them before select validation", () => {
    const image2videoProcessor = {
      name: "image2video",
      title: "Image to Video",
      category: "processor" as const,
      description: "Processor node.",
      inputs: [
        { id: "image", label: "First Frame", type: "image" as const, required: true },
        { id: "prompt", label: "Prompt", type: "text" as const, required: true },
      ],
      outputs: [{ id: "video", label: "Video", type: "video" as const }],
      params: [
        { key: "duration", label: "Duration (s)", type: "number" as const },
        { key: "video_resolution", label: "Resolution", type: "select" as const, choices: ["720p", "1080p"] },
        { key: "model_version", label: "Model", type: "select" as const, choices: ["3.0", "3.0fast", "3.0pro", "3.5pro"] },
      ],
      defaults: {},
      outputMode: "json",
      wrapperAvailable: true,
      rawCliAvailable: true,
      constraints: {
        aliases: {
          "3.0_fast": "3.0fast",
          "3.0_pro": "3.0pro",
          "3.5_pro": "3.5pro",
        },
      },
      warnings: [],
    };

    const result = validateNodeRun(
      image2videoProcessor,
      {
        model_version: "3.0_fast",
      },
      {
        image: [{ kind: "image", localPath: "/tmp/first.png" }],
        prompt: [{ kind: "text", text: "Add a gentle push-in." }],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.normalizedParams.model_version).toBe("3.0fast");
  });

  it("normalizes terminal output for QR-style login sessions", () => {
    const output = normalizeTerminalOutput("\u001b[31mQR\u001b[0m\r\ncode");
    expect(output).toContain("QR");
    expect(output).toContain("\ncode");
  });

  it("parses user_credit into a logged-in auth snapshot", async () => {
    const service = createDreaminaAuthService({
      runCli: async () => ({
        ok: true,
        stdout: JSON.stringify({
          vip_credit: 0,
          gift_credit: 500737,
          purchase_credit: 0,
          total_credit: 500737,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    const auth = await service.getAuthStatus(true);
    expect(auth.loggedIn).toBe(true);
    expect(auth.credits).toEqual({
      vipCredit: 0,
      giftCredit: 500737,
      purchaseCredit: 0,
      totalCredit: 500737,
    });
    expect(auth.message).toBeNull();
  });

  it("parses the newer user_credit payload that only returns total_credit", async () => {
    const service = createDreaminaAuthService({
      runCli: async () => ({
        ok: true,
        stdout: JSON.stringify({
          total_credit: 482902,
          user_id: 1814655359525112,
          user_name: "",
          vip_level: "maestro",
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    const auth = await service.getAuthStatus(true);
    expect(auth.loggedIn).toBe(true);
    expect(auth.credits).toEqual({
      vipCredit: undefined,
      giftCredit: undefined,
      purchaseCredit: undefined,
      totalCredit: 482902,
    });
    expect(auth.message).toBeNull();
  });

  it("keeps login as a no-op when cached auth already says the CLI is authenticated", async () => {
    const resolvedCli = "/usr/local/bin/dreamina";
    const runCli = vi.fn(async (command: string, args: string[]) => {
      if (command === "which" && args[0] === "dreamina") {
        return {
          ok: true,
          stdout: resolvedCli,
          stderr: "",
          exitCode: 0,
        };
      }

      if (command === resolvedCli && args[0] === "user_credit") {
        return {
          ok: true,
          stdout: JSON.stringify({
            vip_credit: 0,
            gift_credit: 12,
            purchase_credit: 0,
            total_credit: 12,
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    const service = createDreaminaAuthService({
      runCli,
      randomId: () => "session-login",
    });

    const auth = await service.getAuthStatus(true);
    expect(auth.loggedIn).toBe(true);

    const session = await service.startLoginSession("login");
    expect(session.phase).toBe("success");
    expect(session.message).toBe("Dreamina is already logged in.");
  });

  it("starts a fresh headless login and captures OAuth device-flow fields", async () => {
    const headlessOutput = [
      "verification_uri: https://dreamina.example/device",
      "user_code: TEST-CODE",
      "device_code: device-code-123",
    ].join("\n");
    const runCli = vi.fn(async (command: string, args: string[]) => {
      if (command === "dreamina" && args[0] === "login" && args[1] === "--headless") {
        return {
          ok: true,
          stdout: headlessOutput,
          stderr: "",
          exitCode: 0,
        };
      }

      if (args[0] === "user_credit") {
        throw new Error("user_credit should not run before a fresh headless login starts");
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    const service = createDreaminaAuthService({
      runCli,
      randomId: () => "session-fresh-login",
    });

    const session = await service.startLoginSession("login");

    expect(session.phase).toBe("pending");
    expect(session.verificationUri).toBe("https://dreamina.example/device");
    expect(session.userCode).toBe("TEST-CODE");
    expect(session.deviceCode).toBe("device-code-123");
    expect(session.terminalOutput).toContain("verification_uri");
    expect(runCli).toHaveBeenCalledWith("dreamina", ["login", "--headless"], undefined, expect.any(String));
  });

  it("keeps polling checklogin after authorization succeeds until auth refresh sees the local login", async () => {
    let authorizationAccepted = false;
    let authRefreshCount = 0;
    let checkloginCount = 0;
    let currentTime = new Date("2026-04-13T00:00:00.000Z").getTime();
    const resolvedCli = "/usr/local/bin/dreamina";
    const service = createDreaminaAuthService({
      now: () => new Date(currentTime),
      runCli: async (command: string, args: string[]) => {
        if (command === "dreamina" && args[0] === "relogin" && args[1] === "--headless") {
          return {
            ok: true,
            stdout: [
              "verification_uri: https://dreamina.example/device",
              "user_code: TEST-CODE",
              "device_code: device-code-123",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === "which" && args[0] === "dreamina") {
          return {
            ok: true,
            stdout: resolvedCli,
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === resolvedCli && args[0] === "login" && args[1] === "checklogin") {
          checkloginCount += 1;
          return {
            ok: authorizationAccepted,
            stdout: authorizationAccepted ? "authorization complete" : "",
            stderr: authorizationAccepted ? "" : "authorization_pending",
            exitCode: authorizationAccepted ? 0 : 1,
          };
        }

        if (command === resolvedCli && args[0] === "user_credit") {
          authRefreshCount += 1;
          if (!authorizationAccepted || authRefreshCount < 3) {
            return {
              ok: false,
              stdout: "",
              stderr: "Please log in first.",
              exitCode: 1,
            };
          }
          return {
            ok: true,
            stdout: JSON.stringify({
              vip_credit: 1,
              gift_credit: 2,
              purchase_credit: 3,
              total_credit: 6,
            }),
            stderr: "",
            exitCode: 0,
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
      randomId: () => "session-relogin",
    });

    const session = await service.startLoginSession("relogin");
    expect(session.phase).toBe("pending");
    expect(session.userCode).toBe("TEST-CODE");

    const firstPoll = await service.getLoginSession("session-relogin");
    expect(firstPoll?.phase).toBe("pending");
    expect(checkloginCount).toBe(1);

    authorizationAccepted = true;
    currentTime += 1100;

    const afterAuthorization = await service.getLoginSession("session-relogin");
    expect(afterAuthorization?.phase).toBe("pending");
    expect(afterAuthorization?.message).toContain("Authorization completed");
    expect(checkloginCount).toBe(2);

    currentTime += 1100;
    const finishedSession = await service.getLoginSession("session-relogin");
    expect(finishedSession?.phase).toBe("success");
    expect(finishedSession?.message).toBe("Dreamina login completed.");
    expect(checkloginCount).toBe(3);

    const auth = await service.getAuthStatus();
    expect(auth.loggedIn).toBe(true);
    expect(auth.credits).toEqual({
      vipCredit: 1,
      giftCredit: 2,
      purchaseCredit: 3,
      totalCredit: 6,
    });
  });

  it("reuses an existing pending headless login session instead of starting another one", async () => {
    const resolvedCli = "/usr/local/bin/dreamina";
    const runCli = vi.fn(async (command: string, args: string[]) => {
      if (command === "dreamina" && args[0] === "login" && args[1] === "--headless") {
        return {
          ok: true,
          stdout: [
            "verification_uri: https://dreamina.example/device",
            "user_code: TEST-CODE",
            "device_code: device-code-123",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }

      if (command === "which" && args[0] === "dreamina") {
        return {
          ok: true,
          stdout: resolvedCli,
          stderr: "",
          exitCode: 0,
        };
      }

      if (command === resolvedCli && args[0] === "login" && args[1] === "checklogin") {
        return {
          ok: false,
          stdout: "",
          stderr: "authorization_pending",
          exitCode: 1,
        };
      }

      if (command === resolvedCli && args[0] === "user_credit") {
        return {
          ok: false,
          stdout: "",
          stderr: "Please log in first.",
          exitCode: 1,
        };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    const service = createDreaminaAuthService({
      runCli,
      randomId: (() => {
        let counter = 0;
        return () => `session-${++counter}`;
      })(),
    });

    const first = await service.startLoginSession("login");
    const second = await service.startLoginSession("login");

    expect(first.phase).toBe("pending");
    expect(second.phase).toBe("pending");
    expect(second.sessionId).toBe(first.sessionId);
    expect(runCli.mock.calls.filter(([command, args]) => command === "dreamina" && args[0] === "login" && args[1] === "--headless")).toHaveLength(1);
  });

  it("keeps the session pending when checklogin returns a non-fatal unknown message", async () => {
    const resolvedCli = "/usr/local/bin/dreamina";
    const service = createDreaminaAuthService({
      runCli: async (command: string, args: string[]) => {
        if (command === "dreamina" && args[0] === "login" && args[1] === "--headless") {
          return {
            ok: true,
            stdout: [
              "verification_uri: https://dreamina.example/device",
              "user_code: TEST-CODE",
              "device_code: device-code-123",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === "which" && args[0] === "dreamina") {
          return {
            ok: true,
            stdout: resolvedCli,
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === resolvedCli && args[0] === "login" && args[1] === "checklogin") {
          return {
            ok: false,
            stdout: "",
            stderr: "please finish authorization in browser first",
            exitCode: 1,
          };
        }

        if (command === resolvedCli && args[0] === "user_credit") {
          return {
            ok: false,
            stdout: "",
            stderr: "Please log in first.",
            exitCode: 1,
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
      randomId: () => "session-unknown-pending",
    });

    const session = await service.startLoginSession("login");
    expect(session.phase).toBe("pending");

    const snapshot = await service.getLoginSession("session-unknown-pending");
    expect(snapshot?.phase).toBe("pending");
    expect(snapshot?.verificationUri).toBe("https://dreamina.example/device");
  });

  it("fails a pending session when checklogin returns a fatal device-flow error", async () => {
    const resolvedCli = "/usr/local/bin/dreamina";
    const service = createDreaminaAuthService({
      runCli: async (command: string, args: string[]) => {
        if (command === "dreamina" && args[0] === "relogin" && args[1] === "--headless") {
          return {
            ok: true,
            stdout: [
              "verification_uri: https://dreamina.example/device",
              "user_code: TEST-CODE",
              "device_code: device-code-123",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === "which" && args[0] === "dreamina") {
          return {
            ok: true,
            stdout: resolvedCli,
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === resolvedCli && args[0] === "login" && args[1] === "checklogin") {
          return {
            ok: false,
            stdout: "",
            stderr: "expired_token",
            exitCode: 1,
          };
        }

        if (command === resolvedCli && args[0] === "user_credit") {
          return {
            ok: false,
            stdout: "",
            stderr: "Please log in first.",
            exitCode: 1,
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
      randomId: () => "session-fatal",
    });

    const session = await service.startLoginSession("relogin");
    expect(session.phase).toBe("pending");

    const snapshot = await service.getLoginSession("session-fatal");
    expect(snapshot?.phase).toBe("fail");
    expect(snapshot?.message).toContain("expired_token");
  });

  it("sweeps pending login sessions to success once auth refresh turns logged in", async () => {
    let loggedIn = false;
    const resolvedCli = "/usr/local/bin/dreamina";
    const service = createDreaminaAuthService({
      runCli: async (command: string, args: string[]) => {
        if (command === "dreamina" && args[0] === "relogin" && args[1] === "--headless") {
          return {
            ok: true,
            stdout: [
              "verification_uri: https://dreamina.example/device",
              "user_code: TEST-CODE",
              "device_code: device-code-123",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === "which" && args[0] === "dreamina") {
          return {
            ok: true,
            stdout: resolvedCli,
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === resolvedCli && args[0] === "user_credit") {
          if (!loggedIn) {
            return {
              ok: false,
              stdout: "",
              stderr: "Please log in first.",
              exitCode: 1,
            };
          }

          return {
            ok: true,
            stdout: JSON.stringify({
              vip_credit: 2,
              gift_credit: 3,
              purchase_credit: 4,
              total_credit: 9,
            }),
            stderr: "",
            exitCode: 0,
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
      randomId: () => "session-sweep",
    });

    const session = await service.startLoginSession("relogin");
    expect(session.phase).toBe("pending");

    loggedIn = true;

    const auth = await service.getAuthStatus(true);
    expect(auth.loggedIn).toBe(true);

    const snapshot = await service.getLoginSession("session-sweep");
    expect(snapshot?.phase).toBe("success");
    expect(snapshot?.message).toBe("Dreamina login completed.");
  });

  it("fails a pending login session after the timeout window and does not reuse it", async () => {
    let currentTime = new Date("2026-04-13T00:00:00.000Z").getTime();
    const runCli = vi.fn(async (command: string, args: string[]) => {
      if (command === "dreamina" && args[0] === "login" && args[1] === "--headless") {
        return {
          ok: true,
          stdout: [
            "verification_uri: https://dreamina.example/device",
            "user_code: TEST-CODE",
            "device_code: device-code-123",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    const service = createDreaminaAuthService({
      now: () => new Date(currentTime),
      runCli,
      randomId: (() => {
        let counter = 0;
        return () => `session-timeout-${++counter}`;
      })(),
    });

    const first = await service.startLoginSession("login");
    expect(first.phase).toBe("pending");

    currentTime += 5 * 60 * 1000 + 1;

    const expired = await service.getLoginSession(first.sessionId);
    expect(expired?.phase).toBe("fail");
    expect(expired?.message).toContain("timed out");

    const second = await service.startLoginSession("login");
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.phase).toBe("pending");
    expect(runCli.mock.calls.filter(([command, args]) => command === "dreamina" && args[0] === "login" && args[1] === "--headless")).toHaveLength(2);
  });

  it("logs out and refreshes auth into a logged-out snapshot", async () => {
    let loggedIn = true;
    const resolvedCli = "/usr/local/bin/dreamina";
    const service = createDreaminaAuthService({
      runCli: async (command: string, args: string[]) => {
        if (command === "which" && args[0] === "dreamina") {
          return {
            ok: true,
            stdout: resolvedCli,
            stderr: "",
            exitCode: 0,
          };
        }

        if (command !== resolvedCli) {
          throw new Error(`Unexpected command: ${command}`);
        }

        if (args[0] === "user_credit") {
          if (!loggedIn) {
            return {
              ok: false,
              stdout: "",
              stderr: "Please log in first.",
              exitCode: 1,
            };
          }

          return {
            ok: true,
            stdout: JSON.stringify({
              vip_credit: 0,
              gift_credit: 25,
              purchase_credit: 0,
              total_credit: 25,
            }),
            stderr: "",
            exitCode: 0,
          };
        }

        if (args[0] === "logout") {
          loggedIn = false;
          return {
            ok: true,
            stdout: "Dreamina logout completed.",
            stderr: "",
            exitCode: 0,
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
    });

    const before = await service.getAuthStatus(true);
    expect(before.loggedIn).toBe(true);

    const after = await service.logout();
    expect(after.loggedIn).toBe(false);
    expect(after.credits).toBeNull();
    expect(after.message).toContain("logout");
  });

  it("loads a legacy QR PNG fallback when headless output still includes a QR marker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dreamina-auth-test-"));
    const qrPath = join(directory, "dreamina-login-qr.png");
    const qrPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wm3G1cAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(qrPath, qrPng);
    const resolvedCli = "/usr/local/bin/dreamina";

    const service = createDreaminaAuthService({
      runCli: async (command: string, args: string[]) => {
        if (command === "dreamina" && args[0] === "relogin" && args[1] === "--headless") {
          return {
            ok: true,
            stdout: [
              "verification_uri: https://dreamina.example/device",
              "user_code: TEST-CODE",
              "device_code: device-code-123",
              `[DREAMINA:QR_READY] ${qrPath}`,
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === "which" && args[0] === "dreamina") {
          return {
            ok: true,
            stdout: resolvedCli,
            stderr: "",
            exitCode: 0,
          };
        }

        if (command === resolvedCli && args[0] === "login" && args[1] === "checklogin") {
          return {
            ok: false,
            stdout: "",
            stderr: "authorization_pending",
            exitCode: 1,
          };
        }

        if (command === resolvedCli && args[0] === "user_credit") {
          return {
            ok: false,
            stdout: "",
            stderr: "Please log in first.",
            exitCode: 1,
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
      randomId: () => "session-qr",
    });

    const session = await service.startLoginSession("relogin");
    expect(session.phase).toBe("pending");

    const snapshot = await service.getLoginSession("session-qr");
    expect(snapshot?.terminalOutput).toContain("[DREAMINA:QR_READY]");
    expect(snapshot?.qrImageDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
