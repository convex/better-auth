import {
  httpActionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  FunctionReference,
  GenericDataModel,
  GenericMutationCtx,
  GenericSchema,
  HttpRouter,
  SchemaDefinition,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import { convexAdapter } from "./adapter.js";
import { corsRouter } from "convex-helpers/server/cors";
import type defaultSchema from "../component/schema.js";
import type { CreateAuth, GenericCtx } from "./index.js";
import type { TrustedOriginsOption } from "../utils/index.js";

export type AuthFunctions = {
  onCreate?: FunctionReference<"mutation", "internal", { [key: string]: any }>;
  onUpdate?: FunctionReference<"mutation", "internal", { [key: string]: any }>;
  onDelete?: FunctionReference<"mutation", "internal", { [key: string]: any }>;
};

export type Triggers<
  DataModel extends GenericDataModel,
  Schema extends SchemaDefinition<any, any>,
> = {
  [K in keyof Schema["tables"]]?: {
    onCreate?: <Ctx extends GenericMutationCtx<DataModel>>(
      ctx: Ctx,
      doc: Infer<Schema["tables"][K]["validator"]> & {
        _id: string;
        _creationTime: number;
      }
    ) => Promise<void>;
    onUpdate?: <Ctx extends GenericMutationCtx<DataModel>>(
      ctx: Ctx,
      newDoc: Infer<Schema["tables"][K]["validator"]> & {
        _id: string;
        _creationTime: number;
      },
      oldDoc: Infer<Schema["tables"][K]["validator"]> & {
        _id: string;
        _creationTime: number;
      }
    ) => Promise<void>;
    onDelete?: <Ctx extends GenericMutationCtx<DataModel>>(
      ctx: Ctx,
      doc: Infer<Schema["tables"][K]["validator"]> & {
        _id: string;
        _creationTime: number;
      }
    ) => Promise<void>;
  };
};

type SlimComponentApi = {
  adapter: {
    create: FunctionReference<"mutation", "internal">;
    findOne: FunctionReference<"query", "internal">;
    findMany: FunctionReference<"query", "internal">;
    updateOne: FunctionReference<"mutation", "internal">;
    updateMany: FunctionReference<"mutation", "internal">;
    deleteOne: FunctionReference<"mutation", "internal">;
    deleteMany: FunctionReference<"mutation", "internal">;
    consumeOne: FunctionReference<"mutation", "internal">;
    incrementOne: FunctionReference<"mutation", "internal">;
  };
};

type RouteCorsOptions =
  | boolean
  | {
      allowedOrigins?: string[];
      allowedHeaders?: string[];
      exposedHeaders?: string[];
    };

type RegisterRoutesLazyOptions = {
  basePath?: string;
  trustedOrigins?: TrustedOriginsOption;
  cors?: RouteCorsOptions;
};

// Origins the app trusts exactly: non-wildcard http(s) entries in
// trustedOrigins, plus what Better Auth derives from a dynamic baseURL's
// allowedHosts and fallback (ctx.trustedOrigins). Origins are compared as
// scheme + host, so an https-only origin is never trusted over http.
const exactTrustedOrigins = async (
  auth: {
    $context: Promise<{
      trustedOrigins?: string[];
      options: { trustedOrigins?: unknown };
    }>;
  },
  request: Request
) => {
  const ctx = await auth.$context;
  const origins: unknown[] = [...(ctx.trustedOrigins ?? [])];
  if (Array.isArray(ctx.options.trustedOrigins)) {
    origins.push(...ctx.options.trustedOrigins);
  } else if (typeof ctx.options.trustedOrigins === "function") {
    const resolved = await ctx.options.trustedOrigins(request);
    if (Array.isArray(resolved)) {
      origins.push(...resolved);
    }
  }
  const trusted = new Set<string>();
  for (const origin of origins) {
    if (typeof origin !== "string" || origin.includes("*")) {
      continue;
    }
    const parsed = parseHttpOrigin(origin);
    if (parsed) {
      trusted.add(parsed);
    }
  }
  return trusted;
};

// Normalized `scheme://host` for an http(s) URL or origin string, or null.
const parseHttpOrigin = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
};

// The origin a `proto` + `host` header pair claims, or null when it isn't a
// bare http(s) origin (no userinfo, path, query or fragment smuggled in).
const forwardedOrigin = (proto: string | null, host: string | null) => {
  if (!host || (proto !== "http" && proto !== "https")) {
    return null;
  }
  try {
    const url = new URL(`${proto}://${host}`);
    return url.href === `${url.origin}/` ? url.origin : null;
  } catch {
    return null;
  }
};

