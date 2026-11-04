import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

export const get = query({
  args: {},
  handler: async (ctx) => {
    // Empty rather than an error while a sign-out is still propagating
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("todos")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthenticated");
    }

    const now = Date.now();
    await ctx.db.insert("todos", {
      text: args.text,
      completed: false,
      userId: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const toggle = mutation({
  args: { id: v.id("todos") },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthenticated");
    }

    const todo = await ctx.db.get(args.id);
    if (!todo) {
      return;
    }

    if (todo.userId !== user._id) {
      throw new ConvexError("Unauthorized");
    }

    await ctx.db.patch(args.id, {
      completed: !todo.completed,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("todos") },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthenticated");
    }

    const todo = await ctx.db.get(args.id);
    if (!todo) {
      return;
    }
    if (todo.userId !== user._id) {
      throw new ConvexError("Unauthorized");
    }

    await ctx.db.delete(args.id);
  },
});
