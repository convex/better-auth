/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../component/testProfiles/schema.constraints.js";
import { api } from "../component/_generated/api.js";

describe("updateMany pagination", () => {
  it("does not treat a later ID filter as the atomic ID-set path", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const ids = await t.run(async (ctx) => {
      const insertedIds = [];
      for (let i = 0; i < 300; i += 1) {
        insertedIds.push(
          await ctx.db.insert("account", {
            issuer: `original-${i}`,
            accountId: `mixed-filter-account-${i}`,
            providerId: "mixed-filter-provider",
            userId: `mixed-filter-user-${i}`,
            scope: "mixed-filter-scope",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        );
      }
      return insertedIds;
    });

    await expect(
      t.mutation(api.testProfiles.adapterConstraints.updateMany, {
        input: {
          model: "account",
          update: { issuer: "updated-issuer" },
          where: [
            {
              field: "scope",
              operator: "in",
              value: ["mixed-filter-scope"],
            },
            { field: "_id", operator: "in", value: ids },
          ],
        },
        paginationOpts: { cursor: null, numItems: 200 },
      })
    ).rejects.toThrow(
      "Cannot update unique fields across multiple pages in account"
    );

    const accounts = await t.run((ctx) => ctx.db.query("account").collect());
    expect(accounts).toHaveLength(300);
    expect(
      accounts.every(({ issuer }) => issuer?.startsWith("original-") === true)
    ).toBe(true);
  });
});
