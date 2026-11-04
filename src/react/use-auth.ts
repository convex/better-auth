import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "@better-auth/core/env";
import type { AuthClient } from "./index.js";
import {
  TOKEN_REQUEST_TIMEOUT_MS,
  TOKEN_REFRESH_BUDGET_MS,
  TOKEN_RECOVERY_DELAY_MS,
  useProviderLifecycleEffect,
  getSessionIdFromToken,
  hasTokenClaims,
  isUsableToken,
  getAuthErrorStatus,
  reportTokenRefreshIssue,
  withAbort,
  withAuthTimeout,
  waitForRetry,
} from "./provider-auth-utils.js";

type TokenFlight = {
  sessionId: string | null;
  controller: AbortController;
  promise: Promise<string | null> | null;
};

export function useUseAuthFromBetterAuth(
  authClient: AuthClient,
  initialToken?: string | null
) {
  const [cachedToken, setCachedToken] = useState(initialToken ?? null);
  const bootstrapTokenRef = useRef(initialToken ?? null);
  const cachedTokenRef = useRef(cachedToken);
  const cachedTokenSessionIdRef = useRef(getSessionIdFromToken(cachedToken));
  const pendingTokenRef = useRef<TokenFlight | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionRefetchRef = useRef<
    ReturnType<AuthClient["useSession"]>["refetch"] | null
  >(null);
  const recoveryRef = useRef<{
    sessionId: string | null;
    resume: () => void;
  } | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProviderMountedRef = useRef(true);
  const updateCachedToken = useCallback((token: string | null) => {
    cachedTokenRef.current = token;
    cachedTokenSessionIdRef.current = getSessionIdFromToken(token);
    setCachedToken(token);
  }, []);
  const clearRecovery = useCallback(() => {
    recoveryRef.current = null;
    if (recoveryTimerRef.current !== null)
      clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
  }, []);
  const restartAuthentication = useCallback(() => {
    const recovery = recoveryRef.current;
    if (
      !recovery ||
      !isProviderMountedRef.current ||
      recovery.sessionId !== activeSessionIdRef.current
    ) {
      return;
    }
    clearRecovery();
    recovery.resume();
  }, [clearRecovery]);
  useProviderLifecycleEffect(() => {
    isProviderMountedRef.current = true;
    const browserWindow =
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function" &&
      typeof window.removeEventListener === "function"
        ? window
        : null;
    const browserDocument =
      typeof document !== "undefined" &&
      typeof document.addEventListener === "function" &&
      typeof document.removeEventListener === "function"
        ? document
        : null;
    const onVisible = () => {
      if (browserDocument?.visibilityState === "visible") {
        restartAuthentication();
      }
    };
    browserWindow?.addEventListener("online", restartAuthentication);
    browserDocument?.addEventListener("visibilitychange", onVisible);
    return () => {
      isProviderMountedRef.current = false;
      pendingTokenRef.current?.controller.abort(
        new Error("provider-unmounted")
      );
      pendingTokenRef.current = null;
      clearRecovery();
      browserWindow?.removeEventListener("online", restartAuthentication);
      browserDocument?.removeEventListener("visibilitychange", onVisible);
    };
  }, [clearRecovery, restartAuthentication]);
  return useMemo(
    () =>
      function useAuthFromBetterAuth() {
        const {
          data: session,
          isPending: isSessionPending,
          error: sessionError,
          refetch,
        } = authClient.useSession();
        sessionRefetchRef.current = refetch;
        const sessionId = session?.session?.id;
        const currentCachedToken = cachedTokenRef.current;
        const cachedSessionIdRef = useRef(
          sessionId ?? getSessionIdFromToken(currentCachedToken)
        );
        const isSignedOut =
          getAuthErrorStatus(sessionError) === 401 ||
          (!isSessionPending && !session?.session && !sessionError);
        const stableSessionId = isSignedOut
          ? null
          : (sessionId ??
            (currentCachedToken ? cachedSessionIdRef.current : null) ??
            null);
        activeSessionIdRef.current = stableSessionId;
        useEffect(() => {
          if (isSignedOut) {
            cachedSessionIdRef.current = null;
            updateCachedToken(null);
          } else if (sessionId) {
            cachedSessionIdRef.current = sessionId;
          }
          const pending = pendingTokenRef.current;
          if (pending && pending.sessionId !== stableSessionId) {
            pending.controller.abort(new Error("session-changed"));
          }
          if (recoveryRef.current?.sessionId !== stableSessionId) {
            clearRecovery();
          }
        }, [sessionId, stableSessionId, isSignedOut]);
        const fetchAccessToken = useCallback(
          async ({ forceRefreshToken = false } = {}) => {
            const requestedSessionId = stableSessionId;
            if (
              !isProviderMountedRef.current ||
              isSignedOut ||
              activeSessionIdRef.current !== requestedSessionId
            ) {
              return null;
            }
            const currentToken = cachedTokenRef.current;
            // Preserve opaque SSR bootstrap tokens until the session resolves.
            // Fresh endpoint responses below still require valid JWT metadata.
            const isOpaqueBootstrap =
              requestedSessionId == null &&
              currentToken === bootstrapTokenRef.current &&
              typeof currentToken === "string" &&
              currentToken.length > 0 &&
              !currentToken.includes(".");
            if (
              !forceRefreshToken &&
              (isUsableToken(currentToken) || isOpaqueBootstrap) &&
              !pendingTokenRef.current &&
              (requestedSessionId == null ||
                cachedTokenSessionIdRef.current === requestedSessionId)
            ) {
              return currentToken;
            }
            const pending = pendingTokenRef.current;
            if (
              pending?.sessionId === requestedSessionId &&
              !pending.controller.signal.aborted
            ) {
              return pending.promise;
            }
            pending?.controller.abort(new Error("session-changed"));
            clearRecovery();
            const flight: TokenFlight = {
              sessionId: requestedSessionId,
              controller: new AbortController(),
              promise: null,
            };
            pendingTokenRef.current = flight;
            const isCurrent = () =>
              isProviderMountedRef.current &&
              activeSessionIdRef.current === requestedSessionId &&
              pendingTokenRef.current === flight;
            const refresh = (async () => {
              let retryAttempt = 0;
              let retryKind = "network-error";
              let retryStatus: number | null = null;
              let recheckedSession = false;
              let deadline = Date.now() + TOKEN_REFRESH_BUDGET_MS;
              const requestTimeout = () =>
                Math.max(
                  1,
                  Math.min(TOKEN_REQUEST_TIMEOUT_MS, deadline - Date.now())
                );
              try {
                while (isCurrent() && !flight.controller.signal.aborted) {
                  if (Date.now() >= deadline) {
                    reportTokenRefreshIssue(
                      retryKind,
                      retryStatus,
                      retryAttempt
                    );
                    // Keep the SDK's existing refresh pending. A cooldown or
                    // connectivity event resumes it without clearAuth/setAuth.
                    await withAbort(
                      new Promise<void>((resume) => {
                        recoveryRef.current = {
                          sessionId: requestedSessionId,
                          resume,
                        };
                        recoveryTimerRef.current = setTimeout(
                          restartAuthentication,
                          TOKEN_RECOVERY_DELAY_MS
                        );
                      }),
                      flight.controller.signal
                    );
                    retryAttempt = 0;
                    recheckedSession = false;
                    deadline = Date.now() + TOKEN_REFRESH_BUDGET_MS;
                    continue;
                  }
                  retryKind = "network-error";
                  retryStatus = null;
                  try {
                    const { data, error } = await withAuthTimeout(
                      (signal) =>
                        authClient.convex.token({
                          fetchOptions: { throw: false, signal },
                        }),
                      flight.controller.signal,
                      requestTimeout()
                    );
                    if (!isCurrent() || flight.controller.signal.aborted) {
                      return null;
                    }
                    const token = data?.token || null;
                    if (token) {
                      const tokenSessionId = getSessionIdFromToken(token);
                      const validClaims = hasTokenClaims(token);
                      if (
                        // A successful server response is authoritative. The
                        // browser clock can be ahead of the JWT's expiry; let
                        // Convex validate its signature and server-time expiry.
                        validClaims &&
                        (requestedSessionId == null ||
                          tokenSessionId === requestedSessionId)
                      ) {
                        if (!forceRefreshToken || token !== currentToken) {
                          updateCachedToken(token);
                          return token;
                        }
                        // JWTs issued in the same second can be identical.
                        // Convex rejects that result on reauthentication
                        // and stops future refreshes on scheduled rotation.
                        retryKind = "unchanged-token";
                      } else {
                        retryKind = validClaims
                          ? "session-mismatch"
                          : "invalid-token";
                        // Do not adopt another account's JWT. Ask Better Auth
                        // to update its authoritative session, which cancels
                        // this flight and starts the new session's setAuth.
                        if (!recheckedSession && sessionRefetchRef.current) {
                          recheckedSession = true;
                          await withAuthTimeout(
                            () =>
                              sessionRefetchRef.current!({
                                query: { disableCookieCache: true },
                              }),
                            flight.controller.signal,
                            requestTimeout()
                          );
                        }
                      }
                    } else {
                      const status = getAuthErrorStatus(error);
                      if (status === 401) {
                        reportTokenRefreshIssue(
                          "unauthorized-response",
                          status,
                          retryAttempt + 1
                        );
                        updateCachedToken(null);
                        return null;
                      }
                      retryKind = error
                        ? "transient-response"
                        : "empty-response";
                      retryStatus = status;
                    }
                  } catch (error) {
                    if (flight.controller.signal.aborted || !isCurrent()) {
                      break;
                    }
                    if (
                      retryKind !== "session-mismatch" &&
                      retryKind !== "invalid-token"
                    ) {
                      retryKind =
                        error instanceof Error &&
                        error.message === "request-timeout"
                          ? "request-timeout"
                          : "network-error";
                    }
                  }
                  if (!isCurrent() || flight.controller.signal.aborted) {
                    break;
                  }
                  if (retryAttempt === 0 || (retryAttempt + 1) % 5 === 0) {
                    logger.warn(
                      "[ConvexBetterAuthProvider] token refresh retrying",
                      {
                        attempt: retryAttempt + 1,
                        kind: retryKind,
                        status: retryStatus,
                      }
                    );
                  }
                  const retryDelay = Math.max(
                    0,
                    Math.min(
                      1000 * 2 ** retryAttempt,
                      10000,
                      deadline - Date.now()
                    )
                  );
                  retryAttempt += 1;
                  try {
                    await waitForRetry(retryDelay, flight.controller.signal);
                  } catch {
                    break;
                  }
                }
                return null;
              } catch (error) {
                if (!flight.controller.signal.aborted) {
                  throw error;
                }
                return null;
              }
            })();
            flight.promise = refresh;
            try {
              return await refresh;
            } finally {
              if (pendingTokenRef.current === flight) {
                pendingTokenRef.current = null;
              }
            }
          },
          [stableSessionId, isSignedOut]
        );
        return useMemo(
          () => ({
            isLoading: isSessionPending && !currentCachedToken,
            isAuthenticated:
              !isSignedOut &&
              (Boolean(session?.session) || currentCachedToken !== null),
            fetchAccessToken,
          }),
          [
            isSessionPending,
            isSignedOut,
            session?.session,
            fetchAccessToken,
            currentCachedToken,
          ]
        );
      },
    [authClient, updateCachedToken, clearRecovery, restartAuthentication]
  );
}
