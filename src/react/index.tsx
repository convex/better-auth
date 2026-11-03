import type { PropsWithChildren, ReactNode } from "react";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthTokenFetcher } from "convex/browser";
import {
  Authenticated,
  ConvexProviderWithAuth,
  useConvexAuth,
  useQuery,
} from "convex/react";
import type { FunctionReference } from "convex/server";
import type { EmptyObject } from "convex-helpers";

// Better Auth client calls resolve to a better-fetch result (`{ data, error }`)
// or, with `fetchOptions.throw`, to the bare payload. The component narrows
// the result itself, so client method types here only fix the arguments.
type FetchResult<T> = {
  data?: T | null;
  error?: unknown;
};

/**
 * The parts of a Better Auth client created with the `convexClient()` plugin
 * that this package uses. Any `createAuthClient()` result that includes
 * `convexClient()` satisfies it.
 *
 * This is described structurally rather than derived from `createAuthClient`
 * over a plugin union: Better Auth 1.7's endpoint inference collapses to
 * `never` for a union that includes the base `BetterAuthClientPlugin`, which
 * made no real client assignable to the previous type.
 */
export type AuthClient = {
  useSession: () => {
    data: {
      session?: { id?: string; token?: string } | null;
      user?: unknown;
    } | null;
    isPending: boolean;
  };
  getSession: (...args: any[]) => Promise<unknown>;
  convex: {
    token: (...args: any[]) => Promise<any>;
  };
};

/**
 * An {@link AuthClient} that also includes the `crossDomainClient()` plugin.
 */
export type AuthClientWithCrossDomain = AuthClient & {
  crossDomain: {
    oneTimeToken: {
      verify: (...args: any[]) => Promise<any>;
    };
  };
  updateSession: () => void;
};

// Until we can import from our own entry points (requires TypeScript 4.7),
// just describe the interface enough to help users pass the right type.
type IConvexReactClient = {
  setAuth(fetchToken: AuthTokenFetcher): void;
  clearAuth(): void;
};

/**
 * A wrapper React component which provides a {@link react.ConvexReactClient}
 * authenticated with Better Auth.
 *
 * @public
 */
export function ConvexBetterAuthProvider({
  children,
  client,
  authClient,
  initialToken,
}: {
  children: ReactNode;
  client: IConvexReactClient;
  authClient: AuthClient;
  initialToken?: string | null;
}) {
  const useBetterAuth = useUseAuthFromBetterAuth(authClient, initialToken);
  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !window.location?.href) {
        return;
      }
      const url = new URL(window.location.href);
      const token = url.searchParams.get("ott");
      if (token) {
        const authClientWithCrossDomain =
          authClient as AuthClientWithCrossDomain;
        url.searchParams.delete("ott");
        window.history.replaceState({}, "", url);
        const result: FetchResult<{ session?: { token: string } | null }> =
          await authClientWithCrossDomain.crossDomain.oneTimeToken.verify({
            token,
          });
        const session = result.data?.session;
        if (session) {
          await authClient.getSession({
            fetchOptions: {
              headers: {
                Authorization: `Bearer ${session.token}`,
              },
            },
          });
          authClientWithCrossDomain.updateSession();
        }
      }
    })();
  }, [authClient]);
  return (
    <ConvexProviderWithAuth client={client} useAuth={useBetterAuth}>
      <>{children}</>
    </ConvexProviderWithAuth>
  );
}

let initialTokenUsed = false;

// Convex JWTs minted by the convex plugin carry the Better Auth session id.
const getTokenSessionId = (token: string) => {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { sessionId } = JSON.parse(json);
    return typeof sessionId === "string" ? sessionId : undefined;
  } catch {
    return undefined;
  }
};

type CachedToken = { sessionId?: string; token: string };

