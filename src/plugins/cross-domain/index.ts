import type { BetterAuthPlugin } from "better-auth";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { oneTimeToken as oneTimeTokenPlugin } from "better-auth/plugins/one-time-token";
import { z } from "zod";
import { VERSION } from "../../version.js";

export const crossDomain = ({ siteUrl }: { siteUrl: string }) => {
  const oneTimeToken = oneTimeTokenPlugin();

  // Origins from trustedOrigins that name a single http(s) origin. Wildcard
  // patterns and custom schemes are excluded.
  const exactTrustedOrigins = (trustedOrigins: string[]) => {
    const origins = new Set<string>();
    for (const entry of trustedOrigins) {
      if (entry.includes("*")) {
        continue;
      }
      try {
        const url = new URL(entry);
        if (url.protocol === "http:" || url.protocol === "https:") {
          origins.add(url.origin);
        }
      } catch {
        // not a URL
      }
    }
    return origins;
  };

  const rewriteCallbackURL = (callbackURL?: string) => {
    if (!callbackURL) {
      return callbackURL;
    }
    if (!callbackURL.startsWith("/")) {
      return callbackURL;
    }
    return new URL(callbackURL, siteUrl).toString();
  };

  const isExpoNative = (ctx: { headers?: Headers }) => {
    return ctx.headers?.has("expo-origin");
  };

  return {
    id: "cross-domain",
    version: VERSION,
    // Adds siteUrl to trustedOrigins so the one-time token is issued
    // for redirects to it even when the app's own list omits it.
    init() {
      return {
        options: {
          trustedOrigins: [siteUrl],
        },
        context: {
          oauthConfig: {
            storeStateStrategy: "database",
            // We could fake the cookie by sending a header, but it would need
            // to be set on a 302 redirect from the identity provider, and we
            // don't have a way to do that. This only means we can't stop an
            // oauth flow that started in one browser from continuing in
            // another. We still verify the state token from the query string
            // against the database. The one-time token appended after the
            // callback is only issued for redirects to an exact trusted
            // origin (see the after hook below).
            skipStateCookieCheck: true,
          },
        },
      };
    },
    hooks: {
      before: [
        {
          matcher(ctx) {
            return (
              Boolean(
                ctx.request?.headers.has("better-auth-cookie") ||
                ctx.headers?.has("better-auth-cookie")
              ) && !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const existingHeaders = (ctx.request?.headers ||
              ctx.headers) as Headers;
            const headers = new Headers({
              ...Object.fromEntries(existingHeaders?.entries()),
            });
            // Skip if the request has an authorization header
            if (headers.get("authorization")) {
              return;
            }
            const cookie = headers.get("better-auth-cookie");
            if (!cookie) {
              return;
            }
            headers.append("cookie", cookie);
            return {
              context: {
                headers,
              },
            };
          }),
        },
        {
          matcher: (ctx) => {
            return Boolean(
              ctx.method === "GET" &&
              ctx.path?.startsWith("/verify-email") &&
              !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.query?.callbackURL) {
              ctx.query.callbackURL = rewriteCallbackURL(ctx.query.callbackURL);
            }
            return { context: ctx };
          }),
        },
        {
          matcher: (ctx) => {
            return Boolean(ctx.method === "POST" && !isExpoNative(ctx));
          },
          handler: createAuthMiddleware(async (ctx) => {
            // Set callbackURL to siteUrl for redirect-triggering paths with
            // no callbackURL defined.
            if (
              ctx.body &&
              !ctx.body.callbackURL &&
              (ctx.path?.startsWith("/sign-in/social") ||
                ctx.path?.startsWith("/sign-in/magic-link") ||
                ctx.path?.startsWith("/send-verification-email"))
            ) {
              ctx.body.callbackURL = siteUrl;
            }
            if (ctx.body?.callbackURL) {
              ctx.body.callbackURL = rewriteCallbackURL(ctx.body.callbackURL);
            }
            if (ctx.body?.newUserCallbackURL) {
              ctx.body.newUserCallbackURL = rewriteCallbackURL(
                ctx.body.newUserCallbackURL
              );
            }
            if (ctx.body?.errorCallbackURL) {
              ctx.body.errorCallbackURL = rewriteCallbackURL(
                ctx.body.errorCallbackURL
              );
            }
            return { context: ctx };
          }),
        },
      ],
      after: [
        {
          matcher(ctx) {
            return (
              Boolean(
                ctx.request?.headers.has("better-auth-cookie") ||
                ctx.headers?.has("better-auth-cookie")
              ) && !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const setCookie = ctx.context.responseHeaders?.get("set-cookie");
            if (!setCookie) {
              return;
            }
            ctx.context.responseHeaders?.delete("set-cookie");
            ctx.setHeader("Set-Better-Auth-Cookie", setCookie);
          }),
        },
        {
          matcher: (ctx) => {
            return Boolean(
              (ctx.path?.startsWith("/callback") ||
                ctx.path?.startsWith("/magic-link/verify")) &&
              !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            // Mostly copied from the one-time-token plugin
            const session = ctx.context.newSession;
            if (!session) {
              ctx.context.logger.error("No session found");
              return;
            }
            const redirectTo = ctx.context.responseHeaders?.get("location");
            if (!redirectTo) {
              ctx.context.logger.error("No redirect to found");
              return;
            }
            const url = new URL(redirectTo);
            if (
              !exactTrustedOrigins(ctx.context.trustedOrigins).has(url.origin)
            ) {
              ctx.context.logger.warn(
                `Not appending one-time token: redirect origin ${url.origin} is not an exact entry in trustedOrigins`
              );
              return;
            }
            const token = generateRandomString(32);
            const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
            await ctx.context.internalAdapter.createVerificationValue({
              value: session.session.token,
              identifier: `one-time-token:${token}`,
              expiresAt,
            });
            url.searchParams.set("ott", token);
            throw ctx.redirect(url.toString());
          }),
        },
      ],
    },
    endpoints: {
      verifyOneTimeToken: createAuthEndpoint(
        "/cross-domain/one-time-token/verify",
        {
          method: "POST",
          body: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          const response = await oneTimeToken.endpoints.verifyOneTimeToken({
            ...ctx,
            asResponse: false,
            returnHeaders: false,
            returnStatus: false,
          });
          await setSessionCookie(ctx, response);
          return response;
        }
      ),
    },
  } satisfies BetterAuthPlugin;
};
