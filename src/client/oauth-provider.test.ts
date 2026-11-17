/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { getAuthTables } from "better-auth/db";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { mcp } from "@better-auth/mcp";
import { anyApi } from "convex/server";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import schema from "../test/oauth-provider/schema.js";
import schemaSource from "../test/oauth-provider/schema.ts?raw";
import { getAuthConfigProvider } from "../auth-config.js";
import { createApi } from "./create-api.js";
import { createSchema } from "./create-schema.js";
import { createClient } from "./index.js";

// The OAuth Provider plugin (@better-auth/oauth-provider) and the MCP plugin
// built on it (@better-auth/mcp), end to end through the Convex adapter on
// convex-test, next to the convex() plugin.

process.env.CONVEX_SITE_URL = "https://happy-animal-123.convex.site";
// Imported after CONVEX_SITE_URL is set.
const { convex } = await import("../plugins/convex/index.js");

const BASE_URL = "http://localhost:3000";
const RESOURCE = "https://api.example.com/mcp";
const REDIRECT_URI = "https://client.example.com/api/mcp/auth_callback";
const SCHEMA_FIXTURE = "src/test/oauth-provider/schema.ts";

// Both plugins link newly registered clients to RESOURCE and enforce those
// links, so registration and token issuance go through oauthClientResource.
const providerOptions = {
  loginPage: "/sign-in",
  consentPage: "/consent",
  enforcePerClientResources: true,
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  scopes: ["openid", "profile", "email", "offline_access"],
};
const providers = {
  oauthProvider: () =>
    oauthProvider({
      ...providerOptions,
      resources: [{ identifier: RESOURCE, name: "MCP" }],
      clientRegistrationDefaultResources: [RESOURCE],
    }),
  mcp: () => mcp({ ...providerOptions, resource: RESOURCE }),
};

const authOptions = (provider: keyof typeof providers) =>
  ({
    baseURL: BASE_URL,
    secret: "a-very-long-test-secret-that-is-at-least-32-chars",
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    plugins: [
      jwt(),
      providers[provider](),
      convex({ authConfig: { providers: [getAuthConfigProvider()] } }),
    ],
  }) as BetterAuthOptions;

// The adapter functions are registered here rather than in the component's
// test profiles: every module under src/component is deployed with the
// component, and oauth-provider is only a devDependency. convex-test finds
// the functions root by the `_generated` path. Both plugins declare the same
// tables, so one set of functions serves both.
const adapterModule = createApi(schema, () => authOptions("oauthProvider"));
const modules = {
  "./_generated/api.js": async () => ({}),
  "./adapter.js": async () => adapterModule,
};

const makeAuth = async (provider: keyof typeof providers) => {
  const t = convexTest(schema, modules);
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as any;
  const auth = betterAuth({
    ...authOptions(provider),
    database: createClient({ adapter: anyApi.adapter } as any, {
      verbose: false,
    }).adapter(ctx),
  });
  const { headers } = await auth.api.signUpEmail({
    body: { email: "user@example.com", password: "pw-123456789", name: "U" },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const request = (
    path: string,
    init: RequestInit & { signedIn?: boolean } = {}
  ) => {
    const { signedIn = true, headers: extraHeaders, ...rest } = init;
    return auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        ...rest,
        headers: {
          origin: BASE_URL,
          ...(signedIn ? { cookie } : {}),
          ...(extraHeaders as Record<string, string>),
        },
      })
    );
  };
  const rows = (table: string) =>
    t.run(async (ctx) => (await ctx.db.query(table as any).collect()) as any[]);
  return { auth, cookie, request, rows };
};

// Where an authorize or consent response sends the browser: a redirect, or a
// JSON body with the URL.
const redirectTarget = async (response: Response) =>
  response.headers.get("location") ??
  (
    (await response
      .clone()
      .json()
      .catch(() => ({}))) as { url?: string }
  ).url;

const tokenRequest = (params: Record<string, string>) => ({
  method: "POST",
  signedIn: false,
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(params).toString(),
});