function useUseAuthFromBetterAuth(
  authClient: AuthClient,
  initialToken?: string | null
) {
  useEffect(() => {
    if (!initialTokenUsed) {
      initialTokenUsed = true;
    }
  }, []);

  return useMemo(
    () =>
      function useAuthFromBetterAuth() {
        const { data: session, isPending: isSessionPending } =
          authClient.useSession();
        // The SSR token stands in for the session until it first loads.
        const [ssrToken, setSsrToken] = useState<CachedToken | null>(() => {
          const token = initialTokenUsed ? null : initialToken;
          return token ? { sessionId: getTokenSessionId(token), token } : null;
        });
        useEffect(() => {
          if (!isSessionPending && ssrToken) {
            setSsrToken(null);
          }
        }, [isSessionPending, ssrToken]);
        // Tokens are cached per session, so a token is never reused for a
        // different session. Refs, not state in the enclosing hook: that
        // state was captured once by this memoized hook and never updated.
        const cachedTokenRef = useRef(ssrToken);
        const pendingTokenRef = useRef<{
          sessionId?: string;
          promise: Promise<string | null>;
        } | null>(null);

        const isSsrTokenActive = isSessionPending && ssrToken !== null;
        const isAuthenticated = Boolean(session?.session) || isSsrTokenActive;
        const sessionId = isSsrTokenActive
          ? ssrToken.sessionId
          : session?.session?.id;

        const fetchAccessToken = useCallback(
          async ({
            forceRefreshToken = false,
          }: { forceRefreshToken?: boolean } = {}) => {
            if (!forceRefreshToken) {
              // Prefer an in-flight request, which may be refreshing a
              // rejected token, over the cached token.
              const pending = pendingTokenRef.current;
              if (pending && pending.sessionId === sessionId) {
                return pending.promise;
              }
              const cached = cachedTokenRef.current;
              if (cached && cached.sessionId === sessionId) {
                return cached.token;
              }
            }
            const promise: Promise<string | null> = authClient.convex
              .token({ fetchOptions: { throw: false } })
              .then(
                ({ data }: FetchResult<{ token?: string | null }>) =>
                  data?.token || null
              )
              .catch(() => null)
              .then((token) => {
                if (pendingTokenRef.current?.promise === promise) {
                  pendingTokenRef.current = null;
                }
                if (token) {
                  cachedTokenRef.current = { sessionId, token };
                } else if (
                  cachedTokenRef.current &&
                  cachedTokenRef.current.sessionId === sessionId
                ) {
                  cachedTokenRef.current = null;
                }
                return token;
              });
            pendingTokenRef.current = { sessionId, promise };
            return promise;
          },
          // Build a new fetchAccessToken, which makes Convex call setAuth(),
          // only when the authenticated session changes. Hydrating the
          // session behind an SSR token keeps the same one.
          [sessionId]
        );
        return useMemo(
          () => ({
            isLoading: isSessionPending && !isAuthenticated,
            isAuthenticated,
            fetchAccessToken,
          }),
          [isSessionPending, isAuthenticated, fetchAccessToken]
        );
      },
    // initialToken is only read when the hook first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authClient]
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onUnauth: () => void | Promise<void>;
  renderFallback?: () => React.ReactNode;
  isAuthError: (error: unknown) => boolean;
}
interface ErrorBoundaryState {
  error?: unknown;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {};
  }
  static defaultProps: Partial<ErrorBoundaryProps> = {
    renderFallback: () => null,
  };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  async componentDidCatch(error: Error) {
    if (this.props.isAuthError(error)) {
      await this.props.onUnauth();
    }
  }
  render() {
    if (this.state.error && this.props.isAuthError(this.state.error)) {
      return this.props.renderFallback?.();
    }
    return this.props.children;
  }
}

// Subscribe to the session validated user to keep this check reactive to
// actual user auth state at the provider level (rather than just jwt validity state).
const UserSubscription = ({
  getAuthUserFn,
}: {
  getAuthUserFn: FunctionReference<"query">;
}) => {
  useQuery(getAuthUserFn);
  return null;
};

/**
 * _Experimental_
 *
 * A wrapper React component which provides error handling for auth related errors.
 * This is typically used to redirect the user to the login page when they are
 * unauthenticated, and does so reactively based on the getAuthUserFn query.
 *
 * @example
 * ```ts
 * // convex/auth.ts
 * export const { getAuthUser } = authComponent.clientApi();
 *
 * // auth-client.tsx
 * import { AuthBoundary } from "@convex-dev/react";
 * import { api } from '../../convex/_generated/api'
 * import { isAuthError } from '../lib/utils'
 *
 * export const ClientAuthBoundary = ({ children }: PropsWithChildren) => {
 *   return (
 *     <AuthBoundary
 *       onUnauth={() => redirect("/sign-in")}
 *       authClient={authClient}
 *       getAuthUserFn={api.auth.getAuthUser}
 *       isAuthError={isAuthError}
 * >
 *   <>{children}</>
 * </AuthBoundary>
 * )
 * ```
 * @param props.children - Children to render.
 * @param props.onUnauth - Function to call when the user is
 * unauthenticated. Typically a redirect to the login page.
 * @param props.authClient - Better Auth authClient to use.
 * @param props.renderFallback - Fallback component to render when the user is
 * unauthenticated. Defaults to null. Generally not rendered as error handling
 * is typically a redirect.
 * @param props.getAuthUserFn - Reference to a Convex query that returns user.
 * The component provides a query for this via `export const { getAuthUser } = authComponent.clientApi()`.
 * @param props.isAuthError - Function to check if the error is auth related.
 */
export const AuthBoundary = ({
  children,
  /**
   * The function to call when the user is unauthenticated. Typically a redirect
   * to the login page.
   */
  onUnauth,
  /**
   * The Better Auth authClient to use.
   */
  authClient,
  /**
   * The fallback to render when the user is unauthenticated. Defaults to null.
   * Generally not rendered as error handling is typically a redirect.
   */
  renderFallback,
  /**
   * The function to call to get the auth user.
   */
  getAuthUserFn,
  /**
   * The function to call to check if the error is auth related.
   */
  isAuthError,
}: PropsWithChildren<{
  onUnauth: () => void | Promise<void>;
  authClient: AuthClient;
  renderFallback?: () => React.ReactNode;
  getAuthUserFn: FunctionReference<"query", "public", EmptyObject>;
  isAuthError: (error: unknown) => boolean;
}>) => {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const handleUnauth = useCallback(async () => {
    // Auth request that will clear cookies if session is invalid
    await authClient.getSession();
    await onUnauth();
  }, [onUnauth]);

  useEffect(() => {
    void (async () => {
      if (!isLoading && !isAuthenticated) {
        await handleUnauth();
      }
    })();
  }, [isLoading, isAuthenticated]);

  return (
    <ErrorBoundary
      onUnauth={handleUnauth}
      isAuthError={isAuthError}
      renderFallback={renderFallback}
    >
      <Authenticated>
        <UserSubscription getAuthUserFn={getAuthUserFn} />
      </Authenticated>
      {children}
    </ErrorBoundary>
  );
};
