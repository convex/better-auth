import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

const SITE_URL = "https://happy-animal-123.convex.site";
process.env.CONVEX_SITE_URL = SITE_URL;

const authConfig = {
  providers: [{ applicationID: "convex", domain: SITE_URL }],
} satisfies AuthConfig;

const PASSWORD = "correct horse battery staple";
const JWT_COOKIE = "better-auth.convex_jwt";

const lastSetCookies = (headers: Headers) => {
  const byName = new Map<string, { value: string; raw: string }>();
  for (const raw of headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    byName.set(pair.slice(0, idx), { value: pair.slice(idx + 1), raw });
  }
  return byName;
};

describe("convex plugin JWT cookie for an expired session", () => {
  it("expires the JWT cookie instead of signing one on get-session", async () => {
    // Imported after CONVEX_SITE_URL is set.
    const { convex } = await import("./index.js");
    const db: Record<string, any[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
    };
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "a-very-long-test-secret-that-is-at-least-32-chars",
      emailAndPassword: { enabled: true },
      // The memory adapter has no Convex ctx; mark it as a mutation ctx so
      // the Convex plugin's query-context before hook doesn't no-op writes.
      database: (options: any) => {
        const adapter = memoryAdapter(db)(options);
        return {
          ...adapter,
          options: { ...(adapter as any).options, isRunMutationCtx: true },
        };
      },
      plugins: [convex({ authConfig })],
    });
    await auth.api.signUpEmail({
      body: { email: "user@example.com", password: PASSWORD, name: "Test" },
    });
    const { headers, response } = await auth.api.signInEmail({
      body: { email: "user@example.com", password: PASSWORD },
      returnHeaders: true,
    });
    const sessionCookie = lastSetCookies(headers).get(
      "better-auth.session_token"
    )!;
    // The session expires in the database while the cookie is still held.
    const row = db.session.find((s) => s.token === (response as any).token);
    row.expiresAt = new Date(Date.now() - 1000);

    // getSession stores the expired session in ctx.context.session before
    // answering null; no JWT may be signed for it.
    const result = await auth.api.getSession({
      headers: new Headers({
        cookie: `better-auth.session_token=${sessionCookie.value}`,
      }),
      returnHeaders: true,
    });
    expect(result.response).toBeNull();
    const jwtCookie = lastSetCookies(result.headers).get(JWT_COOKIE);
    expect(jwtCookie?.value ?? "").toBe("");
    expect(jwtCookie?.raw ?? "Max-Age=0").toMatch(/Max-Age=0/);
  });
});