describe("oauth-provider schema", () => {
  it("matches the committed fixture", async () => {
    for (const provider of Object.keys(providers) as Array<
      keyof typeof providers
    >) {
      const { code } = await createSchema({
        tables: getAuthTables(authOptions(provider)),
      });
      if (process.env.UPDATE_SCHEMA_FIXTURE) {
        writeFileSync(SCHEMA_FIXTURE, code);
        continue;
      }
      expect(
        code,
        `${SCHEMA_FIXTURE} is out of date for ${provider}. Regenerate it with UPDATE_SCHEMA_FIXTURE=1 npx vitest run src/client/oauth-provider.test.ts`
      ).toBe(schemaSource);
      expect(code).toContain(
        '.index("clientId_resourceId", ["clientId","resourceId"])'
      );
    }
  });
});

describe.each(Object.keys(providers) as Array<keyof typeof providers>)(
  "%s on the Convex adapter",
  (provider) => {
    it("registers, links and issues and refreshes tokens", async () => {
      const { auth, cookie, request, rows } = await makeAuth(provider);

      // Dynamic client registration, as MCP clients do it (public client).
      const registration = await request("/oauth2/register", {
        method: "POST",
        signedIn: false,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "MCP client",
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: "openid profile email offline_access",
        }),
      });
      expect(registration.status, await registration.clone().text()).toBe(201);
      const { client_id } = await registration.json();
      // Registration linked the client to the resource.
      expect(
        (await rows("oauthClientResource")).map((r) => [
          r.clientId,
          r.resourceId,
        ])
      ).toEqual([[client_id, RESOURCE]]);

      // Linking the same pair again is idempotent: the compound unique
      // index rejects the duplicate, and the plugin reports alreadyLinked.
      const api = auth.api as any;
      const linkArgs = {
        params: { identifier: RESOURCE, client_id },
        headers: new Headers({ cookie }),
      };
      expect(await api.adminLinkClientResource(linkArgs)).toEqual({
        linked: true,
        alreadyLinked: true,
      });
      expect(await rows("oauthClientResource")).toHaveLength(1);
      expect(await api.adminUnlinkClientResource(linkArgs)).toEqual({
        unlinked: true,
      });
      expect(await rows("oauthClientResource")).toHaveLength(0);
      expect(await api.adminLinkClientResource(linkArgs)).toEqual({
        linked: true,
      });
      expect(await rows("oauthClientResource")).toHaveLength(1);

      // Authorization code with PKCE and a resource indicator.
      const verifier = randomBytes(32).toString("base64url");
      const authorizeQuery = new URLSearchParams({
        response_type: "code",
        client_id,
        redirect_uri: REDIRECT_URI,
        scope: "openid profile offline_access",
        state: "state-1",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        resource: RESOURCE,
      });
      const authorize = await request(`/oauth2/authorize?${authorizeQuery}`);
      const consentPage = await redirectTarget(authorize);
      expect(consentPage, await authorize.clone().text()).toContain("/consent");
      const consent = await request("/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accept: true,
          oauth_query: new URL(consentPage!, BASE_URL).search.slice(1),
        }),
      });
      expect(consent.status, await consent.clone().text()).toBe(200);
      const code = new URL((await consent.json()).url).searchParams.get("code");
      expect(code).toBeTruthy();
      expect(await rows("oauthConsent")).toHaveLength(1);

      const token = await request(
        "/oauth2/token",
        tokenRequest({
          grant_type: "authorization_code",
          code: code!,
          redirect_uri: REDIRECT_URI,
          client_id,
          code_verifier: verifier,
          resource: RESOURCE,
        })
      );
      expect(token.status, await token.clone().text()).toBe(200);
      const tokens = await token.json();
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();

      // A second authorize finds the stored consent and returns a code.
      const again = await request(`/oauth2/authorize?${authorizeQuery}`);
      expect(await redirectTarget(again), await again.clone().text()).toContain(
        REDIRECT_URI
      );

      // The refresh token rotates.
      const refresh = await request(
        "/oauth2/token",
        tokenRequest({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id,
          resource: RESOURCE,
        })
      );
      expect(refresh.status, await refresh.clone().text()).toBe(200);
      const refreshed = await refresh.json();
      expect(refreshed.refresh_token).toBeTruthy();
      expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

      // The convex() plugin still issues its token next to the provider.
      const convexToken = await request("/convex/token");
      expect(convexToken.status, await convexToken.clone().text()).toBe(200);
    });
  }
);
