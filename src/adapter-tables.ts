import type { BetterAuthDBSchema } from "better-auth/db";

// The parts of getAuthTables(options) the adapter reads, for the default auth
// options in ./auth-options.ts. Written out so that loading the adapter, which
// Convex does for every call, doesn't load those options and their plugins.
// component/adapter.test.ts fails if this stops matching them.
export const adapterTables = {
  user: {
    modelName: "user",
    fields: {
      email: { unique: true },
      username: { unique: true },
      phoneNumber: { unique: true },
    },
  },
  session: { modelName: "session", fields: { token: { unique: true } } },
  account: { modelName: "account", fields: {} },
  verification: { modelName: "verification", fields: {} },
  twoFactor: { modelName: "twoFactor", fields: {} },
  jwks: { modelName: "jwks", fields: {} },
  rateLimit: { modelName: "rateLimit", fields: { key: { unique: true } } },
} as unknown as BetterAuthDBSchema;
