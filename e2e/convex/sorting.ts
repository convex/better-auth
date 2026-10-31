import { defineSchema } from "convex/server";
import { v } from "convex/values";
import { createApi } from "@convex-dev/better-auth";
import { sortingTable } from "./sortingSchema";
import { mutation, query } from "./_generated/server";
export const { findMany, updateMany, deleteMany } = createApi(
  defineSchema({ sortItem: sortingTable }),
  () => ({
    plugins: [
      {
        id: "sorting-audit",
        schema: {
          sortItem: {
            fields: {
              group: { type: "string", required: true },
              rank: { type: "number", required: true },
              keep: { type: "boolean", required: true },
              value: { type: "json", required: false },
              profile: { type: "json", required: false },
            },
          },
        },
      },
    ],
  })
);
const localOnly = () => {
  if (process.env.CONVEX_SITE_URL !== "http://127.0.0.1:3211")
    throw new Error("Local sorting audit only");
};
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    localOnly();
    for (const doc of await ctx.db.query("sortItem").collect())
      await ctx.db.delete("sortItem", doc._id);
    for (let rank = 0; rank < 83; rank++) {
      const variant = rank % 8;
      await ctx.db.insert("sortItem", {
        group: ["a", "b", "c"][rank % 3],
        rank,
        keep: rank % 5 === 0,
        profile: { score: variant - 6 },
      });
    }
  },
});
export const native = query({
  args: {
    index: v.union(v.literal("nested"), v.literal("group_nested")),
    direction: v.union(v.literal("asc"), v.literal("desc")),
    group: v.optional(v.string()),
    bounded: v.optional(v.boolean()),
  },
  handler: (ctx, args) => {
    localOnly();
    const table = ctx.db.query("sortItem");
    const indexed =
      args.index === "group_nested"
        ? table.withIndex("group_nested", (q) => {
            if (args.group === undefined) return q;
            const prefix = q.eq("group", args.group);
            return args.bounded
              ? prefix.gte("profile.score", -1).lte("profile.score", 0)
              : prefix;
          })
        : table.withIndex("nested", (q) =>
            args.bounded
              ? q.gte("profile.score", -1).lte("profile.score", 0)
              : q
          );
    return indexed.order(args.direction).collect();
  },
});
