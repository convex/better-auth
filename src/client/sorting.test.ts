/// <reference types="vite/client" />
import { it, expect } from "vitest";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { paginate } from "./adapter-utils.js";

const schema = defineSchema({
  item: defineTable({
    rank: v.optional(v.union(v.number(), v.null())),
    profile: v.object({ rank: v.number() }),
  })
    .index("rank", ["rank"])
    .index("nested", ["profile.rank"]),
});
it("existing versioned nested-index cursors continue without repeating or losing rows", async () => {
  const { stream } = await import("convex-helpers/server/stream");
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  await t.run(async (ctx) => {
    for (let i = 0; i < 25; i++)
      await ctx.db.insert("item", { rank: i, profile: { rank: i % 4 } });
  });
  for (const direction of ["asc", "desc"] as const) {
    const old = await t.run((ctx) =>
      stream(ctx.db, schema)
        .query("item")
        .withIndex("nested")
        .order(direction)
        .paginate({ cursor: null, numItems: 4 })
    );
    const docs = old.page.slice();
    let cursor = "better-auth:1:" + old.continueCursor;
    let done = false;
    for (let i = 0; i < 30; i++) {
      const page = await t.run((ctx) =>
        paginate(
          ctx,
          schema,
          {},
          {
            model: "item",
            sortBy: { field: "profile.rank", direction },
            paginationOpts: { cursor, numItems: 3, maximumBytesRead: 300 },
          }
        )
      );
      docs.push(...(page.page as typeof docs));
      if (page.isDone) {
        done = true;
        break;
      }
      cursor = page.continueCursor;
    }
    expect(done).toBe(true);
    const native = await t.run((ctx) =>
      ctx.db.query("item").withIndex("nested").order(direction).collect()
    );
    expect(docs).toEqual(native);
  }
});
