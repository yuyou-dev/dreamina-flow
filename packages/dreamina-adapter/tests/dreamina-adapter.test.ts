import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildNodeCatalog, buildProcessorDefinitions, validateNodeRun } from "../src/index.js";
import { createDreaminaAuthService, normalizeTerminalOutput } from "../src/auth.js";

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

  it("keeps login as a no-op when the CLI is already authenticated", async () => {
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

    const createInteractiveSession = vi.fn();
    const service = createDreaminaAuthService({
      runCli,
      createInteractiveSession,
      randomId: () => "session-login",
    });

    const session = await service.startLoginSession("login");
    expect(session.phase).toBe("success");
    expect(session.message).toBe("Dreamina is already logged in.");
    expect(createInteractiveSession).not.toHaveBeenCalled();
  });

  it("tracks a headless relogin session and refreshes auth state on success", async () => {
    let loggedIn = false;
    let emittedData: ((text: string) => void) | null = null;
    let emittedExit: ((event: { exitCode: number | null; signal?: string | null }) => void) | null = null;
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
      createInteractiveSession: vi.fn(() => ({
        onData(handler) {
          emittedData = handler;
        },
        onExit(handler) {
          emittedExit = handler;
        },
        write() {},
        kill() {},
      })),
      randomId: () => "session-relogin",
    });

    const session = await service.startLoginSession("relogin");
    expect(session.phase).toBe("pending");
    expect(session.qrText).toBeNull();

    emittedData?.("QR BLOCK\n");
    expect((await service.getLoginSession("session-relogin"))?.qrText).toContain("QR BLOCK");

    loggedIn = true;
    emittedExit?.({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const finishedSession = await service.getLoginSession("session-relogin");
    expect(finishedSession?.phase).toBe("success");
    expect(finishedSession?.message).toBe("Dreamina login completed.");

    const auth = await service.getAuthStatus();
    expect(auth.loggedIn).toBe(true);
    expect(auth.credits).toEqual({
      vipCredit: 1,
      giftCredit: 2,
      purchaseCredit: 3,
      totalCredit: 6,
    });
  });

  it("reuses an existing pending headless login session instead of spawning another one", async () => {
    const resolvedCli = "/usr/local/bin/dreamina";
    const createInteractiveSession = vi.fn(() => ({
      onData() {},
      onExit() {},
      write() {},
      kill() {},
    }));

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
      createInteractiveSession,
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
    expect(createInteractiveSession).toHaveBeenCalledTimes(1);
  });

  it("reconciles a pending session to success when auth turns logged in before the headless process exits", async () => {
    let loggedIn = false;
    let emittedData: ((text: string) => void) | null = null;
    let killCount = 0;
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
              vip_credit: 4,
              gift_credit: 5,
              purchase_credit: 6,
              total_credit: 15,
            }),
            stderr: "",
            exitCode: 0,
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
      createInteractiveSession: vi.fn(() => ({
        onData(handler) {
          emittedData = handler;
        },
        onExit() {},
        write() {},
        kill() {
          killCount += 1;
        },
      })),
      randomId: () => "session-reconcile",
    });

    const session = await service.startLoginSession("relogin");
    expect(session.phase).toBe("pending");

    emittedData?.("QR BLOCK\n");
    loggedIn = true;

    const snapshot = await service.getLoginSession("session-reconcile");
    expect(snapshot?.phase).toBe("success");
    expect(snapshot?.message).toBe("Dreamina login completed.");
    expect(killCount).toBe(1);
  });

  it("sweeps pending login sessions to success once auth refresh turns logged in", async () => {
    let loggedIn = false;
    let emittedData: ((text: string) => void) | null = null;
    let killCount = 0;
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
      createInteractiveSession: vi.fn(() => ({
        onData(handler) {
          emittedData = handler;
        },
        onExit() {},
        write() {},
        kill() {
          killCount += 1;
        },
      })),
      randomId: () => "session-sweep",
    });

    const session = await service.startLoginSession("relogin");
    expect(session.phase).toBe("pending");

    emittedData?.("QR SWEEP\n");
    loggedIn = true;

    const auth = await service.getAuthStatus(true);
    expect(auth.loggedIn).toBe(true);

    const snapshot = await service.getLoginSession("session-sweep");
    expect(snapshot?.phase).toBe("success");
    expect(snapshot?.message).toBe("Dreamina login completed.");
    expect(killCount).toBe(1);
  });

  it("fails a pending login session after the timeout window and does not reuse it", async () => {
    const resolvedCli = "/usr/local/bin/dreamina";
    let currentTime = new Date("2026-04-13T00:00:00.000Z").getTime();
    const createInteractiveSession = vi.fn(() => ({
      onData() {},
      onExit() {},
      write() {},
      kill() {},
    }));

    const service = createDreaminaAuthService({
      now: () => new Date(currentTime),
      runCli: async (command: string, args: string[]) => {
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
            ok: false,
            stdout: "",
            stderr: "Please log in first.",
            exitCode: 1,
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      },
      createInteractiveSession,
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
    expect(createInteractiveSession).toHaveBeenCalledTimes(2);
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

  it("loads the generated QR PNG into the login session snapshot", async () => {
    let emittedData: ((text: string) => void) | null = null;
    let emittedExit: ((event: { exitCode: number | null; signal?: string | null }) => void) | null = null;
    const resolvedCli = "/usr/local/bin/dreamina";
    const directory = await mkdtemp(join(tmpdir(), "dreamina-auth-test-"));
    const qrPath = join(directory, "dreamina-login-qr.png");
    const qrPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wm3G1cAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(qrPath, qrPng);

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
      createInteractiveSession: vi.fn(() => ({
        onData(handler) {
          emittedData = handler;
        },
        onExit(handler) {
          emittedExit = handler;
        },
        write() {},
        kill() {},
      })),
      randomId: () => "session-qr",
    });

    const session = await service.startLoginSession("relogin");
    expect(session.phase).toBe("pending");

    emittedData?.(`二维码 PNG 已保存到：${qrPath}\n[DREAMINA:QR_READY] ${qrPath}\n`);
    const snapshot = await service.getLoginSession("session-qr");

    expect(snapshot?.qrText).toContain("[DREAMINA:QR_READY]");
    expect(snapshot?.qrImageDataUrl).toMatch(/^data:image\/png;base64,/);

    emittedExit?.({ exitCode: 1 });
  });
});
