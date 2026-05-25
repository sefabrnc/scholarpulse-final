import { NextRequest } from "next/server";

type ErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

export function userIdFromRequest(request: NextRequest): string {
  return request.headers.get("x-user-id") ?? "demo-user";
}

export function errorPayload(code: string, message: string): ErrorPayload {
  return { error: { code, message } };
}

export async function tryProxyJson<T>(
  request: NextRequest,
  path: string,
  init?: RequestInit
): Promise<T | null> {
  const baseUrl = process.env.SCHOLARPULSE_API_BASE_URL;
  if (!baseUrl) {
    return null;
  }

  const target = new URL(path, baseUrl);
  const response = await fetch(target.toString(), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userIdFromRequest(request),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}

export async function tryProxyResponse(
  request: NextRequest,
  path: string,
  init?: RequestInit
): Promise<Response | null> {
  const baseUrl = process.env.SCHOLARPULSE_API_BASE_URL;
  if (!baseUrl) {
    return null;
  }

  const target = new URL(path, baseUrl);
  const response = await fetch(target.toString(), {
    ...init,
    headers: {
      "x-user-id": userIdFromRequest(request),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json"
    }
  });
}
