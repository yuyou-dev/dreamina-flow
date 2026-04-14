import type {
  AdapterLoginMode,
  AdapterLoginSession,
  AdapterStatus,
  NodeCatalogResponse,
  NodeRunResponse,
  UploadAssetResponse,
  ValidationResult,
  WorkflowRunResult,
} from "../types";

export class ApiError<TBody = unknown> extends Error {
  readonly status: number;
  readonly body: TBody | null;

  constructor(message: string, status: number, body: TBody | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ApiErrorBody = {
  error?: string;
  errors?: string[];
  [key: string]: unknown;
};

export type AuthRequiredApiBody = ApiErrorBody & {
  authRequired: true;
  auth: AdapterStatus["auth"];
};

function parseJsonBody<T>(text: string): T | null {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function resolveErrorMessage(status: number, body: ApiErrorBody | null, fallbackText = ""): string {
  return body?.error ?? body?.errors?.join(" ") ?? (fallbackText || `Request failed: ${status}`);
}

async function requestJson<TResponse, TErrorBody extends ApiErrorBody = ApiErrorBody>(
  url: string,
  options?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  const text = await response.text();
  const parsed = parseJsonBody<TResponse>(text);
  const errorBody = parseJsonBody<TErrorBody>(text);

  if (!response.ok) {
    throw new ApiError<TErrorBody>(resolveErrorMessage(response.status, errorBody, text), response.status, errorBody);
  }

  return (parsed ?? ({} as TResponse));
}

async function requestFormData<TResponse, TErrorBody extends ApiErrorBody = ApiErrorBody>(
  url: string,
  options: RequestInit,
): Promise<TResponse> {
  const response = await fetch(url, options);
  const text = await response.text();
  const parsed = parseJsonBody<TResponse>(text);
  const errorBody = parseJsonBody<TErrorBody>(text);

  if (!response.ok) {
    throw new ApiError<TErrorBody>(resolveErrorMessage(response.status, errorBody, text), response.status, errorBody);
  }

  return (parsed ?? ({} as TResponse));
}

export function isApiError<TBody = unknown>(error: unknown): error is ApiError<TBody> {
  return error instanceof ApiError;
}

export function isAuthRequiredApiError(error: unknown): error is ApiError<AuthRequiredApiBody> {
  return isApiError<AuthRequiredApiBody>(error)
    && error.status === 401
    && Boolean(error.body?.authRequired);
}

export function fetchCapabilities(): Promise<NodeCatalogResponse> {
  return requestJson<NodeCatalogResponse>("/api/capabilities");
}

export function fetchAdapterStatus(): Promise<AdapterStatus> {
  return requestJson<AdapterStatus>("/api/adapter/status");
}

export async function uploadAsset(file: File, scopeId: string): Promise<UploadAssetResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("scopeId", scopeId);
  return requestFormData<UploadAssetResponse>("/api/assets/upload", {
    method: "POST",
    body: formData,
  });
}

export function validateCommand(name: string, payload: Record<string, unknown>): Promise<ValidationResult> {
  return requestJson<ValidationResult>(`/api/nodes/${name}/validate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runCommand(name: string, payload: Record<string, unknown>): Promise<NodeRunResponse> {
  return requestJson<NodeRunResponse>(`/api/nodes/${name}/run`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runFlow(payload: Record<string, unknown>): Promise<WorkflowRunResult> {
  return requestJson<WorkflowRunResult>("/api/flows/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function queryTask(submitId: string, runId: string, nodeId: string): Promise<NodeRunResponse> {
  return requestJson<NodeRunResponse>(`/api/tasks/${submitId}?runId=${encodeURIComponent(runId)}&nodeId=${encodeURIComponent(nodeId)}`);
}

export function startAdapterLogin(mode: AdapterLoginMode): Promise<AdapterLoginSession> {
  return requestJson<AdapterLoginSession>("/api/adapter/login", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function fetchAdapterLoginSession(sessionId: string): Promise<AdapterLoginSession> {
  return requestJson<AdapterLoginSession>(`/api/adapter/login/${encodeURIComponent(sessionId)}`);
}

export function logoutAdapter(): Promise<AdapterStatus> {
  return requestJson<AdapterStatus>("/api/adapter/logout", {
    method: "POST",
  });
}
