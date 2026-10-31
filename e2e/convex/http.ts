import { httpRouter } from "convex/server";
import { httpAction as httpActionGeneric } from "./_generated/server";
import { authComponent, createAuth, createEdDsaAuth } from "./auth";
import { createSurfaceAuth, createMcpAuth, resource } from "./surfaces";
import { requireMcpAuth } from "@better-auth/mcp";
import { internal } from "./_generated/api";
import { handleMcpSdk } from "./mcpSdk";

const http = httpRouter();
const registration = process.env.OAUTH_ROUTE_REGISTRATION;
if (registration !== "eager" && registration !== "lazy") {
  throw new Error("OAUTH_ROUTE_REGISTRATION must be eager or lazy");
}
http.route({
  path: "/registration-mode",
  method: "GET",
  handler: httpActionGeneric(async () => Response.json({ registration })),
});
if (registration === "lazy") {
  authComponent.registerRoutesLazy(http, createAuth, {
    basePath: process.env.AUDIT_AUTH_BASE_PATH ?? "/api/auth",
  });
  authComponent.registerRoutesLazy(http, createEdDsaAuth, {
    basePath: "/eddsa-auth",
  });
  authComponent.registerRoutesLazy(http, createSurfaceAuth, {
    basePath: "/api/surfaces",
    cors: true,
  });
} else {
  authComponent.registerRoutes(http, createAuth);
  authComponent.registerRoutes(http, createEdDsaAuth);
  authComponent.registerRoutes(http, createSurfaceAuth, { cors: true });
}
// Exercise MCP in the selected mode too: eager registration must not seed
// resources against the metadata-only registration context.
if (registration === "eager") {
  authComponent.registerRoutes(http, createMcpAuth, { cors: true });
} else {
  authComponent.registerRoutesLazy(http, createMcpAuth, {
    basePath: "/api/mcp-auth",
    cors: true,
  });
}
for (const path of [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]) {
  http.route({
    path,
    method: "GET",
    handler: httpActionGeneric((ctx, request) =>
      createMcpAuth(ctx).handler(request)
    ),
  });
}
for (const path of ["/mcp", "/mcp-admin", "/wrong-resource"]) {
  for (const method of path === "/mcp"
    ? (["GET", "POST"] as const)
    : (["POST"] as const)) {
    http.route({
      path,
      method,
      handler: httpActionGeneric(async (ctx, request) =>
        requireMcpAuth(
          createMcpAuth(ctx),
          async (req, claims) => {
            if (path === "/mcp" && new URL(req.url).searchParams.has("format"))
              return handleMcpSdk(req, claims.sub!);
            const body = await req.json();
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: { subject: claims.sub },
            });
          },
          {
            resource:
              path === "/wrong-resource"
                ? "http://127.0.0.1:3211/other"
                : resource,
            jwksUrl: "http://127.0.0.1:3211/api/mcp-auth/convex/jwks",
            requiredScopes: [path === "/mcp-admin" ? "mcp:admin" : "mcp:read"],
          }
        )(request)
      ),
    });
  }
}
http.route({
  path: "/fixture-oauth/authorize",
  method: "GET",
  handler: httpActionGeneric(async (ctx, request) => {
    const url = new URL(request.url);
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    if (
      callback.href !== "http://127.0.0.1:3211/api/surfaces/callback/fixture" ||
      url.searchParams.get("code_challenge_method") !== "S256"
    )
      return new Response(null, { status: 400 });
    const code = crypto.randomUUID();
    await ctx.runMutation(internal.authFixtures.issueCode, {
      code,
      challenge: url.searchParams.get("code_challenge")!,
      email: `${code}@example.com`,
    });
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", url.searchParams.get("state")!);
    return Response.redirect(callback, 302);
  }),
});
http.route({
  path: "/fixture-oauth/token",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const form = new URLSearchParams(await request.text());
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(form.get("code_verifier")!)
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const email = await ctx.runMutation(internal.authFixtures.consumeCode, {
      code: form.get("code")!,
      challenge,
    });
    return email
      ? Response.json({
          access_token: btoa(email),
          token_type: "Bearer",
          expires_in: 3600,
        })
      : Response.json({ error: "invalid_grant" }, { status: 400 });
  }),
});
http.route({
  path: "/fixture-oauth/userinfo",
  method: "GET",
  handler: httpActionGeneric(async (_ctx, request) => {
    const email = atob(request.headers.get("authorization")!.slice(7));
    return Response.json({
      id: email,
      email,
      email_verified: true,
      name: "Fixture user",
    });
  }),
});
export default http;
