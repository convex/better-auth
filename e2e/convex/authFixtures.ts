import { components } from "./_generated/api";
import { internalMutation, query, mutation } from "./_generated/server";
import { v } from "convex/values";

function localOnly() {
  if (process.env.CONVEX_SITE_URL !== "http://127.0.0.1:3211") {
    throw new Error(
      "Authentication test fixtures require the disposable local backend"
    );
  }
}
export const deliver = internalMutation({
  args: { email: v.string(), kind: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    localOnly();
    await ctx.db.insert("outbox", args);
  },
});
export const message = query({
  args: { email: v.string(), kind: v.string() },
  handler: async (ctx, { email, kind }) => {
    localOnly();
    return ctx.db
      .query("outbox")
      .withIndex("email_kind", (q) => q.eq("email", email).eq("kind", kind))
      .order("desc")
      .first();
  },
});
export const issueCode = internalMutation({
  args: { code: v.string(), challenge: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    localOnly();
    await ctx.db.insert("oauthFixture", args);
  },
});
export const consumeCode = internalMutation({
  args: { code: v.string(), challenge: v.string() },
  handler: async (ctx, { code, challenge }) => {
    localOnly();
    const row = await ctx.db
      .query("oauthFixture")
      .withIndex("code", (q) => q.eq("code", code))
      .unique();
    if (!row || row.challenge !== challenge) return null;
    await ctx.db.delete(row._id);
    return row.email;
  },
});

export const expireVerification = mutation({
  args: { identifier: v.string() },
  handler: async (ctx, { identifier }) => {
    localOnly();
    return ctx.runMutation(components.oauthProvider.adapter.updateOne, {
      input: {
        model: "verification",
        where: [{ field: "identifier", value: identifier }],
        update: { expiresAt: 0 },
      },
    });
  },
});
