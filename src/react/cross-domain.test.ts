import { describe, expect, it, vi } from "vitest";
import { handleCrossDomainCallback } from "./cross-domain.js";
import type { RequiredAuthClient } from "./cross-domain.js";

const coreClient = (): RequiredAuthClient => ({
  useSession: () => ({ data: null, isPending: false }),
  getSession: vi.fn(),
  convex: {
    token: vi.fn(),
  },
});

describe("handleCrossDomainCallback", () => {
  it("verifies supported callbacks and refreshes the session", async () => {
    const authClient = {
      ...coreClient(),
      crossDomain: {
        oneTimeToken: {
          verify: vi.fn().mockResolvedValue({
            data: { session: { token: "session-token" } },
          }),
        },
      },
      updateSession: vi.fn(),
    };
    const replaceUrl = vi.fn();

    await handleCrossDomainCallback(
      authClient,
      "https://example.com/callback?ott=one-time-token&next=%2Fsettings",
      replaceUrl
    );

    expect(authClient.crossDomain.oneTimeToken.verify).toHaveBeenCalledWith({
      token: "one-time-token",
    });
    expect(replaceUrl).toHaveBeenCalledOnce();
    const replacedUrl = replaceUrl.mock.calls[0]?.[0] as URL;
    expect(replacedUrl.searchParams.has("ott")).toBe(false);
    expect(replacedUrl.searchParams.get("next")).toBe("/settings");
    expect(authClient.getSession).toHaveBeenCalledWith({
      fetchOptions: {
        headers: { Authorization: "Bearer session-token" },
      },
    });
    expect(authClient.updateSession).toHaveBeenCalledOnce();
  });
});
