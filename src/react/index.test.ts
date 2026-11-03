// @vitest-environment jsdom

import * as React from "react";
import { logger } from "@better-auth/core/env";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ConvexBetterAuthProvider } from "./index.js";

type SessionSignal = {
  data: null | {
    session: { id: string };
  };
  error: null | { status?: number; statusCode?: number };
  isPending: boolean;
};

const state = vi.hoisted(() => ({
  clearAuth: vi.fn(),
  fetchAccessToken: null as
    | null
    | ((options?: { forceRefreshToken?: boolean }) => Promise<string | null>),
  observedTokens: [] as Array<string | null>,
  sessionSignal: {
    data: null,
    error: null,
    isPending: true,
  } as SessionSignal,
  setAuth: vi.fn(),
  setAuthForceRefresh: null as boolean | null,
  refetchSession: vi.fn(),
  token: vi.fn(),
}));

let loggerWarnSpy: ReturnType<typeof vi.spyOn>;

function createUnsignedJwt(
  sessionId: string,
  issuedAt: number,
  lifetime = 900
) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const timestamp = Math.floor(Date.now() / 1_000) - 1_000 + issuedAt;

  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      exp: timestamp + lifetime,
      iat: timestamp,
      sessionId,
      sub: "user_1",
    }),
    "signature",
  ].join(".");
}

const convexClient = {
  clearAuth: state.clearAuth,
  setAuth: state.setAuth,
} as unknown as React.ComponentProps<typeof ConvexBetterAuthProvider>["client"];

function renderProvider(
  initialToken: string,
  options: { strictMode?: boolean } = {}
) {
  const authClient = {
    convex: {
      token: state.token,
    },
    useSession: () => ({
      ...state.sessionSignal,
      refetch: state.refetchSession,
    }),
  } as unknown as React.ComponentProps<
    typeof ConvexBetterAuthProvider
  >["authClient"];

  const createElement = () =>
    React.createElement(ConvexBetterAuthProvider, {
      authClient,
      children: React.createElement("div", { "data-testid": "child" }),
      client: convexClient,
      initialToken,
    });
  const createTree = () =>
    options.strictMode
      ? React.createElement(React.StrictMode, null, createElement())
      : createElement();
  const view = render(createTree());

  return {
    ...view,
    rerenderProvider: () => view.rerender(createTree()),
  };
}

beforeEach(() => {
  loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  state.clearAuth.mockReset();
  state.observedTokens = [];
  state.sessionSignal = {
    data: null,
    error: null,
    isPending: true,
  };
  state.setAuth.mockReset();
  state.setAuthForceRefresh = null;
  state.setAuth.mockImplementation(
    (
      fetchAccessToken: (options?: {
        forceRefreshToken?: boolean;
      }) => Promise<string | null>
    ) => {
      state.fetchAccessToken = fetchAccessToken;
      const forceRefreshToken =
        state.setAuthForceRefresh ?? state.setAuth.mock.calls.length > 1;

      void fetchAccessToken({ forceRefreshToken }).then((token) =>
        state.observedTokens.push(token)
      );
    }
  );
  state.token.mockReset();
  state.refetchSession.mockReset().mockResolvedValue(undefined);
  state.fetchAccessToken = null;
});

afterEach(() => {
  cleanup();
  loggerWarnSpy.mockRestore();
  vi.useRealTimers();
});

test("keeps the initial JWT fetcher stable when Better Auth resolves the same session", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const refreshedToken = createUnsignedJwt("session_2", 1_100);
  state.token.mockResolvedValue({
    data: { token: refreshedToken },
    error: null,
  });

  const view = renderProvider(initialToken);

  await waitFor(() => {
    expect(state.observedTokens).toEqual([initialToken]);
  });
  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(state.token).not.toHaveBeenCalled();

  act(() => {
    state.sessionSignal = {
      data: { session: { id: "session_1" } },
      error: null,
      isPending: false,
    };
    view.rerenderProvider();
  });

  await act(async () => {
    await Promise.resolve();
  });

  expect(state.token).not.toHaveBeenCalled();
  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(state.observedTokens).toEqual([initialToken]);

  act(() => {
    state.sessionSignal = {
      data: { session: { id: "session_2" } },
      error: null,
      isPending: false,
    };
    view.rerenderProvider();
  });

  await waitFor(() => {
    expect(state.setAuth).toHaveBeenCalledTimes(2);
    expect(state.token).toHaveBeenCalledTimes(1);
    expect(state.observedTokens).toEqual([initialToken, refreshedToken]);
  });
});

