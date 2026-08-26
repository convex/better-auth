import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test, vi } from "vitest";

import { ConvexBetterAuthProvider } from "./index.js";
import type { AuthClient } from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConvexBetterAuthProvider", () => {
  test("keeps auth set during SSR hydration and rotates it for a new session", async () => {
    let sessionState: {
      data: { session: { id: string } } | null;
      isPending: boolean;
    } = { data: null, isPending: true };
    const token = vi
      .fn()
      .mockResolvedValueOnce({ data: { token: "fresh-token" } })
      .mockResolvedValueOnce({ data: { token: "replacement-token" } });
    const authClient = {
      convex: { token },
      useSession: () => sessionState,
    } as unknown as AuthClient;
    const client = {
      clearAuth: vi.fn(),
      setAuth: vi.fn(),
    };
    const renderProvider = () => (
      <ConvexBetterAuthProvider
        authClient={authClient}
        client={client}
        initialToken="server-token"
      >
        <div />
      </ConvexBetterAuthProvider>
    );

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderProvider());
    });

    expect(client.setAuth).toHaveBeenCalledTimes(1);
    const initialFetchToken = client.setAuth.mock.calls[0]?.[0];
    await expect(
      initialFetchToken?.({ forceRefreshToken: false })
    ).resolves.toBe("server-token");
    await act(async () => {
      await expect(
        initialFetchToken?.({ forceRefreshToken: true })
      ).resolves.toBe("fresh-token");
    });
    await expect(
      initialFetchToken?.({ forceRefreshToken: false })
    ).resolves.toBe("fresh-token");
    expect(token).toHaveBeenCalledTimes(1);

    sessionState = {
      data: { session: { id: "session-a" } },
      isPending: false,
    };
    await act(async () => {
      renderer.update(renderProvider());
    });

    expect(client.clearAuth).not.toHaveBeenCalled();
    expect(client.setAuth).toHaveBeenCalledTimes(1);

    sessionState = {
      data: { session: { id: "session-b" } },
      isPending: false,
    };
    await act(async () => {
      renderer.update(renderProvider());
    });

    expect(client.clearAuth).toHaveBeenCalledTimes(1);
    expect(client.setAuth).toHaveBeenCalledTimes(2);
    const replacementFetchToken = client.setAuth.mock.calls[1]?.[0];
    expect(replacementFetchToken).not.toBe(initialFetchToken);
    await expect(
      replacementFetchToken?.({ forceRefreshToken: false })
    ).resolves.toBe("replacement-token");
    expect(token).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("does not reuse or cache a pending token from a replaced session", async () => {
    let sessionState: {
      data: { session: { id: string } } | null;
      isPending: boolean;
    } = {
      data: { session: { id: "session-a" } },
      isPending: false,
    };
    let resolveSessionAToken!: (value: { data: { token: string } }) => void;
    const sessionATokenRequest = new Promise<{ data: { token: string } }>(
      (resolve) => {
        resolveSessionAToken = resolve;
      }
    );
    const token = vi
      .fn()
      .mockReturnValueOnce(sessionATokenRequest)
      .mockResolvedValueOnce({ data: { token: "session-b-token" } });
    const authClient = {
      convex: { token },
      useSession: () => sessionState,
    } as unknown as AuthClient;
    const client = {
      clearAuth: vi.fn(),
      setAuth: vi.fn(),
    };
    const renderProvider = () => (
      <ConvexBetterAuthProvider authClient={authClient} client={client}>
        <div />
      </ConvexBetterAuthProvider>
    );

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderProvider());
    });

    const sessionAFetchToken = client.setAuth.mock.calls[0]?.[0];
    const staleTokenPromise = sessionAFetchToken?.({
      forceRefreshToken: false,
    });
    expect(token).toHaveBeenCalledTimes(1);

    sessionState = {
      data: { session: { id: "session-b" } },
      isPending: false,
    };
    await act(async () => {
      renderer.update(renderProvider());
    });

    expect(client.clearAuth).toHaveBeenCalledTimes(1);
    expect(client.setAuth).toHaveBeenCalledTimes(2);
    const sessionBFetchToken = client.setAuth.mock.calls[1]?.[0];
    await act(async () => {
      await expect(
        sessionBFetchToken?.({ forceRefreshToken: false })
      ).resolves.toBe("session-b-token");
    });

    let staleToken: string | null | undefined;
    await act(async () => {
      resolveSessionAToken({ data: { token: "session-a-token" } });
      staleToken = await staleTokenPromise;
    });

    expect(staleToken).toBeNull();
    await expect(
      sessionBFetchToken?.({ forceRefreshToken: false })
    ).resolves.toBe("session-b-token");
    expect(token).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer.unmount();
    });
  });
});
