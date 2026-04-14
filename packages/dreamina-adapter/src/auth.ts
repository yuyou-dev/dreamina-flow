import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  AdapterAuthStatus,
  AdapterCredits,
  AdapterLoginMode,
  AdapterLoginSession,
} from "@workflow-studio/workflow-core";
import { REPO_ROOT } from "./runtime.js";
import {
  createInteractiveSession,
  normalizeTerminalOutput,
  runCli,
  type InteractiveSession,
  type RunCliResult,
} from "./cli.js";

const DEFAULT_DREAMINA_BIN = process.env.DREAMINA_BIN ?? process.env.DREAMINA_CLI ?? "dreamina";
const LOGIN_MESSAGE = "Waiting for Dreamina headless login to complete.";
const LOGIN_COMPLETED_MESSAGE = "Dreamina login completed.";
const LOGIN_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const AUTH_REFRESH_THROTTLE_MS = 1000;
const LOGIN_SESSION_TIMEOUT_MESSAGE = "Dreamina login session timed out. Please start another headless login session.";
const QR_READY_PATTERN = /^\[DREAMINA:QR_READY\]\s+(.+)$/m;

type LoginSessionState = AdapterLoginSession & {
  output: string;
  process: InteractiveSession | null;
  qrImagePath: string | null;
  lastAuthRefreshAtMs: number | null;
  authRefreshInFlight: Promise<AdapterAuthStatus> | null;
  deadlineAtMs: number;
};

export interface DreaminaAuthServiceDependencies {
  cliBin?: string;
  now?: () => Date;
  randomId?: () => string;
  runCli?: typeof runCli;
  createInteractiveSession?: typeof createInteractiveSession;
}

export interface DreaminaAuthService {
  getAuthStatus(forceRefresh?: boolean): Promise<AdapterAuthStatus>;
  startLoginSession(mode: AdapterLoginMode): Promise<AdapterLoginSession>;
  getLoginSession(sessionId: string): Promise<AdapterLoginSession | null>;
  logout(): Promise<AdapterAuthStatus>;
}

type CreditsPayload = {
  vipCredit: number;
  giftCredit: number;
  purchaseCredit: number;
  totalCredit: number;
};

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function defaultRandomId(): string {
  return randomUUID();
}

function toSessionSnapshot(session: LoginSessionState): AdapterLoginSession {
  return {
    sessionId: session.sessionId,
    mode: session.mode,
    phase: session.phase,
    qrText: session.qrText,
    qrImageDataUrl: session.qrImageDataUrl ?? null,
    message: session.message,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt ?? null,
  };
}

function createEmptyAuthStatus(timestamp: string, message: string): AdapterAuthStatus {
  return {
    loggedIn: false,
    credits: null,
    lastCheckedAt: timestamp,
    message,
  };
}

function parseCreditsPayload(payload: unknown): CreditsPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const vipCredit = candidate.vipCredit ?? candidate.vip_credit;
  const giftCredit = candidate.giftCredit ?? candidate.gift_credit;
  const purchaseCredit = candidate.purchaseCredit ?? candidate.purchase_credit;
  const totalCredit = candidate.totalCredit ?? candidate.total_credit;

  if (
    typeof vipCredit !== "number"
    || typeof giftCredit !== "number"
    || typeof purchaseCredit !== "number"
    || typeof totalCredit !== "number"
  ) {
    return null;
  }

  return {
    vipCredit,
    giftCredit,
    purchaseCredit,
    totalCredit,
  };
}

