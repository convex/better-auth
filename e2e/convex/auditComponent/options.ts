import type { BetterAuthOptions } from "better-auth/minimal";
export const options = {
  rateLimit: { storage: "database" },
  plugins: [
    {
      id: "audit-mapped-constraints",
      schema: {
        ledger: {
          modelName: "mapped",
          fields: {
            tenant: { fieldName: "tenantKey", type: "string", required: true },
            subject: {
              fieldName: "subjectKey",
              type: "string",
              required: true,
            },
            count: { type: "number", required: false },
            memo: { type: "string", required: false },
          },
          indexes: [{ fields: ["tenant", "subject"], unique: true }],
        },
      },
    },
  ],
} satisfies BetterAuthOptions;
