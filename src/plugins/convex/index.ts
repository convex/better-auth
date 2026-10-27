import type { BetterAuthPlugin, Session, User } from "better-auth";
import type { BetterAuthOptions } from "better-auth/minimal";
import {
  createAuthEndpoint,
  createAuthMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { bearer as bearerPlugin } from "better-auth/plugins/bearer";
import { jwt as jwtPlugin } from "better-auth/plugins/jwt";
import type { JwtOptions, Jwk } from "better-auth/plugins/jwt";
import { oidcProvider as oidcProviderPlugin } from "better-auth/plugins/oidc-provider";
import { omit } from "convex-helpers";
import type { AuthConfig, AuthProvider } from "convex/server";
import { VERSION } from "../../version.js";

export const JWT_COOKIE_NAME = "convex_jwt";

type BetterAuthAfterHooks = NonNullable<
  NonNullable<BetterAuthPlugin["hooks"]>["after"]
>;
type BetterAuthAfterHook = BetterAuthAfterHooks[number];
type BetterAuthHookContext = Parameters<BetterAuthAfterHook["matcher"]>[0];

const normalizeAfterHooks = <THook extends BetterAuthAfterHook>(
  hooks: THook[]
): BetterAuthAfterHooks => {
  return hooks.map((hook) => ({
    ...hook,
    matcher: (ctx: BetterAuthHookContext) => Boolean(hook.matcher(ctx)),
  }));
};

const getJwksAlg = (authProvider: AuthProvider) => {
  const isCustomJwt =
    "type" in authProvider && authProvider.type === "customJwt";
  if (isCustomJwt && authProvider.algorithm !== "RS256") {
    throw new Error("Only RS256 is supported for custom JWT with Better Auth");
  }
  return isCustomJwt ? authProvider.algorithm : "EdDSA";
};

const DEFAULT_JWKS_CACHE_MAX_AGE_SECONDS = 60;

const parseJwksCacheMaxAgeSeconds = (seconds: number | undefined) => {
  if (seconds === undefined) {
    return DEFAULT_JWKS_CACHE_MAX_AGE_SECONDS;
  }
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error(
      "jwksCacheMaxAgeSeconds must be a non-negative integer number of seconds"
    );
  }
  return seconds;
};

const parseAuthConfig = (authConfig: AuthConfig, opts: { jwks?: string }) => {
  const providerConfigs = authConfig.providers.filter(
    (provider) => provider.applicationID === "convex"
  );
  if (providerConfigs.length > 1) {
    throw new Error(
      "Multiple auth providers with applicationID 'convex' detected. Please use only one."
    );
  }
  const providerConfig = providerConfigs[0];
  if (!providerConfig) {
    throw new Error(
      "No auth provider with applicationID 'convex' found. Please add one to your auth config."
    );
  }
  if (!("type" in providerConfig) || providerConfig.type !== "customJwt") {
    return providerConfig;
  }

  const isDataUriJwks = providerConfig.jwks?.startsWith("data:text/");

  if (isDataUriJwks && !opts.jwks) {
    throw new Error(
      "Static JWKS detected in auth config, but missing from Convex plugin"
    );
  }
  if (!isDataUriJwks && opts.jwks) {
    // eslint-disable-next-line no-console
    console.warn(
      "Static JWKS provided to Convex plugin, but not to auth config. This adds an unnecessary network request for token verification."
    );
  }
  return providerConfig;
};

