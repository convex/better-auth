import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
const site = "http://127.0.0.1:3211";
const redirectUri = "https://client.example.com/callback";
export async function authorize(
  request: APIRequestContext,
  options: { base?: string; resource?: string; scope?: string } = {}
) {
  const base = options.base ?? "http://127.0.0.1:3211/api/auth";
  const scope = options.scope ?? "openid profile email offline_access";
  const signup = await request.post(`${base}/sign-up/email`, {
    data: {
      name: "OAuth test user",
      email: `${randomUUID()}@example.com`,
      password: "TestPassword123!",
    },
  });
  expect(signup.status()).toBe(200);
  const { user } = await signup.json();
  const registration = await request.post(`${base}/oauth2/create-client`, {
    data: {
      client_name: "E2E client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
    },
  });
  expect(registration.status()).toBe(201);
  const { client_id, client_secret } = await registration.json();
  expect(client_id).toBeTruthy();
  expect(client_secret).toBeTruthy();
  const verifier = randomBytes(32).toString("base64url");
  const state = randomUUID();
  const nonce = randomUUID();
  const authorization = await request.get(`${base}/oauth2/authorize`, {
    params: {
      client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "consent",
      ...(options.resource ? { resource: options.resource } : {}),
    },
    maxRedirects: 0,
  });
  expect(authorization.status()).toBe(302);
  const consentUrl = new URL(authorization.headers().location, site);
  expect(consentUrl.pathname).toBe("/consent");
  const consent = await request.post(`${base}/oauth2/consent`, {
    data: { accept: true, oauth_query: consentUrl.search.slice(1) },
  });
  expect(consent.status()).toBe(200);
  const callback = new URL((await consent.json()).url);
  expect(`${callback.origin}${callback.pathname}`).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe(state);
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();
  const credentials = { client_id, client_secret };
  const exchange = await request.post(`${base}/oauth2/token`, {
    headers: { cookie: "" },
    form: {
      ...credentials,
      grant_type: "authorization_code",
      code: code!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      ...(options.resource ? { resource: options.resource } : {}),
    },
  });
  expect(exchange.status()).toBe(200);
  const tokens = await exchange.json();
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.refresh_token).toBeTruthy();
  expect(tokens.id_token).toBeTruthy();
  return {
    credentials,
    tokens,
    user,
    nonce,
    code: code!,
    verifier,
    redirectUri,
  };
}
