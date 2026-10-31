import { describe, expect, it } from "vitest";
import { httpRouter } from "convex/server";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { createClient } from "./create-client.js";

// End-to-end: a dynamic baseURL with a wildcard in allowedHosts, requests
// arriving through registerRoutes the way Convex delivers them.
const APP_HOST = "myapp.example.com";
const ADMIN_HOST = "admin.example.com";
const PREVIEW_HOST = "branch-abc.example-previews.app";
const CONVEX_SITE = "https://deployment.convex.site";

const component = {
  adapter: {
    create: "create",
    findOne: "findOne",
    findMany: "findMany",
    updateOne: "updateOne",
    updateMany: "updateMany",
    deleteOne: "deleteOne",
    deleteMany: "deleteMany",
  },
} as any;

describe("forwarded host restore with dynamic baseURL", async () => {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  let resetUrl = "";
  const auth = betterAuth({
    baseURL: {
      allowedHosts: [APP_HOST, ADMIN_HOST, "*.example-previews.app"],
      fallback: `https://${APP_HOST}`,
    },
    basePath: "/api/auth",
    secret: "test-secret-at-least-thirty-two-characters-long",
    database: memoryAdapter(db),
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ url }) => {
        resetUrl = url;
      },
    },
  });

  await auth.handler(
    new Request(`https://${APP_HOST}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "victim@example.com",
        password: "testpassword123",
        name: "Victim",
      }),
    })
  );

  const http = httpRouter();
  createClient(component).registerRoutes(http, () => auth as any);
  const route = http.lookup("/api/auth/request-password-reset", "POST")!;
  const handler = (route[0] as any)._handler as (
    ctx: unknown,
    request: Request
  ) => Promise<Response>;

  const requestReset = async (headers: Record<string, string>) => {
    resetUrl = "";
    const response = await handler(
      {},
      new Request(`${CONVEX_SITE}/api/auth/request-password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: new URL(CONVEX_SITE).host,
          "x-forwarded-host": new URL(CONVEX_SITE).host,
          "x-forwarded-proto": "https",
          ...headers,
        },
        body: JSON.stringify({ email: "victim@example.com" }),
      })
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(resetUrl).not.toBe("");
    return new URL(resetUrl);
  };

  it("builds links from the fallback with no original host", async () => {
    expect((await requestReset({})).host).toBe(APP_HOST);
  });

  it("uses an exactly listed original host", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.host).toBe(ADMIN_HOST);
  });

  it("ignores an original host that only matches a wildcard", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": PREVIEW_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.host).toBe(APP_HOST);
  });

  it("ignores a forwarded host that is not restored by the component", async () => {
    // A bare x-forwarded-host (no x-better-auth-forwarded-*) is not trusted
    // by Better Auth 1.7 without advanced.trustedProxyHeaders, and the
    // component does not rewrite host for it.
    const url = await requestReset({
      "x-forwarded-host": ADMIN_HOST,
    });
    expect(url.host).toBe(APP_HOST);
  });
});

describe("restoreOriginalForwardedHeaders header rewrite", () => {
  const trusted = new Set([ADMIN_HOST]);
  const http = httpRouter();
  const seen: Request[] = [];
  const auth = {
    options: {
      basePath: "/api/auth",
      trustedOrigins: [`https://${ADMIN_HOST}`],
    },
    $context: Promise.resolve({
      trustedOrigins: [`https://${ADMIN_HOST}`],
      options: { trustedOrigins: [`https://${ADMIN_HOST}`] },
    }),
    handler: async (request: Request) => {
      seen.push(request);
      return new Response("ok");
    },
  };
  createClient(component).registerRoutes(http, () => auth as any);
  const route = http.lookup("/api/auth/get-session", "GET")!;
  const handler = (route[0] as any)._handler as (
    ctx: unknown,
    request: Request
  ) => Promise<Response>;
  const send = async (headers: Record<string, string>) => {
    seen.length = 0;
    await handler(
      {},
      new Request(`${CONVEX_SITE}/api/auth/get-session`, {
        headers: {
          host: new URL(CONVEX_SITE).host,
          "x-forwarded-host": new URL(CONVEX_SITE).host,
          "x-forwarded-proto": "https",
          ...headers,
        },
      })
    );
    return seen[0]!.headers;
  };

  it("rewrites host and x-forwarded-* for an exactly trusted original host", async () => {
    const headers = await send({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(headers.get("host")).toBe(ADMIN_HOST);
    expect(headers.get("x-forwarded-host")).toBe(ADMIN_HOST);
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(trusted.has(ADMIN_HOST)).toBe(true);
  });

  it("leaves every header alone for an untrusted original host", async () => {
    const headers = await send({
      "x-better-auth-forwarded-host": PREVIEW_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(headers.get("host")).toBe(new URL(CONVEX_SITE).host);
    expect(headers.get("x-forwarded-host")).toBe(new URL(CONVEX_SITE).host);
  });

  it("leaves every header alone when the protocol is not http or https", async () => {
    const headers = await send({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "javascript",
    });
    expect(headers.get("host")).toBe(new URL(CONVEX_SITE).host);
  });
});
