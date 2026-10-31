import type { BetterAuthOptions } from "better-auth/minimal";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { options } from "../../auth-options.js";

// Test-only options for the "Convex semantics" suite
// (src/client/convex-semantics.test.ts). It adds, on top of the default
// component options:
//
// - the real `deviceAuthorization()` plugin, whose `deviceCode` table has no
//   field-level `unique` attributes and relies entirely on table-level
//   `indexes: [{ fields, unique: true }]` (a Better Auth 1.7 pattern);
// - a `nullable` table with optional fields that are unindexed (`plain`),
//   covered by a table-level non-unique index (`indexed`), and unique
//   (`uniq`), plus a numeric `counter` for incrementOne;
// - a `clientResource` table with a compound table-level unique index on
//   `[clientId, resourceId]`, modelled on `@better-auth/oauth-provider`'s
//   `oauthClientResource`.
export const convexSemanticsProfileOptions = {
  ...options,
  plugins: [
    ...(options.plugins ?? []),
    deviceAuthorization(),
    {
      id: "convex-semantics-test",
      schema: {
        nullable: {
          fields: {
            plain: { type: "string", required: false },
            indexed: { type: "string", required: false },
            uniq: { type: "string", required: false, unique: true },
            counter: { type: "number", required: false },
          },
          indexes: [{ fields: ["indexed"] }],
        },
        clientResource: {
          fields: {
            clientId: { type: "string", required: true },
            resourceId: { type: "string", required: true },
            label: { type: "string", required: false },
          },
          indexes: [{ fields: ["clientId", "resourceId"], unique: true }],
        },
      },
    },
  ],
} as BetterAuthOptions;
