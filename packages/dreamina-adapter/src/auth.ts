import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  AdapterAuthStatus,
  AdapterLoginMode,
  AdapterLoginSession,
} from "@workflow-studio/workflow-core";
import { REPO_ROOT } from "./runtime.js";
import {
  normalizeTerminalOutput,
  runCli,
  type RunCliResult,
} from "./cli.js";

const DEFAULT_DREAMINA_BIN = process.env.DREAMINA_BIN ?? process.env.DREAMINA_CLI ?? "dreamina";
const LOGIN_MESSAGE = "Waiting for Dreamina OAuth device authorization to complete.";
const LOGIN_PENDING_MESSAGE = "Open the verification URL, enter the user code, and keep this panel open while Dreamina checks login status.";
const LOGIN_COMPLETED_MESSAGE = "Dreamina login completed.";
const LOGIN_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const AUTH_REFRESH_THROTTLE_MS = 1000;
const CHECKLOGIN_THROTTLE_MS = 1000;
const LOGIN_SESSION_TIMEOUT_MESSAGE = "Dreamina OAuth login session timed out. Please start another device login session.";
const QR_READY_PATTERN = /^\[DREAMINA:QR_READY\]\s+(.+)$/m;
const VERIFICATION_URI_PATTERNS = [
  /^\s*verification_uri\s*[:=]\s*(\S+)\s*$/im,
  /^\s*verification uri\s*[:=]\s*(\S+)\s*$/im,
];
const USER_CODE_PATTERNS = [
  /^\s*user_code\s*[:=]\s*([A-Z0-9-]+)\s*$/im,
  /^\s*user code\s*[:=]\s*([A-Z0-9-]+)\s*$/im,
];
const DEVICE_CODE_PATTERNS = [
  /^\s*device_code\s*[:=]\s*(\S+)\s*$/im,
  /^\s*device code\s*[:=]\s*(\S+)\s*$/im,
];
const FATAL_CHECKLOGIN_PATTERNS = [
  "expired_token",
  "access_denied",
  "invalid device code",
  "invalid_device_code",
  "device code expired",
];

type LoginSessionState = AdapterLoginSession & {
  output: string;
  qrImagePath: string | null;
  lastAuthRefreshAtMs: number | null;
  authRefreshInFlight: Promise<AdapterAuthStatus> | null;
  deadlineAtMs: number;
  lastCheckloginAtMs: number | null;
  checkloginInFlight: Promise<RunCliResult> | null;
  authorizationCompletedAtMs: number | null;
};

export interface DreaminaAuthServiceDependencies {
  cliBin?: string;
  now?: () => Date;
  randomId?: () => string;
  runCli?: typeof runCli;
}

export interface DreaminaAuthService {
  getAuthStatus(forceRefresh?: boolean): Promise<AdapterAuthStatus>;
  startLoginSession(mode: AdapterLoginMode): Promise<AdapterLoginSession>;
  getLoginSession(sessionId: string): Promise<AdapterLoginSession | null>;
  logout(): Promise<AdapterAuthStatus>;
}

