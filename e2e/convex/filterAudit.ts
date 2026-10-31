import { createApi } from "@convex-dev/better-auth";
import { defineSchema } from "convex/server";
import { mutation, query } from "./_generated/server";
import { filterTables } from "./filterSchema";
export const {
  findOne,
  findMany,
  updateOne,
  incrementOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(defineSchema(filterTables), () => ({
  plugins: [
    {
      id: "filter-guard-audit",
      schema: {
        filterItem: {
          fields: {
            group: { type: "string", required: false },
            category: { type: "string", required: true },
            rank: { type: "number", required: true },
            flag: { type: "boolean", required: false },
          },
        },
        nestedItem: {
          fields: {
            profile: { type: "json", required: false },
            unindexed: { type: "json", required: false },
            rank: { type: "number", required: true },
            counter: { type: "number", required: false },
            flag: { type: "boolean", required: false },
          },
        },
      },
    },
  ],
}));
const localOnly = () => {
  if (process.env.CONVEX_SITE_URL !== "http://127.0.0.1:3211")
    throw new Error("Disposable filter audit only");
};
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    localOnly();
    for (const table of ["filterItem", "nestedItem"] as const)
      for (const row of await ctx.db.query(table).collect())
        await ctx.db.delete(row._id);
    for (let rank = 0; rank < 205; rank++)
      await ctx.db.insert("filterItem", {
        group: rank % 2 ? "b" : "a",
        category: "wanted",
        rank,
      });
    await ctx.db.insert("filterItem", {
      group: "b",
      category: "excluded",
      rank: 205,
    });
    await ctx.db.insert("filterItem", {
      group: "c",
      category: "wanted",
      rank: 206,
    });
    for (const row of [
      { rank: 0 },
      { rank: 1, profile: null },
      { rank: 2, profile: {} },
      { rank: 3, profile: { name: null } },
      { rank: 4, profile: { name: "present", contact: { city: "Paris" } } },
      { rank: 5, profile: { name: "present", contact: null } },
      {
        rank: 6,
        profile: { name: "present", contact: { city: "Rome" } },
        unindexed: { tag: "keep" },
      },
    ])
      await ctx.db.insert("nestedItem", row);
  },
});
export const rows = query({
  args: {},
  handler: async (ctx) => {
    localOnly();
    return {
      items: await ctx.db.query("filterItem").collect(),
      nested: await ctx.db.query("nestedItem").collect(),
    };
  },
});
