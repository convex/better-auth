/// <reference types="vite/client" />

import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import type { BetterAuthDBSchema } from "better-auth/db";
import { checkUniqueFields, paginate } from "./adapter-utils.js";

const schema = defineSchema({
  account: defineTable({
    issuer: v.string(),
    accountId: v.string(),
  }).index("issuer_accountId", ["issuer", "accountId"]),
});

const betterAuthSchema = {
  account: {
    modelName: "account",
    fields: {
      issuer: { type: "string", required: true },
      accountId: { type: "string", required: true },
    },
    indexes: [{ fields: ["issuer", "accountId"], unique: true }],
  },
} satisfies BetterAuthDBSchema;

const credentialSchema = defineSchema({
  account: defineTable({
    userId: v.string(),
    providerId: v.string(),
    issuer: v.string(),
    accountId: v.string(),
  }).index("userId_providerId_issuer_accountId", [
    "userId",
    "providerId",
    "issuer",
    "accountId",
  ]),
});

const credentialBetterAuthSchema = {
  account: {
    modelName: "account",
    fields: {
      userId: { type: "string", required: true },
      providerId: { type: "string", required: true },
      issuer: { type: "string", required: true },
      accountId: { type: "string", required: true },
    },
  },
} satisfies BetterAuthDBSchema;

const modules = import.meta.glob("../component/**/*.*s");

describe("ordered compound indexes", () => {
  it("uses an index for Better Auth's credential account lookup", async () => {
    const t = convexTest(credentialSchema, modules);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await t.run((ctx) =>
        paginate(ctx, credentialSchema, credentialBetterAuthSchema, {
          model: "account",
          where: [
            { field: "userId", value: "user-1" },
            { field: "providerId", value: "credential" },
            { field: "issuer", value: "local:credential" },
            { field: "accountId", value: "user-1" },
          ],
          paginationOpts: { cursor: null, numItems: 1 },
        })
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("pairs equality values with fields in the selected index order", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("account", {
        issuer: "issuer-value",
        accountId: "account-value",
      });
      await ctx.db.insert("account", {
        issuer: "account-value",
        accountId: "issuer-value",
      });
    });

    const result = await t.run((ctx) =>
      paginate(ctx, schema, betterAuthSchema, {
        model: "account",
        where: [
          { field: "accountId", value: "account-value" },
          { field: "issuer", value: "issuer-value" },
        ],
        paginationOpts: { cursor: null, numItems: 10 },
      })
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
      issuer: "issuer-value",
      accountId: "account-value",
    });
  });

  it("checks compound uniqueness against the declared index order", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("account", {
        issuer: "issuer-value",
        accountId: "account-value",
      })
    );

    await expect(
      t.run((ctx) =>
        checkUniqueFields(ctx, schema, betterAuthSchema, "account", {
          issuer: "issuer-value",
          accountId: "account-value",
        })
      )
    ).rejects.toThrow(
      "account unique constraint issuer+accountId already exists"
    );
  });
});
