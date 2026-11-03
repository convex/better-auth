import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { twoFactor } from "better-auth/plugins/two-factor";

const SITE_URL = "https://happy-animal-123.convex.site";
process.env.CONVEX_SITE_URL = SITE_URL;

const authConfig = {
  providers: [{ applicationID: "convex", domain: SITE_URL }],
} satisfies AuthConfig;

const PASSWORD = "correct horse battery staple";

type Order = "convex-first" | "two-factor-first";

const makeAuth = async (order: Order) => {
  // Imported after CONVEX_SITE_URL is set.
  const { convex } = await import("./index.js");
  const db: Record<string, any[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    twoFactor: [],
    jwks: [],
  };
  const convexPlugin = convex({ authConfig });
  const twoFactorPlugin = twoFactor();
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-very-long-test-secret-that-is-at-least-32-chars",
    emailAndPassword: { enabled: true },
    // The memory adapter has no Convex ctx; mark it as a mutation ctx so the
    // Convex plugin's query-context before hook doesn't no-op writes.
    database: (options: any) => {
      const adapter = memoryAdapter(db)(options);
      return {
        ...adapter,
        options: { ...(adapter as any).options, isRunMutationCtx: true },
      };
    },
    plugins:
      order === "convex-first"
        ? [convexPlugin, twoFactorPlugin]
        : [twoFactorPlugin, convexPlugin],
  });
  const signUp = async (email: string, opts?: { twoFactor?: boolean }) => {
    const { user } = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Test" },
    });
    if (opts?.twoFactor) {
      const ctx = await auth.$context;
      await ctx.adapter.update({
        model: "user",
        where: [{ field: "id", value: user.id }],
        update: { twoFactorEnabled: true },
      });
    }
    return user;
  };
  return { auth, signUp };
};

type Auth = Awaited<ReturnType<typeof makeAuth>>["auth"];

const parseSetCookies = (headers: Headers) => {
  const setCookies = headers.getSetCookie();
  const byName = new Map<string, { value: string; raw: string }>();
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    byName.set(pair.slice(0, idx), {
      value: decodeURIComponent(pair.slice(idx + 1)),
      raw,
    });
  }
  return byName;
};

const passwordSignIn = async (auth: Auth, email: string) => {
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  return { response: response as any, cookies: parseSetCookies(headers) };
};

describe.each<Order>(["convex-first", "two-factor-first"])(
  "convex plugin JWT cookie with plugin order %s",
  (order) => {
    it("does not issue a JWT for a password sign-in while 2FA is pending", async () => {
      const { auth, signUp } = await makeAuth(order);
      await signUp("victim@example.com", { twoFactor: true });
      const ctx = await auth.$context;
      // Sign-up auto-signs in; the pending sign-in must not add a session.
      const sessionsBefore = await ctx.adapter.count({ model: "session" });
      const { response, cookies } = await passwordSignIn(
        auth,
        "victim@example.com"
      );
      expect(response.twoFactorRedirect).toBe(true);
      expect(cookies.get("better-auth.session_token")?.raw).toMatch(
        /Max-Age=0/
      );
      const jwtCookie = cookies.get("better-auth.convex_jwt");
      // Either no cookie at all, or an expired empty one.
      if (jwtCookie) {
        expect(jwtCookie.value).toBe("");
        expect(jwtCookie.raw).toMatch(/Max-Age=0/);
      }
      // And no session was left behind for a JWT to point at.
      expect(await ctx.adapter.count({ model: "session" })).toBe(
        sessionsBefore
      );
    });
  }
);
