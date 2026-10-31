import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const base = "http://127.0.0.1:3211/api/surfaces";
const frontend = "http://localhost:5176";
const db = new ConvexHttpClient("http://127.0.0.1:3210");

async function call(page: Page, path: string, data?: unknown, save = false) {
  return page.evaluate(
    async ({ base, path, data, save }) => {
      const saved = localStorage.getItem("fixture-auth") ?? "";
      const response = await fetch(base + path, {
        method: data === undefined ? "GET" : "POST",
        credentials: "omit",
        headers: {
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
          // Like crossDomainClient, send even the initial empty header: its
          // presence opts into response-header session storage.
          "Better-Auth-Cookie": saved,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      if (save) {
        const cookie = response.headers.get("set-better-auth-cookie");
        if (!cookie)
          throw new Error("Missing exposed cross-domain session header");
        // A real browser can only read this header when CORS exposes it.
        localStorage.setItem(
          "fixture-auth",
          [...cookie.matchAll(/(?:^|,\s*)([^=;,\s]+)=([^;]*)/g)]
            .map((match) => `${match[1]}=${match[2]}`)
            .join("; ")
        );
      }
      return { status: response.status, body: await response.json() };
    },
    { base, path, data, save }
  );
}

async function verifySession(page: Page, email: string) {
  const result = await call(page, "/get-session");
  expect(result.status).toBe(200);
  expect(result.body.user.email).toBe(email);
  await page.reload();
  expect((await call(page, "/get-session")).body.user.email).toBe(email);
  expect((await call(page, "/sign-out", {})).status).toBe(200);
  expect((await call(page, "/get-session")).body).toBeNull();
}

async function redeem(page: Page) {
  const callback = new URL(page.url());
  expect(callback.origin).toBe(frontend);
  const token = callback.searchParams.get("ott");
  expect(!!token).toBe(true);
  expect(
    (await call(page, "/cross-domain/one-time-token/verify", { token }, true))
      .status
  ).toBe(200);
  expect(
    (await call(page, "/cross-domain/one-time-token/verify", { token })).status
  ).toBe(400);
}

test("magic link crosses browser origins, persists through reload and signs out", async ({
  page,
}) => {
  const email = `${randomUUID()}@example.com`;
  await page.goto(frontend);
  expect(
    (
      await call(page, "/sign-in/magic-link", {
        email,
        name: "Browser magic",
        callbackURL: frontend,
      })
    ).status
  ).toBe(200);
  const message = await db.query(api.authFixtures.message, {
    email,
    kind: "magic",
  });
  expect(message).not.toBeNull();
  await page.goto(message!.value);
  await redeem(page);
  await verifySession(page, email);
});

test("email OTP authenticates using exposed cross-domain headers with no native cookie jar", async ({
  page,
}) => {
  const email = `${randomUUID()}@example.com`;
  await page.goto(frontend);
  expect(
    (
      await call(page, "/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      })
    ).status
  ).toBe(200);
  const message = await db.query(api.authFixtures.message, {
    email,
    kind: "sign-in",
  });
  expect(message).not.toBeNull();
  expect(
    (
      await call(
        page,
        "/sign-in/email-otp",
        { email, otp: message!.value, name: "Browser OTP" },
        true
      )
    ).status
  ).toBe(200);
  await verifySession(page, email);
});

test("controlled social OAuth follows browser state/PKCE redirects and persists a session", async ({
  page,
}) => {
  await page.goto(frontend);
  const authorization = await call(page, "/sign-in/social", {
    provider: "fixture",
    callbackURL: frontend,
    disableRedirect: true,
  });
  expect(authorization.status).toBe(200);
  await page.goto(authorization.body.url);
  await redeem(page);
  const result = await call(page, "/get-session");
  expect(result.body.user.email).toMatch(/@example\.com$/);
  await verifySession(page, result.body.user.email);
});

test("untrusted browser origin cannot request an OTP", async ({ page }) => {
  await page.goto("http://127.0.0.1:5176");
  const failed = await page.evaluate(async (base) => {
    try {
      const response = await fetch(`${base}/email-otp/send-verification-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "untrusted@example.com",
          type: "sign-in",
        }),
      });
      return response.status >= 400;
    } catch {
      return true;
    }
  }, base);
  expect(failed).toBe(true);
  expect(
    await db.query(api.authFixtures.message, {
      email: "untrusted@example.com",
      kind: "sign-in",
    })
  ).toBeNull();
});