test.each([403, 404, 503])(
  "keeps the current JWT when get-session returns a %s fetch error",
  async (status) => {
    const initialToken = createUnsignedJwt("session_1", 1_000);
    const view = renderProvider(initialToken);

    await waitFor(() => {
      expect(state.observedTokens).toEqual([initialToken]);
    });

    act(() => {
      state.sessionSignal = {
        data: null,
        error: { status },
        isPending: false,
      };
      view.rerenderProvider();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(state.clearAuth).not.toHaveBeenCalled();
    expect(state.setAuth).toHaveBeenCalledTimes(1);
    expect(state.observedTokens).toEqual([initialToken]);
  }
);

test("reuses the current initial JWT after the provider remounts", async () => {
  const firstToken = createUnsignedJwt("session_1", 1_000);
  const secondToken = createUnsignedJwt("session_2", 1_100);
  const firstView = renderProvider(firstToken);

  await waitFor(() => {
    expect(state.observedTokens).toEqual([firstToken]);
  });

  firstView.unmount();
  state.observedTokens = [];
  state.setAuth.mockClear();

  renderProvider(secondToken);

  await waitFor(() => {
    expect(state.observedTokens).toEqual([secondToken]);
  });
  expect(state.token).not.toHaveBeenCalled();
});

test("rotates a JWT in the same Better Auth session without clearing auth", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const refreshedToken = createUnsignedJwt("session_1", 1_800);
  state.token.mockResolvedValue({
    data: { token: refreshedToken },
    error: null,
  });

  renderProvider(initialToken);

  await waitFor(() => {
    expect(state.fetchAccessToken).not.toBeNull();
    expect(state.observedTokens).toEqual([initialToken]);
  });

  let result: string | null | undefined;
  await act(async () => {
    result = await state.fetchAccessToken?.({ forceRefreshToken: true });
  });

  expect(result).toBe(refreshedToken);
  expect(state.token).toHaveBeenCalledTimes(1);
  expect(state.clearAuth).not.toHaveBeenCalled();
});

test("waits through a transient failure and returns the next confirmed JWT", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const refreshedToken = createUnsignedJwt("session_1", 1_800);
  const recoveredToken = createUnsignedJwt("session_1", 2_600);
  state.token
    .mockResolvedValueOnce({
      data: { token: refreshedToken },
      error: null,
    })
    .mockResolvedValueOnce({
      data: null,
      error: { status: 503 },
    })
    .mockResolvedValueOnce({
      data: { token: recoveredToken },
      error: null,
    });

  renderProvider(initialToken);

  await waitFor(() => {
    expect(state.fetchAccessToken).not.toBeNull();
    expect(state.observedTokens).toEqual([initialToken]);
  });

  let firstRefresh: string | null | undefined;
  await act(async () => {
    firstRefresh = await state.fetchAccessToken?.({ forceRefreshToken: true });
  });

  expect(firstRefresh).toBe(refreshedToken);

  vi.useFakeTimers();

  let transientRefresh: Promise<string | null> | undefined;
  await act(async () => {
    transientRefresh = state.fetchAccessToken?.({
      forceRefreshToken: true,
    });
    await Promise.resolve();
  });

  expect(state.token).toHaveBeenCalledTimes(2);
  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(state.clearAuth).not.toHaveBeenCalled();

  let recoveredRefresh: string | null | undefined;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
    recoveredRefresh = await transientRefresh;
  });

  expect(recoveredRefresh).toBe(recoveredToken);
  expect(state.token).toHaveBeenCalledTimes(3);
  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(state.clearAuth).not.toHaveBeenCalled();
});

