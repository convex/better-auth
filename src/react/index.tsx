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
import type { EmptyObject } from "convex-helpers";
import type { BetterAuthClientOptions } from "better-auth";
import type { ReactAuthClient } from "better-auth/react";
import { handleCrossDomainCallback } from "./cross-domain.js";
import type { RequiredAuthClient } from "./cross-domain.js";

export type AuthClient<
  Client extends RequiredAuthClient = ReactAuthClient<BetterAuthClientOptions> &
    RequiredAuthClient,
> = Client & RequiredAuthClient;

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
export function ConvexBetterAuthProvider<Client extends RequiredAuthClient>({
  children,
  client,
  authClient,
  initialToken,
}: {
  children: ReactNode;
  client: IConvexReactClient;
  authClient: Client;
  initialToken?: string | null;
}) {
  const useBetterAuth = useUseAuthFromBetterAuth(authClient, initialToken);
  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !window.location?.href) {
        return;
      }
      await handleCrossDomainCallback(authClient, window.location.href, (url) =>
        window.history.replaceState({}, "", url)
      );
    })();
  }, [authClient]);
  return (
    <ConvexProviderWithAuth client={client} useAuth={useBetterAuth}>
      <>{children}</>
    </ConvexProviderWithAuth>
  );
}

let initialTokenUsed = false;

function useUseAuthFromBetterAuth<Client extends RequiredAuthClient>(
  authClient: Client,
  initialToken?: string | null
) {
  const [cachedToken, setCachedToken] = useState<string | null>(
    initialTokenUsed ? null : (initialToken ?? null)
  );
  const pendingTokenRef = useRef<Promise<string | null> | null>(null);
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
        const sessionId = session?.session?.id;
        useEffect(() => {
          if (!session && !isSessionPending && cachedToken) {
            setCachedToken(null);
          }
        }, [session, isSessionPending]);
        const fetchAccessToken = useCallback(
          async ({
            forceRefreshToken = false,
          }: { forceRefreshToken?: boolean } = {}) => {
            if (cachedToken && !forceRefreshToken) {
              return cachedToken;
            }
            if (!forceRefreshToken && pendingTokenRef.current) {
              return pendingTokenRef.current;
            }
            pendingTokenRef.current = authClient.convex
              .token({ fetchOptions: { throw: false } })
              .then(({ data }) => {
                const token = data?.token || null;
                setCachedToken(token);
                return token;
              })
              .catch(() => {
                setCachedToken(null);
                return null;
              })
              .finally(() => {
                pendingTokenRef.current = null;
              });
            return pendingTokenRef.current;
          },
          // Build a new fetchAccessToken to trigger setAuth() whenever the
          // session changes.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [sessionId]
        );
        return useMemo(
          () => ({
            isLoading: isSessionPending && !cachedToken,
            isAuthenticated: Boolean(session?.session) || cachedToken !== null,
            fetchAccessToken,
          }),
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [isSessionPending, sessionId, fetchAccessToken, cachedToken]
        );
      },
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
export const AuthBoundary = <Client extends RequiredAuthClient>({
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
  authClient: Client;
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
