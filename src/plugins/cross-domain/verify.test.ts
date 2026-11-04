import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { crossDomain } from "./index.js";

const SITE_URL = "https://myapp.example.com";
const AUTH_BASE_URL = "http://localhost:3000";

// The verify endpoint rejects anything but a live, unused cross-domain token.
describe("verifyCrossDomainOneTimeToken", () => {
  const setup = async () => {
    const db: MemoryDB = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const auth = betterAuth({
      baseURL: AUTH_BASE_URL,
      secret: "test-secret-at-least-thirty-two-characters-long",
      database: memoryAdapter(db),
      emailAndPassword: { enabled: true },
      plugins: [crossDomain({ siteUrl: SITE_URL })],
    });
    await auth.api.signUpEmail({
      body: { email: "a@x.com", password: "password123", name: "a" },
    });
    const session = db.session[0]!;
    const ctx = await auth.$context;
    // Issue a token the way the after hook does.
    const issue = async (identifier: string, ttlMs = 60_000) =>
      ctx.internalAdapter.createVerificationValue({
        identifier,
        value: session.token as string,
        expiresAt: new Date(Date.now() + ttlMs),
      });
    const verify = async (token: string) => {
      const response = await auth.handler(
        new Request(
          `${AUTH_BASE_URL}/api/auth/cross-domain/one-time-token/verify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          }
        )
      );
      return {
        status: response.status,
        body: (await response.json()) as { message?: string },
        setCookie: response.headers.get("set-cookie") ?? "",
      };
    };
    return { session, issue, verify };
  };

  it("redeems a token once and sets the session cookie", async () => {
    const { session, issue, verify } = await setup();
    await issue("cross-domain-ott:tok");
    const first = await verify("tok");
    expect(first.status).toBe(200);
    expect(first.setCookie).toContain(`session_token=${session.token}`);
    const replay = await verify("tok");
    expect(replay.status).toBe(400);
    expect(replay.body.message).toBe("Invalid token");
  });

  it("rejects an unknown token and a Better Auth oneTimeToken value", async () => {
    const { issue, verify } = await setup();
    expect((await verify("nope")).status).toBe(400);
    await issue("one-time-token:tok");
    expect((await verify("tok")).status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const { issue, verify } = await setup();
    await issue("cross-domain-ott:tok", -1000);
    const result = await verify("tok");
    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Invalid token");
  });

  it("rejects a token for an expired session without setting a cookie", async () => {
    const { session, issue, verify } = await setup();
    session.expiresAt = new Date(Date.now() - 1000);
    await issue("cross-domain-ott:tok");
    const result = await verify("tok");
    expect(result.status).toBe(400);
    expect(result.body.message).toBe("Session expired");
    expect(result.setCookie).not.toContain("session_token=");
  });
});
