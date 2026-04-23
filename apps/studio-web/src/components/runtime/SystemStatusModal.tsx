import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, KeyRound, LoaderCircle, LogOut, RefreshCw, ShieldAlert, X } from "lucide-react";
import logoStatic from "../../assets/brand/logo-static.png";
import type { SystemStatusIntent } from "../../hooks/useSystemStatus";
import type {
  AdapterLoginMode,
  AdapterLoginSession,
  AdapterStatus,
  PendingResumeAction,
} from "../../types";

function actionLabel(action: PendingResumeAction | null): string {
  if (!action) {
    return "No blocked action";
  }

  return action.kind === "runNode" ? `Run Node (${action.nodeId})` : `Run Chain (${action.nodeId})`;
}

function creditValue(value: number | undefined): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : "--";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Not checked yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Tone = "danger" | "pending" | "success" | "neutral";

const toneClassMap: Record<
  Tone,
  {
    header: string;
    hero: string;
    badge: string;
    banner: string;
  }
> = {
  danger: {
    header: "bg-[linear-gradient(135deg,#ffe7df_0%,#ffcdbd_100%)]",
    hero: "bg-[#fff0ea]",
    badge: "bg-[#ffd9d0] text-[#8a201c]",
    banner: "bg-[#ffd9d0] text-[#8a201c]",
  },
  pending: {
    header: "bg-[linear-gradient(135deg,#fff7d6_0%,#ffd89b_100%)]",
    hero: "bg-[#fff7db]",
    badge: "bg-[#fff1b8] text-[#8a5a00]",
    banner: "bg-[#fff1b8] text-[#8a5a00]",
  },
  success: {
    header: "bg-[linear-gradient(135deg,#e6ffd8_0%,#c7ffd1_100%)]",
    hero: "bg-[#efffe8]",
    badge: "bg-[#d9ffd5] text-[#14532d]",
    banner: "bg-[#d9ffd5] text-[#14532d]",
  },
  neutral: {
    header: "bg-[linear-gradient(135deg,#f1efe6_0%,#e0dbd0_100%)]",
    hero: "bg-[#f5f3ea]",
    badge: "bg-[#ece9de] text-[#45413b]",
    banner: "bg-[#ece9de] text-[#45413b]",
  },
};

