import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins/magic-link";
import { emailOTP } from "better-auth/plugins/email-otp";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwt } from "better-auth/plugins/jwt";
import { mcp } from "@better-auth/mcp";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import type { GenericCtx } from "@convex-dev/better-auth";
import type { DataModel } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import authConfig from "./auth.config";

export const resource = "http://127.0.0.1:3211/mcp";
export const createSurfaceAuth = (ctx: GenericCtx<DataModel>) => {
  const deliver = async (email: string, kind: string, value: string) => {
    await requireActionCtx(ctx).runMutation(internal.authFixtures.deliver, {
      email,
      kind,
      value,
    });
  };
  return betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    basePath: "/api/surfaces",
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: ({ user, url }) => deliver(user.email, "reset", url),
    },
    emailVerification: {
      sendVerificationEmail: ({ user, url }) =>
        deliver(user.email, "verify", url),
    },
    plugins: [
      magicLink({
        sendMagicLink: ({ email, url }) => deliver(email, "magic", url),
      }),
      emailOTP({
        storeOTP: "hashed",
        allowedAttempts: 3,
        sendVerificationOTP: ({ email, type, otp }) =>
          deliver(email, type, otp),
      }),
      genericOAuth({
        config: [
          {
            providerId: "fixture",
            clientId: "local-fixture",
            clientSecret: "local-fixture-secret",
            authorizationUrl: "http://127.0.0.1:3211/fixture-oauth/authorize",
            tokenUrl: "http://127.0.0.1:3211/fixture-oauth/token",
            userInfoUrl: "http://127.0.0.1:3211/fixture-oauth/userinfo",
            scopes: ["email", "profile"],
            pkce: true,
          },
        ],
      }),
      crossDomain({ siteUrl: "http://localhost:5176" }),
      convex({ authConfig }),
    ],
  });
};

export const createMcpAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    basePath: "/api/mcp-auth",
    trustedOrigins: ["http://localhost:5176"],
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          remoteUrl: `${process.env.CONVEX_SITE_URL}/api/mcp-auth/convex/jwks`,
          keyPairConfig: { alg: "RS256" },
        },
      }),
      convex({ authConfig }),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource,
        scopes: [
          "openid",
          "profile",
          "email",
          "offline_access",
          "mcp:read",
          "mcp:admin",
        ],
        grantTypes: ["authorization_code", "refresh_token"],
        refreshTokenReuseInterval: 0,
      }),
    ],
  });
