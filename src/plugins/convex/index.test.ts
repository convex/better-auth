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

describe("convex plugin OpenID configuration", () => {
  it("publishes only the Convex JWT metadata", async () => {
    const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
    process.env.CONVEX_SITE_URL = "https://deployment.convex.site";
    try {
      const plugin = convex({
        authConfig: {
          providers: [
            {
              type: "customJwt",
              applicationID: "convex",
              issuer: "https://deployment.convex.site",
              algorithm: "RS256",
              jwks: "https://deployment.convex.site/custom/auth/convex/jwks",
            },
          ],
        },
        options: { basePath: "/custom/auth" },
      });

      const response = await plugin.endpoints!.getOpenIdConfig!({
        context: {},
        asResponse: false,
        returnHeaders: false,
        returnStatus: false,
      });

      expect(response).toMatchObject({
        issuer: "https://deployment.convex.site",
        jwks_uri: "https://deployment.convex.site/custom/auth/convex/jwks",
        id_token_signing_alg_values_supported: ["RS256"],
      });
      expect(response).not.toHaveProperty("authorization_endpoint");
      expect(response).not.toHaveProperty("token_endpoint");
    } finally {
      if (originalConvexSiteUrl === undefined) {
        delete process.env.CONVEX_SITE_URL;
      } else {
        process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
      }
    }
  });

  it.each([
    ["/", "https://deployment.convex.site/convex/jwks"],
    ["/custom/auth/", "https://deployment.convex.site/custom/auth/convex/jwks"],
  ])("normalizes the %s base path", async (basePath, expected) => {
    const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
    process.env.CONVEX_SITE_URL = "https://deployment.convex.site";
    try {
      const plugin = convex({ authConfig, options: { basePath } });
      const response = await plugin.endpoints!.getOpenIdConfig!({
        context: {},
        asResponse: false,
        returnHeaders: false,
        returnStatus: false,
      });

      expect(response).toMatchObject({ jwks_uri: expected });
    } finally {
      if (originalConvexSiteUrl === undefined) {
        delete process.env.CONVEX_SITE_URL;
      } else {
        process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
      }
    }
  });
});
