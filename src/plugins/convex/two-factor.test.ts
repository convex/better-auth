import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import * as jose from "jose";
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

const verifyAgainstJwks = async (auth: Auth, jwt: string) => {
  // The check Convex performs: signature against the published JWKS,
  // issuer and audience.
  const api = auth.api as any;
  const jwks = await (api.getConvexJwks ?? api.getJwks)({});
  const keySet = jose.createLocalJWKSet(jwks);
  return await jose.jwtVerify(jwt, keySet, {
    issuer: SITE_URL,
    audience: "convex",
  });
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

    it("does not issue a JWT on sign-in, and issues one on get-session with a valid session", async () => {
      const { auth, signUp } = await makeAuth(order);
      const user = await signUp("user@example.com");
      const { response, cookies } = await passwordSignIn(
        auth,
        "user@example.com"
      );
      expect(response.token).toBeTypeOf("string");
      const jwtCookie = cookies.get("better-auth.convex_jwt");
      if (jwtCookie) {
        expect(jwtCookie.value).toBe("");
        expect(jwtCookie.raw).toMatch(/Max-Age=0/);
      }
      const sessionCookie = cookies.get("better-auth.session_token")!;
      expect(sessionCookie.raw).not.toMatch(/Max-Age=0/);

      const getSession = await auth.api.getSession({
        headers: new Headers({
          cookie: `better-auth.session_token=${encodeURIComponent(sessionCookie.value)}`,
        }),
        returnHeaders: true,
      });
      expect(getSession.response?.user.id).toBe(user.id);
      const refreshed = parseSetCookies(getSession.headers).get(
        "better-auth.convex_jwt"
      );
      expect(refreshed?.raw).toMatch(/Max-Age=900/);
      const { payload } = await verifyAgainstJwks(auth, refreshed!.value);
      expect(payload.sub).toBe(user.id);
      expect((payload as any).sessionId).toBe(getSession.response?.session.id);
    });

    it("issues a JWT from /convex/token with a valid session", async () => {
      const { auth, signUp } = await makeAuth(order);
      const user = await signUp("user@example.com");
      const { cookies } = await passwordSignIn(auth, "user@example.com");
      const sessionCookie = cookies.get("better-auth.session_token")!;
      const api = auth.api as any;
      const { response, headers } = await (api.getConvexToken ?? api.getToken)({
        headers: new Headers({
          cookie: `better-auth.session_token=${encodeURIComponent(sessionCookie.value)}`,
        }),
        returnHeaders: true,
      });
      const { payload } = await verifyAgainstJwks(auth, response.token);
      expect(payload.sub).toBe(user.id);
      expect(
        parseSetCookies(headers).get("better-auth.convex_jwt")?.value
      ).toBe(response.token);
    });
  }
);
