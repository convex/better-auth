import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { jwt } from "better-auth/plugins/jwt";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import schema from "./betterAuth/schema";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel, typeof schema>(
  components.oauthProvider,
  { local: { schema } }
);
export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    emailAndPassword: { enabled: true },
    baseURL: process.env.CONVEX_SITE_URL,
    basePath: process.env.AUDIT_AUTH_BASE_PATH ?? "/api/auth",
    database: authComponent.adapter(ctx),
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          remoteUrl: `${process.env.CONVEX_SITE_URL}${process.env.AUDIT_AUTH_BASE_PATH ?? "/api/auth"}/convex/jwks`,
          keyPairConfig: { alg: "RS256" },
        },
      }),
      convex({
        authConfig,
        options: { basePath: process.env.AUDIT_AUTH_BASE_PATH ?? "/api/auth" },
      }),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: ["openid", "profile", "email", "offline_access"],
        grantTypes: ["authorization_code", "refresh_token"],
        refreshTokenReuseInterval: 0,
      }),
    ],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

const eddsaComponent = createClient<DataModel>(components.audit);
export const createEdDsaAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    basePath: "/eddsa-auth",
    database: eddsaComponent.adapter(ctx),
    emailAndPassword: { enabled: true },
    plugins: [
      convex({
        authConfig: {
          providers: [
            { domain: process.env.CONVEX_SITE_URL!, applicationID: "convex" },
          ],
        },
        options: { basePath: "/eddsa-auth" },
      }),
    ],
  });
