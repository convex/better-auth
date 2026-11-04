import { useConvexAuth } from "convex/react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthClient } from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type FetchToken = (args: {
  forceRefreshToken: boolean;
}) => Promise<string | null>;
type SessionState = {
  data: { session: { id: string } } | null;
  isPending: boolean;
};
type AuthState = ReturnType<typeof useConvexAuth>;

// Convex JWTs minted by the convex plugin always carry `sessionId`.
const convexJwt = (sessionId: string) => {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sessionId })}.sig`;
};

const pending: SessionState = { data: null, isPending: true };
const signedOut: SessionState = { data: null, isPending: false };
const signedIn = (id: string): SessionState => ({
  data: { session: { id } },
  isPending: false,
});

// Fake ConvexReactClient: like the real one, setAuth fetches a token
// (forceRefreshToken: false) and reports whether it got one.
const createClient = () => {
  const events: string[] = [];
  const fetchers: FetchToken[] = [];
  const client = {
    setAuth: (
      fetchToken: FetchToken,
      onChange?: (isAuthenticated: boolean) => void
    ) => {
      events.push("setAuth");
      fetchers.push(fetchToken);
      void fetchToken({ forceRefreshToken: false }).then((token) => {
        events.push(`authenticate:${token}`);
        onChange?.(token !== null);
      });
    },
    clearAuth: () => {
      events.push("clearAuth");
    },
  };
  return { client, events, fetchers };
};

const flush = () => act(async () => {});

const setup = async ({
  initialToken,
  session,
  tokens = [],
}: {
  initialToken?: string;
  session: SessionState;
  tokens?: string[];
}) => {
  // `initialToken` is only honored by the first provider mount, tracked in
  // module state, so every test gets a fresh copy of the module.
  vi.resetModules();
  const { ConvexBetterAuthProvider } = await import("./index.js");
  const state = { session };
  const remaining = [...tokens];
  const token = vi.fn(async () => ({ data: { token: remaining.shift() } }));
  const authClient = {
    convex: { token },
    useSession: () => state.session,
  } as unknown as AuthClient;
  const { client, events, fetchers } = createClient();
  const authStates: AuthState[] = [];
  const Probe = () => {
    authStates.push(useConvexAuth());
    return null;
  };
  const tree = () => (
    <ConvexBetterAuthProvider
      authClient={authClient}
      client={client}
      initialToken={initialToken}
    >
      <Probe />
    </ConvexBetterAuthProvider>
  );
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(tree());
  });
  await flush();
  const setSession = async (next: SessionState) => {
    state.session = next;
    await act(async () => {
      renderer.update(tree());
    });
    await flush();
  };
  const lastAuthState = () => authStates[authStates.length - 1];
  return { authStates, events, fetchers, lastAuthState, setSession, token };
};

describe("ConvexBetterAuthProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps Convex auth when the SSR session hydrates in the browser", async () => {
    const initialToken = convexJwt("session-a");
    const { authStates, events, lastAuthState, setSession, token } =
      await setup({ initialToken, session: pending });
    expect(lastAuthState()).toMatchObject({
      isLoading: false,
      isAuthenticated: true,
    });
    const seen = authStates.length;

    await setSession(signedIn("session-a"));

    expect(events).toEqual(["setAuth", `authenticate:${initialToken}`]);
    expect(authStates.slice(seen)).not.toContainEqual(
      expect.objectContaining({ isAuthenticated: false })
    );
    expect(token).not.toHaveBeenCalled();
  });

  it("drops the SSR token on sign-out", async () => {
    const initialToken = convexJwt("session-a");
    const { events, lastAuthState, setSession, token } = await setup({
      initialToken,
      session: pending,
    });
    await setSession(signedIn("session-a"));

    await setSession(signedOut);

    expect(events).toEqual([
      "setAuth",
      `authenticate:${initialToken}`,
      "clearAuth",
    ]);
    expect(lastAuthState()).toMatchObject({
      isLoading: false,
      isAuthenticated: false,
    });

    // A session refetch while signed out must not resurrect the SSR token.
    await setSession(pending);
    expect(lastAuthState()?.isAuthenticated).toBe(false);
    expect(events).toHaveLength(3);
    expect(token).not.toHaveBeenCalled();
  });

  it("fetches a new token when the session is replaced", async () => {
    const initialToken = convexJwt("session-a");
    const { events, setSession } = await setup({
      initialToken,
      session: pending,
      tokens: ["session-b-token"],
    });
    await setSession(signedIn("session-a"));

    await setSession(signedIn("session-b"));

    expect(events).toEqual([
      "setAuth",
      `authenticate:${initialToken}`,
      "clearAuth",
      "setAuth",
      "authenticate:session-b-token",
    ]);
  });

  it("does not trust an SSR token from a different session", async () => {
    const { events, setSession } = await setup({
      initialToken: convexJwt("session-a"),
      session: pending,
      tokens: ["session-b-token"],
    });

    await setSession(signedIn("session-b"));

    expect(events.slice(-2)).toEqual([
      "setAuth",
      "authenticate:session-b-token",
    ]);
  });

  it("uses an SSR token without a session id, then fetches a new one", async () => {
    const { events, setSession } = await setup({
      initialToken: "opaque-token",
      session: pending,
      tokens: ["session-a-token"],
    });
    expect(events).toEqual(["setAuth", "authenticate:opaque-token"]);

    await setSession(signedIn("session-a"));

    expect(events.slice(2)).toEqual([
      "clearAuth",
      "setAuth",
      "authenticate:session-a-token",
    ]);
  });

  it("caches fetched tokens and replaces them on forced refresh", async () => {
    const { events, fetchers, token } = await setup({
      session: signedIn("session-a"),
      tokens: ["token-1", "token-2"],
    });
    expect(events).toEqual(["setAuth", "authenticate:token-1"]);
    const fetchToken = fetchers[0]!;

    await expect(fetchToken({ forceRefreshToken: false })).resolves.toBe(
      "token-1"
    );
    expect(token).toHaveBeenCalledTimes(1);

    await expect(fetchToken({ forceRefreshToken: true })).resolves.toBe(
      "token-2"
    );
    await expect(fetchToken({ forceRefreshToken: false })).resolves.toBe(
      "token-2"
    );
    expect(token).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight token request", async () => {
    const { fetchers, token } = await setup({
      session: signedIn("session-a"),
      tokens: ["token-1", "token-2"],
    });
    token.mockClear();
    const fetchToken = fetchers[0]!;

    const [a, b] = await Promise.all([
      fetchToken({ forceRefreshToken: true }),
      fetchToken({ forceRefreshToken: false }),
    ]);

    expect([a, b]).toEqual(["token-2", "token-2"]);
    expect(token).toHaveBeenCalledTimes(1);
  });
});