test("keeps current Convex auth while retrying repeated transient failures", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const refreshedToken = createUnsignedJwt("session_1", 1_800);
  state.token
    .mockResolvedValueOnce({
      data: null,
      error: { status: 503 },
    })
    .mockRejectedValueOnce(new Error("network unavailable"))
    .mockResolvedValueOnce({
      data: { token: refreshedToken },
      error: null,
    });

  renderProvider(initialToken);

  await waitFor(() => {
    expect(state.fetchAccessToken).not.toBeNull();
    expect(state.observedTokens).toEqual([initialToken]);
  });

  vi.useFakeTimers();

  let refresh: Promise<string | null> | undefined;
  await act(async () => {
    refresh = state.fetchAccessToken?.({ forceRefreshToken: true });
    await Promise.resolve();
  });

  expect(state.token).toHaveBeenCalledTimes(1);
  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(state.clearAuth).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  expect(state.token).toHaveBeenCalledTimes(2);
  expect(state.clearAuth).not.toHaveBeenCalled();

  let result: string | null | undefined;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
    result = await refresh;
  });

  expect(result).toBe(refreshedToken);
  expect(state.token).toHaveBeenCalledTimes(3);
  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(state.clearAuth).not.toHaveBeenCalled();
});

test("continues refresh retries after the StrictMode effect replay", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const refreshedToken = createUnsignedJwt("session_1", 1_800);
  state.token
    .mockResolvedValueOnce({
      data: null,
      error: { status: 503 },
    })
    .mockResolvedValueOnce({
      data: { token: refreshedToken },
      error: null,
    });

  renderProvider(initialToken, { strictMode: true });

  await waitFor(() => {
    expect(state.fetchAccessToken).not.toBeNull();
    expect(state.observedTokens).toContain(initialToken);
  });
  const strictModeReplayClearAuthCalls = state.clearAuth.mock.calls.length;

  vi.useFakeTimers();

  let refresh: Promise<string | null> | undefined;
  await act(async () => {
    refresh = state.fetchAccessToken?.({ forceRefreshToken: true });
    await Promise.resolve();
  });

  expect(state.token).toHaveBeenCalledTimes(1);

  let result: string | null | undefined;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
    result = await refresh;
  });

  expect(result).toBe(refreshedToken);
  expect(state.token).toHaveBeenCalledTimes(2);
  expect(state.clearAuth).toHaveBeenCalledTimes(strictModeReplayClearAuthCalls);
});

test("starts the new session refresh without reusing an older pending request", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const nextSessionToken = createUnsignedJwt("session_2", 1_800);
  state.sessionSignal = {
    data: { session: { id: "session_1" } },
    error: null,
    isPending: false,
  };
  state.token
    .mockResolvedValueOnce({
      data: null,
      error: { status: 503 },
    })
    .mockResolvedValueOnce({
      data: { token: nextSessionToken },
      error: null,
    });

  const view = renderProvider(initialToken);

  await waitFor(() => {
    expect(state.fetchAccessToken).not.toBeNull();
    expect(state.observedTokens).toEqual([initialToken]);
  });

  vi.useFakeTimers();

  let staleSessionRefresh: Promise<string | null> | undefined;
  await act(async () => {
    staleSessionRefresh = state.fetchAccessToken?.({ forceRefreshToken: true });
    await Promise.resolve();
  });

  expect(state.token).toHaveBeenCalledTimes(1);

  act(() => {
    state.sessionSignal = {
      data: { session: { id: "session_2" } },
      error: null,
      isPending: false,
    };
    view.rerenderProvider();
  });

  await act(async () => {
    await Promise.resolve();
  });

  expect(state.token).toHaveBeenCalledTimes(2);
  expect(state.observedTokens).toEqual([initialToken, nextSessionToken]);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  await expect(staleSessionRefresh).resolves.toBeNull();
  expect(state.clearAuth).toHaveBeenCalledTimes(1);
});

