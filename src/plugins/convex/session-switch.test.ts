import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { multiSession } from "better-auth/plugins/multi-session";

const SITE_URL = "https://happy-animal-123.convex.site";
process.env.CONVEX_SITE_URL = SITE_URL;

const authConfig = {
  providers: [{ applicationID: "convex", domain: SITE_URL }],
} satisfies AuthConfig;

const PASSWORD = "correct horse battery staple";
const JWT_COOKIE = "better-auth.convex_jwt";

const makeAuth = async (session?: { updateAge?: number }) => {
  // Imported after CONVEX_SITE_URL is set.
  const { convex } = await import("./index.js");
  const db: Record<string, any[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-very-long-test-secret-that-is-at-least-32-chars",
    emailAndPassword: { enabled: true },
    session,
    // The memory adapter has no Convex ctx; mark it as a mutation ctx so the
    // Convex plugin's query-context before hook doesn't no-op writes.
    database: (options: any) => {
      const adapter = memoryAdapter(db)(options);
      return {
        ...adapter,
        options: { ...(adapter as any).options, isRunMutationCtx: true },
      };
    },
    plugins: [convex({ authConfig }), multiSession()],
  });
};

type Auth = Awaited<ReturnType<typeof makeAuth>>;

// A minimal cookie jar: the last Set-Cookie per name wins, Max-Age=0 deletes.
const lastSetCookies = (headers: Headers) => {
  const byName = new Map<string, { value: string; raw: string }>();
  for (const raw of headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    byName.set(pair.slice(0, idx), { value: pair.slice(idx + 1), raw });
  }
  return byName;
};

const applySetCookies = (jar: Map<string, string>, headers: Headers) => {
  for (const [name, { value, raw }] of lastSetCookies(headers)) {
    if (/Max-Age=0/i.test(raw)) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
};

const cookieHeader = (jar: Map<string, string>) =>
  new Headers({
    cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
  });

const signUpAndSignIn = async (
  auth: Auth,
  jar: Map<string, string>,
  email: string
) => {
  await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: "Test" },
  });
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    headers: cookieHeader(jar),
    returnHeaders: true,
  });
  applySetCookies(jar, headers);
  return response as { token: string; user: { id: string } };
};

describe("convex plugin JWT cookie across session changes", () => {
  it("keeps the JWT cookie when get-session refreshes the session", async () => {
    // updateAge 0: every get-session refreshes the session and sets a new
    // session cookie, which Better Auth records as ctx.context.newSession.
    const auth = await makeAuth({ updateAge: 0 });
    const jar = new Map<string, string>();
    const user = await signUpAndSignIn(auth, jar, "user@example.com");
    const { headers, response } = await auth.api.getSession({
      headers: cookieHeader(jar),
      returnHeaders: true,
    });
    expect(response?.user.id).toBe(user.user.id);
    const setCookies = lastSetCookies(headers);
    // The session was refreshed...
    expect(setCookies.get("better-auth.session_token")?.raw).not.toMatch(
      /Max-Age=0/
    );
    // ...and the JWT cookie the refresh hook set is not expired after it.
    const jwtCookie = setCookies.get(JWT_COOKIE);
    expect(jwtCookie?.raw).toMatch(/Max-Age=900/);
    expect(jwtCookie?.value).not.toBe("");
  });

  it("expires the JWT cookie when multi-session switches accounts", async () => {
    const auth = await makeAuth();
    const jar = new Map<string, string>();
    const first = await signUpAndSignIn(auth, jar, "first@example.com");
    const second = await signUpAndSignIn(auth, jar, "second@example.com");
    expect(first.user.id).not.toBe(second.user.id);

    // A JWT for the active (second) account, as a server render would cache.
    const refreshed = await auth.api.getSession({
      headers: cookieHeader(jar),
      returnHeaders: true,
    });
    expect(refreshed.response?.user.id).toBe(second.user.id);
    applySetCookies(jar, refreshed.headers);
    expect(jar.get(JWT_COOKIE)).toBeTruthy();

    const { headers, response } = await auth.api.setActiveSession({
      body: { sessionToken: first.token },
      headers: cookieHeader(jar),
      returnHeaders: true,
    });
    expect((response as any)?.user.id).toBe(first.user.id);
    expect(lastSetCookies(headers).get(JWT_COOKIE)?.raw).toMatch(/Max-Age=0/);
  });
});
