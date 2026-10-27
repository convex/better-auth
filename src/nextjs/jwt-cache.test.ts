import { afterEach, describe, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { convexBetterAuthNextJs } from "./index.js";

const { mockGetToken, mockFetchQuery } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockFetchQuery: vi.fn(),
}));

vi.mock("../utils/index.js", () => ({
  getToken: mockGetToken,
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: mockFetchQuery,
  fetchMutation: vi.fn(),
  fetchAction: vi.fn(),
  preloadQuery: vi.fn(),
}));

vi.mock("next/headers.js", () => ({
  headers: async () => new Headers({ cookie: "session=abc" }),
}));

const SITE_URL = "https://test.convex.site";
const CONVEX_URL = "https://test.convex.cloud";
const queryRef = {
  _name: "api.tasks.list",
} as unknown as FunctionReference<"query">;

const setup = (isAuthError: (error: unknown) => boolean) =>
  convexBetterAuthNextJs({
    convexUrl: CONVEX_URL,
    convexSiteUrl: SITE_URL,
    jwtCache: {
      enabled: true,
      isAuthError,
    },
  });

describe("convexBetterAuthNextJs jwtCache retry", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the token once when the first error is auth-related", async () => {
    const authError = new Error("Unauthorized");
    mockGetToken
      .mockResolvedValueOnce({ token: "stale-token", isFresh: false })
      .mockResolvedValueOnce({ token: "fresh-token", isFresh: true });
    mockFetchQuery
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
    expect(mockFetchQuery).toHaveBeenNthCalledWith(
      1,
      queryRef,
      {},
      { token: "stale-token" }
    );
    expect(mockFetchQuery).toHaveBeenNthCalledWith(
      2,
      queryRef,
      {},
      { token: "fresh-token" }
    );
  });

  it("rethrows non-auth errors without refreshing", async () => {
    const failure = new Error("validation failed");
    mockGetToken.mockResolvedValue({ token: "stale-token", isFresh: false });
    mockFetchQuery.mockRejectedValue(failure);

    const { fetchAuthQuery } = setup(() => false);

    await expect(fetchAuthQuery(queryRef, {})).rejects.toBe(failure);
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockFetchQuery).toHaveBeenCalledTimes(1);
  });
  it("does not retry when the cached token was already fresh", async () => {
    const authError = new Error("Unauthorized");
    mockGetToken.mockResolvedValue({ token: "fresh-token", isFresh: true });
    mockFetchQuery.mockRejectedValue(authError);

    const { fetchAuthQuery } = setup((error) => error === authError);

    await expect(fetchAuthQuery(queryRef, {})).rejects.toBe(authError);
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockFetchQuery).toHaveBeenCalledTimes(1);
  });
});