test("ignores a successful stale-session response that arrives after the new JWT", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const staleSessionToken = createUnsignedJwt("session_1", 1_800);
  const nextSessionToken = createUnsignedJwt("session_2", 1_900);
  let resolveStaleResponse!: (value: {
    data: { token: string };
    error: null;
  }) => void;
  const staleResponse = new Promise<{
    data: { token: string };
    error: null;
  }>((resolve) => {
    resolveStaleResponse = resolve;
  });

  state.sessionSignal = {
    data: { session: { id: "session_1" } },
    error: null,
    isPending: false,
  };
  state.token
    .mockImplementationOnce(() => staleResponse)
    .mockResolvedValueOnce({
      data: { token: nextSessionToken },
      error: null,
    });

  const view = renderProvider(initialToken);

  await waitFor(() => {
    expect(state.fetchAccessToken).not.toBeNull();
    expect(state.observedTokens).toEqual([initialToken]);
  });

  const staleFetcher = state.fetchAccessToken;
  let staleRefresh: Promise<string | null> | undefined;
  await act(async () => {
    staleRefresh = staleFetcher?.({ forceRefreshToken: true });
    await Promise.resolve();
  });
  expect(state.token).toHaveBeenCalledTimes(1);

  act(() => {
    state.sessionSignal = {
      data: { session: { id: "session_2" } },
      error: null,
      isPending: false,
    };
    view.rerenderProvider();
  });

  await waitFor(() => {
    expect(state.token).toHaveBeenCalledTimes(2);
    expect(state.observedTokens).toEqual([initialToken, nextSessionToken]);
  });

  await act(async () => {
    resolveStaleResponse({
      data: { token: staleSessionToken },
      error: null,
    });
    await staleRefresh;
  });

  await expect(staleRefresh).resolves.toBeNull();
  await expect(state.fetchAccessToken?.()).resolves.toBe(nextSessionToken);
  expect(state.token).toHaveBeenCalledTimes(2);
});

test.each(["sign-out", "provider unmount"])(
  "ignores a pending token response after %s",
  async (boundary) => {
    const initialToken = createUnsignedJwt("session_1", 1_000);
    const staleToken = createUnsignedJwt("session_1", 1_800);
    let resolveStaleResponse!: (value: {
      data: { token: string };
      error: null;
    }) => void;
    state.token.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleResponse = resolve;
        })
    );
    const view = renderProvider(initialToken);

    await waitFor(() => {
      expect(state.observedTokens).toEqual([initialToken]);
    });

    let staleRefresh: Promise<string | null> | undefined;
    await act(async () => {
      staleRefresh = state.fetchAccessToken?.({ forceRefreshToken: true });
      await Promise.resolve();
    });
    expect(state.token).toHaveBeenCalledTimes(1);

    if (boundary === "sign-out") {
      act(() => {
        state.sessionSignal = {
          data: null,
          error: null,
          isPending: false,
        };
        view.rerenderProvider();
      });
      await waitFor(() => {
        expect(state.clearAuth).toHaveBeenCalledTimes(1);
      });
    } else {
      view.unmount();
    }

    await act(async () => {
      resolveStaleResponse({ data: { token: staleToken }, error: null });
      await staleRefresh;
    });

    await expect(staleRefresh).resolves.toBeNull();
    expect(state.observedTokens).toEqual([initialToken]);
  }
);

test("coalesces forced refresh callers across a transient retry", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const refreshedToken = createUnsignedJwt("session_1", 1_800);
  state.token
    .mockResolvedValueOnce({
      data: null,
      error: { status: 503 },
    })
    .mockResolvedValueOnce({
      data: { token: refreshedToken },
      error: null,
    });

  renderProvider(initialToken);

  await waitFor(() => {
    expect(state.fetchAccessToken).not.toBeNull();
    expect(state.observedTokens).toEqual([initialToken]);
  });

  vi.useFakeTimers();

  let firstRefresh: Promise<string | null> | undefined;
  let secondRefresh: Promise<string | null> | undefined;
  await act(async () => {
    firstRefresh = state.fetchAccessToken?.({ forceRefreshToken: true });
    secondRefresh = state.fetchAccessToken?.({ forceRefreshToken: true });
    await Promise.resolve();
  });

  expect(state.token).toHaveBeenCalledTimes(1);
  expect(state.setAuth).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  await expect(firstRefresh).resolves.toBe(refreshedToken);
  await expect(secondRefresh).resolves.toBe(refreshedToken);
  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(state.token).toHaveBeenCalledTimes(2);
  expect(state.observedTokens).toEqual([initialToken]);
  expect(state.clearAuth).not.toHaveBeenCalled();
});

