import { test, expect } from "@playwright/test";
import { authorize } from "../helpers/authorize";

const base = "http://127.0.0.1:3211/api/mcp-auth";
const resource = "http://127.0.0.1:3211/mcp";

test("MCP protected-resource discovery and unauthenticated challenge", async ({
  request,
}) => {
  const discovery = await request.get(
    "/.well-known/oauth-protected-resource/mcp"
  );
  expect(discovery.status()).toBe(200);
  expect(await discovery.json()).toMatchObject({ resource });
  const rejected = await request.post(resource, {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(rejected.status()).toBe(401);
  expect(rejected.headers()["www-authenticate"]).toContain("resource_metadata");
});

test("MCP tokens enforce audience, scope and signature and support refresh", async ({
  request,
}) => {
  const { tokens, credentials, code, verifier, redirectUri, user } =
    await authorize(request, {
      base,
      resource,
      scope: "openid profile email offline_access mcp:read",
    });
  const invoke = (url: string, token: string) =>
    request.post(url, {
      headers: {
        authorization: `Bearer ${token}`,
        cookie: "",
        accept: "application/json, text/event-stream",
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
  const accepted = await invoke(resource, tokens.access_token);
  expect(accepted.status()).toBe(200);
  expect((await accepted.json()).result.subject).toBe(user.id);
  expect((await invoke("/mcp-admin", tokens.access_token)).status()).toBe(403);
  expect((await invoke("/wrong-resource", tokens.access_token)).status()).toBe(
    401
  );
  expect(
    (
      await invoke(resource, `${tokens.access_token.slice(0, -10)}aaaaaaaaaa`)
    ).status()
  ).toBe(401);
  const refresh = (token: string) =>
    request.post(`${base}/oauth2/token`, {
      form: {
        ...credentials,
        grant_type: "refresh_token",
        refresh_token: token,
        resource,
      },
    });
  const rotated = await refresh(tokens.refresh_token);
  expect(rotated.status()).toBe(200);
  const next = await rotated.json();
  const refreshed = await invoke(resource, next.access_token);
  expect(refreshed.status()).toBe(200);
  expect((await refreshed.json()).result.subject).toBe(user.id);
  expect((await refresh(tokens.refresh_token)).status()).toBe(400);
  expect((await refresh(next.refresh_token)).status()).toBe(400);
  const replay = await request.post(`${base}/oauth2/token`, {
    form: {
      ...credentials,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    },
  });
  expect(replay.status()).toBe(400);
});

test("MCP auth route initializes for CORS preflight and discovery", async ({
  request,
}) => {
  for (const origin of [
    "http://localhost:5176",
    "https://untrusted.example.com",
  ]) {
    const response = await request.fetch(
      `${base}/.well-known/openid-configuration`,
      {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization,content-type",
        },
      }
    );
    expect(response.status()).toBe(204);
    expect(response.headers()["access-control-allow-origin"]).toBe(
      origin === "http://localhost:5176" ? origin : undefined
    );
    expect(response.headers()["access-control-allow-methods"]).toContain("GET");
    expect(response.headers()["access-control-allow-methods"]).toContain(
      "POST"
    );
  }
  const discovery = await request.get(
    `${base}/.well-known/openid-configuration`,
    { headers: { origin: "http://localhost:5176" } }
  );
  expect(discovery.status()).toBe(200);
  expect(discovery.headers()["access-control-allow-origin"]).toBe(
    "http://localhost:5176"
  );
  expect((await discovery.json()).issuer).toBe(base);
});
