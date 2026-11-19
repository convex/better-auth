/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { encodeDeterministicId } from "@better-auth/core/db/internal";
import { anyApi } from "convex/server";
import schema from "../component/testProfiles/schema.profile-plugin-table.js";
import { pluginTableProfileOptions } from "../component/testProfiles/auth-options.profile-plugin-table.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";

const options = {
  ...pluginTableProfileOptions,
  plugins: [
    ...(pluginTableProfileOptions.plugins ?? []),
    {
      // Shaped like @better-auth/oauth-provider 1.7's `oauthClientAssertion`.
      id: "client-assertion-test",
      schema: {
        oauthClientAssertion: {
          fields: {
            expiresAt: { type: "date", required: true },
          },
        },
      },
    },
  ],
} as BetterAuthOptions;

const setup = (betterAuthOptions: BetterAuthOptions = options) => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as any;
  return createClient<DataModel>(
    { adapter: anyApi.testProfiles.adapterPluginTable } as any,
    { verbose: false }
  ).adapter(ctx)(betterAuthOptions);
};

// An id Better Auth derives for a row of `model`.
const deriveId = (adapter: ReturnType<typeof setup>, model: string) =>
  encodeDeterministicId(crypto.getRandomValues(new Uint8Array(24)), options, {
    adapter,
    model,
  });

describe("ids Better Auth derives", () => {
  it("refuses a private_key_jwt client assertion", async () => {
    const adapter = setup();
    const id = deriveId(adapter, "oauthClientAssertion");
    await expect(
      adapter.create({
        model: "oauthClientAssertion",
        data: { id, expiresAt: new Date(Date.now() + 300_000) },
        forceAllowId: true,
      })
    ).rejects.toThrow("private_key_jwt client authentication isn't supported");
  });

  it("refuses a derived id on any other table", async () => {
    const adapter = setup();
    const id = deriveId(adapter, "compoundIndex");
    await expect(
      adapter.create({
        model: "compoundIndex",
        data: { id, groupId: "g", slot: "1" },
        forceAllowId: true,
      })
    ).rejects.toThrow("Better Auth derived an id for a new compoundIndex row");
  });

  it("refuses an OAuth Provider older than 1.7.25", () => {
    const withOAuthProvider = (version: string) =>
      setup({
        ...options,
        plugins: [
          ...(options.plugins ?? []),
          { id: "oauth-provider", version },
        ],
      } as BetterAuthOptions);
    expect(() => withOAuthProvider("1.7.24")).toThrow(
      "1.7.25 or later are required"
    );
    expect(() => withOAuthProvider("1.7.25")).not.toThrow();
    expect(() => withOAuthProvider("1.8.0")).not.toThrow();
  });
});