test("returns no JWT after an explicit unauthorized token response", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  state.token.mockResolvedValue({
    data: null,
    error: { statusCode: 401 },
  });

  renderProvider(initialToken);

  await waitFor(() => {
    expect(state.fetchAccessToken).not.toBeNull();
    expect(state.observedTokens).toEqual([initialToken]);
  });

  let refresh: Promise<string | null> | undefined;
  await act(async () => {
    refresh = state.fetchAccessToken?.({ forceRefreshToken: true });
    await Promise.resolve();
  });

  await expect(refresh).resolves.toBeNull();
  expect(state.clearAuth).toHaveBeenCalledTimes(1);
});

test.each([
  { status: 400, statusCode: undefined },
  { status: 403, statusCode: undefined },
  { status: undefined, statusCode: 404 },
])(
  "preserves Convex auth while retrying a non-401 token response ($status$statusCode)",
  async (error) => {
    const initialToken = createUnsignedJwt("session_1", 1_000);
    const refreshedToken = createUnsignedJwt("session_1", 1_800);
    state.token
      .mockResolvedValueOnce({
        data: null,
        error,
      })
      .mockResolvedValueOnce({
        data: { token: refreshedToken },
        error: null,
      });

    renderProvider(initialToken);

    await waitFor(() => {
      expect(state.fetchAccessToken).not.toBeNull();
      expect(state.observedTokens).toEqual([initialToken]);
    });

    vi.useFakeTimers();

    let refresh: Promise<string | null> | undefined;
    await act(async () => {
      refresh = state.fetchAccessToken?.({ forceRefreshToken: true });
      await Promise.resolve();
    });

    expect(state.token).toHaveBeenCalledTimes(1);
    expect(state.clearAuth).not.toHaveBeenCalled();

    let result: string | null | undefined;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      result = await refresh;
    });

    expect(result).toBe(refreshedToken);
    expect(state.token).toHaveBeenCalledTimes(2);
    expect(state.clearAuth).not.toHaveBeenCalled();
  }
);

test("rechecks the authoritative session when a successful token belongs to another session", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const nextToken = createUnsignedJwt("session_2", 1_100);
  state.sessionSignal = {
    data: { session: { id: "session_1" } },
    error: null,
    isPending: false,
  };
  state.token.mockResolvedValue({ data: { token: nextToken }, error: null });
  const view = renderProvider(initialToken);
  await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
  state.refetchSession.mockImplementation(async () => {
    state.sessionSignal = {
      data: { session: { id: "session_2" } },
      error: null,
      isPending: false,
    };
    view.rerenderProvider();
  });

  let refresh: Promise<string | null> | undefined;
  await act(async () => {
    refresh = state.fetchAccessToken?.({ forceRefreshToken: true });
    await Promise.resolve();
  });

  await expect(refresh).resolves.toBeNull();
  expect(state.refetchSession).toHaveBeenCalledWith({
    query: { disableCookieCache: true },
  });
  expect(state.observedTokens).toEqual([initialToken, nextToken]);
  expect(state.token).toHaveBeenCalledTimes(2);
});