type CreditsPayload = {
  vipCredit?: number;
  giftCredit?: number;
  purchaseCredit?: number;
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
    terminalOutput: session.terminalOutput,
    verificationUri: session.verificationUri,
    userCode: session.userCode,
    deviceCode: session.deviceCode ?? null,
    qrText: session.qrText ?? null,
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

  if (typeof totalCredit !== "number") {
    return null;
  }

  return {
    vipCredit: typeof vipCredit === "number" ? vipCredit : undefined,
    giftCredit: typeof giftCredit === "number" ? giftCredit : undefined,
    purchaseCredit: typeof purchaseCredit === "number" ? purchaseCredit : undefined,
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

function extractQrImagePath(output: string): string | null {
  const match = output.match(QR_READY_PATTERN);
  const rawPath = match?.[1]?.trim();
  return rawPath ? rawPath : null;
}

function toPngDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function readStringValue(candidate: Record<string, unknown> | null, keys: string[]): string | null {
  if (!candidate) {
    return null;
  }

  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readPatternValue(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function updateSessionArtifacts(session: LoginSessionState): void {
  const output = normalizeTerminalOutput(session.output);
  const parsed = parseJsonObject(output);
  session.terminalOutput = output.trim().length > 0 ? output : null;
  session.qrText = session.terminalOutput;
  session.verificationUri = readStringValue(parsed, ["verification_uri", "verificationUri"])
    ?? readPatternValue(output, VERIFICATION_URI_PATTERNS);
  session.userCode = readStringValue(parsed, ["user_code", "userCode"])
    ?? readPatternValue(output, USER_CODE_PATTERNS);
  session.deviceCode = readStringValue(parsed, ["device_code", "deviceCode"])
    ?? readPatternValue(output, DEVICE_CODE_PATTERNS);

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

function appendSessionOutput(session: LoginSessionState, text: string): void {
  const normalized = normalizeTerminalOutput(text).trim();
  if (!normalized) {
    return;
  }

  const current = normalizeTerminalOutput(session.output).trim();
  if (current === normalized || current.endsWith(`\n${normalized}`)) {
    updateSessionArtifacts(session);
    return;
  }

  session.output = [current, normalized].filter(Boolean).join("\n");
  updateSessionArtifacts(session);
}

function hasAuthMaterial(session: LoginSessionState): boolean {
  return Boolean(session.deviceCode || session.userCode || session.verificationUri || session.qrImageDataUrl);
}

function checkloginText(result: RunCliResult): string {
  return normalizeTerminalOutput([result.stdout, result.stderr].filter(Boolean).join("\n")).trim().toLowerCase();
}

function isRecoverableCheckloginResult(result: RunCliResult): boolean {
  const text = checkloginText(result);
  if (text && FATAL_CHECKLOGIN_PATTERNS.some((pattern) => text.includes(pattern))) {
    return false;
  }

  if (result.ok) {
    return false;
  }

  if (!text) {
    return true;
  }

  return true;
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
  updateSessionArtifacts(session);
}

function createSessionState(mode: AdapterLoginMode, now: () => Date, randomId: () => string): LoginSessionState {
  const startedAt = now();
  return {
    sessionId: randomId(),
    mode,
    phase: "pending",
    terminalOutput: null,
    verificationUri: null,
    userCode: null,
    deviceCode: null,
    qrText: null,
    qrImageDataUrl: null,
    message: LOGIN_MESSAGE,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    output: "",
    qrImagePath: null,
    lastAuthRefreshAtMs: null,
    authRefreshInFlight: null,
    deadlineAtMs: startedAt.getTime() + LOGIN_SESSION_TIMEOUT_MS,
    lastCheckloginAtMs: null,
    checkloginInFlight: null,
    authorizationCompletedAtMs: null,
  };
}

function createDreaminaAuthRuntime(deps: DreaminaAuthServiceDependencies = {}) {
  const cliBin = deps.cliBin ?? DEFAULT_DREAMINA_BIN;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? defaultRandomId;
  const runCliFn = deps.runCli ?? runCli;
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
      const result = await runCliFn(resolvedCliBin, ["user_credit"], undefined, REPO_ROOT);
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

  function finalizePendingSession(session: LoginSessionState, phase: AdapterLoginSession["phase"], message: string): void {
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

  async function runChecklogin(session: LoginSessionState): Promise<RunCliResult | null> {
    if (!session.deviceCode) {
      return null;
    }

    if (session.checkloginInFlight) {
      return session.checkloginInFlight;
    }

    const runPromise = (async () => {
      const resolvedCliBin = await resolveCliBin();
      const result = await runCliFn(
        resolvedCliBin,
        ["login", "checklogin", `--device_code=${session.deviceCode}`, "--poll=0"],
        undefined,
        REPO_ROOT,
      );
      appendSessionOutput(session, [result.stdout, result.stderr].filter(Boolean).join("\n"));
      return result;
    })();

    session.checkloginInFlight = runPromise;
    try {
      const result = await runPromise;
      session.lastCheckloginAtMs = now().getTime();
      return result;
    } finally {
      if (session.checkloginInFlight === runPromise) {
        session.checkloginInFlight = null;
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
      finalizePendingSession(session, "success", LOGIN_COMPLETED_MESSAGE);
    }
  }

  async function reconcilePendingSession(session: LoginSessionState): Promise<void> {
    if (session.phase !== "pending") {
      return;
    }

    updateSessionArtifacts(session);

    const currentTime = now().getTime();
    if (currentTime >= session.deadlineAtMs) {
      finalizePendingSession(session, "fail", LOGIN_SESSION_TIMEOUT_MESSAGE);
      return;
    }

    if (session.deviceCode) {
      const shouldChecklogin =
        session.lastCheckloginAtMs === null
        || currentTime - session.lastCheckloginAtMs >= CHECKLOGIN_THROTTLE_MS;

      if (!shouldChecklogin) {
        return;
      }

      const checkloginResult = await runChecklogin(session);
      if (session.phase !== "pending") {
        return;
      }

      const auth = await refreshPendingSessionAuth(session);
      if (session.phase !== "pending") {
        return;
      }

      if (auth.loggedIn) {
        finalizePendingSession(session, "success", LOGIN_COMPLETED_MESSAGE);
        return;
      }

      if (checkloginResult?.ok) {
        session.authorizationCompletedAtMs = now().getTime();
        session.message = "Authorization completed. Waiting for Dreamina to refresh the local login state.";
        return;
      }

      if (checkloginResult && !checkloginResult.ok && !isRecoverableCheckloginResult(checkloginResult)) {
        const output = normalizeTerminalOutput([checkloginResult.stdout, checkloginResult.stderr].filter(Boolean).join("\n")).trim();
        finalizePendingSession(session, "fail", output || "Dreamina login check failed.");
        return;
      }

      session.message = session.authorizationCompletedAtMs !== null
        ? "Authorization completed. Waiting for Dreamina to refresh the local login state."
        : LOGIN_PENDING_MESSAGE;
      return;
    }

    const shouldRefreshAuth =
      session.lastAuthRefreshAtMs === null
      || currentTime - session.lastAuthRefreshAtMs >= AUTH_REFRESH_THROTTLE_MS;

    if (!shouldRefreshAuth) {
      return;
    }

    const auth = await refreshPendingSessionAuth(session);
    if (session.phase !== "pending") {
      return;
    }
    if (auth.loggedIn) {
      finalizePendingSession(session, "success", LOGIN_COMPLETED_MESSAGE);
    }
  }

  function terminatePendingSessions(message: string): void {
    for (const session of loginSessions.values()) {
      if (session.phase !== "pending") {
        continue;
      }

      finalizePendingSession(session, "fail", message);
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
    updateSessionArtifacts(session);
    return toSessionSnapshot(session);
  }

  async function startLoginSession(mode: AdapterLoginMode): Promise<AdapterLoginSession> {
    if (mode === "login" && authCache?.loggedIn) {
      const startedAtDate = now();
      const startedAt = startedAtDate.toISOString();
      const startedAtMs = startedAtDate.getTime();
      const session: LoginSessionState = {
        sessionId: randomId(),
        mode,
        phase: "success",
        terminalOutput: null,
        verificationUri: null,
        userCode: null,
        deviceCode: null,
        qrText: null,
        qrImageDataUrl: null,
        message: "Dreamina is already logged in.",
        startedAt,
        finishedAt: startedAt,
        output: "",
        qrImagePath: null,
        lastAuthRefreshAtMs: null,
        authRefreshInFlight: null,
        deadlineAtMs: startedAtMs + LOGIN_SESSION_TIMEOUT_MS,
        lastCheckloginAtMs: null,
        checkloginInFlight: null,
        authorizationCompletedAtMs: null,
      };
      registerSession(session);
      return toSessionSnapshot(session);
    }

    const existingPendingSession = await activePendingSession();
    if (existingPendingSession?.phase === "pending") {
      return toSessionSnapshot(existingPendingSession);
    }

    const session = createSessionState(mode, now, randomId);
    registerSession(session);

    try {
      const result = await runCliFn(cliBin, [mode, "--headless"], undefined, REPO_ROOT);
      appendSessionOutput(session, [result.stdout, result.stderr].filter(Boolean).join("\n"));

      if (hasAuthMaterial(session)) {
        if (!session.deviceCode) {
          finalizePendingSession(
            session,
            "fail",
            "Dreamina headless login output is missing device_code, so automatic checklogin cannot continue.",
          );
        } else {
          session.message = LOGIN_PENDING_MESSAGE;
        }
        return toSessionSnapshot(session);
      }

      const auth = await getAuthStatus(true);
      if (auth.loggedIn) {
        finalizeSession(session, "success", "Dreamina is already logged in.", now);
        return toSessionSnapshot(session);
      }

      const output = normalizeTerminalOutput([result.stdout, result.stderr].filter(Boolean).join("\n")).trim();
      finalizeSession(session, "fail", output || `Dreamina ${mode} --headless did not return OAuth login material.`, now);
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
      const result = await runCliFn(resolvedCliBin, ["logout"], undefined, REPO_ROOT);
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
