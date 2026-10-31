/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { paginate } from "./adapter-utils.js";
const schema = defineSchema({
  item: defineTable({
    parent: v.object({ value: v.string() }),
    rank: v.number(),
  }).index("nested", ["parent.value", "rank"]),
});
it("returns nested indexed non-null equality results", async () => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  await t.run(async (ctx) => {
    await ctx.db.insert("item", { parent: { value: "match" }, rank: 1 });
    await ctx.db.insert("item", { parent: { value: "other" }, rank: 2 });
  });
  const result = await t.run((ctx) =>
    paginate(
      ctx,
      schema,
      {},
      {
        model: "item",
        where: [{ field: "parent.value", value: "match" }],
        sortBy: { field: "rank", direction: "asc" },
        paginationOpts: { cursor: null, numItems: 10 },
      }
    )
  );
  expect(result.page.map((x: any) => x.parent.value)).toEqual(["match"]);
});
it("returns four explicit null equality values on a wide index", async () => {
  const s = defineSchema({
    item: defineTable({
      a: v.union(v.string(), v.null()),
      b: v.union(v.string(), v.null()),
      c: v.union(v.string(), v.null()),
      d: v.union(v.string(), v.null()),
      rank: v.number(),
    }).index("wide", ["a", "b", "c", "d", "rank"]),
  });
  const t = convexTest(s, import.meta.glob("../component/**/*.*s"));
  await t.run(async (ctx) => {
    await ctx.db.insert("item", {
      a: null,
      b: null,
      c: null,
      d: null,
      rank: 1,
    });
    await ctx.db.insert("item", { a: "x", b: null, c: null, d: null, rank: 2 });
  });
  const result = await t.run((ctx) =>
    paginate(
      ctx,
      s,
      {},
      {
        model: "item",
        where: ["a", "b", "c", "d"].map((field) => ({ field, value: null })),
        sortBy: { field: "rank", direction: "asc" },
        paginationOpts: { cursor: null, numItems: 10 },
      }
    )
  );
  expect(result.page.map((x) => x.rank)).toEqual([1]);
});
it("returns four non-null equality values on a wide index", async () => {
  const s = defineSchema({
    item: defineTable({
      a: v.string(),
      b: v.string(),
      c: v.string(),
      d: v.string(),
      rank: v.number(),
    }).index("wide", ["a", "b", "c", "d", "rank"]),
  });
  const t = convexTest(s, import.meta.glob("../component/**/*.*s"));
  await t.run(async (ctx) => {
    await ctx.db.insert("item", { a: "x", b: "x", c: "x", d: "x", rank: 1 });
    await ctx.db.insert("item", { a: "z", b: "x", c: "x", d: "x", rank: 2 });
  });
  const result = await t.run((ctx) =>
    paginate(
      ctx,
      s,
      {},
      {
        model: "item",
        where: ["a", "b", "c", "d"].map((field) => ({ field, value: "x" })),
        sortBy: { field: "rank", direction: "asc" },
        paginationOpts: { cursor: null, numItems: 10 },
      }
    )
  );
  expect(result.page.map((x) => x.rank)).toEqual([1]);
});
it("upstream returns explicit null rows for optional wide fields", async () => {
  const f = () => v.optional(v.union(v.string(), v.null()));
  const s = defineSchema({
    item: defineTable({
      a: f(),
      b: f(),
      c: f(),
      d: f(),
      rank: v.number(),
    }).index("wide", ["a", "b", "c", "d", "rank"]),
  });
  const t = convexTest(s, import.meta.glob("../component/**/*.*s"));
  await t.run(async (ctx) => {
    await ctx.db.insert("item", {
      a: null,
      b: null,
      c: null,
      d: null,
      rank: 1,
    });
  });
  const result = await t.run((ctx) =>
    paginate(
      ctx,
      s,
      {},
      {
        model: "item",
        where: ["a", "b", "c", "d"].map((field) => ({ field, value: null })),
        sortBy: { field: "rank", direction: "asc" },
        paginationOpts: { cursor: null, numItems: 10 },
      }
    )
  );
  expect(result.page.map((x) => x.rank)).toEqual([1]);
});

it("retains existing indexed-null behavior for omitted fields", async () => {
  const s = defineSchema({
    item: defineTable({
      a: v.optional(v.union(v.string(), v.null())),
      rank: v.number(),
    }).index("a_rank", ["a", "rank"]),
  });
  const t = convexTest(s, import.meta.glob("../component/**/*.*s"));
  await t.run(async (ctx) => {
    await ctx.db.insert("item", { a: null, rank: 1 });
    await ctx.db.insert("item", { rank: 2 });
  });
  const result = await t.run((ctx) =>
    paginate(
      ctx,
      s,
      {},
      {
        model: "item",
        where: [{ field: "a", value: null }],
        sortBy: { field: "rank", direction: "asc" },
        paginationOpts: { cursor: null, numItems: 10 },
      }
    )
  );
  expect(result.page.map((row) => row.rank)).toEqual([1]);
});
