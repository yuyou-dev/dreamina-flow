import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { REPO_ROOT } from "./runtime.js";

export interface RunCliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface InteractiveSession {
  onData(handler: (text: string) => void): void;
  onExit(handler: (event: { exitCode: number | null; signal?: string | null }) => void): void;
  write(text: string): void;
  kill(signal?: string | number): void;
  resize?(columns: number, rows: number): void;
}

export interface InteractiveSessionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

function createBufferedSession(session: InteractiveSession): InteractiveSession {
  const dataBuffer: string[] = [];
  const dataHandlers = new Set<(text: string) => void>();
  const exitHandlers = new Set<(event: { exitCode: number | null; signal?: string | null }) => void>();
  let exitEvent: { exitCode: number | null; signal?: string | null } | null = null;

  session.onData((text) => {
    dataBuffer.push(text);
    dataHandlers.forEach((handler) => handler(text));
  });

  session.onExit((event) => {
    exitEvent = event;
    exitHandlers.forEach((handler) => handler(event));
  });

  return {
    onData(handler) {
      dataHandlers.add(handler);
      dataBuffer.forEach((chunk) => handler(chunk));
    },
    onExit(handler) {
      exitHandlers.add(handler);
      if (exitEvent) {
        handler(exitEvent);
      }
    },
    write(text) {
      session.write(text);
    },
    kill(signal) {
      session.kill(signal);
    },
    resize(columns, rows) {
      session.resize?.(columns, rows);
    },
  };
}

function quoteForExpect(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, "\\n")}"`;
}

function buildExpectSessionScript(command: string, args: string[]): string {
  return [
    "log_user 1",
    `if {[catch {spawn -noecho ${[command, ...args].map(quoteForExpect).join(" ")}} spawnError]} {`,
    "  puts $spawnError",
    "  exit 1",
    "}",
    "expect eof",
    "set result [wait]",
    "set exitCode [lindex $result 3]",
    "if {$exitCode eq \"\"} {",
    "  exit 1",
    "}",
    "exit $exitCode",
  ].join("\n");
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function normalizeTerminalOutput(text: string): string {
  return stripAnsi(text).replace(/\r\n?/g, "\n");
}

export async function runCli(command: string, args: string[], inputText?: string, cwd = REPO_ROOT): Promise<RunCliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      rejectPromise(error);
    });
    child.on("close", (exitCode) => {
      resolvePromise({
        ok: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
      });
    });

    if (inputText) {
      child.stdin.write(inputText);
    }
    child.stdin.end();
  });
}

export async function tryRunCli(command: string, args: string[], inputText?: string, cwd = REPO_ROOT): Promise<RunCliResult> {
  try {
    return await runCli(command, args, inputText, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      stdout: "",
      stderr: message,
      exitCode: null,
    };
  }
}

type PtyModule = {
  spawn: (
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      cols?: number;
      rows?: number;
      name?: string;
    },
  ) => {
    onData(handler: (text: string) => void): void;
    onExit(handler: (event: { exitCode: number; signal?: number }) => void): void;
    write(text: string): void;
    kill(signal?: string | number): void;
    resize?(columns: number, rows: number): void;
  };
};

function loadNodePty(): PtyModule | null {
  try {
    const require = createRequire(import.meta.url);
    const candidate = require("node-pty") as Partial<PtyModule> | null;
    if (candidate && typeof candidate.spawn === "function") {
      return candidate as PtyModule;
    }
  } catch {
    return null;
  }
  return null;
}

function createSpawnSession(command: string, args: string[], options: InteractiveSessionOptions = {}): InteractiveSession {
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const dataHandlers = new Set<(text: string) => void>();
  const exitHandlers = new Set<(event: { exitCode: number | null; signal?: string | null }) => void>();

  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    dataHandlers.forEach((handler) => handler(text));
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    dataHandlers.forEach((handler) => handler(text));
  });

  child.on("close", (exitCode, signal) => {
    exitHandlers.forEach((handler) => handler({ exitCode, signal: signal ? String(signal) : null }));
  });

  child.on("error", (error) => {
    const text = error instanceof Error ? error.message : String(error);
    dataHandlers.forEach((handler) => handler(text));
    exitHandlers.forEach((handler) => handler({ exitCode: null, signal: null }));
  });

  return {
    onData(handler) {
      dataHandlers.add(handler);
    },
    onExit(handler) {
      exitHandlers.add(handler);
    },
    write(text) {
      if (!child.stdin.destroyed) {
        child.stdin.write(text);
      }
    },
    kill(signal = "SIGTERM") {
      child.kill(signal as NodeJS.Signals | number);
    },
    resize() {
      // No PTY available in the fallback path.
    },
  };
}

function createExpectSession(command: string, args: string[], options: InteractiveSessionOptions = {}): InteractiveSession {
  const child = spawn("expect", ["-c", buildExpectSessionScript(command, args)], {
    cwd: options.cwd ?? REPO_ROOT,
    env: {
      ...process.env,
      COLUMNS: String(options.cols ?? 100),
      LINES: String(options.rows ?? 36),
      ...(options.env ?? {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const dataHandlers = new Set<(text: string) => void>();
  const exitHandlers = new Set<(event: { exitCode: number | null; signal?: string | null }) => void>();

  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    dataHandlers.forEach((handler) => handler(text));
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    dataHandlers.forEach((handler) => handler(text));
  });

  child.on("close", (exitCode, signal) => {
    exitHandlers.forEach((handler) => handler({ exitCode, signal: signal ? String(signal) : null }));
  });

  child.on("error", (error) => {
    const text = error instanceof Error ? error.message : String(error);
    dataHandlers.forEach((handler) => handler(text));
    exitHandlers.forEach((handler) => handler({ exitCode: null, signal: null }));
  });

  return {
    onData(handler) {
      dataHandlers.add(handler);
    },
    onExit(handler) {
      exitHandlers.add(handler);
    },
    write(text) {
      if (!child.stdin.destroyed) {
        child.stdin.write(text);
      }
    },
    kill(signal = "SIGTERM") {
      child.kill(signal as NodeJS.Signals | number);
    },
    resize() {
      // expect does not expose a resize hook for the spawned PTY.
    },
  };
}

function createNodePtySession(command: string, args: string[], options: InteractiveSessionOptions = {}): InteractiveSession {
  const module = loadNodePty();
  if (!module) {
    try {
      return createExpectSession(command, args, options);
    } catch {
      return createSpawnSession(command, args, options);
    }
  }

  try {
    const pty = module.spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      cols: options.cols ?? 100,
      rows: options.rows ?? 36,
      name: "xterm-color",
    });

    return {
      onData(handler) {
        pty.onData(handler);
      },
      onExit(handler) {
        pty.onExit(({ exitCode, signal }) => {
          handler({ exitCode, signal: signal ? String(signal) : null });
        });
      },
      write(text) {
        pty.write(text);
      },
      kill(signal = "SIGTERM") {
        pty.kill(signal);
      },
      resize(columns, rows) {
        pty.resize?.(columns, rows);
      },
    };
  } catch {
    try {
      return createExpectSession(command, args, options);
    } catch {
      return createSpawnSession(command, args, options);
    }
  }
}

export function createInteractiveSession(command: string, args: string[], options: InteractiveSessionOptions = {}): InteractiveSession {
  return createBufferedSession(createNodePtySession(command, args, options));
}