// The component sits in front of Better Auth as its reverse proxy, so it
// decides which origin Better Auth sees. On every request the URL, `host`,
// `x-forwarded-host` and `x-forwarded-proto` are all set to one origin, in
// this order of preference:
//
// 1. The browser-facing origin a framework proxy handler sent in
//    x-better-auth-forwarded-host/-proto, when scheme and host together form
//    an origin the app trusts exactly.
// 2. The request's own origin, when the app trusts it exactly (a custom
//    domain listed in trustedOrigins or allowedHosts).
// 3. The deployment's own site URL, which only the deployment config
//    controls. On Convex Cloud the edge already sets the forwarded headers
//    and request URL to this; the self-hosted backend passes a client's
//    `Host` and x-forwarded-* through and builds `request.url` from them,
//    so they can't be trusted on their own.
//
// Better Auth reads whichever of these its version and config call for:
// x-forwarded-* with `trustedProxyHeaders`, `host` for a dynamic baseURL
// without it, and the request URL otherwise. Setting all of them keeps the
// result the same across those modes, and the same as a direct deploy at
// the trusted origin.
const normalizeRequestOrigin = (
  request: Request,
  trustedOrigins: Set<string>
) => {
  const url = new URL(request.url);
  const fromProxyHandler = forwardedOrigin(
    request.headers.get("x-better-auth-forwarded-proto"),
    request.headers.get("x-better-auth-forwarded-host")
  );
  const ownOrigin = parseHttpOrigin(url.origin);
  const siteOrigin = process.env.CONVEX_SITE_URL
    ? parseHttpOrigin(process.env.CONVEX_SITE_URL)
    : null;
  const origin =
    (fromProxyHandler && trustedOrigins.has(fromProxyHandler)
      ? fromProxyHandler
      : null) ??
    (ownOrigin && trustedOrigins.has(ownOrigin) ? ownOrigin : null) ??
    siteOrigin ??
    ownOrigin;
  if (!origin) {
    return request;
  }
  const target = new URL(origin);
  const headers = new Headers(request.headers);
  headers.set("host", target.host);
  headers.set("x-forwarded-host", target.host);
  headers.set("x-forwarded-proto", target.protocol.slice(0, -1));
  headers.delete("x-better-auth-forwarded-host");
  headers.delete("x-better-auth-forwarded-proto");
  return new Request(`${origin}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: request.body,
    // @ts-expect-error - duplex is required for streaming request bodies in modern fetch
    duplex: "half",
  });
};

/**
 * Backend API for the Better Auth component.
 * Responsible for exposing the `client` and `triggers` APIs to the client, http
 * route registration, and having convenience methods for interacting with the
 * component from the backend.
 *
 * @param component - Generally `components.betterAuth` from
 * `./_generated/api` once you've configured it in `convex.config.ts`.
 * @param config - Configuration options for the component.
 * @param config.local - Local schema configuration.
 * @param config.verbose - Whether to enable verbose logging.
 * @param config.triggers - Triggers configuration.
 * @param config.authFunctions - Authentication functions configuration.
 */
// Verbose logs end up in the Convex dashboard and log streams, and get pasted
// into issues. Keep credentials (session cookies, bearer tokens, JWTs, API
// keys) out of them.
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "better-auth-cookie",
  "set-better-auth-cookie",
  "set-auth-token",
  "set-auth-jwt",
  "x-api-key",
]);
// Redirects carry one-time tokens, OAuth codes and state in the query string
const redactQuery = (value: string) => {
  const queryStart = value.indexOf("?");
  return queryStart === -1 ? value : `${value.slice(0, queryStart)}?[redacted]`;
};
const redactHeaders = (headers: Headers) =>
  Array.from(headers.entries()).map(([name, value]) => [
    name,
    SENSITIVE_HEADERS.has(name)
      ? "[redacted]"
      : name === "location" || name === "referer"
        ? redactQuery(value)
        : value,
  ]);

export const createClient = <
  DataModel extends GenericDataModel,
  Schema extends SchemaDefinition<GenericSchema, true> = typeof defaultSchema,
  Api extends SlimComponentApi = SlimComponentApi,
>(
  component: Api,
  config?: {
    local?: {
      schema?: Schema;
    };
    verbose?: boolean;
  } & (
    | {
        triggers: Triggers<DataModel, Schema>;
        authFunctions: AuthFunctions;
      }
    | { triggers?: undefined }
  )
) => {
  type BetterAuthDataModel = DataModelFromSchemaDefinition<Schema>;

  const safeGetAuthUser = async (ctx: GenericCtx<DataModel>) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return;
    }
    const session = (await ctx.runQuery(component.adapter.findOne, {
      model: "session",
      where: [
        {
          field: "_id",
          value: identity.sessionId as string,
        },
        {
          field: "expiresAt",
          operator: "gt",
          value: new Date().getTime(),
        },
      ],
    })) as BetterAuthDataModel["session"]["document"] | null;

    if (!session) {
      return;
    }

    const doc = (await ctx.runQuery(component.adapter.findOne, {
      model: "user",
      where: [
        {
          field: "_id",
          value: identity.subject,
        },
      ],
    })) as BetterAuthDataModel["user"]["document"] | null;
    if (!doc) {
      return;
    }
    return doc;
  };

  const getAuthUser = async (ctx: GenericCtx<DataModel>) => {
    const user = await safeGetAuthUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthenticated");
    }
    return user;
  };

  const getHeaders = async (ctx: GenericCtx<DataModel>) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Headers();
    }
    // Don't validate the session here, let Better Auth handle that
    const session = await ctx.runQuery(component.adapter.findOne, {
      model: "session",
      where: [
        {
          field: "_id",
          value: identity.sessionId as string,
        },
      ],
    });
    return new Headers({
      ...(session?.token ? { authorization: `Bearer ${session.token}` } : {}),
      ...(session?.ipAddress
        ? { "x-forwarded-for": session.ipAddress as string }
        : {}),
    });
  };

  return {
    /**
     * Returns the Convex database adapter for use in Better Auth options.
     * @param ctx - The Convex context
     * @returns The Convex database adapter
     */
    adapter: (ctx: GenericCtx<DataModel>) =>
      convexAdapter<DataModel, typeof ctx, Schema>(ctx, component, {
        ...config,
        debugLogs: config?.verbose,
      }),

    /**
     * Returns the Better Auth auth object and headers for using Better Auth API
     * methods directly in a Convex mutation or query. Convex functions don't
     * have access to request headers, so the headers object is created at
     * runtime with the token for the current session as a Bearer token.
     *
     * @param createAuth - The createAuth function
     * @param ctx - The Convex context
     * @returns A promise that resolves to the Better Auth `auth` API object and
     * headers.
     */
    getAuth: async <T extends CreateAuth<DataModel>>(
      createAuth: T,
      ctx: GenericCtx<DataModel>
    ) => ({
      auth: createAuth(ctx) as ReturnType<T>,
      headers: await getHeaders(ctx),
    }),

    /**
     * Returns a Headers object for the current session using the session id
     * from the current user identity via `ctx.auth.getUserIdentity()`. This is
     * used to pass the headers to the Better Auth API methods when using the
     * `getAuth` method.
     *
     * @param ctx - The Convex context
     * @returns The headers
     */
    getHeaders,

    /**
     * Returns the current user or null if the user is not found
     * @param ctx - The Convex context
     * @returns The user or null if the user is not found
     */
    safeGetAuthUser,

    /**
     * Returns the current user or throws an error if the user is not found
     *
     * @param ctx - The Convex context
     * @returns The user or throws an error if the user is not found
     */
    getAuthUser,

    /**
     * Returns a user by their Better Auth user id.
     * @param ctx - The Convex context
     * @param id - The Better Auth user id
     * @returns The user or null if the user is not found
     */
    getAnyUserById: async (ctx: GenericCtx<DataModel>, id: string) => {
      return (await ctx.runQuery(component.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: id }],
      })) as BetterAuthDataModel["user"]["document"] | null;
    },

    /**
     * Replaces 0.7 behavior of returning a new user id from
     * onCreateUser
     * @param ctx - The Convex context
     * @param authId - The Better Auth user id
     * @param userId - The app user id
     * @deprecated in 0.9
     */
    setUserId: async (
      ctx: GenericMutationCtx<DataModel>,
      authId: string,
      userId: string
    ) => {
      await ctx.runMutation(component.adapter.updateOne, {
        input: {
          model: "user",
          where: [{ field: "_id", value: authId }],
          update: { userId },
        },
      });
    },

    /**
     * Exposes functions for use with the ClientAuthBoundary component. Currently
     * only contains getAuthUser.
     * @returns Functions to pass to the ClientAuthBoundary component.
     */
    clientApi: () => ({
      /**
       * Convex query to get the current user. For use with the ClientAuthBoundary component.
       *
       * ```ts title="convex/auth.ts"
       * export const { getAuthUser } = authComponent.clientApi();
       * ```
       *
       * @returns The user or throws an error if the user is not found
       */
      getAuthUser: queryGeneric({
        args: {},
        handler: async (ctx: GenericCtx<DataModel>) => {
          return await getAuthUser(ctx);
        },
      }),
    }),

    /**
     * Exposes functions for executing trigger callbacks in the app context.
     *
     * Callbacks are defined in the `triggers` option to the component client config.
     *
     * See {@link createClient} for more information.
     *
     * @returns Functions to execute trigger callbacks in the app context.
     */
    triggersApi: () => ({
      onCreate: internalMutationGeneric({
        args: {
          doc: v.any(),
          model: v.string(),
        },
        handler: async (ctx, args) => {
          await config?.triggers?.[args.model]?.onCreate?.(ctx, args.doc);
        },
      }),
      onUpdate: internalMutationGeneric({
        args: {
          oldDoc: v.any(),
          newDoc: v.any(),
          model: v.string(),
        },
        handler: async (ctx, args) => {
          await config?.triggers?.[args.model]?.onUpdate?.(
            ctx,
            args.newDoc,
            args.oldDoc
          );
        },
      }),
      onDelete: internalMutationGeneric({
        args: {
          doc: v.any(),
          model: v.string(),
        },
        handler: async (ctx, args) => {
          await config?.triggers?.[args.model]?.onDelete?.(ctx, args.doc);
        },
      }),
    }),

    registerRoutes: (
      http: HttpRouter,
      createAuth: CreateAuth<DataModel>,
      opts: {
        cors?:
          | boolean
          | {
              // These values are appended to the default values
              allowedOrigins?: string[];
              allowedHeaders?: string[];
              exposedHeaders?: string[];
            };
      } = {}
    ) => {
      const staticAuth = createAuth({} as any);
      const path = staticAuth.options.basePath ?? "/api/auth";
      const authRequestHandler = httpActionGeneric(async (ctx, request) => {
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("options.baseURL", staticAuth.options.baseURL);
          // eslint-disable-next-line no-console
          console.log("request headers", redactHeaders(request.headers));
        }
        const auth = createAuth(ctx as any);
        const normalizedRequest = normalizeRequestOrigin(
          request,
          await exactTrustedOrigins(auth, request)
        );
        const response = await auth.handler(normalizedRequest);
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("response headers", redactHeaders(response.headers));
        }
        return response;
      });
      const wellKnown = http.lookup("/.well-known/openid-configuration", "GET");

      // If registerRoutes is used multiple times, this may already be defined
      if (!wellKnown) {
        // Redirect root well-known to api well-known
        http.route({
          path: "/.well-known/openid-configuration",
          method: "GET",
          handler: httpActionGeneric(async () => {
            const url = `${process.env.CONVEX_SITE_URL}${path}/convex/.well-known/openid-configuration`;
            return Response.redirect(url);
          }),
        });
      }

      if (!opts.cors) {
        http.route({
          pathPrefix: `${path}/`,
          method: "GET",
          handler: authRequestHandler,
        });

        http.route({
          pathPrefix: `${path}/`,
          method: "POST",
          handler: authRequestHandler,
        });

        return;
      }
      const corsOpts =
        typeof opts.cors === "boolean"
          ? { allowedOrigins: [], allowedHeaders: [], exposedHeaders: [] }
          : opts.cors;
      let trustedOriginsOption:
        | (string | null | undefined)[]
        | ((
            request?: Request
          ) =>
            | (string | null | undefined)[]
            | Promise<(string | null | undefined)[]>)
        | undefined;
      const cors = corsRouter(http, {
        allowedOrigins: async (request) => {
          const resolvedTrustedOrigins =
            trustedOriginsOption ??
            (await staticAuth.$context).options.trustedOrigins ??
            [];
          trustedOriginsOption = resolvedTrustedOrigins;
          const rawOrigins = Array.isArray(resolvedTrustedOrigins)
            ? resolvedTrustedOrigins
            : await resolvedTrustedOrigins(request);
          const trustedOrigins = rawOrigins.filter(
            (origin): origin is string => typeof origin === "string"
          );
          return trustedOrigins
            .map((origin) =>
              // Strip trailing wildcards, unsupported for allowedOrigins
              origin.endsWith("*") && origin.length > 1
                ? origin.slice(0, -1)
                : origin
            )
            .concat(corsOpts.allowedOrigins ?? []);
        },
        allowCredentials: true,
        allowedHeaders: [
          "Content-Type",
          "Better-Auth-Cookie",
          "Authorization",
        ].concat(corsOpts.allowedHeaders ?? []),
        exposedHeaders: ["Set-Better-Auth-Cookie"].concat(
          corsOpts.exposedHeaders ?? []
        ),
        // The CORS router logs raw request and response headers, which carry
        // credentials. The verbose logs above print them redacted.
        debug: false,
        enforceAllowOrigins: false,
      });

      cors.route({
        pathPrefix: `${path}/`,
        method: "GET",
        handler: authRequestHandler,
      });

      cors.route({
        pathPrefix: `${path}/`,
        method: "POST",
        handler: authRequestHandler,
      });
    },

    registerRoutesLazy: <T extends CreateAuth<DataModel>>(
      http: HttpRouter,
      createAuth: T,
      opts: RegisterRoutesLazyOptions = {}
    ) => {
      let registrationAuth: ReturnType<T> | undefined;
      const getRegistrationAuth = (): ReturnType<T> => {
        registrationAuth =
          registrationAuth ?? (createAuth({} as any) as ReturnType<T>);
        return registrationAuth;
      };

      const path = opts.basePath ?? "/api/auth";
      let trustedOriginsOption = opts.trustedOrigins;
      const authRequestHandler = httpActionGeneric(async (ctx, request) => {
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("options.baseURL", getRegistrationAuth().options.baseURL);
          // eslint-disable-next-line no-console
          console.log("request headers", redactHeaders(request.headers));
        }
        const auth = createAuth(ctx as any);
        const normalizedRequest = normalizeRequestOrigin(
          request,
          await exactTrustedOrigins(auth, request)
        );
        const response = await auth.handler(normalizedRequest);
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("response headers", redactHeaders(response.headers));
        }
        return response;
      });
      const wellKnown = http.lookup("/.well-known/openid-configuration", "GET");

      // If registerRoutes is used multiple times, this may already be defined
      if (!wellKnown) {
        // Redirect root well-known to api well-known
        http.route({
          path: "/.well-known/openid-configuration",
          method: "GET",
          handler: httpActionGeneric(async () => {
            const url = `${process.env.CONVEX_SITE_URL}${path}/convex/.well-known/openid-configuration`;
            return Response.redirect(url);
          }),
        });
      }

      if (!opts.cors) {
        http.route({
          pathPrefix: `${path}/`,
          method: "GET",
          handler: authRequestHandler,
        });

        http.route({
          pathPrefix: `${path}/`,
          method: "POST",
          handler: authRequestHandler,
        });

        return;
      }

      const corsOpts =
        typeof opts.cors === "boolean"
          ? { allowedOrigins: [], allowedHeaders: [], exposedHeaders: [] }
          : opts.cors;
      const cors = corsRouter(http, {
        allowedOrigins: async (request) => {
          const resolvedTrustedOrigins =
            trustedOriginsOption ??
            (await getRegistrationAuth().$context).options.trustedOrigins ??
            [];
          trustedOriginsOption = resolvedTrustedOrigins;
          const rawOrigins = Array.isArray(resolvedTrustedOrigins)
            ? resolvedTrustedOrigins
            : await resolvedTrustedOrigins(request);
          const trustedOrigins = rawOrigins.filter(
            (origin): origin is string => typeof origin === "string"
          );
          return trustedOrigins
            .map((origin) =>
              // Strip trailing wildcards, unsupported for allowedOrigins
              origin.endsWith("*") && origin.length > 1
                ? origin.slice(0, -1)
                : origin
            )
            .concat(corsOpts.allowedOrigins ?? []);
        },
        allowCredentials: true,
        allowedHeaders: [
          "Content-Type",
          "Better-Auth-Cookie",
          "Authorization",
        ].concat(corsOpts.allowedHeaders ?? []),
        exposedHeaders: ["Set-Better-Auth-Cookie"].concat(
          corsOpts.exposedHeaders ?? []
        ),
        // The CORS router logs raw request and response headers, which carry
        // credentials. The verbose logs above print them redacted.
        debug: false,
        enforceAllowOrigins: false,
      });

      cors.route({
        pathPrefix: `${path}/`,
        method: "GET",
        handler: authRequestHandler,
      });

      cors.route({
        pathPrefix: `${path}/`,
        method: "POST",
        handler: authRequestHandler,
      });
    },
  };
};
