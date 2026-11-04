import { useEffect, useLayoutEffect } from "react";
import { logger } from "@better-auth/core/env";
import { base64Url } from "@better-auth/utils/base64";
import type { JWTPayload } from "jose";

// Bound each request and retry burst, not the authentication lifetime. Convex
// interprets null as lost credentials and reruns subscriptions anonymously.
export const TOKEN_REQUEST_TIMEOUT_MS = 5000;
export const TOKEN_REFRESH_BUDGET_MS = 30000;
export const TOKEN_RECOVERY_DELAY_MS = 10000;
export const useProviderLifecycleEffect =
  typeof window === "undefined" || typeof document === "undefined"
    ? useEffect
    : useLayoutEffect;
function getTokenPayload(token: unknown): JWTPayload | null {
  if (typeof token !== "string") {
    return null;
  }
  try {
    const segments = token.split(".");
    if (segments.length !== 3) {
      return null;
    }
    const encodedPayload = segments[1]?.replace(/\+/g, "-").replace(/\//g, "_");
    if (
      !encodedPayload ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(encodedPayload) ||
      (encodedPayload.includes("=") && encodedPayload.length % 4 !== 0)
    ) {
      return null;
    }
    const bytes = base64Url.decode(encodedPayload);
    if (
      base64Url.encode(bytes, { padding: false }) !==
      encodedPayload.replace(/=+$/, "")
    ) {
      return null;
    }
    // JWT payloads are UTF-8. Native runtimes need neither browser atob nor
    // Node Buffer/TextDecoder globals to recover the JSON text.
    const utf8 = Array.from(
      bytes,
      (byte) => `%${byte.toString(16).padStart(2, "0")}`
    ).join("");
    return JSON.parse(decodeURIComponent(utf8)) as JWTPayload;
  } catch {
    return null;
  }
}
export function getSessionIdFromToken(token: unknown): string | null {
  const payload = getTokenPayload(token);
  return typeof payload?.sessionId === "string" ? payload.sessionId : null;
}
export function hasTokenClaims(token: unknown): token is string {
  const payload = getTokenPayload(token);
  return (
    typeof payload?.sessionId === "string" && typeof payload.exp === "number"
  );
}
export function isUsableToken(token: unknown): token is string {
  return (
    hasTokenClaims(token) && getTokenPayload(token)!.exp! > Date.now() / 1000
  );
}
export function getAuthErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === "number" ? status : null;
}
export function reportTokenRefreshIssue(
  kind: string,
  status: number | null,
  attempt: number
) {
  const outcome = kind === "unauthorized-response" ? "stopped" : "paused";
  logger.warn(`[ConvexBetterAuthProvider] token refresh ${outcome}`, {
    kind,
    status,
    attempt,
  });
}
export function withAbort<T>(
  operation: PromiseLike<T> | T,
  signal: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
export async function withAuthTimeout<T>(
  operation: (signal: AbortSignal) => PromiseLike<T> | T,
  signal: AbortSignal,
  timeoutMs = TOKEN_REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
  }
  const timer = setTimeout(
    () => controller.abort(new Error("request-timeout")),
    timeoutMs
  );
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    return await withAbort(operation(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
export async function waitForRetry(delay: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await withAbort(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, delay);
      }),
      signal
    );
  } finally {
    clearTimeout(timer);
  }
}
