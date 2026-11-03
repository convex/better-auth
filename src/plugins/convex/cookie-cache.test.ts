import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

const SITE_URL = "https://happy-animal-123.convex.site";
process.env.CONVEX_SITE_URL = SITE_URL;

const authConfig = {
  providers: [{ applicationID: "convex", domain: SITE_URL }],
} satisfies AuthConfig;

const PASSWORD = "correct horse battery staple";
const SESSION_TOKEN_COOKIE = "better-auth.session_token";
const SESSION_DATA_COOKIE = "better-auth.session_data";

// A plugin that returns options from init, as plugins like cross-domain do.
// Better Auth merges these under the app's options with a copy, so the
// Convex plugin's change must survive one running before and after it.
const returnsSessionOptions = (id: string): BetterAuthPlugin => ({
  id,
  init: () => ({ options: { session: { expiresIn: 60 * 60 * 24 } } }),
});

const makeAuth = async (opts?: {
  cookieCache?: boolean;
  before?: BetterAuthPlugin[];
  after?: BetterAuthPlugin[];
}) => {
  // Imported after CONVEX_SITE_URL is set.
  const { convex } = await import("./index.js");
  const db: Record<string, any[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };
  const logs: { level: string; message: string }[] = [];
  const session: BetterAuthOptions["session"] =
    opts?.cookieCache === false
      ? undefined
      : { cookieCache: { enabled: true, maxAge: 300 } };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-very-long-test-secret-that-is-at-least-32-chars",
    emailAndPassword: { enabled: true },
    session,
    logger: {
      log: (level, message) => {
        logs.push({ level, message });
      },
    },
    // The memory adapter has no Convex ctx; mark it as a mutation ctx so the
    // Convex plugin's query-context before hook doesn't no-op writes.
    database: (options: any) => {
      const adapter = memoryAdapter(db)(options);
      return {
        ...adapter,
        options: { ...(adapter as any).options, isRunMutationCtx: true },
      };
    },
    plugins: [
      ...(opts?.before ?? []),
      convex({ authConfig }),
      ...(opts?.after ?? []),
    ],
  });
  return { auth, db, logs };
};

type Auth = Awaited<ReturnType<typeof makeAuth>>["auth"];

const setCookieNames = (headers: Headers) =>
  headers.getSetCookie().map((raw) => raw.split("=")[0]);

const signUp = async (auth: Auth) => {
  const { headers, response } = await auth.api.signUpEmail({
    body: { email: "user@example.com", password: PASSWORD, name: "Test" },
    returnHeaders: true,
  });
  return { headers, user: (response as { user: { id: string } }).user };
};

const sessionCookie = (headers: Headers) => {
  const raw = headers
    .getSetCookie()
    .find((c) => c.startsWith(`${SESSION_TOKEN_COOKIE}=`));
  if (!raw) {
    throw new Error("No session cookie set");
  }
  return raw.split(";")[0];
};

describe("convex plugin session cookie cache", () => {
  it("turns the cookie cache off and warns once", async () => {
    const { auth, logs } = await makeAuth();
    const ctx = await auth.$context;
    expect(ctx.options.session?.cookieCache?.enabled).toBe(false);
    const warnings = logs.filter((log) => log.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("session.cookieCache");
  });

  it("leaves the options alone when the cookie cache is off", async () => {
    const { auth, logs } = await makeAuth({ cookieCache: false });
    const ctx = await auth.$context;
    expect(ctx.options.session?.cookieCache).toBeUndefined();
    expect(logs).toHaveLength(0);
  });

  it("stays off when other plugins return options from init", async () => {
    const { auth } = await makeAuth({
      before: [returnsSessionOptions("before-convex")],
      after: [returnsSessionOptions("after-convex")],
    });
    const ctx = await auth.$context;
    expect(ctx.options.session?.expiresIn).toBe(60 * 60 * 24);
    expect(ctx.options.session?.cookieCache?.enabled).toBe(false);
    const { headers } = await signUp(auth);
    expect(setCookieNames(headers)).not.toContain(SESSION_DATA_COOKIE);
  });

  it("never sets the session data cookie and reads the session from the database", async () => {
    const { auth, db } = await makeAuth();
    const { headers: signUpHeaders, user } = await signUp(auth);
    expect(setCookieNames(signUpHeaders)).toContain(SESSION_TOKEN_COOKIE);
    expect(setCookieNames(signUpHeaders)).not.toContain(SESSION_DATA_COOKIE);

    // Hide the session row: a cookie cache would still return the session.
    const [row] = db.session.splice(0, db.session.length);
    expect(row.userId).toBe(user.id);
    const { headers, response } = await auth.api.getSession({
      headers: new Headers({ cookie: sessionCookie(signUpHeaders) }),
      returnHeaders: true,
    });
    expect(response).toBeNull();
    // A missing session clears the session cookies; nothing is cached.
    for (const raw of headers.getSetCookie()) {
      if (raw.startsWith(`${SESSION_DATA_COOKIE}=`)) {
        expect(raw).toMatch(/Max-Age=0/i);
      }
    }
  });

  it("clears a session data cookie left over from a cached session", async () => {
    const { auth } = await makeAuth();
    const { headers: signUpHeaders, user } = await signUp(auth);
    const { headers, response } = await auth.api.getSession({
      headers: new Headers({
        cookie: `${sessionCookie(signUpHeaders)}; ${SESSION_DATA_COOKIE}=stale`,
      }),
      returnHeaders: true,
    });
    expect(response?.user.id).toBe(user.id);
    const cleared = headers
      .getSetCookie()
      .find((c) => c.startsWith(`${SESSION_DATA_COOKIE}=`));
    expect(cleared).toMatch(/Max-Age=0/i);
  });
});
