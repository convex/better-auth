import { afterEach, describe, expect, it, vi } from "vitest";
import { httpRouter } from "convex/server";
import { createClient } from "./create-client.js";
import type { TrustedOriginsOption } from "../utils/index.js";

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

const getRouteHandler = (
  http: ReturnType<typeof httpRouter>,
  path: string,
  method: "GET" | "POST" | "OPTIONS"
) => {
  const route = http.lookup(path, method);
  if (!route) {
    return null;
  }
  return route[0] as unknown as {
    _handler: (ctx: unknown, request: Request) => Promise<Response>;
  };
};

describe("createClient route registration", () => {
  it("registerRoutes eagerly initializes auth and infers basePath", () => {
    const client = createClient(component);
    const http = httpRouter();
    const createAuth = vi.fn(() => ({
      handler: async () => new Response("ok"),
      options: {
        basePath: "/custom/auth",
        trustedOrigins: ["https://app.example.com"],
      },
      $context: Promise.resolve({
        options: {
          trustedOrigins: ["https://app.example.com"],
        },
      }),
    }));

    client.registerRoutes(http, createAuth);

    expect(createAuth).toHaveBeenCalledTimes(1);
    expect(getRouteHandler(http, "/custom/auth/test", "GET")).toBeTruthy();
    expect(
      getRouteHandler(http, "/.well-known/openid-configuration", "GET")
    ).toBeTruthy();
  });

  it("registerRoutes uses auth options for CORS and basePath", async () => {
    const client = createClient(component);
    const http = httpRouter();
    const createAuth = vi.fn(() => ({
      handler: async () => new Response("ok"),
      options: {
        basePath: "/custom/auth",
        trustedOrigins: ["https://app.example.com"],
      },
      $context: Promise.resolve({
        options: {
          trustedOrigins: ["https://app.example.com"],
        },
      }),
    }));

    client.registerRoutes(http, createAuth, { cors: true });

    expect(createAuth).toHaveBeenCalledTimes(1);
    expect(getRouteHandler(http, "/custom/auth/test", "GET")).toBeTruthy();
    expect(getRouteHandler(http, "/custom/auth/test", "OPTIONS")).toBeTruthy();

    const optionsHandler = getRouteHandler(
      http,
      "/custom/auth/test",
      "OPTIONS"
    );
    expect(optionsHandler).toBeTruthy();
    const response = await optionsHandler!._handler(
      {},
      new Request("https://deployment.convex.site/custom/auth/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
        },
      })
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com"
    );
    expect(createAuth).toHaveBeenCalledTimes(1);

    const getHandler = getRouteHandler(http, "/custom/auth/test", "GET");
    expect(getHandler).toBeTruthy();
    await getHandler!._handler(
      {},
      new Request("https://deployment.convex.site/custom/auth/test", {
        method: "GET",
      })
    );
    expect(createAuth).toHaveBeenCalledTimes(2);
  });

  describe("request origin normalization", () => {
    const SITE = "https://deployment.convex.site";

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    const callHandler = async (
      trustedOrigins: TrustedOriginsOption,
      headers: Record<string, string>,
      init: { url?: string; method?: "GET" | "POST"; body?: string } = {}
    ) => {
      const client = createClient(component);
      const http = httpRouter();
      const handler = vi.fn(async (_request: Request) => new Response("ok"));
      const createAuth = vi.fn(() => ({
        handler,
        options: { trustedOrigins },
        $context: Promise.resolve({ options: { trustedOrigins } }),
      }));
      client.registerRoutes(http, createAuth);
      const method = init.method ?? "GET";
      const getHandler = getRouteHandler(http, "/api/auth/test", method);
      expect(getHandler).toBeTruthy();
      await getHandler!._handler(
        {},
        new Request(init.url ?? `${SITE}/api/auth/test?x=1`, {
          method,
          headers: { host: "deployment.convex.site", ...headers },
          body: init.body,
        })
      );
      const forwarded = handler.mock.calls[0]?.[0] as Request;
      expect(forwarded).toBeInstanceOf(Request);
      return forwarded;
    };

    const originOf = (request: Request) => ({
      url: request.url,
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
    });

    it("restores an original origin that is exactly trusted", async () => {
      const request = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
        "x-better-auth-forwarded-host": "app.example.com",
        "x-better-auth-forwarded-proto": "https",
      });
      expect(originOf(request)).toEqual({
        url: "https://app.example.com/api/auth/test?x=1",
        host: "app.example.com",
        forwardedHost: "app.example.com",
        forwardedProto: "https",
      });
      expect(request.headers.get("x-better-auth-forwarded-host")).toBeNull();
      expect(request.headers.get("x-better-auth-forwarded-proto")).toBeNull();
    });

    it("rejects an http scheme for a host trusted only over https", async () => {
      vi.stubEnv("CONVEX_SITE_URL", SITE);
      const request = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
        "x-better-auth-forwarded-host": "app.example.com",
        "x-better-auth-forwarded-proto": "http",
      });
      expect(originOf(request)).toEqual({
        url: `${SITE}/api/auth/test?x=1`,
        host: "deployment.convex.site",
        forwardedHost: "deployment.convex.site",
        forwardedProto: "https",
      });
    });

    it("accepts an http scheme when that origin is trusted", async () => {
      const request = await callHandler(
        ["https://app.example.com", "http://app.example.com"],
        {
          "x-better-auth-forwarded-host": "app.example.com",
          "x-better-auth-forwarded-proto": "http",
        }
      );
      expect(originOf(request)).toEqual({
        url: "http://app.example.com/api/auth/test?x=1",
        host: "app.example.com",
        forwardedHost: "app.example.com",
        forwardedProto: "http",
      });
    });

    it("ignores an original host that only matches a wildcard", async () => {
      vi.stubEnv("CONVEX_SITE_URL", SITE);
      const request = await callHandler(
        ["https://app.example.com", "https://*.previews.example.app"],
        {
          "x-better-auth-forwarded-host": "branch.previews.example.app",
          "x-better-auth-forwarded-proto": "https",
        }
      );
      expect(originOf(request).url).toBe(`${SITE}/api/auth/test?x=1`);
    });

    it("ignores a trusted original host without a valid protocol", async () => {
      vi.stubEnv("CONVEX_SITE_URL", SITE);
      const request = await callHandler(["https://app.example.com"], {
        "x-better-auth-forwarded-host": "app.example.com",
      });
      expect(originOf(request).host).toBe("deployment.convex.site");
    });

    it("ignores an original host that smuggles a path or userinfo", async () => {
      vi.stubEnv("CONVEX_SITE_URL", SITE);
      for (const host of [
        "app.example.com/evil",
        "app.example.com?x",
        "user@app.example.com",
        "app.example.com#f",
      ]) {
        const request = await callHandler(["https://app.example.com"], {
          "x-better-auth-forwarded-host": host,
          "x-better-auth-forwarded-proto": "https",
        });
        expect(originOf(request).host, host).toBe("deployment.convex.site");
      }
    });

    it("replaces client-sent host and x-forwarded-* with the site URL", async () => {
      // The self-hosted backend passes these through and builds request.url
      // from them, so none of them can be trusted on their own.
      vi.stubEnv("CONVEX_SITE_URL", SITE);
      const request = await callHandler(
        ["https://app.example.com"],
        {
          host: "evil.example",
          "x-forwarded-host": "evil2.example",
          "x-forwarded-proto": "http",
        },
        { url: "http://evil2.example/api/auth/test?x=1" }
      );
      expect(originOf(request)).toEqual({
        url: `${SITE}/api/auth/test?x=1`,
        host: "deployment.convex.site",
        forwardedHost: "deployment.convex.site",
        forwardedProto: "https",
      });
    });

    it("keeps the request's own origin when it is exactly trusted", async () => {
      vi.stubEnv("CONVEX_SITE_URL", SITE);
      const request = await callHandler(
        ["https://auth.example.com"],
        { host: "auth.example.com" },
        { url: "https://auth.example.com/api/auth/test?x=1" }
      );
      expect(originOf(request)).toEqual({
        url: "https://auth.example.com/api/auth/test?x=1",
        host: "auth.example.com",
        forwardedHost: "auth.example.com",
        forwardedProto: "https",
      });
    });

    it("keeps the request's own origin without a site URL", async () => {
      vi.stubEnv("CONVEX_SITE_URL", "");
      const request = await callHandler([], {
        "x-forwarded-host": "other.example",
        "x-forwarded-proto": "http",
      });
      expect(originOf(request)).toEqual({
        url: `${SITE}/api/auth/test?x=1`,
        host: "deployment.convex.site",
        forwardedHost: "deployment.convex.site",
        forwardedProto: "https",
      });
    });

    it("preserves method, body and other headers", async () => {
      const request = await callHandler(
        ["https://app.example.com"],
        {
          "content-type": "application/json",
          cookie: "a=b",
          "x-better-auth-forwarded-host": "app.example.com",
          "x-better-auth-forwarded-proto": "https",
        },
        { method: "POST", body: JSON.stringify({ email: "a@b.co" }) }
      );
      expect(request.method).toBe("POST");
      expect(request.headers.get("cookie")).toBe("a=b");
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(await request.json()).toEqual({ email: "a@b.co" });
    });

    it("honors exact origins returned by a trustedOrigins function", async () => {
      const request = await callHandler(
        (request?: Request) =>
          request?.headers.get("x-test-tenant") === "acme"
            ? ["https://acme.example.com"]
            : [],
        {
          "x-test-tenant": "acme",
          "x-better-auth-forwarded-host": "acme.example.com",
          "x-better-auth-forwarded-proto": "https",
        }
      );
      expect(originOf(request).host).toBe("acme.example.com");
    });
  });

  it("registerRoutesLazy resolves trustedOrigins lazily when needed", async () => {
    const client = createClient(component);
    const http = httpRouter();
    const createAuth = vi.fn(() => ({
      handler: async () => new Response("ok"),
      options: {
        trustedOrigins: ["https://fallback.example.com"],
      },
      $context: Promise.resolve({
        options: {
          trustedOrigins: ["https://fallback.example.com"],
        },
      }),
    }));

    client.registerRoutesLazy(http, createAuth, { cors: true });
    expect(createAuth).not.toHaveBeenCalled();
    expect(getRouteHandler(http, "/api/auth/test", "GET")).toBeTruthy();

    const optionsHandler = getRouteHandler(http, "/api/auth/test", "OPTIONS");
    expect(optionsHandler).toBeTruthy();
    const response = await optionsHandler!._handler(
      {},
      new Request("https://deployment.convex.site/api/auth/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://fallback.example.com",
          "access-control-request-method": "GET",
        },
      })
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://fallback.example.com"
    );
    expect(createAuth).toHaveBeenCalledTimes(1);
  });
});
