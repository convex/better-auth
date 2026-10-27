import { afterEach, describe, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { convexBetterAuthReactStart } from "./index.js";

const { mockGetToken, mockQuery, mockSetAuth } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockQuery: vi.fn(),
  mockSetAuth: vi.fn(),
}));

vi.mock("../utils/index.js", () => ({
  getToken: mockGetToken,
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    setAuth = mockSetAuth;
    setFetchOptions() {}
    query = mockQuery;
    mutation = vi.fn();
    action = vi.fn();
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers({ cookie: "session=abc" }),
}));

const SITE_URL = "https://test.convex.site";
const CONVEX_URL = "https://test.convex.cloud";
const queryRef = {
  _name: "api.tasks.list",
} as unknown as FunctionReference<"query">;

const setup = (isAuthError: (error: unknown) => boolean) =>
  convexBetterAuthReactStart({
    convexUrl: CONVEX_URL,
    convexSiteUrl: SITE_URL,
    jwtCache: {
      enabled: true,
      isAuthError,
    },
  });

describe("convexBetterAuthReactStart jwtCache retry", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the token once when the first error is auth-related", async () => {
    const authError = new Error("Unauthorized");
    mockGetToken
      .mockResolvedValueOnce({ token: "stale-token", isFresh: false })
      .mockResolvedValueOnce({ token: "fresh-token", isFresh: true });
    mockQuery
      .mockRejectedValueOnce(authError)
      .mockResolvedValueOnce([{ text: "ok" }]);

    const { fetchAuthQuery } = setup((error) => error === authError);

    await expect(fetchAuthQuery(queryRef, {})).resolves.toEqual([
      { text: "ok" },
    ]);

    expect(mockGetToken).toHaveBeenCalledTimes(2);
    expect(mockGetToken.mock.calls[1]?.[2]).toMatchObject({
      forceRefresh: true,
    });
    expect(mockSetAuth.mock.calls).toEqual([["stale-token"], ["fresh-token"]]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-auth errors without refreshing", async () => {
    const failure = new Error("validation failed");
    mockGetToken.mockResolvedValue({ token: "stale-token", isFresh: false });
    mockQuery.mockRejectedValue(failure);

    const { fetchAuthQuery } = setup(() => false);

    await expect(fetchAuthQuery(queryRef, {})).rejects.toBe(failure);
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
  it("does not retry when the cached token was already fresh", async () => {
    const authError = new Error("Unauthorized");
    mockGetToken.mockResolvedValue({ token: "fresh-token", isFresh: true });
    mockQuery.mockRejectedValue(authError);

    const { fetchAuthQuery } = setup((error) => error === authError);

    await expect(fetchAuthQuery(queryRef, {})).rejects.toBe(authError);
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
