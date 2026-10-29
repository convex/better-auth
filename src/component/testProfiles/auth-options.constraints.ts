import type { BetterAuthOptions } from "better-auth/minimal";
import { options } from "../../auth-options.js";

// Test-only constraints; production accounts do not require issuer.
export const constraintsProfileOptions = {
  ...options,
  plugins: [
    ...(options.plugins ?? []),
    {
      id: "test-account-constraints",
      schema: {
        account: {
          fields: { issuer: { type: "string", required: true } },
          indexes: [{ fields: ["issuer", "accountId"], unique: true }],
        },
      },
    },
  ],
} satisfies BetterAuthOptions;