test("bounds retries for an unresolved session mismatch without reporting sign-out to the SDK", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const wrongToken = createUnsignedJwt("session_2", 1_100);
  state.token.mockResolvedValue({ data: { token: wrongToken }, error: null });
  renderProvider(initialToken);
  await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
  vi.useFakeTimers();
  const settled = vi.fn();

  await act(async () => {
    void state.fetchAccessToken?.({ forceRefreshToken: true }).then(settled);
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(settled).not.toHaveBeenCalled();
  expect(state.token.mock.calls.length).toBeLessThanOrEqual(6);
  expect(state.refetchSession).toHaveBeenCalled();
  expect(loggerWarnSpy).toHaveBeenCalledWith(
    "[ConvexBetterAuthProvider] token refresh retrying",
    expect.objectContaining({ kind: "session-mismatch", status: null })
  );
  expect(loggerWarnSpy).not.toHaveBeenCalledWith(
    "[ConvexBetterAuthProvider] token refresh retrying",
    expect.objectContaining({ kind: "transient-response", status: null })
  );
  expect(state.observedTokens).toEqual([initialToken]);
  expect(state.clearAuth).not.toHaveBeenCalled();
});

test("times out an unresponsive request before retrying a confirmed token", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const refreshedToken = createUnsignedJwt("session_1", 1_100);
  state.token
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce({ data: { token: refreshedToken }, error: null });
  renderProvider(initialToken);
  await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
  vi.useFakeTimers();
  let refresh: Promise<string | null> | undefined;

  await act(async () => {
    refresh = state.fetchAccessToken?.({ forceRefreshToken: true });
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(state.token.mock.calls[0]?.[0]?.fetchOptions.signal.aborted).toBe(
    true
  );
  expect(state.token).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  await expect(refresh).resolves.toBe(refreshedToken);
  expect(state.token).toHaveBeenCalledTimes(2);
  expect(state.clearAuth).not.toHaveBeenCalled();
});

test.each(["sign-out", "provider unmount", "session switch"])(
  "cancels an unresponsive token request immediately on %s",
  async (boundary) => {
    const initialToken = createUnsignedJwt("session_1", 1_000);
    const nextToken = createUnsignedJwt("session_2", 1_100);
    state.token
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ data: { token: nextToken }, error: null });
    const view = renderProvider(initialToken);
    await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
    const settled = vi.fn();
    await act(async () => {
      void state.fetchAccessToken?.({ forceRefreshToken: true }).then(settled);
      await Promise.resolve();
    });

    await act(async () => {
      if (boundary === "provider unmount") {
        view.unmount();
      } else {
        state.sessionSignal = {
          data:
            boundary === "session switch"
              ? { session: { id: "session_2" } }
              : null,
          error: null,
          isPending: false,
        };
        view.rerenderProvider();
      }
    });

    expect(state.token.mock.calls[0]?.[0]?.fetchOptions.signal.aborted).toBe(
      true
    );
    expect(settled).toHaveBeenCalledWith(null);
    if (boundary === "session switch") {
      expect(state.observedTokens).toEqual([initialToken, nextToken]);
    }
  }
);

test("clears a cached token on an explicit unauthorized session response", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const view = renderProvider(initialToken);
  await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));

  await act(async () => {
    state.sessionSignal = {
      data: null,
      error: { status: 401 },
      isPending: false,
    };
    view.rerenderProvider();
  });

  expect(state.clearAuth).toHaveBeenCalledTimes(1);
  await expect(state.fetchAccessToken?.()).resolves.toBeNull();
});

test("keeps a prolonged refresh pending and resumes it when connectivity returns", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const refreshedToken = createUnsignedJwt("session_1", 1_100);
  state.token.mockResolvedValue({ data: null, error: { status: 503 } });
  renderProvider(initialToken);
  await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
  vi.useFakeTimers();
  const settled = vi.fn();
  await act(async () => {
    void state.fetchAccessToken?.({ forceRefreshToken: true }).then(settled);
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(settled).not.toHaveBeenCalled();
  expect(state.clearAuth).not.toHaveBeenCalled();
  state.token.mockResolvedValue({
    data: { token: refreshedToken },
    error: null,
  });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });

  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledWith(refreshedToken);
  expect(state.observedTokens).toEqual([initialToken]);
  const requests = state.token.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("online"));
  });
  expect(state.token).toHaveBeenCalledTimes(requests);
});

test("refreshes an expired initial token instead of replaying it", async () => {
  const expiredToken = createUnsignedJwt("session_1", 1_000, -1);
  const freshToken = createUnsignedJwt("session_1", 1_100);
  state.token.mockResolvedValue({ data: { token: freshToken }, error: null });

  renderProvider(expiredToken);

  await waitFor(() => expect(state.observedTokens).toEqual([freshToken]));
  expect(state.token).toHaveBeenCalledTimes(1);
});

test("restarts a stalled initial refresh after the StrictMode effect replay", async () => {
  const expiredToken = createUnsignedJwt("session_1", 1_000, -1);
  const freshToken = createUnsignedJwt("session_1", 1_100);
  state.token
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue({ data: { token: freshToken }, error: null });

  renderProvider(expiredToken, { strictMode: true });

  await waitFor(() => expect(state.observedTokens).toContain(freshToken));
  expect(state.token.mock.calls[0]?.[0]?.fetchOptions.signal.aborted).toBe(
    true
  );
  expect(state.token).toHaveBeenCalledTimes(2);
});

