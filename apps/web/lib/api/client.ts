export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

type RequestInitWithJson = RequestInit & {
  json?: unknown;
};

const USER_ID_STORAGE_KEY = "scholarpulse.web.user-id";
const DEFAULT_USER_ID = "demo-user";

function safeReadStoredUserId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(USER_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getUserId(): string {
  const stored = safeReadStoredUserId();
  if (stored && stored.trim().length > 0) {
    return stored.trim();
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(USER_ID_STORAGE_KEY, DEFAULT_USER_ID);
    } catch {
      // no-op
    }
  }
  return DEFAULT_USER_ID;
}

export function setUserId(userId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(USER_ID_STORAGE_KEY, userId);
  } catch {
    // no-op
  }
}

export async function apiRequest<T>(path: string, init: RequestInitWithJson = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("x-user-id", getUserId());
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body = (parsed ?? {}) as ApiErrorBody;
    const code = body.error?.code ?? `http_${response.status}`;
    const message = body.error?.message ?? response.statusText ?? "Request failed";
    throw new Error(`${code}: ${message}`);
  }

  return parsed as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "GET", cache: "no-store" });
}

export function apiPost<T>(path: string, json?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "POST", json });
}

export function apiPatch<T>(path: string, json?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", json });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE" });
}
