import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  auth,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthTokens,
  OAuthClientInformationMixed,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const base = "http://127.0.0.1:3211/api/mcp-auth";
const resource = "http://127.0.0.1:3211/mcp";
const redirectUri = "https://client.example.com/callback";
const scope = "openid profile email offline_access mcp:read";

class MemoryProvider implements OAuthClientProvider {
  redirectUrl = redirectUri;
  clientMetadata = {
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope,
  };
  savedTokens?: OAuthTokens;
  authorizationUrl?: URL;
  verifier = "";
  oauthState = randomUUID();
  constructor(private credentials: OAuthClientInformationMixed) {}
  clientInformation() {
    return this.credentials;
  }
  tokens() {
    return this.savedTokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.savedTokens = tokens;
  }
  state() {
    return this.oauthState;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(value: string) {
    this.verifier = value;
  }
  codeVerifier() {
    return this.verifier;
  }
}

async function register(request: APIRequestContext) {
  const signup = await request.post(`${base}/sign-up/email`, {
    data: {
      name: "MCP SDK user",
      email: `${randomUUID()}@example.com`,
      password: "TestPassword123!",
    },
  });
  expect(signup.status()).toBe(200);
  const { user } = await signup.json();
  const registration = await request.post(`${base}/oauth2/create-client`, {
    data: {
      client_name: "Private SDK client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
    },
  });
  expect(registration.status()).toBe(201);
  return { provider: new MemoryProvider(await registration.json()), user };
}

for (const format of ["json", "sse"]) {
  test(`MCP SDK ${format} supports discovery, PKCE, authenticated requests and refresh`, async ({
    request,
  }) => {
    const { provider, user } = await register(request);
    const observed: {
      path: string;
      method: string;
      status: number;
      type: string;
    }[] = [];
    const transport = new StreamableHTTPClientTransport(
      new URL(`${resource}?format=${format}`),
      {
        authProvider: provider,
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          observed.push({
            path: new URL(String(input)).pathname,
            method: init?.method ?? "GET",
            status: response.status,
            type: response.headers.get("content-type") ?? "",
          });
          return response;
        },
      }
    );
    const first = new Client({ name: "private-client", version: "1.0.0" });
    try {
      await expect(first.connect(transport)).rejects.toBeInstanceOf(
        UnauthorizedError
      );
      expect(observed.some((r) => r.path === "/mcp" && r.status === 401)).toBe(
        true
      );
      expect(
        observed.some(
          (r) => r.path.includes("oauth-protected-resource") && r.status === 200
        )
      ).toBe(true);
      // The transport follows the challenge's least-privilege mcp:read scope.
      // The application explicitly asks the SDK for offline access to exercise
      // refresh; no discovery, PKCE generation or token exchange is stubbed.
      expect(provider.authorizationUrl!.searchParams.get("scope")).toBe(
        "mcp:read"
      );
      expect(await auth(provider, { serverUrl: resource, scope })).toBe(
        "REDIRECT"
      );
      const url = provider.authorizationUrl!;
      expect(url.origin + url.pathname).toBe(`${base}/oauth2/authorize`);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("resource")).toBe(resource);
      expect(url.searchParams.get("state")).toBe(provider.oauthState);
      const authorization = await request.get(url.href, { maxRedirects: 0 });
      expect(authorization.status()).toBe(302);
      const consentUrl = new URL(authorization.headers().location, base);
      expect(consentUrl.pathname).toBe("/consent");
      const consent = await request.post(`${base}/oauth2/consent`, {
        data: { accept: true, oauth_query: consentUrl.search.slice(1) },
      });
      expect(consent.status()).toBe(200);
      const callback = new URL((await consent.json()).url);
      expect(callback.origin + callback.pathname).toBe(redirectUri);
      expect(callback.searchParams.get("state")).toBe(provider.oauthState);
      await transport.finishAuth(callback.searchParams.get("code")!);
    } finally {
      await first.close();
    }
    expect(!!provider.savedTokens?.refresh_token).toBe(true);
    const connected = new Client({ name: "private-client", version: "1.0.0" });
    const sdkTransport = new StreamableHTTPClientTransport(
      new URL(`${resource}?format=${format}`),
      {
        authProvider: provider,
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          observed.push({
            path: new URL(String(input)).pathname,
            method: init?.method ?? "GET",
            status: response.status,
            type: response.headers.get("content-type") ?? "",
          });
          return response;
        },
      }
    );
    try {
      await connected.connect(sdkTransport);
      expect(connected.getServerVersion()?.name).toBe("private-auth-fixture");
      expect(sdkTransport.protocolVersion).toBeTruthy();
      await connected.ping();
      expect(
        (await connected.listTools()).tools.map((tool) => tool.name)
      ).toContain("echo");
      const result = await connected.callTool({
        name: "echo",
        arguments: { text: "hello" },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual({
        text: "hello",
        subject: user.id,
      });
      expect(
        observed.some(
          (r) =>
            r.path === "/mcp" &&
            r.method === "POST" &&
            r.status === 200 &&
            r.type.includes(
              format === "json" ? "application/json" : "text/event-stream"
            )
        )
      ).toBe(true);
    } finally {
      await connected.close();
    }
    // Invalid access credential forces the SDK itself through refresh, rather
    // than manually posting the grant as the earlier auth-only test does.
    const oldRefresh = provider.savedTokens!.refresh_token;
    provider.savedTokens = {
      ...provider.savedTokens!,
      access_token: "expired-test-access-token",
    };
    const refreshed = new Client({
      name: "private-client-reconnected",
      version: "1.0.0",
    });
    try {
      await refreshed.connect(
        new StreamableHTTPClientTransport(
          new URL(`${resource}?format=${format}`),
          { authProvider: provider }
        )
      );
      expect(provider.savedTokens!.refresh_token !== oldRefresh).toBe(true);
      expect((await refreshed.listTools()).tools[0].name).toBe("echo");
    } finally {
      await refreshed.close();
    }
  });
}
