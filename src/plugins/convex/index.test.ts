import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import type { AuthConfig } from "convex/server";
import { getAuthConfigProvider } from "../../auth-config.js";
import { convex } from "./index.js";

const authConfig = {
  providers: [{ applicationID: "convex", domain: "https://example.com" }],
} satisfies AuthConfig;

const getJwtSetCookieMatcher = () => {
  const plugin = convex({ authConfig });
  const afterHooks = plugin.hooks?.after ?? [];
  const matcher = afterHooks.find((hook) => {
    return (
      hook.matcher({
        path: "/sign-in/email",
        context: { session: { id: "s1" } },
      } as unknown as Parameters<typeof hook.matcher>[0]) &&
      !hook.matcher({
        path: "/sign-out",
        context: { session: null },
      } as unknown as Parameters<typeof hook.matcher>[0])
    );
  })?.matcher;
  if (!matcher) {
    throw new Error("Failed to find Convex JWT set-cookie after hook matcher");
  }
  return matcher;
};

describe("convex plugin JWT cookie refresh matcher", () => {
  it("matches update-session", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const ctx = {
      path: "/update-session",
      context: { session: { id: "s1" } },
    };
    expect(matcher(ctx as unknown as MatcherContext)).toBe(true);
  });

  it("matches get-session only when a session exists", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const withSessionCtx = {
      path: "/get-session",
      context: { session: { id: "s1" } },
    };
    const withoutSessionCtx = {
      path: "/get-session",
      context: { session: null },
    };
    expect(matcher(withSessionCtx as unknown as MatcherContext)).toBe(true);
    expect(matcher(withoutSessionCtx as unknown as MatcherContext)).toBe(false);
  });
});

const BASE_URL = "http://localhost:3000";
const BASE_PATH = "/api/auth";

const createJwksRow = async () => {
  const { publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  return {
    id: "test-key-id",
    alg: "RS256",
    publicKey: JSON.stringify(await crypto.subtle.exportKey("jwk", publicKey)),
    createdAt: new Date(),
  };
};

const createAuth = async (convexOpts?: { jwksCacheMaxAgeSeconds?: number }) => {
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [await createJwksRow()],
  };
  return betterAuth({
    baseURL: BASE_URL,
    basePath: BASE_PATH,
    secret: "test-secret-at-least-thirty-two-characters-long",
    database: memoryAdapter(db),
    plugins: [
      convex({
        authConfig: { providers: [getAuthConfigProvider()] },
        ...convexOpts,
      }),
    ],
  });
};

const getJwks = async (convexOpts?: { jwksCacheMaxAgeSeconds?: number }) => {
  const auth = await createAuth(convexOpts);
  return auth.handler(new Request(`${BASE_URL}${BASE_PATH}/convex/jwks`));
};

describe("convex plugin JWKS cache-control", () => {
  beforeEach(() => {
    // The plugin reads CONVEX_SITE_URL when it is constructed.
    vi.stubEnv("CONVEX_SITE_URL", BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caches for a minute by default", async () => {
    const response = await getJwks();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, must-revalidate"
    );
  });

  it("uses the configured max age", async () => {
    const response = await getJwks({ jwksCacheMaxAgeSeconds: 300 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate"
    );
  });

  it("sends no cache-control header when set to zero", async () => {
    const response = await getJwks({ jwksCacheMaxAgeSeconds: 0 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(null);
  });

  it("does not cache other endpoints", async () => {
    const auth = await createAuth();
    const response = await auth.handler(
      new Request(`${BASE_URL}${BASE_PATH}/ok`)
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(null);
  });

  it("rejects a max age that is not a whole number of seconds", () => {
    expect(() => convex({ authConfig, jwksCacheMaxAgeSeconds: -1 })).toThrow(
      /non-negative integer/
    );
    expect(() => convex({ authConfig, jwksCacheMaxAgeSeconds: 1.5 })).toThrow(
      /non-negative integer/
    );
    expect(() => convex({ authConfig, jwksCacheMaxAgeSeconds: 1e21 })).toThrow(
      /non-negative integer/
    );
  });
});