export function SystemStatusModal({
  open,
  runtimeStatus,
  loginSession,
  pendingResumeAction,
  isStartingLogin,
  isLoggingOut,
  isResumingAction,
  statusIntent,
  onClose,
  onStartLogin,
  onLogout,
}: {
  open: boolean;
  runtimeStatus: AdapterStatus | null;
  loginSession: AdapterLoginSession | null;
  pendingResumeAction: PendingResumeAction | null;
  isStartingLogin: boolean;
  isLoggingOut: boolean;
  isResumingAction: boolean;
  statusIntent: SystemStatusIntent;
  onClose: () => void;
  onStartLogin: (mode: AdapterLoginMode) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const credits = runtimeStatus?.auth.credits;
  const isCliReady = Boolean(runtimeStatus?.cliFound);
  const isLoggedIn = Boolean(runtimeStatus?.auth.loggedIn);
  const effectiveLoginSucceeded = isLoggedIn || loginSession?.phase === "success";
  const isRefreshingAccount = loginSession?.phase === "success" && !isLoggedIn;
  const isSessionPending = !effectiveLoginSucceeded && (isStartingLogin || loginSession?.phase === "pending");
  const isSessionFailed = !effectiveLoginSucceeded && loginSession?.phase === "fail";
  const hasBlockedAction = Boolean(pendingResumeAction);
  const primaryLoginMode: AdapterLoginMode = effectiveLoginSucceeded ? "relogin" : "login";
  const showLoginPanel = !effectiveLoginSucceeded;
  const showLegacyQr = Boolean(loginSession?.qrImageDataUrl);
  const hasDeviceFlowDetails = Boolean(loginSession?.verificationUri || loginSession?.userCode || loginSession?.deviceCode);
  const sessionLabel = isLoggedIn
    ? "auth · logged in"
    : loginSession
      ? `${loginSession.mode} · ${loginSession.phase}`
      : "No active session";
  const sessionMessage = effectiveLoginSucceeded
    ? runtimeStatus?.auth.message ?? loginSession?.message ?? "Dreamina login completed."
    : loginSession?.message ?? runtimeStatus?.auth.message ?? "Start Dreamina headless login to render the device authorization details here.";

  let tone: Tone = "danger";
  if (!isCliReady) {
    tone = "neutral";
  } else if (isLoggedIn) {
    tone = "success";
  } else if (isRefreshingAccount || isSessionPending || isResumingAction) {
    tone = "pending";
  }

  let stageLabel = "Login Required";
  let stageTitle = "Dreamina login is required";
  let stageDescription = "Start a headless login session, open the verification URL, and enter the user code to finish OAuth Device Flow.";

  if (!isCliReady) {
    stageLabel = "CLI Missing";
    stageTitle = "Dreamina CLI is not available in this environment";
    stageDescription = "Install the Dreamina CLI first. The account panel can only start headless login after the CLI is ready.";
  } else if (isLoggedIn) {
    stageLabel = "Account Ready";
    stageTitle = "Dreamina account connected";
    stageDescription = hasBlockedAction
      ? "The account is back online. The blocked action will resume automatically once the runtime settles."
      : "Credits and login status are up to date. You can run nodes and chains from the canvas.";
  } else if (isRefreshingAccount) {
    stageLabel = "Refreshing";
    stageTitle = "Login succeeded, refreshing account details";
    stageDescription = "Dreamina accepted the login. Waiting for the runtime snapshot and credits to refresh.";
  } else if (isSessionPending) {
    stageLabel = "Waiting for Authorization";
    stageTitle = "Complete Dreamina OAuth Device Flow";
    stageDescription = "Open the verification URL, enter the user code, and keep this panel open while the runtime checks login status.";
  } else if (statusIntent === "authRequired" && pendingResumeAction) {
    stageLabel = "Login Required";
    stageTitle = `${actionLabel(pendingResumeAction)} is blocked until you log in`;
    stageDescription = "Open a headless login session from this panel, finish OAuth Device Flow, and the canvas will continue the blocked action once.";
  } else if (isSessionFailed) {
    stageLabel = "Login Failed";
    stageTitle = "The last headless login attempt did not complete";
    stageDescription = "Review the device authorization output below and try starting another headless login session.";
  }

  const toneClasses = toneClassMap[tone];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/65 px-4 py-6" onClick={onClose}>
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-y-auto rounded-[28px] border-[3px] border-black bg-[#fbfbf8] shadow-[5px_6px_0px_0px_rgba(0,0,0,1)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`flex items-start justify-between gap-4 border-b-[3px] border-black px-5 py-4 ${toneClasses.header}`}>
          <div className="flex items-center gap-4">
            <img src={logoStatic} alt="歪比巴布 Workflow Studio" className="h-14 w-14 rounded-[18px] border-[2px] border-black bg-white object-cover shadow-[2px_3px_0px_0px_rgba(0,0,0,1)]" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Account Status</div>
              <div className="mt-1 text-[24px] font-black leading-none">歪比巴布Workflow Studio</div>
              <div className="mt-2 text-[11px] font-medium leading-5 text-gray-700">
                Login, credits, CLI status, and the headless Dreamina OAuth flow all live in one place.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-[2px] border-black bg-white"
          >
            <X size={18} strokeWidth={3} />
          </button>
        </div>

        <div className={`grid gap-5 px-4 py-4 sm:px-5 sm:py-5 ${showLoginPanel ? "lg:grid-cols-[1.08fr_0.92fr]" : ""}`}>
          <div className="flex flex-col gap-4">
            <div className={`rounded-[26px] border-[3px] border-black p-5 ${toneClasses.hero}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className={`inline-flex items-center gap-2 rounded-full border-[2px] border-black px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] ${toneClasses.badge}`}>
                    {tone === "pending" ? (
                      <LoaderCircle size={12} className="shrink-0 animate-spin" />
                    ) : tone === "success" ? (
                      <CheckCircle2 size={12} className="shrink-0" />
                    ) : (
                      <ShieldAlert size={12} className="shrink-0" />
                    )}
                    {stageLabel}
                  </div>
                  <div className="mt-4 text-[22px] font-black leading-tight sm:text-[24px]">{stageTitle}</div>
                  <div className="mt-3 h-[54px] max-w-2xl overflow-hidden text-[12px] font-medium leading-[18px] text-gray-700">{stageDescription}</div>
                </div>

                <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto">
                  {isLoggedIn ? (
                    <button
                      type="button"
                      disabled={isSessionPending || isRefreshingAccount || isStartingLogin || isLoggingOut || isResumingAction}
                      onClick={() => void onLogout()}
                      className="flex w-full items-center justify-center gap-2 rounded-[18px] border-[2px] border-black bg-white px-4 py-3 text-[10px] font-black uppercase disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                    >
                      {isLoggingOut ? <LoaderCircle size={14} className="animate-spin" /> : <LogOut size={14} />}
                      {isLoggingOut ? "Logging Out" : "Log Out"}
                    </button>
                  ) : null}
                  {isLoggedIn ? (
                    <button
                      type="button"
                      disabled={isSessionPending || isRefreshingAccount || isStartingLogin || isLoggingOut || isResumingAction}
                      onClick={() => void onStartLogin(primaryLoginMode)}
                      className="flex w-full items-center justify-center gap-2 rounded-[18px] border-[2px] border-black bg-white px-4 py-3 text-[10px] font-black uppercase disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                    >
                      {isStartingLogin ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {isStartingLogin ? "Starting Relogin" : "Start Headless Relogin"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {hasBlockedAction ? (
              <div className={`rounded-[20px] border-[2px] border-black px-4 py-3 text-[11px] font-black leading-5 ${toneClasses.banner}`}>
                {isResumingAction
                  ? `Resuming ${actionLabel(pendingResumeAction)} now.`
                  : `${actionLabel(pendingResumeAction)} will resume automatically after a successful login.`}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[20px] border-[2px] border-black bg-white p-4">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Login State</div>
                <div className="mt-2 text-sm font-black">{isRefreshingAccount ? "Refreshing" : effectiveLoginSucceeded ? "Logged In" : "Login Required"}</div>
                <div className="mt-1 text-[10px] font-medium text-gray-600">{formatTimestamp(runtimeStatus?.auth.lastCheckedAt)}</div>
              </div>
              <div className="rounded-[20px] border-[2px] border-black bg-white p-4">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Total Credits</div>
                <div className="mt-2 text-sm font-black">{creditValue(credits?.totalCredit)}</div>
                <div className="mt-1 text-[10px] font-medium text-gray-600">Available Dreamina balance</div>
              </div>
              <div className="rounded-[20px] border-[2px] border-black bg-white p-4">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">CLI Version</div>
                <div className="mt-2 text-sm font-black">{runtimeStatus?.cliVersion ?? "dreamina not found"}</div>
                <div className="mt-1 text-[10px] font-medium text-gray-600">{isCliReady ? "CLI available" : "Install CLI first"}</div>
              </div>
              <div className="rounded-[20px] border-[2px] border-black bg-white p-4">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Login Session</div>
                <div className="mt-2 text-sm font-black">{sessionLabel}</div>
                <div className="mt-1 text-[10px] font-medium text-gray-600">{loginSession?.sessionId ?? "No active session"}</div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-[20px] border-[2px] border-black bg-white p-4">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">CLI Path</div>
                <div className="mt-2 break-all text-[11px] font-medium leading-5 text-gray-700">{runtimeStatus?.cliPath ?? "Not detected"}</div>
              </div>
              <div className="rounded-[20px] border-[2px] border-black bg-white p-4">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Session Message</div>
                <div className="mt-2 h-[56px] overflow-hidden break-words text-[11px] font-medium leading-[18px] text-gray-700">
                  <div className="[display:-webkit-box] overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                    {sessionMessage}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[18px] border-[2px] border-black bg-[#f5f3ea] px-4 py-3">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">VIP</div>
                <div className="mt-1 text-[14px] font-black">{creditValue(credits?.vipCredit)}</div>
              </div>
              <div className="rounded-[18px] border-[2px] border-black bg-[#f5f3ea] px-4 py-3">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Gift</div>
                <div className="mt-1 text-[14px] font-black">{creditValue(credits?.giftCredit)}</div>
              </div>
              <div className="rounded-[18px] border-[2px] border-black bg-[#f5f3ea] px-4 py-3">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Purchase</div>
                <div className="mt-1 text-[14px] font-black">{creditValue(credits?.purchaseCredit)}</div>
              </div>
            </div>
          </div>

          {showLoginPanel ? (
            <div className="flex min-w-0 flex-col gap-4">
              <div className="min-w-0 rounded-[24px] border-[3px] border-black bg-[#f5f3ea] p-4 text-gray-900">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                  <KeyRound size={14} />
                  OAuth Device Login
                </div>
                <div className="min-w-0 space-y-3">
                  <div className="rounded-[18px] border-[2px] border-black bg-white p-4">
                    <div className="space-y-3">
                      {!isCliReady ? (
                        <div className="text-center text-[12px] font-medium leading-6 text-gray-700">
                          请先安装 Dreamina CLI，再从这里发起登录。
                        </div>
                      ) : isSessionPending || isStartingLogin ? (
                        hasDeviceFlowDetails ? (
                          <div className="space-y-3">
                            <div className="rounded-[16px] border-[2px] border-black bg-[#fff9db] px-4 py-3">
                              <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Verification URL</div>
                              <div className="mt-2 break-all text-[12px] font-medium leading-5 text-gray-700">
                                {loginSession?.verificationUri ? (
                                  <a
                                    href={loginSession.verificationUri}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline decoration-[2px] underline-offset-2"
                                  >
                                    {loginSession.verificationUri}
                                  </a>
                                ) : (
                                  "Waiting for Dreamina to print verification_uri."
                                )}
                              </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-[16px] border-[2px] border-black bg-[#f8f5ef] px-4 py-3">
                                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">User Code</div>
                                <div className="mt-2 break-all font-mono text-[20px] font-black tracking-[0.12em]">
                                  {loginSession?.userCode ?? "--"}
                                </div>
                              </div>
                              <div className="rounded-[16px] border-[2px] border-black bg-[#f8f5ef] px-4 py-3">
                                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Device Code</div>
                                <div className="mt-2 break-all font-mono text-[11px] font-medium leading-5 text-gray-700">
                                  {loginSession?.deviceCode ?? "Waiting for Dreamina to print device_code."}
                                </div>
                              </div>
                            </div>
                            {showLegacyQr ? (
                              <div className="rounded-[16px] border-[2px] border-dashed border-black bg-[#fffdfa] p-4">
                                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-500">Legacy QR Fallback</div>
                                <img
                                  src={loginSession?.qrImageDataUrl ?? undefined}
                                  alt="Dreamina login QR fallback"
                                  className="mt-3 max-h-[220px] w-full rounded-[12px] bg-white object-contain"
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-3 text-center text-[12px] font-medium leading-6 text-gray-700">
                            <LoaderCircle size={18} className="animate-spin" />
                            <span>正在启动登录，授权地址和 user code 会自动显示在这里。</span>
                          </div>
                        )
                      ) : isRefreshingAccount ? (
                        <div className="flex flex-col items-center gap-3 text-center text-[12px] font-medium leading-6 text-gray-700">
                          <LoaderCircle size={18} className="animate-spin" />
                          <span>Dreamina accepted the authorization. Waiting for the runtime status to refresh.</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-4 text-center">
                          <button
                            type="button"
                            disabled={isLoggingOut || isResumingAction}
                            onClick={() => void onStartLogin(primaryLoginMode)}
                            className="flex w-full items-center justify-center gap-2 rounded-[18px] border-[2px] border-black bg-[#ffe36c] px-4 py-3 text-[14px] font-black text-black shadow-[2px_3px_0px_0px_rgba(0,0,0,1)] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
                          >
                            <KeyRound size={16} />
                            开始设备登录
                          </button>
                          <div className="text-[12px] font-medium leading-6 text-gray-700">
                            点击后会在这里显示 verification URL、user code 和终端输出。
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <pre
                    className="h-[180px] min-w-0 overflow-x-hidden overflow-y-auto rounded-[18px] border-[2px] border-black bg-[#fffdfa] p-4 font-mono text-[11px] leading-4 whitespace-pre-wrap break-words text-[#5f5246] [overflow-wrap:anywhere]"
                  >
                    {loginSession?.terminalOutput
                      ?? loginSession?.message
                      ?? runtimeStatus?.auth.message
                      ?? "Terminal output will appear here after the headless login session starts."}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
