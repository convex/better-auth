import { stripIndent } from "common-tags";
import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import { ConvexHttpClient } from "convex/browser";
import { getToken } from "../utils/index.js";
import type { GetTokenOptions } from "../utils/index.js";
import React from "react";

// Caching supported for React 19+ only
const cache =
  React.cache ||
  ((fn: (...args: any[]) => any) => {
    return (...args: any[]) => fn(...args);
  });

type ClientOptions = {
  /**
   * The URL of the Convex deployment to use for the function call.
   */
  convexUrl: string;
  /**
   * The HTTP Actions URL of the Convex deployment to use for the function call.
   */
  convexSiteUrl: string;
  /**
   * The JWT-encoded OpenID Connect authentication token to use for the function call.
   * Just an optional override for edge cases, you probably don't need this.
   */
  token?: string;
};

function setupClient(options: ClientOptions) {
  const client = new ConvexHttpClient(options.convexUrl);
  if (options.token !== undefined) {
    client.setAuth(options.token);
  }
  // @ts-expect-error - setFetchOptions is internal
  client.setFetchOptions({ cache: "no-store" });
  return client;
}

const parseConvexSiteUrl = (url: string) => {
  if (!url) {
    throw new Error(stripIndent`
      CONVEX_SITE_URL is not set.
      This is automatically set in the Convex backend, but must be set in the TanStack Start environment.
      For local development, this can be set in the .env.local file.
    `);
  }
  if (url.endsWith(".convex.cloud")) {
    throw new Error(stripIndent`
      CONVEX_SITE_URL should be set to your Convex Site URL, which ends in .convex.site.
      Currently set to ${url}.
    `);
  }
  return url;
};

const handler = (request: Request, opts: { convexSiteUrl: string }) => {
  const requestUrl = new URL(request.url);
  const nextUrl = `${opts.convexSiteUrl}${requestUrl.pathname}${requestUrl.search}`;
  const headers = new Headers(request.headers);
  // Strip hop-by-hop headers inherited from the incoming request; undici
  // rejects an outbound `transfer-encoding: chunked` header value.
  headers.delete("transfer-encoding");
  headers.delete("content-length");
  headers.delete("connection");
  headers.set("accept-encoding", "application/json");
  headers.set("host", new URL(opts.convexSiteUrl).host);
  headers.set("x-better-auth-forwarded-host", requestUrl.host);
  headers.set(
    "x-better-auth-forwarded-proto",
    requestUrl.protocol.replace(/:$/, "")
  );
  return fetch(nextUrl, {
    method: request.method,
    headers,
    redirect: "manual",
    body: request.body,
    // @ts-expect-error - duplex is required for streaming request bodies in modern fetch
    duplex: "half",
  });
};

export const convexBetterAuthReactStart = (
  opts: Omit<GetTokenOptions, "forceRefresh"> & {
    convexUrl: string;
    convexSiteUrl: string;
  }
) => {
  const siteUrl = parseConvexSiteUrl(opts.convexSiteUrl);

  const cachedGetToken = cache(async (opts: GetTokenOptions) => {
    const { getRequestHeaders } = await import("@tanstack/react-start/server");
    const headers = getRequestHeaders();
    const mutableHeaders = new Headers(headers);
    mutableHeaders.delete("content-length");
    mutableHeaders.delete("transfer-encoding");
    mutableHeaders.set("accept-encoding", "identity");
    return getToken(siteUrl, mutableHeaders, opts);
  });

  const callWithToken = async <
    FnType extends "query" | "mutation" | "action",
    Fn extends FunctionReference<FnType>,
  >(
    fn: (token?: string) => Promise<FunctionReturnType<Fn>>
  ): Promise<FunctionReturnType<Fn>> => {
    const token = (await cachedGetToken(opts)) ?? {};
    try {
      return await fn(token?.token);
    } catch (error) {
      if (
        !opts?.jwtCache?.enabled ||
        token.isFresh ||
        opts.jwtCache?.isAuthError(error)
      ) {
        throw error;
      }
      const newToken = await cachedGetToken({
        ...opts,
        forceRefresh: true,
      });
      return await fn(newToken.token);
    }
  };

  return {
    getToken: async () => {
      const token = await cachedGetToken(opts);
      return token.token;
    },
    handler: (request: Request) => handler(request, opts),
    fetchAuthQuery: async <Query extends FunctionReference<"query">>(
      query: Query,
      ...args: OptionalRestArgs<Query>
    ): Promise<FunctionReturnType<Query>> => {
      return callWithToken((token?: string) => {
        const client = setupClient({ ...opts, token });
        return client.query(query, ...args);
      });
    },
    fetchAuthMutation: async <Mutation extends FunctionReference<"mutation">>(
      mutation: Mutation,
      ...args: OptionalRestArgs<Mutation>
    ): Promise<FunctionReturnType<Mutation>> => {
      return callWithToken((token?: string) => {
        const client = setupClient({ ...opts, token });
        return client.mutation(mutation, ...args);
      });
    },
    fetchAuthAction: async <Action extends FunctionReference<"action">>(
      action: Action,
      ...args: OptionalRestArgs<Action>
    ): Promise<FunctionReturnType<Action>> => {
      return callWithToken((token?: string) => {
        const client = setupClient({ ...opts, token });
        return client.action(action, ...args);
      });
    },
  };
};
