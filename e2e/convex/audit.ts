import type { DataModel } from "./_generated/dataModel";
import schema from "./auditComponent/schema";
import { action, mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { convexAdapter } from "@convex-dev/better-auth";
import { createFunctionHandle } from "convex/server";
import { v } from "convex/values";
import { options } from "./auditComponent/options";
const localOnly = () => {
  if (process.env.CONVEX_SITE_URL !== "http://127.0.0.1:3211")
    throw new Error("Disposable local audit only");
};
export const call = action({
  args: {
    operation: v.string(),
    data: v.any(),
    trigger: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    localOnly();
    const adapter = convexAdapter<DataModel, typeof ctx, typeof schema>(
      ctx,
      components.audit,
      args.trigger
        ? {
            authFunctions: {
              onCreate: components.audit.fixtures.trigger,
              onUpdate: components.audit.fixtures.trigger,
              onDelete: components.audit.fixtures.trigger,
            },
            triggers: {
              mapped: {
                onCreate: async () => {},
                onUpdate: async () => {},
                onDelete: async () => {},
              },
            },
          }
        : {}
    )(options);
    switch (args.operation) {
      case "create":
        return adapter.create(args.data);
      case "findOne":
        return adapter.findOne(args.data);
      case "findMany":
        return adapter.findMany(args.data);
      case "count":
        return adapter.count(args.data);
      case "update":
        return adapter.update(args.data);
      case "updateMany":
        return adapter.updateMany(args.data);
      case "deleteMany":
        return adapter.deleteMany(args.data);
      case "consumeOne":
        return adapter.consumeOne(args.data);
      case "incrementOne":
        return adapter.incrementOne(args.data);
      default:
        throw new Error("Unknown operation");
    }
  },
});
export const seed = mutation({
  args: { model: v.string(), rows: v.array(v.any()) },
  handler: (ctx, args) => {
    localOnly();
    return ctx.runMutation(components.audit.fixtures.seed, args);
  },
});
export const rows = query({
  args: { model: v.string() },
  handler: (ctx, args) => {
    localOnly();
    return ctx.runQuery(components.audit.fixtures.rows, args);
  },
});
export const raw = mutation({
  args: {
    operation: v.string(),
    data: v.any(),
    trigger: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    localOnly();
    const onUpdateHandle = args.trigger
      ? await createFunctionHandle(components.audit.fixtures.trigger)
      : undefined;
    switch (args.operation) {
      case "updateMany":
        return ctx.runMutation(components.audit.adapter.updateMany, {
          ...args.data,
          onUpdateHandle,
        });
      case "incrementOne":
        return ctx.runMutation(components.audit.adapter.incrementOne, {
          ...args.data,
          onUpdateHandle,
        });
      case "clear":
        return ctx.runMutation(
          components.audit.migrations.clearLegacyOAuthProviderRecords,
          args.data
        );
      default:
        throw new Error("Unknown operation");
    }
  },
});
export const exportClients = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: (ctx, paginationOpts) => {
    localOnly();
    return ctx.runQuery(
      components.audit.migrations.listLegacyOAuthApplications,
      { paginationOpts }
    );
  },
});

// Observe actual component calls so the concurrency test can distinguish
// adapter recovery from caller-side retries and check trigger rollback.
export const retryStress = action({
  args: { count: v.number(), spoof: v.optional(v.boolean()) },
  handler: async (ctx, { count, spoof }) => {
    localOnly();
    if (!Number.isInteger(count) || count < 1 || count > 40)
      throw new Error("Invalid stress size");
    let attempts = 0;
    let conflicts = 0;
    const runMutation: typeof ctx.runMutation = async (reference, args) => {
      attempts++;
      try {
        return await ctx.runMutation(reference, args);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith('Documents read from or written to the "')
        )
          conflicts++;
        throw error;
      }
    };
    const adapter = convexAdapter<DataModel, typeof ctx, typeof schema>(
      { ...ctx, runMutation },
      components.audit,
      {
        authFunctions: { onUpdate: components.audit.fixtures.trigger },
        triggers: { mapped: { onUpdate: async () => {} } },
      }
    )(options);
    const row = await adapter.create<{ id: string }>({
      model: "ledger",
      data: {
        tenant: crypto.randomUUID(),
        subject: "retry-stress",
        count: 0,
        memo: spoof ? "conflict-shaped" : "count-trigger",
      },
    });
    attempts = 0;
    const outcomes = await Promise.allSettled(
      Array.from({ length: count }, () =>
        adapter.incrementOne({
          model: "ledger",
          where: [{ field: "id", value: row.id }],
          increment: { count: 1 },
        })
      )
    );
    const stored = (
      await ctx.runQuery(components.audit.fixtures.rows, { model: "mapped" })
    ).find((doc: { _id: string }) => doc._id === row.id);
    return {
      attempts,
      conflicts,
      successes: outcomes.filter((r) => r.status === "fulfilled").length,
      errors: outcomes.flatMap((r) =>
        r.status === "rejected" ? [String(r.reason)] : []
      ),
      count: stored.count,
      triggerCount: stored.triggerCount ?? 0,
    };
  },
});
