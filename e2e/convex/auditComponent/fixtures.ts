import {
  mutationGeneric as mutation,
  queryGeneric as query,
} from "convex/server";
import { v } from "convex/values";
// Only mounted by the disposable E2E application. Never included in library src/.
const localOnly = () => {
  if (process.env.CONVEX_SITE_URL !== "http://127.0.0.1:3211")
    throw new Error("Disposable local audit only");
};
export const seed = mutation({
  args: { model: v.string(), rows: v.array(v.any()) },
  handler: async (ctx, { model, rows }) => {
    localOnly();
    for (const row of rows) await ctx.db.insert(model, row);
  },
});
export const rows = query({
  args: { model: v.string() },
  handler: (ctx, { model }) => ctx.db.query(model).collect(),
});
export const trigger = mutation({
  args: {
    model: v.string(),
    doc: v.optional(v.any()),
    newDoc: v.optional(v.any()),
    oldDoc: v.optional(v.any()),
  },
  handler: async (ctx, { model, doc, newDoc }) => {
    localOnly();
    const row = newDoc ?? doc;
    if (row?.memo === "count-trigger")
      await ctx.db.patch(model, row._id, {
        triggerCount: (row.triggerCount ?? 0) + 1,
      });
    if (row?.memo === "conflict-shaped")
      throw new Error(
        'Documents read from or written to the "mapped" table changed while this mutation was being run and on every subsequent retry. Another call to this mutation changed the document with ID "fake". See https://docs.convex.dev/error#1'
      );
    if (row?.memo === "clear-required")
      await ctx.db.patch(model, row._id, { tenantKey: null });
    if (row?.memo === "collide")
      await ctx.db.patch(model, row._id, { subjectKey: "taken" });
    if (row?.memo === "throw") throw new Error("audit trigger rejected write");
  },
});
