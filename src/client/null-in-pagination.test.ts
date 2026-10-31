/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import { paginate } from "./adapter-utils.js";

const optional = () => v.optional(v.union(v.string(), v.null()));
const schema = defineSchema({
  item: defineTable({
    group: optional(),
    a: optional(),
    b: optional(),
    c: optional(),
    d: optional(),
    rank: v.number(),
  }).index("compound", ["group", "a", "b", "c", "d", "rank"]),
});
const modules = import.meta.glob("../component/**/*.*s");
it("rejects a legacy-format cursor and supports an explicit fresh restart", async () => {
  const simple = defineSchema({
    item: defineTable({ a: optional(), rank: v.number() }).index("a", ["a"]),
  });
  const t = convexTest(simple, modules);
  await t.run(async (ctx) => {
    for (let rank = 0; rank < 3; rank++)
      await ctx.db.insert("item", { a: null, rank });
    await ctx.db.insert("item", { rank: 3 });
  });
  // The previous adapter delegated this exact range directly to stream.paginate.
  const first = await t.run((ctx) =>
    stream(ctx.db, simple)
      .query("item")
      .withIndex("a", (q) => q.eq("a", null))
      .paginate({ cursor: null, numItems: 1 })
  );
  const args = {
    model: "item",
    where: [{ field: "a", value: null }],
    paginationOpts: { cursor: null, numItems: 10 },
  };
  await expect(
    t.run((ctx) =>
      paginate(
        ctx,
        simple,
        {},
        {
          ...args,
          paginationOpts: { cursor: first.continueCursor, numItems: 10 },
        }
      )
    )
  ).rejects.toThrow("BETTER_AUTH_PAGINATION_RESTART_REQUIRED");
  const fresh = await t.run((ctx) => paginate(ctx, simple, {}, args));
  expect(fresh.page.map((doc) => doc.rank)).toEqual([0, 1, 2]);
});

it("versions split/end cursors and rejects malformed or unsupported cursor versions", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let rank = 0; rank < 6; rank++)
      await ctx.db.insert("item", { group: "second", rank });
  });
  const args = {
    model: "item",
    where: [{ field: "group", value: "second" }],
    paginationOpts: { cursor: null, numItems: 4, maximumBytesRead: 1 },
  };
  const first = await t.run((ctx) => paginate(ctx, schema, {}, args));
  expect(first.continueCursor).toMatch(/^better-auth:1:/);
  expect(first.splitCursor).toMatch(/^better-auth:1:/);
  const refreshed = await t.run((ctx) =>
    paginate(
      ctx,
      schema,
      {},
      {
        ...args,
        paginationOpts: {
          cursor: null,
          numItems: 4,
          endCursor: first.continueCursor,
        },
      }
    )
  );
  expect(refreshed.page.map((doc) => doc.rank)).toEqual(
    first.page.map((doc) => doc.rank)
  );
  for (const invalid of [
    "[]",
    "better-auth:0:[]",
    "better-auth:1:not-json",
    "better-auth:1:{}",
  ]) {
    await expect(
      t.run((ctx) =>
        paginate(
          ctx,
          schema,
          {},
          { ...args, paginationOpts: { cursor: invalid, numItems: 1 } }
        )
      )
    ).rejects.toThrow("RESTART_REQUIRED");
    await expect(
      t.run((ctx) =>
        paginate(
          ctx,
          schema,
          {},
          {
            ...args,
            paginationOpts: { cursor: null, endCursor: invalid, numItems: 1 },
          }
        )
      )
    ).rejects.toThrow("RESTART_REQUIRED");
  }
});

it("empty and repeated IN values preserve set semantics", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("item", { group: "second", rank: 0 }));
  for (const values of [[], ["second", "second"]]) {
    const page = await t.run((ctx) =>
      paginate(
        ctx,
        schema,
        {},
        {
          model: "item",
          where: [{ field: "group", operator: "in", value: values }],
          paginationOpts: { cursor: null, numItems: 10 },
        }
      )
    );
    expect(page.page.map((doc) => doc.rank)).toEqual(values.length ? [0] : []);
  }
});
