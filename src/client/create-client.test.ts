import { afterEach, describe, expect, it, vi } from "vitest";
import { httpActionGeneric, httpRouter } from "convex/server";
import { betterAuth } from "better-auth/minimal";
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
  describe.each(["registerRoutes", "registerRoutesLazy"] as const)(
    "%s database-backed initialization",
    (register) => {
      it("initializes plugin DB reads with the request context and preserves plugin CORS origins", async () => {
        const client = createClient(component);
        const http = httpRouter();
        const createAuth = (ctx: any) =>
          betterAuth({
            baseURL: "https://deployment.convex.site",
            basePath: "/custom/auth",
            secret: "disposable-route-initialization-regression-secret",
            database: client.adapter(ctx),
            telemetry: { enabled: false },
            plugins: [
              {
                id: "database-initializer",
                init: async (context) => {
                  await context.adapter.findOne({
                    model: "user",
                    where: [{ field: "email", value: "seed@example.com" }],
                  });
                  return {
                    options: { trustedOrigins: ["https://plugin.example.com"] },
                  };
                },
              },
            ],
          });
        if (register === "registerRoutes")
          client.registerRoutes(http, createAuth, { cors: true });
        else
          client.registerRoutesLazy(http, createAuth, {
            basePath: "/custom/auth",
            cors: true,
          });
        const runQuery = vi.fn(async () => null);
        const response = await getRouteHandler(
          http,
          "/custom/auth/ok",
          "OPTIONS"
        )!._handler(
          { runQuery },
          new Request("https://deployment.convex.site/custom/auth/ok", {
            method: "OPTIONS",
            headers: {
              origin: "https://plugin.example.com",
              "access-control-request-method": "GET",
            },
          })
        );
        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe(
          "https://plugin.example.com"
        );
        expect(runQuery).toHaveBeenCalledTimes(1);
        const ok = await getRouteHandler(
          http,
          "/custom/auth/ok",
          "GET"
        )!._handler(
          { runQuery },
          new Request("https://deployment.convex.site/custom/auth/ok", {
            headers: { origin: "https://plugin.example.com" },
          })
        );
        expect(ok.status).toBe(200);
        expect(ok.headers.get("access-control-allow-origin")).toBe(
          "https://plugin.example.com"
        );
        expect(runQuery).toHaveBeenCalledTimes(2);
      });

      it("supports database-backed plugin init without CORS and propagates runtime DB failures", async () => {
        const client = createClient(component);
        const http = httpRouter();
        const createAuth = (ctx: any) =>
          betterAuth({
            baseURL: "https://deployment.convex.site",
            basePath: "/api/auth",
            secret: "disposable-route-initialization-regression-secret",
            database: client.adapter(ctx),
            telemetry: { enabled: false },
            plugins: [
              {
                id: "database-initializer",
                init: async (context) => {
                  await context.adapter.findOne({
                    model: "user",
                    where: [{ field: "email", value: "seed@example.com" }],
                  });
                },
              },
            ],
          });
        client[register](http, createAuth);
        const handler = getRouteHandler(http, "/api/auth/ok", "GET")!;
        const response = await handler._handler(
          { runQuery: async () => null },
          new Request("https://deployment.convex.site/api/auth/ok")
        );
        expect(response.status).toBe(200);
        const failure = new Error("real request database failure");
        await expect(
          handler._handler(
            {
              runQuery: async () => {
                throw failure;
              },
            },
            new Request("https://deployment.convex.site/api/auth/ok")
          )
        ).rejects.toBe(failure);
      });

      it("keeps concurrent request-dependent origins isolated", async () => {
        const client = createClient(component);
        const http = httpRouter();
        const createAuth = (ctx: any) => ({
          options: { basePath: "/api/auth" },
          $context: Promise.resolve({
            options: { trustedOrigins: async () => [await ctx.runQuery()] },
          }),
          handler: async () => new Response("ok"),
        });
        client[register](http, createAuth, { cors: true });
        const handler = getRouteHandler(http, "/api/auth/test", "OPTIONS")!;
        const response = await Promise.all(
          ["one", "two"].map(async (name) =>
            handler._handler(
              { runQuery: async () => `https://${name}.example.com` },
              new Request("https://deployment.convex.site/api/auth/test", {
                method: "OPTIONS",
                headers: {
                  origin: `https://${name}.example.com`,
                  "access-control-request-method": "GET",
                },
              })
            )
          )
        );
        expect(
          response.map((r) => r.headers.get("access-control-allow-origin"))
        ).toEqual(["https://one.example.com", "https://two.example.com"]);
        const denied = await handler._handler(
          { runQuery: async () => "https://one.example.com" },
          new Request("https://deployment.convex.site/api/auth/test", {
            method: "OPTIONS",
            headers: {
              origin: "https://untrusted.example.com",
              "access-control-request-method": "GET",
            },
          })
        );
        expect(denied.headers.has("access-control-allow-origin")).toBe(false);
      });

      it.each(["GET", "OPTIONS"] as const)(
        "propagates genuine initialization errors on %s",
        async (method) => {
          const client = createClient(component);
          const http = httpRouter();
          const failure = new Error("genuine plugin configuration failure");
          const createAuth = () => ({
            options: {},
            $context: Promise.reject(failure),
            handler: async () => new Response("must not succeed"),
          });
          client[register](http, createAuth, { cors: true });
          // Observe request-time failures before another event-loop turn.
          await expect(
            getRouteHandler(http, "/api/auth/test", method)!._handler(
              {},
              new Request("https://deployment.convex.site/api/auth/test", {
                method,
              })
            )
          ).rejects.toBe(failure);
        }
      );
    }
  );

  it.each(["wrapped", "replaced"] as const)(
    "isolates %s metadata initialization errors from real requests",
    async (kind) => {
      vi.stubEnv("CONVEX_SITE_URL", "https://deployment.convex.site");
      const client = createClient(component);
      const createAuth = (ctx: any) =>
        betterAuth({
          baseURL: "https://deployment.convex.site",
          secret: "disposable-route-initialization-regression-secret",
          database: client.adapter(ctx),
          telemetry: { enabled: false },
          plugins: [
            {
              id: "wrapped-database-initializer",
              init: async (context) => {
                try {
                  await context.adapter.findOne({
                    model: "user",
                    where: [{ field: "email", value: "seed@example.com" }],
                  });
                } catch (cause) {
                  throw kind === "wrapped"
                    ? Object.assign(new Error("plugin initialization failed"), {
                        cause,
                      })
                    : new Error("plugin initialization failed");
                }
              },
            },
          ],
        });
      for (const cors of [false, true]) {
        const http = httpRouter();
        const runQuery = vi.fn(async () => null);
        client.registerRoutes(http, createAuth, { cors });
        // Allow the discarded metadata initialization to reject before requests.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(runQuery).not.toHaveBeenCalled();
        const cases = [
          { path: "/api/auth/ok", method: "GET" as const, status: 200 },
          { path: "/api/auth/sign-out", method: "POST" as const, status: 200 },
          {
            path: "/.well-known/openid-configuration",
            method: "GET" as const,
            status: 302,
          },
          ...(cors
            ? [
                {
                  path: "/api/auth/ok",
                  method: "OPTIONS" as const,
                  status: 204,
                },
              ]
            : []),
        ];
        for (const { path, method, status } of cases) {
          const request = () =>
            new Request(`https://deployment.convex.site${path}`, {
              method,
              headers: { origin: "https://deployment.convex.site" },
            });
          const handler = getRouteHandler(http, path, method)!;
          expect((await handler._handler({ runQuery }, request())).status).toBe(
            status
          );
          const failure = new Error("real request database failure");
          await expect(
            handler._handler(
              {
                runQuery: async () => {
                  throw failure;
                },
              },
              request()
            )
          ).rejects.toMatchObject({
            message: "plugin initialization failed",
            ...(kind === "wrapped" ? { cause: failure } : {}),
          });
        }
      }
    }
  );

  it("does not wait for a pending metadata probe before serving requests", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://deployment.convex.site");
    const client = createClient(component);
    const http = httpRouter();
    let releaseProbe!: () => void;
    let probeStarted!: () => void;
    const probe = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const started = new Promise<void>((resolve) => {
      probeStarted = resolve;
    });
    const createAuth = (ctx: any) =>
      betterAuth({
        baseURL: "https://deployment.convex.site",
        secret: "disposable-route-initialization-regression-secret",
        database: client.adapter(ctx),
        telemetry: { enabled: false },
        plugins: [
          {
            id: "pending-metadata-initializer",
            init: async () => {
              if (!ctx.requestContext) {
                probeStarted();
                await probe;
              }
            },
          },
        ],
      });
    client.registerRoutes(http, createAuth, { cors: true });
    try {
      await started;
      for (const [path, method, status] of [
        ["/api/auth/ok", "GET", 200],
        ["/api/auth/sign-out", "POST", 200],
        ["/api/auth/ok", "OPTIONS", 204],
        ["/.well-known/openid-configuration", "GET", 302],
      ] as const) {
        let timer!: ReturnType<typeof setTimeout>;
        try {
          const response = await Promise.race([
            getRouteHandler(http, path, method)!._handler(
              { requestContext: true },
              new Request(`https://deployment.convex.site${path}`, {
                method,
                headers: { origin: "https://deployment.convex.site" },
              })
            ),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("request waited for metadata")),
                1000
              );
            }),
          ]);
          expect(response.status).toBe(status);
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      releaseProbe();
    }
  });

  it("propagates synchronous route-registration errors", () => {
    const client = createClient(component);
    const failure = new Error("synchronous configuration failure");
    expect(() =>
      client.registerRoutes(httpRouter(), () => {
        throw failure;
      })
    ).toThrow(failure);
  });

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
    expect(createAuth).toHaveBeenCalledTimes(2);

    const getHandler = getRouteHandler(http, "/custom/auth/test", "GET");
    expect(getHandler).toBeTruthy();
    await getHandler!._handler(
      {},
      new Request("https://deployment.convex.site/custom/auth/test", {
        method: "GET",
      })
    );
    expect(createAuth).toHaveBeenCalledTimes(3);
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
