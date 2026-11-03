import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "convex/server";
import { convex } from "./index.js";

const authConfig = {
  providers: [{ applicationID: "convex", domain: "https://example.com" }],
} satisfies AuthConfig;

const FUTURE = new Date(Date.now() + 60_000);

const getJwtSetCookieMatcher = () => {
  const plugin = convex({ authConfig });
  const afterHooks = plugin.hooks?.after ?? [];
  const matcher = afterHooks.find((hook) => {
    return (
      hook.matcher({
        path: "/update-session",
        context: { session: { session: { id: "s1", expiresAt: FUTURE } } },
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
      context: { session: { session: { id: "s1", expiresAt: FUTURE } } },
    };
    expect(matcher(ctx as unknown as MatcherContext)).toBe(true);
  });

  it("matches get-session only when a session exists", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const withSessionCtx = {
      path: "/get-session",
      context: { session: { session: { id: "s1", expiresAt: FUTURE } } },
    };
    const withoutSessionCtx = {
      path: "/get-session",
      context: { session: null },
    };
    expect(matcher(withSessionCtx as unknown as MatcherContext)).toBe(true);
    expect(matcher(withoutSessionCtx as unknown as MatcherContext)).toBe(false);
  });

  it("never matches requests that create a new session", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    for (const path of [
      "/sign-in/email",
      "/sign-in/username",
      "/sign-in/phone-number",
      "/sign-in/social",
      "/sign-up/email",
      "/callback/github",
      "/magic-link/verify",
      "/email-otp/verify-email",
      "/phone-number/verify",
      "/siwe/verify",
    ]) {
      const ctx = {
        path,
        context: { session: null, newSession: { session: { id: "s1" } } },
      };
      expect(matcher(ctx as unknown as MatcherContext), path).toBe(false);
    }
  });
});

const getJwtExpireCookieMatcher = () => {
  const plugin = convex({ authConfig });
  const afterHooks = plugin.hooks?.after ?? [];
  const matcher = afterHooks.find((hook) => {
    return hook.matcher({
      path: "/sign-out",
      context: { session: null },
    } as unknown as Parameters<typeof hook.matcher>[0]);
  })?.matcher;
  if (!matcher) {
    throw new Error(
      "Failed to find Convex JWT expire-cookie after hook matcher"
    );
  }
  return matcher;
};

describe("convex plugin JWT cookie expire matcher", () => {
  it("matches a request that switches to a different session", () => {
    const matcher = getJwtExpireCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    for (const path of [
      "/multi-session/set-active",
      "/admin/impersonate-user",
      "/admin/stop-impersonating",
      "/verify-email",
      "/one-time-token/verify",
    ]) {
      const switched = {
        path,
        context: {
          session: { session: { id: "s1", expiresAt: FUTURE } },
          newSession: { session: { id: "s2" } },
        },
      };
      const fresh = {
        path,
        context: { session: null, newSession: { session: { id: "s2" } } },
      };
      expect(matcher(switched as unknown as MatcherContext), path).toBe(true);
      expect(matcher(fresh as unknown as MatcherContext), path).toBe(true);
    }
  });

  it("doesn't match a refresh of the same session", () => {
    const matcher = getJwtExpireCookieMatcher();
    const setMatcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    for (const path of ["/get-session", "/update-session", "/update-user"]) {
      const ctx = {
        path,
        context: {
          session: { session: { id: "s1", expiresAt: FUTURE } },
          newSession: { session: { id: "s1" } },
        },
      };
      expect(matcher(ctx as unknown as MatcherContext), path).toBe(false);
    }
    // The set and expire hooks never both match the same request.
    for (const path of ["/get-session", "/update-session"]) {
      const ctx = {
        path,
        context: {
          session: { session: { id: "s1", expiresAt: FUTURE } },
          newSession: { session: { id: "s1" } },
        },
      };
      expect(setMatcher(ctx as unknown as MatcherContext), path).toBe(true);
      expect(matcher(ctx as unknown as MatcherContext), path).toBe(false);
    }
  });

  it("doesn't match a request without a new session", () => {
    const matcher = getJwtExpireCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const ctx = {
      path: "/multi-session/list-device-sessions",
      context: {
        session: { session: { id: "s1", expiresAt: FUTURE } },
        newSession: null,
      },
    };
    expect(matcher(ctx as unknown as MatcherContext)).toBe(false);
  });
});

describe("convex plugin OpenID discovery document", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves issuer and jwks_uri for the Convex deployment", async () => {
    const { betterAuth } = await import("better-auth/minimal");
    const { memoryAdapter } = await import("better-auth/adapters/memory");
    vi.stubEnv("CONVEX_SITE_URL", "https://deployment.convex.site");
    const auth = betterAuth({
      baseURL: "https://deployment.convex.site",
      secret: "test-secret-at-least-thirty-two-characters-long",
      database: memoryAdapter({}),
      logger: { disabled: true },
      plugins: [convex({ authConfig })],
    });
    const response = await auth.handler(
      new Request(
        "https://deployment.convex.site/api/auth/convex/.well-known/openid-configuration"
      )
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("https://deployment.convex.site");
    expect(body.jwks_uri).toBe(
      "https://deployment.convex.site/api/auth/convex/jwks"
    );
    expect(body.id_token_signing_alg_values_supported).toEqual(["EdDSA"]);
    expect(body.response_types_supported).toEqual(["id_token"]);
    expect(body.subject_types_supported).toEqual(["public"]);
    expect(body.claims_supported).toEqual([
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "sessionId",
    ]);
    // The plugin is not an authorization server: it must not advertise
    // endpoints nothing serves.
    expect(body).not.toHaveProperty("authorization_endpoint");
    expect(body).not.toHaveProperty("token_endpoint");
    expect(body).not.toHaveProperty("userinfo_endpoint");
    expect(body).not.toHaveProperty("registration_endpoint");
    expect(body).not.toHaveProperty("end_session_endpoint");
  });

  it("uses endpoint keys that other Better Auth plugins do not", () => {
    const plugin = convex({ authConfig });
    expect(Object.keys(plugin.endpoints)).toEqual([
      "getConvexOpenIdConfig",
      "getConvexJwks",
      "getLatestJwks",
      "rotateKeys",
      "getConvexToken",
    ]);
  });
});
