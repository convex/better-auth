import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import type { AuthConfig } from "convex/server";
import { convex } from "./index.js";
import { getAuthConfigProvider } from "../../auth-config.js";

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

const AUTH_BASE_URL = "https://example.com";
const BASE_PATH = "/api/auth";

process.env.CONVEX_SITE_URL = "https://example.convex.site";

const emptyDb = (): MemoryDB => ({
  user: [],
  session: [],
  account: [],
  verification: [],
  jwks: [],
});

const mutationCtxDatabase = (db: MemoryDB) => (options: BetterAuthOptions) => {
  const adapter = memoryAdapter(db)(options);
  return {
    ...adapter,
    options: { ...(adapter.options ?? {}), isRunMutationCtx: true },
  };
};

const makeAuth = (db: MemoryDB, jwks?: string) =>
  betterAuth({
    baseURL: AUTH_BASE_URL,
    basePath: BASE_PATH,
    secret: "test-secret-at-least-thirty-two-characters-long",
    database: mutationCtxDatabase(db),
    emailAndPassword: { enabled: true },
    plugins: [
      convex({
        authConfig: {
          providers: [getAuthConfigProvider(jwks ? { jwks } : undefined)],
        },
        ...(jwks ? { jwks } : {}),
      }),
    ],
  });

const request = (
  auth: ReturnType<typeof makeAuth>,
  path: string,
  init?: RequestInit
) => auth.handler(new Request(`${AUTH_BASE_URL}${BASE_PATH}${path}`, init));

const signUp = async (auth: ReturnType<typeof makeAuth>) => {
  const res = await request(auth, "/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test@example.com",
      password: "testpassword123",
      name: "Test User",
    }),
  });
  expect(res.status).toBe(200);
  const setCookies = res.headers.getSetCookie();
  return {
    setCookies,
    cookie: setCookies.map((c) => c.split(";")[0]).join("; "),
  };
};

const mintKey = async () => {
  const db = emptyDb();
  const res = await request(makeAuth(db), "/convex/jwks");
  expect(res.status).toBe(200);
  return db.jwks[0];
};

const kidOf = (token: string) =>
  JSON.parse(
    new TextDecoder().decode(Buffer.from(token.split(".")[0], "base64url"))
  ).kid;

describe("convex plugin static JWKS", async () => {
  const [firstKey, secondKey] = await Promise.all([mintKey(), mintKey()]);
  const older = { ...firstKey, createdAt: 1_700_000_000_000 };
  const newer = { ...secondKey, createdAt: 1_700_000_000_090 };

  it("issues a token with a single key", async () => {
    const auth = makeAuth(emptyDb(), JSON.stringify([newer]));
    const { cookie } = await signUp(auth);
    const res = await request(auth, "/convex/token", { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("issues a token signed by the newest key with multiple keys", async () => {
    const auth = makeAuth(emptyDb(), JSON.stringify([older, newer]));
    const { cookie, setCookies } = await signUp(auth);
    const res = await request(auth, "/convex/token", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(kidOf((await res.json()).token)).toBe(newer.id);
    expect(setCookies.some((c) => c.includes("convex_jwt="))).toBe(true);
  });

  it("serves the jwks endpoint for a key with expiresAt", async () => {
    const jwks = JSON.stringify([
      { ...newer, expiresAt: 1_700_000_086_400_000 },
    ]);
    const res = await request(makeAuth(emptyDb(), jwks), "/convex/jwks");
    expect(res.status).toBe(200);
  });
});
