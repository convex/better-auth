// Stub trigger handles for tests that need a real FunctionReference to pass
// as onCreateHandle / onUpdateHandle on adapter writes.

import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

export const sessionOnCreateUpdater = internalMutationGeneric({
  args: { doc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.model === "session") {
      await ctx.db.patch("session", args.doc._id, {
        userAgent: "trigger-ran-on-create",
      });
    }
  },
});

export const sessionOnUpdateUpdater = internalMutationGeneric({
  args: { newDoc: v.any(), oldDoc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.model === "session") {
      await ctx.db.patch("session", args.newDoc._id, {
        userAgent: "trigger-ran-on-update",
      });
    }
  },
});

export const accountOnCreateIssuerClearer = internalMutationGeneric({
  args: { doc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.model === "account") {
      await ctx.db.patch("account", args.doc._id, { issuer: null });
    }
  },
});

export const accountOnUpdateIssuerClearer = internalMutationGeneric({
  args: { newDoc: v.any(), oldDoc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.model === "account") {
      await ctx.db.patch("account", args.newDoc._id, { issuer: null });
    }
  },
});

export const accountOnUpdateNoop = internalMutationGeneric({
  args: { newDoc: v.any(), oldDoc: v.any(), model: v.string() },
  handler: async () => {},
});

export const accountOnCreateIssuerCollider = internalMutationGeneric({
  args: { doc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.model === "account") {
      await ctx.db.patch("account", args.doc._id, {
        issuer: "collision-issuer",
      });
    }
  },
});

export const accountOnUpdateAccountIdCollider = internalMutationGeneric({
  args: { newDoc: v.any(), oldDoc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.model === "account") {
      await ctx.db.patch("account", args.newDoc._id, {
        accountId: "collision-account",
      });
    }
  },
});
