import type { PaginatedResponse } from "../types/api";

const ACCESS_KEY = "edusms_access";
const REFRESH_KEY = "edusms_refresh";
const SESSION_KEY = "edusms_session_id";

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, message: string, code = "error", details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const tokenStore = {
  getAccess(): string | null {
    try {
      return localStorage.getItem(ACCESS_KEY);
    } catch {
      return null;
    }
  },
  getRefresh(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  getSessionId(): string | null {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  setTokens(tokens: { access: string; refresh: string; session_id?: string }): void {
    try {
      localStorage.setItem(ACCESS_KEY, tokens.access);
      localStorage.setItem(REFRESH_KEY, tokens.refresh);
      if (tokens.session_id) {
        localStorage.setItem(SESSION_KEY, tokens.session_id);
      }
      window.dispatchEvent(new CustomEvent("edusms:tokens-updated"));
    } catch {
      // ignore storage errors
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new CustomEvent("edusms:auth-cleared"));
    } catch {
      // ignore storage errors
    }
  },
};

export function unwrapList<T>(data: PaginatedResponse<T> | T[] | null | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as PaginatedResponse<T>).results)) {
    return (data as PaginatedResponse<T>).results;
  }
  return [];
}

let activeRefreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (activeRefreshPromise) return activeRefreshPromise;

  const refresh = tokenStore.getRefresh();
  if (!refresh) {
    tokenStore.clear();
    return null;
  }

  activeRefreshPromise = (async () => {
    try {
      const resp = await fetch("/api/v1/auth/refresh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      if (!resp.ok) {
        tokenStore.clear();
        return null;
      }
      const data = (await resp.json()) as { access: string; refresh: string; session_id?: string };
      if (!data.access) {
        tokenStore.clear();
        return null;
      }
      tokenStore.setTokens({
        access: data.access,
        refresh: data.refresh || refresh,
        session_id: data.session_id,
      });
      return data.access;
    } catch {
      tokenStore.clear();
      return null;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

function parseErrorPayload(status: number, payload: unknown): ApiError {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (obj.error && typeof obj.error === "object") {
      const errObj = obj.error as Record<string, unknown>;
      const details =
        errObj.details && typeof errObj.details === "object"
          ? (errObj.details as Record<string, unknown>)
          : obj;
      return new ApiError(
        status,
        String(errObj.message || "Request failed."),
        String(errObj.code || "error"),
        details
      );
    }
    if (typeof obj.detail === "string") {
      return new ApiError(status, obj.detail, "error", obj);
    }
    const entries = Object.entries(obj);
    if (entries.length > 0) {
      const [field, val] = entries[0];
      const msg = Array.isArray(val) && val.length > 0 ? `${field}: ${String(val[0])}` : `${field}: ${String(val)}`;
      return new ApiError(status, msg, "validation_error", obj);
    }
  }
  return new ApiError(status, `Request failed with status ${status}`);
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  skipAuth?: boolean;
  idempotencyKey?: string;
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipAuth = false, idempotencyKey, headers: customHeaders, ...rest } = options;
  const url = path.startsWith("http") || path.startsWith("/api/") ? path : `/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  const buildHeaders = (token: string | null): Headers => {
    const h = new Headers(customHeaders);
    if (body !== undefined && !(body instanceof FormData) && !h.has("Content-Type")) {
      h.set("Content-Type", "application/json");
    }
    if (!skipAuth && token) {
      h.set("Authorization", `Bearer ${token}`);
    }
    if (idempotencyKey) {
      h.set("Idempotency-Key", idempotencyKey);
    }
    return h;
  };

  const serializedBody =
    body === undefined
      ? undefined
      : body instanceof FormData || typeof body === "string"
        ? body
        : JSON.stringify(body);

  let token = skipAuth ? null : tokenStore.getAccess();
  let resp = await fetch(url, {
    ...rest,
    headers: buildHeaders(token),
    body: serializedBody,
  });

  if (resp.status === 401 && !skipAuth && !url.includes("/auth/login/") && !url.includes("/auth/refresh/")) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      token = newAccess;
      resp = await fetch(url, {
        ...rest,
        headers: buildHeaders(token),
        body: serializedBody,
      });
    }
  }

  if (resp.status === 204) {
    return undefined as T;
  }

  const contentType = resp.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await resp.json().catch(() => null) : await resp.text().catch(() => "");

  if (!resp.ok) {
    throw parseErrorPayload(resp.status, payload);
  }

  return payload as T;
}

export const api = {
  get: <T = unknown>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: "GET" }),
  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: "POST", body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: "PATCH", body }),
  delete: <T = unknown>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: "DELETE" }),

  async downloadFile(path: string, filename: string): Promise<void> {
    const url = path.startsWith("/api/") ? path : `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers();
    const token = tokenStore.getAccess();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let resp = await fetch(url, { method: "GET", headers });
    if (resp.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        headers.set("Authorization", `Bearer ${refreshed}`);
        resp = await fetch(url, { method: "GET", headers });
      }
    }
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => null);
      throw parseErrorPayload(resp.status, errBody);
    }
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },
};
