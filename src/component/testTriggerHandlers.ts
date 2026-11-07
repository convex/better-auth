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

// Appends a marker to `user.image` on every onUpdate call so a test can tell
// how many times a row's onUpdate trigger fired (an "x" per firing).
export const userOnUpdateMarker = internalMutationGeneric({
  args: { newDoc: v.any(), oldDoc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.model === "user") {
      await ctx.db.patch("user", args.newDoc._id, {
        image: `${args.oldDoc.image ?? ""}x`,
      });
    }
  },
});

// Moves every other `oauthClientResource` row to the updated row's client on
// each onUpdate call, so a test can check that updateMany's unique checks see
// what a trigger wrote to the rows after the one it fired for.
export const oauthClientResourceOnUpdateMover = internalMutationGeneric({
  args: { newDoc: v.any(), oldDoc: v.any(), model: v.string() },
  handler: async (ctx, args) => {
    if (args.model !== "oauthClientResource") {
      return;
    }
    for (const doc of await ctx.db.query("oauthClientResource").collect()) {
      if (doc.clientId !== args.newDoc.clientId) {
        await ctx.db.patch("oauthClientResource", doc._id, {
          clientId: args.newDoc.clientId,
        });
      }
    }
  },
});
