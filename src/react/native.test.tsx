// @vitest-environment node

import * as React from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ConvexBetterAuthProvider } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([undefined, {}])(
  "mounts and cancels pending auth without DOM APIs (window: %j)",
  async (nativeWindow) => {
    vi.stubGlobal("window", nativeWindow);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const payload = Buffer.from(
      JSON.stringify({ sessionId: "session_1", exp: Date.now() / 1000 + 900 })
    ).toString("base64url");
    const initialToken = `header.${payload}.signature`;
    let fetchAccessToken!: (options: {
      forceRefreshToken: boolean;
    }) => Promise<string | null>;
    const observedTokens: Array<string | null> = [];
    const client = {
      setAuth: vi.fn((fetcher: typeof fetchAccessToken) => {
        fetchAccessToken = fetcher;
        void fetcher({ forceRefreshToken: false }).then((token) => {
          observedTokens.push(token);
        });
      }),
      clearAuth: vi.fn(),
    } as unknown as React.ComponentProps<
      typeof ConvexBetterAuthProvider
    >["client"];
    const token = vi.fn(() => new Promise<never>(() => {}));
    const authClient = {
      convex: { token },
      useSession: () => ({
        data: { session: { id: "session_1" } },
        isPending: false,
        error: null,
        refetch: vi.fn(),
      }),
    } as unknown as React.ComponentProps<
      typeof ConvexBetterAuthProvider
    >["authClient"];
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          <ConvexBetterAuthProvider
            client={client}
            authClient={authClient}
            initialToken={initialToken}
          >
            {null}
          </ConvexBetterAuthProvider>
        );
      });
      expect(observedTokens).toEqual([initialToken]);
      let pending: Promise<string | null> | undefined;
      await act(async () => {
        pending = fetchAccessToken({ forceRefreshToken: true });
        await Promise.resolve();
      });
      expect(token).toHaveBeenCalledTimes(1);
      const request = token.mock.calls[0] as unknown as [
        { fetchOptions: { signal: AbortSignal } },
      ];
      await act(async () => renderer?.unmount());
      renderer = undefined;
      await expect(pending).resolves.toBeNull();
      expect(request[0].fetchOptions.signal.aborted).toBe(true);
      expect(client.clearAuth).toHaveBeenCalledTimes(1);
    } finally {
      if (renderer) await act(async () => renderer?.unmount());
    }
  }
);
