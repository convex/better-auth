import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
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

describe("convex plugin OpenID discovery document", () => {
  it("serves issuer and jwks_uri for the Convex deployment", async () => {
    const { betterAuth } = await import("better-auth/minimal");
    const { memoryAdapter } = await import("better-auth/adapters/memory");
    const previousSiteUrl = process.env.CONVEX_SITE_URL;
    process.env.CONVEX_SITE_URL = "https://deployment.convex.site";
    try {
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
      expect(body.response_types_supported).toEqual(["code"]);
      expect(body.subject_types_supported).toEqual(["public"]);
    } finally {
      process.env.CONVEX_SITE_URL = previousSiteUrl;
    }
  });

  it("uses endpoint keys that the jwt and oauth-provider plugins do not", () => {
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
