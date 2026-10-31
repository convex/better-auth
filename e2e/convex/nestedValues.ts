import { defineSchema } from "convex/server";
import { v } from "convex/values";
import { createApi } from "@convex-dev/better-auth";
import { mutation, query } from "./_generated/server";
import { nestedValueTable } from "./nestedValueSchema";
export const {
  findMany,
  updateOne,
  updateMany,
  incrementOne,
  deleteOne,
  deleteMany,
} = createApi(defineSchema({ nestedValueItem: nestedValueTable }), () => ({
  plugins: [
    {
      id: "nested-values-audit",
      schema: {
        nestedValueItem: {
          fields: {
            label: { type: "string", required: true },
            rank: { type: "number", required: true },
            count: { type: "number", required: true },
            profile: { type: "json", required: false },
            rangeValue: { type: "json", required: false },
          },
        },
      },
    },
  ],
}));
const localOnly = () => {
  if (process.env.CONVEX_SITE_URL !== "http://127.0.0.1:3211")
    throw new Error("Local nested-value audit only");
};
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    localOnly();
    for (const row of await ctx.db.query("nestedValueItem").collect())
      await ctx.db.delete("nestedValueItem", row._id);
    const profiles = [
      undefined,
      null,
      "abc",
      [1, 2, 3],
      new ArrayBuffer(3),
      3,
      3n,
      true,
      Object.create(null) as {
        length?: number;
        byteLength?: number;
        toString?: number;
      },
      { length: null, byteLength: null, toString: null },
      { length: 2, byteLength: 2, toString: 2 },
      { length: 3, byteLength: 3, toString: 3 },
      { length: 4, byteLength: 4, toString: 4 },
    ];
    const labels = [
      "missing",
      "null",
      "string",
      "array",
      "bytes",
      "number",
      "bigint",
      "boolean",
      "empty",
      "null-child",
      "object2",
      "object3",
      "object4",
    ];
    for (const [rank, profile] of profiles.entries())
      await ctx.db.insert("nestedValueItem", {
        label: labels[rank],
        rank,
        count: 0,
        ...(profile === undefined ? {} : { profile }),
      });
  },
});
export const native = query({
  args: {
    field: v.union(
      v.literal("length"),
      v.literal("byteLength"),
      v.literal("toString")
    ),
    direction: v.union(v.literal("asc"), v.literal("desc")),
    guard: v.optional(v.union(v.number(), v.null())),
  },
  handler: (ctx, args) => {
    localOnly();
    const index = {
      length: "length_rank",
      byteLength: "bytes_rank",
      toString: "method_rank",
    }[args.field] as "length_rank" | "bytes_rank" | "method_rank";
    const path = `profile.${args.field}` as const;
    let rows = ctx.db
      .query("nestedValueItem")
      .withIndex(index)
      .order(args.direction);
    if (args.guard === null)
      rows = rows.filter((q) =>
        q.or(q.eq(q.field(path), undefined), q.eq(q.field(path), null))
      );
    else if (args.guard !== undefined)
      rows = rows.filter((q) => q.eq(q.field(path), args.guard));
    return rows.collect();
  },
});

export const seedRanges = mutation({
  args: { mixed: v.boolean() },
  handler: async (ctx, args) => {
    localOnly();
    for (const row of await ctx.db.query("nestedValueItem").collect())
      await ctx.db.delete("nestedValueItem", row._id);
    const entries = args.mixed
      ? ([
          ["missing", undefined],
          ["null", null],
          ["negative", -1],
          ["zero", 0],
          ["two", 2],
          ["false", false],
          ["true", true],
          ["string-zero", "0"],
          ["string-two", "2"],
        ] as const)
      : ([
          ["ascii", "z"],
          ["private-use", "\uE000"],
          ["astral", "\u{10000}"],
        ] as const);
    for (const [rank, [label, rangeValue]] of entries.entries())
      await ctx.db.insert("nestedValueItem", {
        label,
        rank,
        count: 0,
        ...(rangeValue === undefined ? {} : { rangeValue }),
      });
  },
});
export const nativeRange = query({
  args: {
    operator: v.union(
      v.literal("lt"),
      v.literal("lte"),
      v.literal("gt"),
      v.literal("gte")
    ),
    bound: v.union(v.number(), v.string(), v.boolean(), v.null()),
  },
  handler: (ctx, args) => {
    localOnly();
    return ctx.db
      .query("nestedValueItem")
      .withIndex("range_value_rank", (q) =>
        q[args.operator]("rangeValue", args.bound)
      )
      .collect();
  },
});
