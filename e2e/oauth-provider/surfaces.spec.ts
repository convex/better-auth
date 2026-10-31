import { randomUUID } from "node:crypto";
import {
  request as apiRequest,
  test,
  expect,
  type APIResponse,
  type APIRequestContext,
} from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const base = "http://127.0.0.1:3211/api/surfaces";
const client = new ConvexHttpClient("http://127.0.0.1:3210");
const email = () => `${randomUUID()}@example.com`;
const password = "PrivateTestPassword123!";
const cookie = (response: APIResponse) => {
  const header =
    response.headers()["set-better-auth-cookie"] ??
    response.headers()["set-cookie"] ??
    "";
  return [...header.matchAll(/(?:^|,\s*)([^=;,\s]+)=([^;]*)/g)]
    .map((match) => `${match[1]}=${match[2]}`)
    .join("; ");
};
const sessionHeaders = (value: string) => ({
  cookie: value,
  "better-auth-cookie": value,
});

async function message(address: string, kind: string) {
  const row = await client.query(api.authFixtures.message, {
    email: address,
    kind,
  });
  expect(row).not.toBeNull();
  return row!.value;
}

async function session(
  _request: APIRequestContext,
  saved: string,
  address: string
) {
  // No native cookie jar: authenticate through the cross-domain header alone.
  const isolated = await apiRequest.newContext();
  try {
    const response = await isolated.get(`${base}/get-session`, {
      headers: { "better-auth-cookie": saved },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.user.email).toBe(address);
    expect(body.user).not.toHaveProperty("betterAuthNullIndexes");
    return body;
  } finally {
    await isolated.dispose();
  }
}

async function signup(request: APIRequestContext) {
  const address = email();
  const response = await request.post(`${base}/sign-up/email`, {
    data: { email: address, password, name: "Surface user" },
  });
  expect(response.status()).toBe(200);
  return { address, saved: cookie(response) };
}

test("email/password rejects wrong passwords and supports sessions, JWTs, and logout", async ({
  request,
}) => {
  const { address, saved } = await signup(request);
  await session(request, saved, address);
  const wrong = await request.post(`${base}/sign-in/email`, {
    headers: { cookie: "" },
    data: { email: address, password: "wrong-password" },
  });
  expect(wrong.status()).toBe(401);
  const login = await request.post(`${base}/sign-in/email`, {
    headers: { cookie: "" },
    data: { email: address, password },
  });
  expect(login.status()).toBe(200);
  const current = cookie(login);
  await session(request, current, address);
  const token = await request.get(`${base}/convex/token`, {
    headers: sessionHeaders(current),
  });
  expect(token.status()).toBe(200);
  expect((await token.json()).token).toBeTruthy();
  const logout = await request.post(`${base}/sign-out`, {
    headers: sessionHeaders(current),
    data: {},
  });
  expect(logout.status()).toBe(200);
  const revoked = await request.get(`${base}/get-session`, {
    headers: sessionHeaders(current),
  });
  expect(await revoked.json()).toBeNull();
});

test("magic link supports delivery, cross-domain sessions, and replay rejection", async ({
  request,
}) => {
  const address = email();
  expect(
    (
      await request.post(`${base}/sign-in/magic-link`, {
        data: {
          email: address,
          name: "Magic user",
          callbackURL: "http://localhost:5176/",
        },
      })
    ).status()
  ).toBe(200);
  const link = await message(address, "magic");
  const verified = await request.get(link, { maxRedirects: 0 });
  expect(verified.status()).toBe(302);
  const location = new URL(verified.headers().location);
  expect(location.origin).toBe("http://localhost:5176");
  const ott = location.searchParams.get("ott");
  expect(ott).toBeTruthy();
  const redeem = await request.post(
    `${base}/cross-domain/one-time-token/verify`,
    { data: { token: ott } }
  );
  expect(redeem.status()).toBe(200);
  await session(request, cookie(redeem), address);
  expect(
    (
      await request.post(`${base}/cross-domain/one-time-token/verify`, {
        data: { token: ott },
      })
    ).status()
  ).toBe(400);
  const replay = await request.get(link, { maxRedirects: 0 });
  expect(replay.headers().location ?? "").not.toContain("ott=");
});

test("concurrent magic-link redemption succeeds once", async ({ request }) => {
  const address = email();
  expect(
    (
      await request.post(`${base}/sign-in/magic-link`, {
        data: { email: address, name: "Race" },
      })
    ).status()
  ).toBe(200);
  const link = await message(address, "magic");
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => request.get(link, { maxRedirects: 0 }))
  );
  expect(
    responses.filter((r) => (r.headers().location ?? "").includes("ott="))
  ).toHaveLength(1);
});

test("email OTP handles hashed codes, wrong attempts, signup, and replay", async ({
  request,
}) => {
  const address = email();
  expect(
    (
      await request.post(`${base}/email-otp/send-verification-otp`, {
        data: { email: address, type: "sign-in" },
      })
    ).status()
  ).toBe(200);
  const otp = await message(address, "sign-in");
  const wrong = otp === "000000" ? "111111" : "000000";
  expect(
    (
      await request.post(`${base}/sign-in/email-otp`, {
        data: { email: address, otp: wrong },
      })
    ).status()
  ).toBe(400);
  const verified = await request.post(`${base}/sign-in/email-otp`, {
    data: { email: address, otp, name: "OTP user" },
  });
  expect(verified.status()).toBe(200);
  await session(request, cookie(verified), address);
  expect(
    (
      await request.post(`${base}/sign-in/email-otp`, {
        data: { email: address, otp },
      })
    ).status()
  ).toBe(400);
});