test("retries a prolonged outage on a bounded recovery timer without a browser event", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const freshToken = createUnsignedJwt("session_1", 1_100);
  state.token.mockResolvedValue({ data: null, error: { status: 503 } });
  renderProvider(initialToken);
  await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
  vi.useFakeTimers();
  const settled = vi.fn();
  await act(async () => {
    void state.fetchAccessToken?.({ forceRefreshToken: true }).then(settled);
    await vi.advanceTimersByTimeAsync(30_000);
  });

  state.token.mockResolvedValue({ data: { token: freshToken }, error: null });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });

  expect(state.setAuth).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledWith(freshToken);
  expect(state.observedTokens).toEqual([initialToken]);
  expect(vi.getTimerCount()).toBe(0);
});

test("cleans up a pending recovery timer and listeners on unmount", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  state.token.mockResolvedValue({ data: null, error: { status: 503 } });
  const view = renderProvider(initialToken);
  await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
  vi.useFakeTimers();
  await act(async () => {
    void state.fetchAccessToken?.({ forceRefreshToken: true });
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(vi.getTimerCount()).toBe(1);

  view.unmount();
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(vi.getTimerCount()).toBe(0);
  expect(state.setAuth).toHaveBeenCalledTimes(1);
});

test("coalesces an SDK reconfiguration into the pending refresh without replaying its old JWT", async () => {
  const initialToken = createUnsignedJwt("session_1", 1_000);
  const freshToken = createUnsignedJwt("session_1", 1_100);
  state.setAuthForceRefresh = false;
  state.token.mockResolvedValue({ data: null, error: { status: 503 } });
  renderProvider(initialToken);
  await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
  vi.useFakeTimers();
  await act(async () => {
    void state.fetchAccessToken?.({ forceRefreshToken: true });
    await vi.advanceTimersByTimeAsync(30_000);
  });

  const joined = vi.fn();
  void state.fetchAccessToken?.({ forceRefreshToken: false }).then(joined);
  await act(async () => {
    await Promise.resolve();
  });
  expect(joined).not.toHaveBeenCalled();

  state.token.mockResolvedValue({ data: { token: freshToken }, error: null });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });

  expect(state.observedTokens).toEqual([initialToken]);
  expect(joined).toHaveBeenCalledWith(freshToken);
  await expect(state.fetchAccessToken?.()).resolves.toBe(freshToken);
});

test.each(["same-token", "empty-response"])(
  "does not turn a successful but unusable %s response into an authentication failure",
  async (response) => {
    const initialToken = createUnsignedJwt("session_1", 1_000);
    const freshToken = createUnsignedJwt("session_1", 1_100);
    state.token
      .mockResolvedValueOnce({
        data: response === "same-token" ? { token: initialToken } : null,
        error: null,
      })
      .mockResolvedValueOnce({ data: { token: freshToken }, error: null });
    renderProvider(initialToken);
    await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
    vi.useFakeTimers();
    const settled = vi.fn();
    await act(async () => {
      void state.fetchAccessToken?.({ forceRefreshToken: true }).then(settled);
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(settled).toHaveBeenCalledWith(freshToken);
    expect(state.clearAuth).not.toHaveBeenCalled();
    expect(state.setAuth).toHaveBeenCalledTimes(1);
  }
);

test.each(["sign-out", "session switch"])(
  "cancels the recovery cooldown on %s without adopting the previous identity",
  async (boundary) => {
    const initialToken = createUnsignedJwt("session_1", 1_000);
    const nextToken = createUnsignedJwt("session_2", 1_100);
    state.token.mockResolvedValue({ data: null, error: { status: 503 } });
    const view = renderProvider(initialToken);
    await waitFor(() => expect(state.observedTokens).toEqual([initialToken]));
    vi.useFakeTimers();
    const settled = vi.fn();
    await act(async () => {
      void state.fetchAccessToken?.({ forceRefreshToken: true }).then(settled);
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(settled).not.toHaveBeenCalled();
    state.token.mockResolvedValue({ data: { token: nextToken }, error: null });
    await act(async () => {
      state.sessionSignal = {
        data:
          boundary === "session switch"
            ? { session: { id: "session_2" } }
            : null,
        error: null,
        isPending: false,
      };
      view.rerenderProvider();
    });
    expect(settled).toHaveBeenCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
    if (boundary === "session switch")
      expect(state.observedTokens).toEqual([initialToken, nextToken]);
  }
);
