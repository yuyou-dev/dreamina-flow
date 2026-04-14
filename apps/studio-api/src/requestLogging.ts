import { errorMessage, writeRuntimeLog } from "./logger.js";

type RequestMeta = Record<string, unknown>;

export type ApiRequestLogContext = {
  requestId: string;
  route: string;
  method: string;
  startedAt: number;
  meta: RequestMeta;
};

export async function startApiRequestLog({
  requestId,
  route,
  method,
  meta = {},
}: {
  requestId: string;
  route: string;
  method: string;
  meta?: RequestMeta;
}): Promise<ApiRequestLogContext> {
  const context: ApiRequestLogContext = {
    requestId,
    route,
    method,
    startedAt: Date.now(),
    meta,
  };
  try {
    await writeRuntimeLog("info", "api.request.started", {
      requestId,
      route,
      method,
      ...meta,
    });
  } catch {
    // Observability should not break request handling.
  }
  return context;
}

export async function finishApiRequestLog(
  context: ApiRequestLogContext,
  status: number,
  meta: RequestMeta = {},
): Promise<void> {
  try {
    await writeRuntimeLog(status >= 400 ? "warn" : "info", "api.request.finished", {
      requestId: context.requestId,
      route: context.route,
      method: context.method,
      status,
      durationMs: Date.now() - context.startedAt,
      ...context.meta,
      ...meta,
    });
  } catch {
    // Observability should not break request handling.
  }
}

export async function failApiRequestLog(
  context: ApiRequestLogContext,
  error: unknown,
  meta: RequestMeta = {},
): Promise<void> {
  try {
    await writeRuntimeLog("error", "api.request.failed", {
      requestId: context.requestId,
      route: context.route,
      method: context.method,
      durationMs: Date.now() - context.startedAt,
      ...context.meta,
      ...meta,
      error: errorMessage(error),
    });
  } catch {
    // Observability should not break request handling.
  }
}
