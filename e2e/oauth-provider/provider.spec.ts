import { test, expect } from "@playwright/test";
import { createLocalJWKSet, jwtVerify } from "jose";

const site = "http://127.0.0.1:3211";
const base = `${site}/api/auth`;
import { authorize } from "../helpers/authorize";

test.describe(`${process.env.OAUTH_ROUTE_REGISTRATION} OAuth provider`, () => {
  test.beforeEach(async ({ request }) => {
    const mode = await request.get("/registration-mode");
    expect(mode.status()).toBe(200);
    expect(await mode.json()).toEqual({
      registration: process.env.OAUTH_ROUTE_REGISTRATION,
    });
  });
  test("discovery leads to provider metadata and keys that verify its ID token", async ({
    request,
  }) => {
    const root = await request.get(`${site}/.well-known/openid-configuration`, {
      maxRedirects: 0,
    });
    expect(root.status()).toBe(302);
    expect(root.headers().location).toBe(
      `${base}/.well-known/openid-configuration`
    );
    const discovery = await request.get(root.headers().location);
    expect(discovery.status()).toBe(200);
    const metadata = await discovery.json();
    expect(metadata).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/oauth2/authorize`,
      token_endpoint: `${base}/oauth2/token`,
      jwks_uri: `${base}/convex/jwks`,
    });
    const { credentials, tokens, user, nonce } = await authorize(request);
    const keys = await request.get(metadata.jwks_uri);
    expect(keys.status()).toBe(200);
    const jwks = await keys.json();
    expect(jwks.keys.length).toBeGreaterThan(0);
    for (const key of jwks.keys) expect(key).not.toHaveProperty("d");
    const { payload } = await jwtVerify(
      tokens.id_token,
      createLocalJWKSet(jwks),
      {
        issuer: metadata.issuer,
        audience: credentials.client_id,
        algorithms: ["RS256"],
      }
    );
    expect(payload).toMatchObject({ sub: user.id, nonce });
  });

  test("refresh rotates the token and rejects reuse of the old token and its family", async ({
    request,
  }) => {
    const { credentials, tokens, user } = await authorize(request);
    const refresh = (token: string) =>
      request.post(`${base}/oauth2/token`, {
        headers: { cookie: "" },
        form: {
          ...credentials,
          grant_type: "refresh_token",
          refresh_token: token,
        },
      });
    const rotation = await refresh(tokens.refresh_token);
    expect(rotation.status()).toBe(200);
    const rotated = await rotation.json();
    expect(rotated.refresh_token).toBeTruthy();
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(rotated.access_token).toBeTruthy();
    const profile = await request.get(`${base}/oauth2/userinfo`, {
      headers: { cookie: "", authorization: `Bearer ${rotated.access_token}` },
    });
    expect(profile.status()).toBe(200);
    expect(await profile.json()).toMatchObject({ sub: user.id });

    const replay = await refresh(tokens.refresh_token);
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    const family = await refresh(rotated.refresh_token);
    expect(family.status()).toBe(400);
    expect(await family.json()).toMatchObject({ error: "invalid_grant" });
  });
});