export const convex = (opts: {
  /**
   * @param {AuthConfig} authConfig - Auth config from your Convex project.
   *
   * Typically found in `convex/auth.config.ts`.
   *
   * @example
   * ```ts
   * // convex/auth.config.ts
   * export default {
   *   providers: [getAuthConfigProvider({ jwks: process.env.JWKS })],
   * } satisfies AuthConfig;
   * ```
   *
   * @example
   * ```ts
   * // convex/auth.ts
   * import authConfig from './auth.config';
   * export const createAuth = (ctx: GenericCtx<DataModel>) => {
   *   return betterAuth({
   *     // ...
   *     plugins: [convex({ authConfig })],
   *   });
   * };
   * ```
   */
  authConfig: AuthConfig;
  /**
   * @param {Object} jwt - JWT options.
   * @param {number} jwt.expirationSeconds - JWT expiration seconds.
   * @param {Function} jwt.definePayload - Function to define the JWT payload. `sessionId` and `iat` are added automatically.
   */
  jwt?: {
    expirationSeconds?: number;
    definePayload?: (session: {
      user: User & Record<string, any>;
      session: Session & Record<string, any>;
    }) => Promise<Record<string, any>> | Record<string, any> | undefined;
  };
  /**
   * @deprecated Use jwt.expirationSeconds instead.
   */
  jwtExpirationSeconds?: number;
  /**
   * @param {string} jwks - Optional static JWKS to avoid fetching from the database.
   *
   * This should be a stringified document from the Better Auth JWKS table. You
   * can create one in the console.
   *
   * @example
   * ```ts
   * // convex/auth.ts
   * export const rotateKeys = internalAction({
   *   args: {},
   *   handler: async (ctx) => {
   *     const auth = createAuth(ctx)
   *     return await auth.api.rotateKeys()
   *   },
   * })
   * ```
   * Run the action and set the JWKS environment variable
   *
   * ```bash
   * npx convex run auth:rotateKeys | npx convex env set JWKS
   * ```
   * Then use it in your auth config and Better Auth options:
   *
   * ```ts
   * // convex/auth.config.ts
   * export default {
   *   providers: [getAuthConfigProvider({ jwks: process.env.JWKS })],
   * } satisfies AuthConfig;
   *
   * // convex/auth.ts
   * export const createAuth = (ctx: GenericCtx<DataModel>) => {
   *   return betterAuth({
   *     // ...
   *     plugins: [convex({ authConfig, jwks: process.env.JWKS })],
   *   });
   * };
   * ```
   */
  jwks?: string;
  /**
   * @param {number} jwksCacheMaxAgeSeconds - How long the JWKS endpoint response may be cached, in seconds.
   *
   * The Convex backend fetches the JWKS url through an http cache while
   * validating a token. Without a cache lifetime the response is revalidated
   * on every validation, costing a request and a database read each time.
   * Set to `0` to send no `Cache-Control` header.
   *
   * The trade-off: Convex does not refetch when it sees an unknown `kid`, so
   * after a key rotation tokens signed with the new key are rejected until the
   * cached set expires, up to this many seconds. Revocation lags the same way:
   * `rotateKeys` deletes the old key set, while an already cached response
   * still carries the removed public key, so tokens signed with a revoked key
   * keep validating until that cache entry expires. Lowering this value, or
   * setting `0`, shrinks both windows. Concurrent cache misses are not
   * coalesced either, so several validations that miss at the same instant
   * each fetch once.
   *
   * @default 60
   */
  jwksCacheMaxAgeSeconds?: number;
  /**
   * @param {boolean} jwksRotateOnTokenGenerationError - Whether to rotate the JWKS on token generation error.
   *
   * Does nothing if a static JWKS is provided.
   *
   * Handles error that occurs when existing JWKS key does not match configured
   * algorithm, which will be common for 0.10 upgrades switching from EdDSA to RS256.
   *
   * @default false
   */
  jwksRotateOnTokenGenerationError?: boolean;
  /**
   * @param {BetterAuthOptions} options - Better Auth options. Not required,
   * currently used to pass the basePath to the oidcProvider plugin.
   */
  options?: BetterAuthOptions;
}) => {
  const jwksCacheMaxAgeSeconds = parseJwksCacheMaxAgeSeconds(
    opts.jwksCacheMaxAgeSeconds
  );
  const jwtExpirationSeconds =
    opts.jwt?.expirationSeconds ?? opts.jwtExpirationSeconds ?? 60 * 15;
  const oidcProvider = oidcProviderPlugin({
    loginPage: "/not-used",
    metadata: {
      issuer: `${process.env.CONVEX_SITE_URL}`,
      jwks_uri: `${process.env.CONVEX_SITE_URL}${opts.options?.basePath ?? "/api/auth"}/convex/jwks`,
    },
    __skipDeprecationWarning: true,
  });
  const providerConfig = parseAuthConfig(opts.authConfig, opts);

  const jwtOptions = {
    jwt: {
      issuer: `${process.env.CONVEX_SITE_URL}`,
      audience: "convex",
      expirationTime: `${jwtExpirationSeconds}s`,
      definePayload: async ({ user, session }) => ({
        ...(opts.jwt?.definePayload
          ? await opts.jwt.definePayload({ user, session })
          : omit(user, ["id", "image"])),
        sessionId: session.id,
        iat: Math.floor(new Date().getTime() / 1000),
      }),
    },
    jwks: {
      keyPairConfig: {
        alg: getJwksAlg(providerConfig),
      },
    },
  } satisfies JwtOptions;
  const jwks = opts.jwks ? JSON.parse(opts.jwks) : undefined;
  const jwt = jwtPlugin({
    ...jwtOptions,
    adapter: {
      createJwk: async (webKey, ctx) => {
        if (opts.jwks) {
          throw new Error("Not implemented");
        }
        // TODO: remove when date parsing for jwks adapter is fixed upstream
        return await ctx.context.adapter.create<Omit<Jwk, "id">, Jwk>({
          model: "jwks",
          data: {
            ...webKey,
            createdAt: new Date(),
          },
        });
      },
      getJwks: async (ctx) => {
        if (opts.jwks) {
          return jwks;
        }
        // TODO: remove when date parsing for jwks adapter is fixed upstream
        const keys: Jwk[] = await ctx.context.adapter.findMany<Jwk>({
          model: "jwks",
          sortBy: {
            field: "createdAt",
            direction: "desc",
          },
        });
        return keys.map((key) => ({
          ...key,
          createdAt: new Date(key.createdAt),
          ...(key.expiresAt ? { expiresAt: new Date(key.expiresAt) } : {}),
        }));
      },
    },
  });
  // Bearer plugin converts the session token to a cookie
  // for cross domain social login after code verification,
  // and is required for the headers() helper to work.
  const bearer = bearerPlugin();
  const schema = {
    user: {
      fields: { userId: { type: "string", required: false, input: false } },
    } as const,
    ...jwt.schema,
  };

  return {
    id: "convex",
    version: VERSION,
    init: (ctx) => {
      const { options, logger: _logger } = ctx;
      if (options.basePath !== "/api/auth" && !opts.options?.basePath) {
        // eslint-disable-next-line no-console
        console.warn(
          `Better Auth basePath set to ${options.basePath} but no basePath is set in the Convex plugin. This is probably a mistake.`
        );
      }
      if (
        opts.options?.basePath &&
        options.basePath !== opts.options?.basePath
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          `Better Auth basePath ${options.basePath} does not match Convex plugin basePath ${opts.options?.basePath}. This is probably a mistake.`
        );
      }
    },
    hooks: {
      before: [
        ...bearer.hooks.before,
        // In query context, no writes can succeed. No-op adapter write
        // methods and session refresh to prevent errors from fire-and-forget
        // side effects in Better Auth plugins (session cleanup, expired
        // api-key deletion, org state correction, etc.).
        {
          matcher: (ctx) => {
            return !ctx.context.adapter.options?.isRunMutationCtx;
          },
          handler: createAuthMiddleware(async (ctx) => {
            ctx.query = { ...ctx.query, disableRefresh: true };
            ctx.context.internalAdapter.deleteSession = async (
              ..._args: any[]
            ) => {
              //skip
            };
            const knownSafePaths = ["/api-key/list", "/api-key/get"];
            const noopWrite = (method: string) => {
              return async (..._args: any[]) => {
                if (ctx.path && !knownSafePaths.includes(ctx.path)) {
                  // eslint-disable-next-line no-console
                  console.warn(
                    `[convex-better-auth] Write operation "${method}" skipped in query context for ${ctx.path}`
                  );
                }
                return 0;
              };
            };
            ctx.context.adapter.create = noopWrite("create") as any;
            ctx.context.adapter.update = noopWrite("update") as any;
            ctx.context.adapter.updateMany = noopWrite("updateMany") as any;
            ctx.context.adapter.delete = noopWrite("delete") as any;
            ctx.context.adapter.deleteMany = noopWrite("deleteMany") as any;
            return { context: ctx };
          }),
        },
      ],
      after: [
        ...normalizeAfterHooks(oidcProvider.hooks.after),
        {
          matcher: (ctx) => {
            return Boolean(
              ctx.path?.startsWith("/sign-in") ||
                ctx.path?.startsWith("/sign-up") ||
                ctx.path?.startsWith("/callback") ||
                ctx.path?.startsWith("/oauth2/callback") ||
                ctx.path?.startsWith("/magic-link/verify") ||
                ctx.path?.startsWith("/email-otp/verify-email") ||
                ctx.path?.startsWith("/phone-number/verify") ||
                ctx.path?.startsWith("/siwe/verify") ||
                ctx.path?.startsWith("/update-session") ||
                (ctx.path?.startsWith("/get-session") && ctx.context.session)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            // Set jwt cookie at login for authenticated ssr
            const originalSession = ctx.context.session;
            try {
              ctx.context.session =
                ctx.context.session ?? ctx.context.newSession;
              const { token } = await jwt.endpoints.getToken({
                ...ctx,
                headers: {},
                method: "GET",
                asResponse: false,
                returnHeaders: false,
                returnStatus: false,
              });
              const jwtCookie = ctx.context.createAuthCookie(JWT_COOKIE_NAME, {
                maxAge: jwtExpirationSeconds,
              });
              ctx.setCookie(jwtCookie.name, token, jwtCookie.attributes);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (_err) {
              // no-op, some sign-in calls (eg., when redirecting to 2fa)
              // 401 here
            }
            ctx.context.session = originalSession;
          }),
        },
        {
          matcher: (ctx) => {
            return Boolean(
              ctx.path?.startsWith("/sign-out") ||
                ctx.path?.startsWith("/delete-user") ||
                (ctx.path?.startsWith("/get-session") && !ctx.context.session)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const jwtCookie = ctx.context.createAuthCookie(JWT_COOKIE_NAME, {
              maxAge: 0,
            });
            ctx.setCookie(jwtCookie.name, "", jwtCookie.attributes);
          }),
        },
      ],
    },
    endpoints: {
      getOpenIdConfig: createAuthEndpoint(
        "/convex/.well-known/openid-configuration",
        {
          method: "GET",
          metadata: {
            isAction: false,
          },
          // TODO: properly type this
        },
        async (ctx) => {
          const response = await oidcProvider.endpoints.getOpenIdConfig({
            ...ctx,
            asResponse: false,
            returnHeaders: false,
            returnStatus: false,
          });
          return response;
        }
      ),
      getJwks: createAuthEndpoint(
        "/convex/jwks",
        {
          method: "GET",
          metadata: {
            openapi: {
              description: "Get the JSON Web Key Set",
              responses: {
                "200": {
                  description: "JSON Web Key Set retrieved successfully",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          keys: {
                            type: "array",
                            description: "Array of public JSON Web Keys",
                            items: {
                              type: "object",
                              properties: {
                                kid: {
                                  type: "string",
                                  description:
                                    "Key ID uniquely identifying the key, corresponds to the 'id' from the stored Jwk",
                                },
                                kty: {
                                  type: "string",
                                  description:
                                    "Key type (e.g., 'RSA', 'EC', 'OKP')",
                                },
                                alg: {
                                  type: "string",
                                  description:
                                    "Algorithm intended for use with the key (e.g., 'EdDSA', 'RS256')",
                                },
                                use: {
                                  type: "string",
                                  description:
                                    "Intended use of the public key (e.g., 'sig' for signature)",
                                  enum: ["sig"],
                                  nullable: true,
                                },
                                n: {
                                  type: "string",
                                  description:
                                    "Modulus for RSA keys (base64url-encoded)",
                                  nullable: true,
                                },
                                e: {
                                  type: "string",
                                  description:
                                    "Exponent for RSA keys (base64url-encoded)",
                                  nullable: true,
                                },
                                crv: {
                                  type: "string",
                                  description:
                                    "Curve name for elliptic curve keys (e.g., 'Ed25519', 'P-256')",
                                  nullable: true,
                                },
                                x: {
                                  type: "string",
                                  description:
                                    "X coordinate for elliptic curve keys (base64url-encoded)",
                                  nullable: true,
                                },
                                y: {
                                  type: "string",
                                  description:
                                    "Y coordinate for elliptic curve keys (base64url-encoded)",
                                  nullable: true,
                                },
                              },
                              required: ["kid", "kty", "alg"],
                            },
                          },
                        },
                        required: ["keys"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          if (jwksCacheMaxAgeSeconds > 0) {
            ctx.setHeader(
              "cache-control",
              `public, max-age=${jwksCacheMaxAgeSeconds}, must-revalidate`
            );
          }
          const response = await jwt.endpoints.getJwks({
            ...ctx,
            asResponse: false,
            returnHeaders: false,
            returnStatus: false,
          });
          return response;
        }
      ),
      getLatestJwks: createAuthEndpoint(
        // This path is inaccessible due to SERVER_ONLY: true, it's here to
        // avoid errors that occur in all matchers when path is undefined.
        "/convex/latest-jwks",
        {
          isAction: true,
          method: "POST",
          metadata: {
            SERVER_ONLY: true,
            openapi: {
              description:
                "Delete and regenerate JWKS, and return the new JWKS for static usage",
            },
          },
        },
        async (ctx) => {
          // Ensure at least one key exists
          await jwtPlugin(jwtOptions).endpoints.getJwks({
            ...ctx,
            method: "GET",
            asResponse: false,
            returnHeaders: false,
            returnStatus: false,
          });
          const jwks: any[] = await ctx.context.adapter.findMany({
            model: "jwks",
            limit: 1,
            sortBy: {
              field: "createdAt",
              direction: "desc",
            },
          });
          // Add alg to jwks, otherwise Better Auth will default to EdDSA
          jwks[0].alg = jwtOptions.jwks.keyPairConfig.alg;
          return jwks;
        }
      ),
      rotateKeys: createAuthEndpoint(
        // This path is inaccessible due to SERVER_ONLY: true, it's here to
        // avoid errors that occur in all matchers when path is undefined.
        "/convex/rotate-keys",
        {
          isAction: true,
          method: "POST",
          metadata: {
            SERVER_ONLY: true,
            openapi: {
              description:
                "Delete and regenerate JWKS, and return the new JWKS for static usage",
            },
          },
        },
        async (ctx) => {
          await ctx.context.adapter.deleteMany({
            model: "jwks",
            where: [],
          });

          await jwtPlugin(jwtOptions).endpoints.getJwks({
            ...ctx,
            method: "GET",
            asResponse: false,
            returnHeaders: false,
            returnStatus: false,
          });
          const jwks: any[] = await ctx.context.adapter.findMany({
            model: "jwks",
            limit: 1,
            sortBy: {
              field: "createdAt",
              direction: "desc",
            },
          });
          jwks[0].alg = jwtOptions.jwks.keyPairConfig.alg;
          return jwks;
        }
      ),
      getToken: createAuthEndpoint(
        "/convex/token",
        {
          method: "GET",
          requireHeaders: true,
          use: [sessionMiddleware],
          metadata: {
            openapi: {
              description: "Get a JWT token",
              responses: {
                200: {
                  description: "Success",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          token: {
                            type: "string",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          const runEndpoint = async () => {
            const response = await jwt.endpoints.getToken({
              ...ctx,
              asResponse: false,
              returnHeaders: false,
              returnStatus: false,
            });
            const jwtCookie = ctx.context.createAuthCookie(JWT_COOKIE_NAME, {
              maxAge: jwtExpirationSeconds,
            });
            ctx.setCookie(jwtCookie.name, response.token, jwtCookie.attributes);
            return response;
          };
          try {
            return await runEndpoint();
          } catch (error: any) {
            // If alg config has changed and no longer matches one or more keys,
            // roll the keys
            if (!opts.jwks && error?.code === "ERR_JOSE_NOT_SUPPORTED") {
              if (opts.jwksRotateOnTokenGenerationError) {
                await ctx.context.adapter.deleteMany({
                  model: "jwks",
                  where: [],
                });
                return await runEndpoint();
              } else {
                // eslint-disable-next-line no-console
                console.error(
                  "Try temporarily setting jwksRotateOnTokenGenerationError: true on the Convex Better Auth plugin."
                );
              }
            }
            throw error;
          }
        }
      ),
    },
    schema,
  } satisfies BetterAuthPlugin;
};