function parseUserCreditOutput(result: RunCliResult, timestamp: string): AdapterAuthStatus {
  const combined = result.ok ? result.stdout : [result.stdout, result.stderr].filter(Boolean).join("\n");
  const trimmed = combined.trim();

  if (!trimmed) {
    return createEmptyAuthStatus(timestamp, "Dreamina user_credit did not return any output.");
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const credits = parseCreditsPayload(parsed);
    if (credits) {
      return {
        loggedIn: true,
        credits: {
          vipCredit: credits.vipCredit,
          giftCredit: credits.giftCredit,
          purchaseCredit: credits.purchaseCredit,
          totalCredit: credits.totalCredit,
        },
        lastCheckedAt: timestamp,
        message: null,
      };
    }

    const message = typeof parsed === "object" && parsed
      ? String((parsed as Record<string, unknown>).error ?? (parsed as Record<string, unknown>).message ?? trimmed)
      : trimmed;
    return createEmptyAuthStatus(timestamp, message);
  } catch {
    return createEmptyAuthStatus(timestamp, trimmed);
  }
}

function combineSessionOutput(session: LoginSessionState): string {
  return session.output;
}

function extractQrImagePath(output: string): string | null {
  const match = output.match(QR_READY_PATTERN);
  const rawPath = match?.[1]?.trim();
  return rawPath ? rawPath : null;
}

function toPngDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function updateSessionQrArtifacts(session: LoginSessionState): void {
  const output = normalizeTerminalOutput(combineSessionOutput(session));
  session.qrText = output.trim().length > 0 ? output : null;

  const qrImagePath = extractQrImagePath(output);
  if (!qrImagePath) {
    return;
  }

  const shouldReloadQrImage = session.qrImagePath !== qrImagePath || !session.qrImageDataUrl;
  if (!shouldReloadQrImage) {
    return;
  }

  session.qrImagePath = qrImagePath;
  try {
    session.qrImageDataUrl = toPngDataUrl(readFileSync(qrImagePath));
  } catch {
    session.qrImageDataUrl = null;
  }
}

function finalizeSession(
  session: LoginSessionState,
  phase: AdapterLoginSession["phase"],
  message: string | null,
  now: () => Date,
): void {
  session.phase = phase;
  session.message = message;
  session.finishedAt = nowIso(now);
  session.process = null;
  updateSessionQrArtifacts(session);
}

function createSessionState(mode: AdapterLoginMode, now: () => Date, randomId: () => string): LoginSessionState {
  const startedAt = now();
  return {
    sessionId: randomId(),
    mode,
    phase: "pending",
    qrText: null,
    qrImageDataUrl: null,
    message: LOGIN_MESSAGE,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    output: "",
    process: null,
    qrImagePath: null,
    lastAuthRefreshAtMs: null,
    authRefreshInFlight: null,
    deadlineAtMs: startedAt.getTime() + LOGIN_SESSION_TIMEOUT_MS,
  };
}

