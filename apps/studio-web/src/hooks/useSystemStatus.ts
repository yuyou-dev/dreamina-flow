import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAdapterLoginSession, logoutAdapter, startAdapterLogin } from "../lib/api";
import type {
  AdapterLoginMode,
  AdapterLoginSession,
  AdapterStatus,
  PendingResumeAction,
} from "../types";

export type SystemStatusIntent = "overview" | "authRequired";
const PENDING_LOGIN_SESSION_STORAGE_KEY = "workflow-studio.pending-login-session-id";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useSystemStatus({
  runtimeStatus,
  refreshRuntimeStatus,
  onError,
}: {
  runtimeStatus: AdapterStatus | null;
  refreshRuntimeStatus: () => Promise<AdapterStatus | null>;
  onError: (message: string) => void;
}) {
  const [isSystemStatusOpen, setIsSystemStatusOpen] = useState(false);
  const [loginSession, setLoginSession] = useState<AdapterLoginSession | null>(null);
  const [pendingResumeAction, setPendingResumeAction] = useState<PendingResumeAction | null>(null);
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [statusIntent, setStatusIntent] = useState<SystemStatusIntent>("overview");
  const pollingTimerRef = useRef<number | null>(null);
  const effectiveLoginSucceeded = Boolean(runtimeStatus?.auth.loggedIn || loginSession?.phase === "success");

  const clearPollingTimer = useCallback(() => {
    if (pollingTimerRef.current !== null) {
      window.clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  const openSystemStatus = useCallback(() => {
    setStatusIntent("overview");
    setIsSystemStatusOpen(true);
  }, []);

  const dismissSystemStatus = useCallback(() => {
    setIsSystemStatusOpen(false);
  }, []);

  const clearPendingResumeAction = useCallback(() => {
    setPendingResumeAction(null);
  }, []);

  const closeSystemStatus = useCallback(() => {
    dismissSystemStatus();
    clearPendingResumeAction();
    setStatusIntent("overview");
  }, [clearPendingResumeAction, dismissSystemStatus]);

  const beginLogin = useCallback(async (mode: AdapterLoginMode) => {
    setIsSystemStatusOpen(true);
    setIsStartingLogin(true);
    setLoginSession(null);

    try {
      const session = await startAdapterLogin(mode);
      setLoginSession(session);
      if (session.phase !== "pending") {
        await refreshRuntimeStatus();
      }
    } catch (error) {
      setPendingResumeAction(null);
      onError(errorMessage(error, `Failed to start Dreamina ${mode}.`));
    } finally {
      setIsStartingLogin(false);
    }
  }, [onError, refreshRuntimeStatus]);

  const handleAuthRequired = useCallback(async (action: PendingResumeAction) => {
    setPendingResumeAction(action);
    setStatusIntent("authRequired");
    setIsSystemStatusOpen(true);

    if (loginSession?.phase === "pending" || isStartingLogin) {
      return;
    }

    setLoginSession(null);
  }, [isStartingLogin, loginSession?.phase]);

  const performLogout = useCallback(async () => {
    clearPollingTimer();
    setIsLoggingOut(true);
    setStatusIntent("overview");

    try {
      await logoutAdapter();
      setLoginSession(null);
      setPendingResumeAction(null);
      await refreshRuntimeStatus();
      setIsSystemStatusOpen(true);
    } catch (error) {
      onError(errorMessage(error, "Failed to log out of Dreamina."));
    } finally {
      setIsLoggingOut(false);
    }
  }, [clearPollingTimer, onError, refreshRuntimeStatus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sessionId = window.localStorage.getItem(PENDING_LOGIN_SESSION_STORAGE_KEY);
    if (!sessionId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [runtimeResult, sessionResult] = await Promise.allSettled([
          refreshRuntimeStatus(),
          fetchAdapterLoginSession(sessionId),
        ]);

        if (cancelled) {
          return;
        }

        const freshRuntimeStatus = runtimeResult.status === "fulfilled" ? runtimeResult.value : null;
        if (freshRuntimeStatus?.auth.loggedIn) {
          window.localStorage.removeItem(PENDING_LOGIN_SESSION_STORAGE_KEY);
          return;
        }

        if (sessionResult.status === "fulfilled" && sessionResult.value.phase === "pending") {
          setLoginSession(sessionResult.value);
          return;
        }

        if (sessionResult.status === "fulfilled") {
          setLoginSession(sessionResult.value);
        }
        window.localStorage.removeItem(PENDING_LOGIN_SESSION_STORAGE_KEY);
      } catch {
        if (!cancelled) {
          window.localStorage.removeItem(PENDING_LOGIN_SESSION_STORAGE_KEY);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshRuntimeStatus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (runtimeStatus?.auth.loggedIn) {
      clearPollingTimer();
      setLoginSession((current) => (current?.phase === "pending" ? null : current));
      window.localStorage.removeItem(PENDING_LOGIN_SESSION_STORAGE_KEY);
      return;
    }

    if (loginSession?.phase === "pending") {
      window.localStorage.setItem(PENDING_LOGIN_SESSION_STORAGE_KEY, loginSession.sessionId);
      return;
    }

    window.localStorage.removeItem(PENDING_LOGIN_SESSION_STORAGE_KEY);
  }, [clearPollingTimer, loginSession, runtimeStatus?.auth.loggedIn]);

  useEffect(() => {
    clearPollingTimer();

    if (!loginSession || loginSession.phase !== "pending" || runtimeStatus?.auth.loggedIn) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const nextSession = await fetchAdapterLoginSession(loginSession.sessionId);
        if (cancelled) {
          return;
        }

        setLoginSession(nextSession);
        const nextRuntimeStatus = await refreshRuntimeStatus();
        if (cancelled) {
          return;
        }

        if (nextRuntimeStatus?.auth.loggedIn) {
          return;
        }

        if (nextSession.phase === "pending") {
          pollingTimerRef.current = window.setTimeout(() => {
            void poll();
          }, 1200);
          return;
        }

        if (nextSession.phase === "fail") {
          setPendingResumeAction(null);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        onError(errorMessage(error, "Failed to refresh Dreamina login status."));
        pollingTimerRef.current = window.setTimeout(() => {
          void poll();
        }, 1800);
      }
    };

    pollingTimerRef.current = window.setTimeout(() => {
      void poll();
    }, 1200);

    return () => {
      cancelled = true;
      clearPollingTimer();
    };
  }, [clearPollingTimer, loginSession, onError, refreshRuntimeStatus, runtimeStatus?.auth.loggedIn]);

  return {
    isSystemStatusOpen,
    loginSession,
    effectiveLoginSucceeded,
    pendingResumeAction,
    isStartingLogin,
    isLoggingOut,
    statusIntent,
    openSystemStatus,
    dismissSystemStatus,
    closeSystemStatus,
    beginLogin,
    performLogout,
    handleAuthRequired,
    clearPendingResumeAction,
  };
}