test("email OTP limits attempts and rejects an exhausted code", async ({
  request,
}) => {
  const address = email();
  expect(
    (
      await request.post(`${base}/email-otp/send-verification-otp`, {
        data: { email: address, type: "sign-in" },
      })
    ).status()
  ).toBe(200);
  const otp = await message(address, "sign-in");
  for (let i = 0; i < 3; i++) {
    const rejected = await request.post(`${base}/sign-in/email-otp`, {
      data: { email: address, otp: otp === "000000" ? "111111" : "000000" },
    });
    expect(rejected.ok()).toBe(false);
  }
  expect(
    (
      await request.post(`${base}/sign-in/email-otp`, {
        data: { email: address, otp },
      })
    ).ok()
  ).toBe(false);
});

test("ten simultaneous email OTP uses have one winner", async ({ request }) => {
  const address = email();
  expect(
    (
      await request.post(`${base}/email-otp/send-verification-otp`, {
        data: { email: address, type: "sign-in" },
      })
    ).status()
  ).toBe(200);
  const otp = await message(address, "sign-in");
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      request.post(`${base}/sign-in/email-otp`, {
        data: { email: address, otp, name: "Race" },
      })
    )
  );
  expect(responses.filter((r) => r.status() === 200)).toHaveLength(1);
});

test("password reset invalidates the old password and consumes the reset token", async ({
  request,
}) => {
  const { address } = await signup(request);
  expect(
    (
      await request.post(`${base}/request-password-reset`, {
        data: { email: address, redirectTo: "http://localhost:5176/" },
      })
    ).status()
  ).toBe(200);
  const link = new URL(await message(address, "reset"));
  const token = link.pathname.split("/").at(-1)!;
  const updated = "ChangedPrivatePassword123!";
  expect(
    (
      await request.post(`${base}/reset-password`, {
        data: { token, newPassword: updated },
      })
    ).status()
  ).toBe(200);
  expect(
    (
      await request.post(`${base}/reset-password`, {
        data: { token, newPassword: password },
      })
    ).ok()
  ).toBe(false);
  expect(
    (
      await request.post(`${base}/sign-in/email`, {
        data: { email: address, password },
      })
    ).status()
  ).toBe(401);
  expect(
    (
      await request.post(`${base}/sign-in/email`, {
        data: { email: address, password: updated },
      })
    ).status()
  ).toBe(200);
});

test("email verification updates the authenticated user", async ({
  request,
}) => {
  const { address, saved } = await signup(request);
  expect(
    (
      await request.post(`${base}/send-verification-email`, {
        headers: sessionHeaders(saved),
        data: { email: address, callbackURL: "http://localhost:5176/" },
      })
    ).status()
  ).toBe(200);
  const verified = await request.get(await message(address, "verify"), {
    maxRedirects: 0,
  });
  expect(verified.status()).toBe(302);
  expect((await session(request, saved, address)).user.emailVerified).toBe(
    true
  );
});

test("social OAuth supports PKCE, cross-domain tokens, and persistent sessions", async ({
  request,
}) => {
  const start = await request.post(`${base}/sign-in/social`, {
    data: {
      provider: "fixture",
      callbackURL: "http://localhost:5176/",
      disableRedirect: true,
    },
  });
  expect(start.status()).toBe(200);
  const authorization = await request.get((await start.json()).url, {
    maxRedirects: 0,
  });
  expect(authorization.status()).toBe(302);
  const callback = await request.get(authorization.headers().location, {
    maxRedirects: 0,
  });
  expect(callback.status()).toBe(302);
  const location = new URL(callback.headers().location);
  expect(location.origin).toBe("http://localhost:5176");
  const ott = location.searchParams.get("ott");
  expect(ott).toBeTruthy();
  const redeemed = await request.post(
    `${base}/cross-domain/one-time-token/verify`,
    { data: { token: ott } }
  );
  expect(redeemed.status()).toBe(200);
  const identity = await redeemed.json();
  await session(request, cookie(redeemed), identity.user.email);
  const replay = await request.get(authorization.headers().location, {
    maxRedirects: 0,
  });
  expect(replay.headers().location ?? "").not.toContain("ott=");
});

test("cross-domain rejects untrusted origins and callback destinations", async ({
  request,
}) => {
  const rejected = await request.post(`${base}/sign-in/magic-link`, {
    headers: { origin: "https://untrusted.example" },
    data: { email: email(), callbackURL: "https://untrusted.example/" },
  });
  expect(rejected.status()).toBe(403);
});

test("expired magic links and email OTPs cannot authenticate", async ({
  request,
}) => {
  const address = email();
  expect(
    (
      await request.post(`${base}/sign-in/magic-link`, {
        data: { email: address, callbackURL: "http://localhost:5176/" },
      })
    ).status()
  ).toBe(200);
  const link = await message(address, "magic");
  await client.mutation(api.authFixtures.expireVerification, {
    identifier: `magic-link:${new URL(link).searchParams.get("token")}`,
  });
  const magic = await request.get(link, { maxRedirects: 0 });
  expect(magic.status()).toBe(302);
  expect(magic.headers().location).toContain("error=");
  expect(magic.headers().location).not.toContain("ott=");
  expect(
    (
      await request.post(`${base}/email-otp/send-verification-otp`, {
        data: { email: address, type: "sign-in" },
      })
    ).status()
  ).toBe(200);
  const otp = await message(address, "sign-in");
  await client.mutation(api.authFixtures.expireVerification, {
    identifier: `sign-in-otp-${address}`,
  });
  expect(
    (
      await request.post(`${base}/sign-in/email-otp`, {
        data: { email: address, otp },
      })
    ).status()
  ).toBe(400);
});
