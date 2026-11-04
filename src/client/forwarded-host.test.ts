import { afterEach, describe, expect, it, vi } from "vitest";
import { httpRouter } from "convex/server";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import type { BetterAuthOptions } from "better-auth";
import { createClient } from "./create-client.js";

// End-to-end: a dynamic baseURL with a wildcard in allowedHosts, requests
// arriving through registerRoutes the way Convex delivers them. The emailed
// password reset link shows which origin Better Auth resolved.
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

const setup = async (advanced?: BetterAuthOptions["advanced"]) => {
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
    advanced,
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

  // `origin` is what the request arrives as: on Convex Cloud the edge sets
  // the URL, host and x-forwarded-* to the deployment; a self-hosted backend
  // builds them from whatever the client sent.
  const requestReset = async (
    headers: Record<string, string>,
    origin = CONVEX_SITE
  ) => {
    resetUrl = "";
    const response = await handler(
      {},
      new Request(`${origin}/api/auth/request-password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: new URL(origin).host,
          "x-forwarded-host": new URL(origin).host,
          "x-forwarded-proto": new URL(origin).protocol.slice(0, -1),
          ...headers,
        },
        body: JSON.stringify({ email: "victim@example.com" }),
      })
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(resetUrl).not.toBe("");
    return new URL(resetUrl);
  };
  return { requestReset };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("forwarded origin with dynamic baseURL (proxy headers trusted)", async () => {
  // Better Auth 1.6 trusts x-forwarded-* by default in dynamic mode.
  const { requestReset } = await setup();

  it("builds links from the fallback with no original host", async () => {
    expect((await requestReset({})).host).toBe(APP_HOST);
  });

  it("uses an exactly listed original origin", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.origin).toBe(`https://${ADMIN_HOST}`);
  });

  it("ignores an original host that only matches a wildcard", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": PREVIEW_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.host).toBe(APP_HOST);
  });

  it("does not downgrade an exactly listed host to http", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "http",
    });
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe(APP_HOST);
  });

  it("ignores client-sent x-forwarded-* on a self-hosted backend", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({}, `https://${PREVIEW_HOST}`);
    expect(url.host).toBe(APP_HOST);
  });
});

describe("forwarded origin with dynamic baseURL (proxy headers not trusted)", async () => {
  // Better Auth 1.7's default: the host header and request URL are used.
  const { requestReset } = await setup({ trustedProxyHeaders: false });

  it("uses an exactly listed original origin", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.origin).toBe(`https://${ADMIN_HOST}`);
  });

  it("ignores a client-sent Host that matches a wildcard", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({}, `https://${PREVIEW_HOST}`);
    expect(url.host).toBe(APP_HOST);
  });

  it("does not downgrade an exactly listed host to http", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({}, `http://${ADMIN_HOST}`);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe(APP_HOST);
  });
});
