/* eslint-disable @typescript-eslint/no-explicit-any -- table names come in as
   strings, as in the component's own generic adapter code under src/. */
// Raw database access for the live harness in src/client/convex-semantics.test.ts:
// what the convex-test variant does with `t.run`.
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import schema from "../../../src/component/testProfiles/schema.profile-convex-semantics.js";

export const insertMany = mutationGeneric({
  args: { table: v.string(), docs: v.array(v.any()) },
  handler: async (ctx, args) => {
    const ids: string[] = [];
    for (const doc of args.docs) {
      ids.push(String(await ctx.db.insert(args.table as any, doc)));
    }
    return ids;
  },
});

export const collect = queryGeneric({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query(args.table as any).collect();
  },
});

// Deletes up to `budget` documents per call and reports whether any remain,
// so a table left over from the read-limit probe can be cleared in several
// transactions.
export const clearAll = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    const budget = 4000;
    let deleted = 0;
    for (const table of Object.keys(schema.tables)) {
      const docs = await ctx.db.query(table as any).take(budget - deleted + 1);
      const toDelete = docs.slice(0, budget - deleted);
      for (const doc of toDelete) {
        await ctx.db.delete(table as any, doc._id);
      }
      deleted += toDelete.length;
      if (docs.length > toDelete.length) {
        return { more: true };
      }
    }
    return { more: false };
  },
});

// Probes of backend behaviour the test suite relies on.
export const creationTimes = queryGeneric({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db.query(args.table as any).collect();
    return docs.map((doc) => doc._creationTime);
  },
});

export const indexedOrder = queryGeneric({
  args: { direction: v.union(v.literal("asc"), v.literal("desc")) },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("nullable")
      .withIndex("indexed")
      .order(args.direction)
      .collect();
    return docs.map((doc) => ("indexed" in doc ? doc.indexed : "<omitted>"));
  },
});

export const insertBulk = mutationGeneric({
  args: { count: v.number(), start: v.number() },
  handler: async (ctx, args) => {
    for (let i = 0; i < args.count; i++) {
      await ctx.db.insert("nullable", { counter: args.start + i });
    }
  },
});

export const countAll = queryGeneric({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db.query(args.table as any).collect();
    return docs.length;
  },
});
