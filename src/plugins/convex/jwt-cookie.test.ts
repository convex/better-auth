import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { convex } from "./index.js";

const site = "http://localhost:3211";
const password = "Synthetic-cookie-test-password-42!";

function fixture() {
  const log = vi.fn();
  const db = Object.fromEntries(
    [
      "user",
      "account",
      "session",
      "verification",
      "jwks",
      "oauthClient",
      "oauthAccessToken",
      "oauthRefreshToken",
      "oauthConsent",
    ].map((model) => [model, []])
  );
  const plugin = convex({
    authConfig: { providers: [{ applicationID: "convex", domain: site }] },
  });
  const auth = betterAuth({
    baseURL: site,
    secret: "synthetic-cookie-test-secret-at-least-32-characters",
    database: (options: BetterAuthOptions) => {
      const adapter = memoryAdapter(db)(options);
      // Match a writable Convex action; unmarked adapters use query-safe no-op writes.
      if (!adapter.options) throw new Error("Memory adapter options missing");
      adapter.options.isRunMutationCtx = true;
      return adapter;
    },
    emailAndPassword: { enabled: true },
    logger: { level: "debug", log },
    plugins: [plugin],
  });
  const post = (path: string, body: object, cookie = "") =>
    auth.handler(
      new Request(`${site}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: site, cookie },
        body: JSON.stringify(body),
      })
    );
  return { auth, log, post };
}

describe("Convex JWT cookies", () => {
  beforeEach(() => vi.stubEnv("CONVEX_SITE_URL", site));
  afterEach(() => vi.unstubAllEnvs());
  it("rejects an unknown user without logging a caught session-reader error", async () => {
    const { post, log } = fixture();
    const response = await post("/sign-in/email", {
      email: "missing@example.test",
      password,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "INVALID_EMAIL_OR_PASSWORD",
    });
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "convex_jwt="
    );
    expect(log.mock.calls.filter(([level]) => level === "error")).toEqual([]);
  });

  it("rejects a wrong password with an existing session cookie without issuing a JWT", async () => {
    const { post, log } = fixture();
    const signup = await post("/sign-up/email", {
      email: "existing@example.test",
      name: "Existing",
      password,
    });
    expect(signup.status).toBe(200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    log.mockClear();
    const response = await post(
      "/sign-in/email",
      { email: "existing@example.test", password: "wrong-password" },
      cookie
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "INVALID_EMAIL_OR_PASSWORD",
    });
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "convex_jwt="
    );
    expect(log.mock.calls.filter(([level]) => level === "error")).toEqual([]);
  });

  it("still issues JWT cookies and restores sessions on successful sign-in", async () => {
    const { auth, post, log } = fixture();
    const signup = await post("/sign-up/email", {
      email: "success@example.test",
      name: "Success",
      password,
    });
    expect(signup.status).toBe(200);
    expect(signup.headers.get("set-cookie")).toContain("convex_jwt=");
    const response = await post("/sign-in/email", {
      email: "success@example.test",
      password,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("convex_jwt=");
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const session = await auth.handler(
      new Request(`${site}/api/auth/get-session`, { headers: { cookie } })
    );
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      user: { email: "success@example.test" },
    });
    expect(log.mock.calls.filter(([level]) => level === "error")).toEqual([]);
  });
});
