import { test, expect } from "@playwright/test";
import { createLocalJWKSet, jwtVerify } from "jose";
import { authorize } from "../helpers/authorize";

const site = "http://127.0.0.1:3211";
const base = `${site}${process.env.AUDIT_AUTH_BASE_PATH ?? "/api/auth"}`;

test("provider discovery and Convex tokens use distinct issuers and independently verifiable JWTs", async ({
  request,
}) => {
  const root = await request.get(`${site}/.well-known/openid-configuration`, {
    maxRedirects: 0,
  });
  expect(root.status()).toBe(302);
  expect(root.headers().location).toBe(
    `${base}/.well-known/openid-configuration`
  );
  const metadata = await (await request.get(root.headers().location)).json();
  expect(metadata.issuer).toBe(base);
  expect(metadata.jwks_uri).toBe(`${base}/convex/jwks`);
  const { tokens, user, credentials, nonce } = await authorize(request, {
    base,
  });
  const jwks = await (await request.get(metadata.jwks_uri)).json();
  const keys = createLocalJWKSet(jwks);
  expect(
    (
      await jwtVerify(tokens.id_token, keys, {
        issuer: base,
        audience: credentials.client_id,
        algorithms: ["RS256"],
      })
    ).payload
  ).toMatchObject({ sub: user.id, nonce });
  // The documented plugin order lets OAuth Provider own the shared discovery
  // endpoint key. Convex custom-JWT verification uses its JWKS URL directly.
  const tokenResponse = await request.get(`${base}/convex/token`);
  expect(tokenResponse.status()).toBe(200);
  const token = (await tokenResponse.json()).token;
  expect(
    (
      await jwtVerify(token, keys, {
        issuer: site,
        audience: "convex",
        algorithms: ["RS256"],
      })
    ).payload.sub
  ).toBe(user.id);
  await expect(
    jwtVerify(tokens.id_token, keys, { issuer: site, audience: "convex" })
  ).rejects.toThrow();
  for (const key of jwks.keys) expect(key).not.toHaveProperty("d");
});
