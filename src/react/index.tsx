import type { PropsWithChildren, ReactNode } from "react";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthTokenFetcher } from "convex/browser";
import {
  Authenticated,
  ConvexProviderWithAuth,
  useConvexAuth,
  useQuery,
} from "convex/react";
import type { FunctionReference } from "convex/server";
import type { BetterAuthClientPlugin } from "better-auth";
import type { createAuthClient } from "better-auth/react";
import type {
  convexClient,
  crossDomainClient,
} from "../client/plugins/index.js";
import type { EmptyObject } from "convex-helpers";

type CrossDomainClient = ReturnType<typeof crossDomainClient>;
type ConvexClient = ReturnType<typeof convexClient>;
type PluginsWithCrossDomain = (
  | CrossDomainClient
  | ConvexClient
  | BetterAuthClientPlugin
)[];
type PluginsWithoutCrossDomain = (ConvexClient | BetterAuthClientPlugin)[];
type AuthClientWithPlugins<
  Plugins extends PluginsWithCrossDomain | PluginsWithoutCrossDomain,
> = ReturnType<
  typeof createAuthClient<
    BetterAuthClientPlugin & {
      plugins: Plugins;
    }
  >
>;
export type AuthClient =
  | AuthClientWithPlugins<PluginsWithCrossDomain>
  | AuthClientWithPlugins<PluginsWithoutCrossDomain>;

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
          authClient as AuthClientWithPlugins<PluginsWithCrossDomain>;
        url.searchParams.delete("ott");
        window.history.replaceState({}, "", url);
        const result =
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

function useUseAuthFromBetterAuth(
  authClient: AuthClient,
  initialToken?: string | null
) {
  return useMemo(
    () =>
      function useAuthFromBetterAuth() {
        const { data: session, isPending: isSessionPending } =
          authClient.useSession();
        const sessionId = session?.session?.id;
        const [cachedToken, setCachedToken] = useState<string | null>(
          initialTokenUsed ? null : (initialToken ?? null)
        );
        const cachedTokenRef = useRef(cachedToken);
        const tokenGenerationRef = useRef(0);
        const pendingTokenRef = useRef<{
          generation: number;
          requestId: symbol;
          promise: Promise<string | null>;
        } | null>(null);
        const previousSessionIdRef = useRef(sessionId);
        const [sessionVersion, setSessionVersion] = useState(0);

        const cacheToken = useCallback((token: string | null) => {
          cachedTokenRef.current = token;
          setCachedToken(token);
        }, []);

        const invalidatePendingToken = useCallback(() => {
          tokenGenerationRef.current += 1;
          pendingTokenRef.current = null;
        }, []);

        useEffect(() => {
          if (!initialTokenUsed) {
            initialTokenUsed = true;
          }
        }, []);

        useEffect(() => {
          const previousSessionId = previousSessionIdRef.current;
          if (previousSessionId && previousSessionId !== sessionId) {
            invalidatePendingToken();
            cacheToken(null);
            if (sessionId) {
              setSessionVersion((version) => version + 1);
            }
          }
          previousSessionIdRef.current = sessionId;
        }, [cacheToken, invalidatePendingToken, sessionId]);

        useEffect(() => {
          if (
            !session &&
            !isSessionPending &&
            (cachedTokenRef.current || pendingTokenRef.current)
          ) {
            invalidatePendingToken();
            cacheToken(null);
          }
        }, [cacheToken, invalidatePendingToken, session, isSessionPending]);

        const fetchAccessToken = useCallback(
          async ({
            forceRefreshToken = false,
          }: { forceRefreshToken?: boolean } = {}) => {
            if (cachedTokenRef.current && !forceRefreshToken) {
              return cachedTokenRef.current;
            }
            const pendingToken = pendingTokenRef.current;
            if (
              !forceRefreshToken &&
              pendingToken?.generation === tokenGenerationRef.current
            ) {
              return pendingToken.promise;
            }
            const requestGeneration = tokenGenerationRef.current;
            const requestId = Symbol();
            const tokenRequest = authClient.convex
              .token({ fetchOptions: { throw: false } })
              .then(({ data }) => {
                if (
                  tokenGenerationRef.current !== requestGeneration ||
                  pendingTokenRef.current?.requestId !== requestId
                ) {
                  return null;
                }
                const token = data?.token || null;
                cacheToken(token);
                return token;
              })
              .catch(() => {
                if (
                  tokenGenerationRef.current === requestGeneration &&
                  pendingTokenRef.current?.requestId === requestId
                ) {
                  cacheToken(null);
                }
                return null;
              })
              .finally(() => {
                if (pendingTokenRef.current?.requestId === requestId) {
                  pendingTokenRef.current = null;
                }
              });
            pendingTokenRef.current = {
              generation: requestGeneration,
              requestId,
              promise: tokenRequest,
            };
            return tokenRequest;
          },
          // authClient changes replace this hook factory, and sessionVersion intentionally
          // rebuilds the callback so Convex reauthenticates for a different session.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [authClient, cacheToken, sessionVersion]
        );
        return useMemo(
          () => ({
            isLoading: isSessionPending && !cachedToken,
            isAuthenticated: Boolean(session?.session) || cachedToken !== null,
            fetchAccessToken,
          }),
          [isSessionPending, session, fetchAccessToken, cachedToken]
        );
      },
    [authClient, initialToken]
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
