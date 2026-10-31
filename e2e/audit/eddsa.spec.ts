import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";

const site = "http://127.0.0.1:3211";

test("legacy domain-provider EdDSA discovery matches the actual token and public keys", async ({
  request,
}) => {
  const signup = await request.post(`${site}/eddsa-auth/sign-up/email`, {
    data: {
      name: "EdDSA",
      email: `${randomUUID()}@example.com`,
      password: "FixturePassword123!",
    },
  });
  expect(signup.status()).toBe(200);
  const user = (await signup.json()).user;
  const metadata = await (
    await request.get(
      `${site}/eddsa-auth/convex/.well-known/openid-configuration`
    )
  ).json();
  expect(metadata).toMatchObject({
    issuer: site,
    jwks_uri: `${site}/eddsa-auth/convex/jwks`,
    id_token_signing_alg_values_supported: ["EdDSA"],
  });
  const response = await request.get(`${site}/eddsa-auth/convex/token`);
  expect(response.status()).toBe(200);
  const keys = await (await request.get(metadata.jwks_uri)).json();
  expect(
    (
      await jwtVerify((await response.json()).token, createLocalJWKSet(keys), {
        issuer: site,
        audience: "convex",
        algorithms: ["EdDSA"],
      })
    ).payload.sub
  ).toBe(user.id);
  for (const key of keys.keys) expect(key).not.toHaveProperty("d");
});
