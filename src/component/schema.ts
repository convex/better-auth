/**
 * Generated from Better Auth 1.7.7, then intentionally staged for the 0.13
 * migration. Do not regenerate it without preserving the documented migration
 * exceptions: optional legacy account.issuer and the three legacy OAuth provider
 * tables retained below.
 * To regenerate the schema, from your project root:
 *
 *   npx auth generate --output src/component/schema.ts
 *
 * To customize the schema, generate to an alternate file and import
 * the table definitions to your schema file. See
 * https://labs.convex.dev/better-auth/features/local-install#adding-custom-indexes.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const tables = {
  user: defineTable({
    name: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    image: v.optional(v.union(v.null(), v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
    twoFactorEnabled: v.optional(v.union(v.null(), v.boolean())),
    isAnonymous: v.optional(v.union(v.null(), v.boolean())),
    username: v.optional(v.union(v.null(), v.string())),
    displayUsername: v.optional(v.union(v.null(), v.string())),
    phoneNumber: v.optional(v.union(v.null(), v.string())),
    phoneNumberVerified: v.optional(v.union(v.null(), v.boolean())),
    userId: v.optional(v.union(v.null(), v.string())),
  })
    .index("email_name", ["email", "name"])
    .index("name", ["name"])
    .index("userId", ["userId"])
    .index("username", ["username"])
    .index("phoneNumber", ["phoneNumber"]),
  session: defineTable({
    expiresAt: v.number(),
    token: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    ipAddress: v.optional(v.union(v.null(), v.string())),
    userAgent: v.optional(v.union(v.null(), v.string())),
    userId: v.string(),
  })
    .index("expiresAt", ["expiresAt"])
    .index("expiresAt_userId", ["expiresAt", "userId"])
    .index("token", ["token"])
    .index("userId", ["userId"]),
  account: defineTable({
    // Retained only for data written by Better Auth 1.7.0–1.7.2.
    // Better Auth 1.7.7 neither requires nor writes issuer.
    issuer: v.optional(v.union(v.null(), v.string())),
    accountId: v.string(),
    providerId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.union(v.null(), v.string())),
    refreshToken: v.optional(v.union(v.null(), v.string())),
    idToken: v.optional(v.union(v.null(), v.string())),
    accessTokenExpiresAt: v.optional(v.union(v.null(), v.number())),
    refreshTokenExpiresAt: v.optional(v.union(v.null(), v.number())),
    scope: v.optional(v.union(v.null(), v.string())),
    password: v.optional(v.union(v.null(), v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("accountId", ["accountId"])
    .index("accountId_providerId", ["accountId", "providerId"])
    .index("providerId_userId", ["providerId", "userId"])
    .index("userId_providerId_accountId", [
      "userId",
      "providerId",
      "accountId",
    ])
    .index("userId", ["userId"]),
  verification: defineTable({
    identifier: v.string(),
    value: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("expiresAt", ["expiresAt"])
    .index("identifier", ["identifier"]),
  twoFactor: defineTable({
    secret: v.string(),
    backupCodes: v.string(),
    userId: v.string(),
    verified: v.optional(v.union(v.null(), v.boolean())),
    failedVerificationCount: v.optional(v.union(v.null(), v.number())),
    lockedUntil: v.optional(v.union(v.null(), v.number())),
  }).index("userId", ["userId"]),
  // Kept during the 0.13 migration so existing OIDC provider clients can be
  // exported before moving provider support to a Local Install.
  oauthApplication: defineTable({
    name: v.optional(v.union(v.null(), v.string())),
    icon: v.optional(v.union(v.null(), v.string())),
    metadata: v.optional(v.union(v.null(), v.string())),
    clientId: v.optional(v.union(v.null(), v.string())),
    clientSecret: v.optional(v.union(v.null(), v.string())),
    redirectUrls: v.optional(v.union(v.null(), v.string())),
    type: v.optional(v.union(v.null(), v.string())),
    disabled: v.optional(v.union(v.null(), v.boolean())),
    userId: v.optional(v.union(v.null(), v.string())),
    createdAt: v.optional(v.union(v.null(), v.number())),
    updatedAt: v.optional(v.union(v.null(), v.number())),
  })
    .index("clientId", ["clientId"])
    .index("userId", ["userId"]),
  oauthAccessToken: defineTable({
    accessToken: v.optional(v.union(v.null(), v.string())),
    refreshToken: v.optional(v.union(v.null(), v.string())),
    accessTokenExpiresAt: v.optional(v.union(v.null(), v.number())),
    refreshTokenExpiresAt: v.optional(v.union(v.null(), v.number())),
    clientId: v.optional(v.union(v.null(), v.string())),
    userId: v.optional(v.union(v.null(), v.string())),
    scopes: v.optional(v.union(v.null(), v.string())),
    createdAt: v.optional(v.union(v.null(), v.number())),
    updatedAt: v.optional(v.union(v.null(), v.number())),
  })
    .index("accessToken", ["accessToken"])
    .index("refreshToken", ["refreshToken"])
    .index("clientId", ["clientId"])
    .index("userId", ["userId"]),
  oauthConsent: defineTable({
    clientId: v.optional(v.union(v.null(), v.string())),
    userId: v.optional(v.union(v.null(), v.string())),
    scopes: v.optional(v.union(v.null(), v.string())),
    createdAt: v.optional(v.union(v.null(), v.number())),
    updatedAt: v.optional(v.union(v.null(), v.number())),
    consentGiven: v.optional(v.union(v.null(), v.boolean())),
  })
    .index("clientId_userId", ["clientId", "userId"])
    .index("userId", ["userId"]),
  jwks: defineTable({
    publicKey: v.string(),
    privateKey: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.union(v.null(), v.number())),
    alg: v.optional(v.union(v.null(), v.string())),
    crv: v.optional(v.union(v.null(), v.string())),
  }),
  rateLimit: defineTable({
    key: v.string(),
    count: v.number(),
    lastRequest: v.number(),
  }).index("key", ["key"]),
};

const schema = defineSchema(tables);

export default schema;