function createDreaminaAuthRuntime(deps: DreaminaAuthServiceDependencies = {}) {
  const cliBin = deps.cliBin ?? DEFAULT_DREAMINA_BIN;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? defaultRandomId;
  const runCliFn = deps.runCli ?? runCli;
  const createSessionFn = deps.createInteractiveSession ?? createInteractiveSession;
  const loginSessions = new Map<string, LoginSessionState>();
  let resolvedCliBinPromise: Promise<string> | null = null;

  let authCache: AdapterAuthStatus | null = null;

  async function resolveCliBin(): Promise<string> {
    if (cliBin.includes("/")) {
      return cliBin;
    }

    if (!resolvedCliBinPromise) {
      resolvedCliBinPromise = runCliFn("which", [cliBin])
        .then((result) => {
          const resolved = result.stdout.trim().split(/\r?\n/)[0]?.trim();
          return resolved || cliBin;
        })
        .catch(() => cliBin);
    }

    return resolvedCliBinPromise;
  }

  async function refreshAuthStatus(forceRefresh = false): Promise<AdapterAuthStatus> {
    if (authCache && !forceRefresh) {
      return authCache;
    }

    const timestamp = nowIso(now);
    try {
      const resolvedCliBin = await resolveCliBin();
      const result = await runCliFn(resolvedCliBin, ["user_credit"]);
      authCache = parseUserCreditOutput(result, timestamp);
    } catch (error) {
      authCache = createEmptyAuthStatus(timestamp, error instanceof Error ? error.message : String(error));
    }
    return authCache;
  }

  function registerSession(session: LoginSessionState): void {
    loginSessions.set(session.sessionId, session);
  }

  async function activePendingSession(): Promise<LoginSessionState | null> {
    for (const session of loginSessions.values()) {
      if (session.phase !== "pending") {
        continue;
      }

      await reconcilePendingSession(session);
      if (session.phase === "pending") {
        return session;
      }
    }
    return null;
  }

  function finalizePendingSession(session: LoginSessionState, phase: AdapterLoginSession["phase"], message: string, process: InteractiveSession | null): void {
    if (process) {
      process.kill();
    }
    finalizeSession(session, phase, message, now);
  }

  async function refreshPendingSessionAuth(session: LoginSessionState): Promise<AdapterAuthStatus> {
    if (session.authRefreshInFlight) {
      return session.authRefreshInFlight;
    }

    const refreshPromise = refreshAuthStatus(true);
    session.authRefreshInFlight = refreshPromise;
    try {
      const auth = await refreshPromise;
      session.lastAuthRefreshAtMs = now().getTime();
      return auth;
    } finally {
      if (session.authRefreshInFlight === refreshPromise) {
        session.authRefreshInFlight = null;
      }
    }
  }

  async function sweepPendingSessions(auth: AdapterAuthStatus): Promise<void> {
    if (!auth.loggedIn) {
      return;
    }

    for (const session of loginSessions.values()) {
      if (session.phase !== "pending") {
        continue;
      }
      finalizePendingSession(session, "success", LOGIN_COMPLETED_MESSAGE, session.process);
    }
  }

  async function reconcilePendingSession(session: LoginSessionState): Promise<void> {
    if (session.phase !== "pending") {
      return;
    }

    updateSessionQrArtifacts(session);

    const currentTime = now().getTime();
    if (currentTime >= session.deadlineAtMs) {
      finalizePendingSession(session, "fail", LOGIN_SESSION_TIMEOUT_MESSAGE, session.process);
      return;
    }

    const shouldRefreshAuth =
      session.lastAuthRefreshAtMs === null
      || currentTime - session.lastAuthRefreshAtMs >= AUTH_REFRESH_THROTTLE_MS;

    if (shouldRefreshAuth) {
      const auth = await refreshPendingSessionAuth(session);
      if (session.phase !== "pending") {
        return;
      }
      if (auth.loggedIn) {
        finalizePendingSession(session, "success", LOGIN_COMPLETED_MESSAGE, session.process);
      }
    }
  }

  function terminatePendingSessions(message: string): void {
    for (const session of loginSessions.values()) {
      if (session.phase !== "pending") {
        continue;
      }

      finalizePendingSession(session, "fail", message, session.process);
    }
  }

  async function getLoginSession(sessionId: string): Promise<AdapterLoginSession | null> {
    const session = loginSessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.phase === "pending") {
      await reconcilePendingSession(session);
    }
    updateSessionQrArtifacts(session);
    return toSessionSnapshot(session);
  }

  async function startLoginSession(mode: AdapterLoginMode): Promise<AdapterLoginSession> {
    if (mode === "login") {
      // Avoid forcing a fresh `user_credit` probe right before `login --headless`.
      // In practice, the Dreamina CLI can fail to emit the QR session after that probe,
      // so only trust the cached auth snapshot if we already have one.
      if (authCache?.loggedIn) {
        const startedAtDate = now();
        const startedAt = startedAtDate.toISOString();
        const startedAtMs = startedAtDate.getTime();
        const session: LoginSessionState = {
          sessionId: randomId(),
          mode,
          phase: "success",
          qrText: null,
          qrImageDataUrl: null,
          message: "Dreamina is already logged in.",
          startedAt,
          finishedAt: startedAt,
          output: "",
          process: null,
          qrImagePath: null,
          lastAuthRefreshAtMs: null,
          authRefreshInFlight: null,
          deadlineAtMs: startedAtMs + LOGIN_SESSION_TIMEOUT_MS,
        };
        registerSession(session);
        return toSessionSnapshot(session);
      }
    }

    const existingPendingSession = await activePendingSession();
    if (existingPendingSession?.phase === "pending") {
      return toSessionSnapshot(existingPendingSession);
    }

    const session = createSessionState(mode, now, randomId);
    registerSession(session);

    try {
      // Interactive headless login is more reliable when launched with the configured
      // command name instead of the `which`-resolved absolute path.
      const interactiveCliBin = cliBin;
      const sessionProcess = createSessionFn(interactiveCliBin, [mode, "--headless"], {
        cwd: REPO_ROOT,
        env: process.env,
        cols: 100,
        rows: 36,
      });

      session.process = sessionProcess;
      sessionProcess.onData((chunk) => {
        session.output += chunk;
        updateSessionQrArtifacts(session);
      });
      sessionProcess.onExit(({ exitCode }) => {
        void (async () => {
          if (session.phase !== "pending") {
            return;
          }

          const auth = await getAuthStatus(true);
          if (session.phase !== "pending") {
            return;
          }

          if (auth.loggedIn) {
            finalizePendingSession(session, "success", LOGIN_COMPLETED_MESSAGE, session.process);
            return;
          }

          const output = normalizeTerminalOutput(combineSessionOutput(session)).trim();
          finalizePendingSession(session, "fail", output || `Dreamina ${mode} --headless exited with code ${exitCode}.`, session.process);
        })();
      });
    } catch (error) {
      finalizeSession(session, "fail", error instanceof Error ? error.message : String(error), now);
    }

    return toSessionSnapshot(session);
  }

  async function getAuthStatus(forceRefresh = false): Promise<AdapterAuthStatus> {
    const auth = await refreshAuthStatus(forceRefresh);
    if (forceRefresh) {
      await sweepPendingSessions(auth);
    }
    return auth;
  }

  async function logout(): Promise<AdapterAuthStatus> {
    const timestamp = nowIso(now);
    let message: string | null = null;

    terminatePendingSessions("Dreamina login session was cancelled.");

    try {
      const resolvedCliBin = await resolveCliBin();
      const result = await runCliFn(resolvedCliBin, ["logout"]);
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      message = combined || (result.ok ? "Dreamina logout completed." : "Dreamina logout failed.");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    authCache = null;
    const refreshed = await getAuthStatus(true);

    if (!refreshed.loggedIn) {
      authCache = {
        ...refreshed,
        lastCheckedAt: timestamp,
        message: message ?? refreshed.message ?? "Dreamina logout completed.",
      };
      return authCache;
    }

    authCache = {
      ...refreshed,
      message: message ?? refreshed.message,
    };
    return authCache;
  }

  return {
    getAuthStatus,
    startLoginSession,
    getLoginSession,
    logout,
  };
}

const defaultDreaminaAuthRuntime = createDreaminaAuthRuntime();

export function createDreaminaAuthService(deps: DreaminaAuthServiceDependencies = {}): DreaminaAuthService {
  return createDreaminaAuthRuntime(deps);
}

export async function getDreaminaAuthStatus(forceRefresh = false): Promise<AdapterAuthStatus> {
  return defaultDreaminaAuthRuntime.getAuthStatus(forceRefresh);
}

export async function startDreaminaLoginSession(mode: AdapterLoginMode): Promise<AdapterLoginSession> {
  return defaultDreaminaAuthRuntime.startLoginSession(mode);
}

export async function getDreaminaLoginSession(sessionId: string): Promise<AdapterLoginSession | null> {
  return defaultDreaminaAuthRuntime.getLoginSession(sessionId);
}

export async function logoutDreamina(): Promise<AdapterAuthStatus> {
  return defaultDreaminaAuthRuntime.logout();
}

export { normalizeTerminalOutput, parseCreditsPayload as parseDreaminaCreditsPayload, parseUserCreditOutput as parseDreaminaUserCreditOutput };
