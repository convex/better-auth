import type { BetterAuthOptions } from "better-auth/minimal";
import { options } from "../../auth-options.js";

// Test-only options used to provide static schema coverage for tests that
// otherwise mutate plugin tables and user additional fields at runtime.
export const pluginTableProfileOptions = {
  ...options,
  user: {
    ...options.user,
    additionalFields: {
      ...options.user?.additionalFields,
      testField: {
        type: "string",
        required: false,
        defaultValue: "test-value",
      },
      cbDefaultValueField: {
        type: "string",
        required: false,
        defaultValue: () => "advanced-test-value",
      },
      customField: {
        type: "string",
        required: false,
        input: false,
        defaultValue: "default-value",
      },
      numericField: {
        type: "number",
        required: false,
        defaultValue: 0,
      },
      dateField: {
        type: "date",
        required: false,
      },
    },
  },
  plugins: [
    ...(options.plugins ?? []),
    {
      id: "one-to-one-test",
      schema: {
        oneToOneTable: {
          fields: {
            oneToOne: {
              type: "string",
              required: true,
              references: { field: "id", model: "user" },
              unique: true,
            },
          },
        },
      },
    },
    {
      // Table-level unique index (Better Auth 1.7 `indexes`), as declared by
      // e.g. the device-authorization and oauth-provider plugins.
      id: "compound-unique-test",
      schema: {
        compoundUnique: {
          fields: {
            groupId: {
              type: "string",
              required: true,
            },
            slot: {
              type: "string",
              required: true,
            },
            label: {
              type: "string",
              required: false,
            },
          },
          indexes: [{ fields: ["groupId", "slot"], unique: true }],
        },
      },
    },
    {
      id: "plugin-table-test-model",
      schema: {
        testModel: {
          fields: {
            nullableReference: {
              type: "string",
              references: { field: "id", model: "user" },
              required: false,
            },
            testField: {
              type: "string",
              required: false,
              defaultValue: "test-value",
            },
            cbDefaultValueField: {
              type: "string",
              required: false,
              defaultValue: () => "advanced-test-value",
            },
            stringArray: {
              type: "string[]",
              required: false,
            },
            numberArray: {
              type: "number[]",
              required: false,
            },
            json: {
              type: "json",
              required: false,
            },
          },
        },
      },
    },
  ],
} as BetterAuthOptions;
