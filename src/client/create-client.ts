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

const getOpenIdConfigPath = (plugins: unknown) =>
  Array.isArray(plugins) &&
  plugins.some((plugin) => plugin?.id === "oauth-provider")
    ? "/.well-known/openid-configuration"
    : "/convex/.well-known/openid-configuration";

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
    incrementOne: FunctionReference<"mutation", "internal">;
    updateMany: FunctionReference<"mutation", "internal">;
    deleteOne: FunctionReference<"mutation", "internal">;
    deleteMany: FunctionReference<"mutation", "internal">;
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

// Hosts named exactly in trustedOrigins (and, with a dynamic baseURL, in
// allowedHosts). Wildcard patterns and non-http(s) entries are excluded.
const exactTrustedHosts = async (
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
  const hosts = new Set<string>();
  for (const origin of origins) {
    if (typeof origin !== "string" || origin.includes("*")) {
      continue;
    }
    try {
      const url = new URL(origin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        hosts.add(url.host.toLowerCase());
      }
    } catch {
      // not a URL
    }
  }
  return hosts;
};

// The framework proxy handlers send the original host and protocol in
// x-better-auth-forwarded-* headers. Restore them into x-forwarded-* only
// when the host is one the app lists exactly in trustedOrigins and the
// protocol is http or https. Both are restored or neither is.
const restoreOriginalForwardedHeaders = (
  request: Request,
  trustedHosts: Set<string>
) => {
  const originalHost = request.headers.get("x-better-auth-forwarded-host");
  const originalProto = request.headers.get("x-better-auth-forwarded-proto");
  if (
    !originalHost ||
    !trustedHosts.has(originalHost.toLowerCase()) ||
    (originalProto !== "http" && originalProto !== "https")
  ) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", originalHost);
  headers.set("x-forwarded-proto", originalProto);
  return new Request(request, { headers });
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
          console.log("request headers", request.headers);
        }
        const auth = createAuth(ctx as any);
        const normalizedRequest = restoreOriginalForwardedHeaders(
          request,
          await exactTrustedHosts(auth, request)
        );
        const response = await auth.handler(normalizedRequest);
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("response headers", response.headers);
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
            const url = `${process.env.CONVEX_SITE_URL}${path}${getOpenIdConfigPath(staticAuth.options.plugins)}`;
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
        debug: config?.verbose,
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
          console.log("request headers", request.headers);
        }
        const auth = createAuth(ctx as any);
        const normalizedRequest = restoreOriginalForwardedHeaders(
          request,
          await exactTrustedHosts(auth, request)
        );
        const response = await auth.handler(normalizedRequest);
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("response headers", response.headers);
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
          handler: httpActionGeneric(async (ctx) => {
            const auth = createAuth(ctx as any);
            const url = `${process.env.CONVEX_SITE_URL}${path}${getOpenIdConfigPath(auth.options.plugins)}`;
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
        debug: config?.verbose,
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
