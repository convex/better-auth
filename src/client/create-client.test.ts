import { afterEach, describe, expect, it, vi } from "vitest";
import { httpActionGeneric, httpRouter } from "convex/server";
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
  afterEach(() => vi.unstubAllEnvs());

  describe.each(["registerRoutes", "registerRoutesLazy"] as const)(
    "%s discovery",
    (register) => {
      it.each([
        [undefined, false, "/api/auth/convex/.well-known/openid-configuration"],
        [undefined, true, "/api/auth/.well-known/openid-configuration"],
        ["/custom/auth", true, "/custom/auth/.well-known/openid-configuration"],
        [
          "/custom/auth",
          false,
          "/custom/auth/convex/.well-known/openid-configuration",
        ],
      ])(
        "redirects basePath=%s provider=%s",
        async (basePath, provider, target) => {
          vi.stubEnv("CONVEX_SITE_URL", "https://deployment.convex.site");
          const client = createClient(component);
          const http = httpRouter();
          const createAuth = vi.fn(() => ({
            handler: async (request: Request) =>
              new URL(request.url).pathname === target
                ? Response.json({ issuer: "https://deployment.convex.site" })
                : new Response(null, { status: 404 }),
            options: {
              basePath,
              plugins: provider ? [{ id: "oauth-provider" }] : [],
            },
            $context: Promise.resolve({ options: {} }),
          }));
          if (register === "registerRoutesLazy") {
            client.registerRoutesLazy(http, createAuth, { basePath });
            expect(createAuth).not.toHaveBeenCalled();
          } else {
            client.registerRoutes(http, createAuth);
          }
          const root =
            "https://deployment.convex.site/.well-known/openid-configuration";
          const redirect = await getRouteHandler(
            http,
            new URL(root).pathname,
            "GET"
          )!._handler({}, new Request(root));
          expect(redirect.status).toBe(302);
          const location = redirect.headers.get("location")!;
          expect(location).toBe(`https://deployment.convex.site${target}`);
          const response = await getRouteHandler(
            http,
            new URL(location).pathname,
            "GET"
          )!._handler({}, new Request(location));
          expect(response.status).toBe(200);
        }
      );

      it("preserves an application-defined discovery route", async () => {
        const client = createClient(component);
        const http = httpRouter();
        http.route({
          path: "/.well-known/openid-configuration",
          method: "GET",
          handler: httpActionGeneric(async () =>
            Response.json({ custom: true })
          ),
        });
        const createAuth = vi.fn(() => ({
          handler: async () => new Response(null, { status: 404 }),
          options: { plugins: [{ id: "oauth-provider" }] },
          $context: Promise.resolve({ options: {} }),
        }));
        client[register](http, createAuth);
        const response = await getRouteHandler(
          http,
          "/.well-known/openid-configuration",
          "GET"
        )!._handler(
          {},
          new Request(
            "https://deployment.convex.site/.well-known/openid-configuration"
          )
        );
        expect(await response.json()).toEqual({ custom: true });
      });
    }
  );
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

  describe("forwarded host restore", () => {
    const callHandler = async (
      trustedOrigins: TrustedOriginsOption,
      headers: Record<string, string>
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
      const getHandler = getRouteHandler(http, "/api/auth/test", "GET");
      expect(getHandler).toBeTruthy();
      await getHandler!._handler(
        {},
        new Request("https://deployment.convex.site/api/auth/test", {
          method: "GET",
          headers: { host: "deployment.convex.site", ...headers },
        })
      );
      const forwarded = handler.mock.calls[0]?.[0] as Request;
      expect(forwarded).toBeInstanceOf(Request);
      return forwarded.headers;
    };

    it("restores the original host when it is an exact trusted origin", async () => {
      const headers = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
        "x-better-auth-forwarded-host": "app.example.com",
        "x-better-auth-forwarded-proto": "https",
      });
      expect(headers.get("x-forwarded-host")).toBe("app.example.com");
      expect(headers.get("x-forwarded-proto")).toBe("https");
    });

    it("ignores the original host when it only matches a wildcard", async () => {
      const headers = await callHandler(
        ["https://app.example.com", "https://*.previews.example.app"],
        {
          "x-forwarded-host": "deployment.convex.site",
          "x-forwarded-proto": "https",
          "x-better-auth-forwarded-host": "branch.previews.example.app",
          "x-better-auth-forwarded-proto": "https",
        }
      );
      expect(headers.get("x-forwarded-host")).toBe("deployment.convex.site");
      expect(headers.get("x-forwarded-proto")).toBe("https");
    });

    it("ignores a trusted original host without a valid protocol", async () => {
      const headers = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
        "x-better-auth-forwarded-host": "app.example.com",
      });
      expect(headers.get("x-forwarded-host")).toBe("deployment.convex.site");
      expect(headers.get("x-forwarded-proto")).toBe("https");
    });

    it("leaves incoming x-forwarded-* headers as they arrived", async () => {
      const headers = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
      });
      expect(headers.get("x-forwarded-host")).toBe("deployment.convex.site");
      expect(headers.get("x-forwarded-proto")).toBe("https");
    });

    it("honors exact origins returned by a trustedOrigins function", async () => {
      const headers = await callHandler(
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
      expect(headers.get("x-forwarded-host")).toBe("acme.example.com");
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
