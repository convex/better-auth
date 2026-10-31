import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";
import { magicLink } from "better-auth/plugins/magic-link";
import { crossDomain } from "./index.js";

const SITE_URL = "https://myapp.example.com";
const OTHER_TRUSTED_ORIGIN = "https://other.example.com";
const WILDCARD_PATTERN = "https://*.previews.example.app";
const WILDCARD_ORIGIN = "https://branch-abc.previews.example.app";
const NATIVE_SCHEME = "myapp://";
const DYNAMIC_ORIGIN = "https://dynamic.example.com";
const AUTH_BASE_URL = "http://localhost:3000";
const BASE_PATH = "/api/auth";
const PROVIDER_ID = "example-oauth";
const PROVIDER_TOKEN_URL = "https://provider.example.com/oauth/token";
const PROVIDER_USERINFO_URL = "https://provider.example.com/oauth/userinfo";

const createTestAuth = (siteUrl: string) => {
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const warnings: string[] = [];
  let capturedMagicLinkUrl = "";

  const auth = betterAuth({
    baseURL: AUTH_BASE_URL,
    basePath: BASE_PATH,
    secret: "test-secret-at-least-thirty-two-characters-long",
    database: memoryAdapter(db),
    trustedOrigins: (request) => {
      const origins = [
        SITE_URL,
        OTHER_TRUSTED_ORIGIN,
        WILDCARD_PATTERN,
        NATIVE_SCHEME,
      ];
      if (request?.headers.get("x-test-dynamic-origin")) {
        origins.push(DYNAMIC_ORIGIN);
      }
      return origins;
    },
    advanced: {
      // Better Auth disables callbackURL validation in test environments,
      // re-enable it so the tests exercise production behavior.
      disableOriginCheck: false,
    },
    logger: {
      log: (level, message) => {
        if (level === "warn") {
          warnings.push(message);
        }
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ url }) => {
          capturedMagicLinkUrl = url;
        },
      }),
      genericOAuth({
        config: [
          {
            providerId: PROVIDER_ID,
            clientId: "test-client-id",
            clientSecret: "test-client-secret",
            authorizationUrl: "https://provider.example.com/oauth/authorize",
            tokenUrl: PROVIDER_TOKEN_URL,
            userInfoUrl: PROVIDER_USERINFO_URL,
          },
        ],
      }),
      crossDomain({ siteUrl }),
    ],
  });

  const post = (
    path: string,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ) =>
    auth.handler(
      new Request(`${AUTH_BASE_URL}${BASE_PATH}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      })
    );

  const oneTimeTokenCount = () =>
    db.verification.filter((entry) =>
      entry.identifier.startsWith("one-time-token:")
    ).length;

  // Request a magic link, then follow it the way the user's browser would:
  // a plain GET with no cookies, since the auth server is on another domain.
  const verifyMagicLink = async (
    callbackURL?: string,
    headers?: Record<string, string>
  ) => {
    capturedMagicLinkUrl = "";
    await post(
      "/sign-in/magic-link",
      {
        email: "test@example.com",
        ...(callbackURL ? { callbackURL } : {}),
      },
      headers
    );
    expect(capturedMagicLinkUrl).not.toBe("");
    return auth.handler(
      new Request(capturedMagicLinkUrl, {
        method: "GET",
        redirect: "manual",
        headers,
      })
    );
  };

  // Start an OAuth flow, then simulate the provider redirecting the browser
  // back to the callback. No cookies: the state is looked up in the database.
  const completeOAuth = async (callbackURL?: string) => {
    const start = await post("/sign-in/social", {
      provider: PROVIDER_ID,
      disableRedirect: true,
      ...(callbackURL ? { callbackURL } : {}),
    });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state");
    expect(state).toBeTruthy();
    const callback = new URL(
      `${AUTH_BASE_URL}${BASE_PATH}/callback/${PROVIDER_ID}`
    );
    callback.searchParams.set("code", "test-authorization-code");
    callback.searchParams.set("state", state!);
    return auth.handler(
      new Request(callback, { method: "GET", redirect: "manual" })
    );
  };

  return {
    auth,
    db,
    warnings,
    post,
    oneTimeTokenCount,
    verifyMagicLink,
    completeOAuth,
    getMagicLinkUrl: () => capturedMagicLinkUrl,
    resetMagicLinkUrl: () => {
      capturedMagicLinkUrl = "";
    },
  };
};

const mockOAuthProvider = () => {
  const realFetch = globalThis.fetch;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === PROVIDER_TOKEN_URL) {
        return json({
          access_token: "test-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url === PROVIDER_USERINFO_URL) {
        return json({
          id: "oauth-user-1",
          email: "oauth-user@example.com",
          email_verified: true,
          name: "OAuth User",
        });
      }
      return realFetch(input, init);
    }
  );
};

const expectOtt = (response: Response, origin: string) => {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!);
  expect(location.origin).toBe(origin);
  const ott = location.searchParams.get("ott");
  expect(ott).toBeTruthy();
  return ott!;
};

const expectNoOtt = (response: Response, origin: string) => {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!);
  expect(location.origin).toBe(origin);
  expect(location.searchParams.get("ott")).toBeNull();
};

describe("crossDomain plugin", async () => {
  const {
    db,
    warnings,
    post,
    oneTimeTokenCount,
    verifyMagicLink,
    completeOAuth,
    getMagicLinkUrl,
    resetMagicLinkUrl,
  } = createTestAuth(SITE_URL);

  await post("/sign-up/email", {
    email: "test@example.com",
    password: "testpassword123",
    name: "Test User",
  });

  describe("callbackURL defaulting for magic-link", () => {
    it("injects siteUrl when callbackURL is absent", async () => {
      resetMagicLinkUrl();
      await post("/sign-in/magic-link", { email: "test@example.com" });
      const url = new URL(getMagicLinkUrl());
      expect(url.searchParams.get("callbackURL")).toBe(SITE_URL);
    });

    it("rewrites relative callbackURL to absolute using siteUrl", async () => {
      resetMagicLinkUrl();
      await post("/sign-in/magic-link", {
        email: "test@example.com",
        callbackURL: "/dashboard",
      });
      const url = new URL(getMagicLinkUrl());
      expect(url.searchParams.get("callbackURL")).toBe(`${SITE_URL}/dashboard`);
    });

    it("preserves absolute callbackURL", async () => {
      resetMagicLinkUrl();
      await post("/sign-in/magic-link", {
        email: "test@example.com",
        callbackURL: `${OTHER_TRUSTED_ORIGIN}/callback`,
      });
      const url = new URL(getMagicLinkUrl());
      expect(url.searchParams.get("callbackURL")).toBe(
        `${OTHER_TRUSTED_ORIGIN}/callback`
      );
    });
  });

  describe("callbackURL defaulting for generic OAuth", () => {
    it("injects siteUrl when callbackURL is absent", async () => {
      const response = await post("/sign-in/social", {
        provider: "example-oauth",
        disableRedirect: true,
      });
      const { url } = (await response.json()) as { url: string };
      const state = new URL(url).searchParams.get("state");
      const verification = db.verification.find(
        (entry) => entry.identifier === `auth-state:${state}`
      );
      expect(verification).toBeDefined();
      expect(JSON.parse(verification!.value).callbackURL).toBe(SITE_URL);
    });

    it("rewrites relative callbackURL to absolute using siteUrl", async () => {
      const response = await post("/sign-in/social", {
        provider: "example-oauth",
        callbackURL: "/dashboard",
        disableRedirect: true,
      });
      const { url } = (await response.json()) as { url: string };
      const state = new URL(url).searchParams.get("state");
      const verification = db.verification.find(
        (entry) => entry.identifier === `auth-state:${state}`
      );
      expect(verification).toBeDefined();
      expect(JSON.parse(verification!.value).callbackURL).toBe(
        `${SITE_URL}/dashboard`
      );
    });
  });

  describe("one-time token after magic link verification", () => {
    it("appends ott when redirecting to siteUrl", async () => {
      const before = oneTimeTokenCount();
      const response = await verifyMagicLink();
      const ott = expectOtt(response, SITE_URL);
      expect(oneTimeTokenCount()).toBe(before + 1);
      expect(
        db.verification.find(
          (entry) => entry.identifier === `one-time-token:${ott}`
        )
      ).toBeDefined();
    });

    it("appends ott when redirecting to another exact trusted origin", async () => {
      const before = oneTimeTokenCount();
      const response = await verifyMagicLink(
        `${OTHER_TRUSTED_ORIGIN}/callback`
      );
      expectOtt(response, OTHER_TRUSTED_ORIGIN);
      expect(oneTimeTokenCount()).toBe(before + 1);
    });

    it("does not append ott when the origin is only matched by a wildcard", async () => {
      const before = oneTimeTokenCount();
      warnings.length = 0;
      const response = await verifyMagicLink(`${WILDCARD_ORIGIN}/callback`);
      expectNoOtt(response, WILDCARD_ORIGIN);
      expect(oneTimeTokenCount()).toBe(before);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Not appending one-time token");
    });

    it("does not append ott when redirecting to a custom scheme", async () => {
      const before = oneTimeTokenCount();
      const response = await verifyMagicLink(`${NATIVE_SCHEME}callback`);
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location")!);
      expect(location.protocol).toBe("myapp:");
      expect(location.searchParams.get("ott")).toBeNull();
      expect(oneTimeTokenCount()).toBe(before);
    });

    it("appends ott for an exact origin returned by a trustedOrigins function", async () => {
      const before = oneTimeTokenCount();
      const headers = { "x-test-dynamic-origin": "1" };
      const response = await verifyMagicLink(
        `${DYNAMIC_ORIGIN}/callback`,
        headers
      );
      expectOtt(response, DYNAMIC_ORIGIN);
      expect(oneTimeTokenCount()).toBe(before + 1);
    });
  });

  describe("one-time token after oauth2 callback", () => {
    beforeAll(() => {
      mockOAuthProvider();
    });
    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it("appends ott when redirecting to siteUrl", async () => {
      const before = oneTimeTokenCount();
      const response = await completeOAuth();
      const ott = expectOtt(response, SITE_URL);
      expect(oneTimeTokenCount()).toBe(before + 1);
      const sessionToken = db.verification.find(
        (entry) => entry.identifier === `one-time-token:${ott}`
      )?.value;
      expect(sessionToken).toBeTruthy();
      // The token redeems for the session created by the callback.
      const verify = await post("/cross-domain/one-time-token/verify", {
        token: ott,
      });
      expect(verify.status).toBe(200);
      const { session, user } = (await verify.json()) as {
        session: { token: string };
        user: { email: string };
      };
      expect(session.token).toBe(sessionToken);
      expect(user.email).toBe("oauth-user@example.com");
    });

    it("appends ott when redirecting to another exact trusted origin", async () => {
      const before = oneTimeTokenCount();
      const response = await completeOAuth(`${OTHER_TRUSTED_ORIGIN}/callback`);
      expectOtt(response, OTHER_TRUSTED_ORIGIN);
      expect(oneTimeTokenCount()).toBe(before + 1);
    });

    it("does not append ott when the origin is only matched by a wildcard", async () => {
      const before = oneTimeTokenCount();
      const response = await completeOAuth(`${WILDCARD_ORIGIN}/callback`);
      expectNoOtt(response, WILDCARD_ORIGIN);
      expect(oneTimeTokenCount()).toBe(before);
    });
  });

  describe("no callbackURL injection for email sign-in", () => {
    it("does not redirect when callbackURL is absent", async () => {
      const response = await post("/sign-in/email", {
        email: "test@example.com",
        password: "testpassword123",
      });
      expect(response.status).not.toBe(302);
    });
  });
});
