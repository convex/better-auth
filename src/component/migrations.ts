import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { omit } from "convex-helpers";
import { paginator } from "convex-helpers/server/pagination";
import { mutation, query } from "./_generated/server.js";
import schema from "./schema.js";

const migrationCompleteCursorPrefix = "convex-better-auth:migration-complete:";

const migrationCompleteCursorFor = (operation: string) =>
  `${migrationCompleteCursorPrefix}${operation}`;

const isMigrationCompleteCursor = (
  cursor: string | null,
  operation: string
) => {
  const expected = migrationCompleteCursorFor(operation);
  if (cursor === expected) {
    return true;
  }
  if (cursor?.startsWith(migrationCompleteCursorPrefix)) {
    throw new Error(`Migration cursor is not valid for ${operation}`);
  }
  return false;
};

const assertValidPaginationOpts = (paginationOpts: {
  cursor: string | null;
  numItems: number;
}) => {
  if (
    !Number.isInteger(paginationOpts.numItems) ||
    paginationOpts.numItems <= 0
  ) {
    throw new Error("paginationOpts.numItems must be a positive integer");
  }
};

const legacyOAuthApplicationExportValidator = v.object({
  ...omit(schema.tables.oauthApplication.validator.fields, ["clientSecret"]),
  _id: v.id("oauthApplication"),
  _creationTime: v.number(),
  hadClientSecret: v.boolean(),
});

const clearedLegacyRecordsValidator = v.object({
  continueCursor: v.string(),
  isDone: v.boolean(),
  deleted: v.number(),
});

export const listLegacyOAuthApplications = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(legacyOAuthApplicationExportValidator),
  handler: async (ctx, args) => {
    const operation = "listLegacyOAuthApplications";
    const completeCursor = migrationCompleteCursorFor(operation);
    assertValidPaginationOpts(args.paginationOpts);
    if (isMigrationCompleteCursor(args.paginationOpts.cursor, operation)) {
      return {
        page: [],
        continueCursor: completeCursor,
        isDone: true,
      };
    }
    const result = await paginator(ctx.db, schema)
      .query("oauthApplication")
      .paginate(args.paginationOpts);
    return {
      ...result,
      continueCursor: result.isDone ? completeCursor : result.continueCursor,
      page: result.page.map(({ clientSecret, ...application }) => ({
        ...application,
        hadClientSecret: Boolean(clientSecret),
      })),
    };
  },
});

export const clearLegacyOAuthProviderRecords = mutation({
  args: {
    table: v.union(
      v.literal("oauthApplication"),
      v.literal("oauthAccessToken"),
      v.literal("oauthConsent")
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: clearedLegacyRecordsValidator,
  handler: async (ctx, args) => {
    const operation = `clearLegacyOAuthProviderRecords:${args.table}`;
    const completeCursor = migrationCompleteCursorFor(operation);
    assertValidPaginationOpts(args.paginationOpts);
    if (isMigrationCompleteCursor(args.paginationOpts.cursor, operation)) {
      return {
        continueCursor: completeCursor,
        isDone: true,
        deleted: 0,
      };
    }
    const result =
      args.table === "oauthApplication"
        ? await paginator(ctx.db, schema)
            .query("oauthApplication")
            .paginate(args.paginationOpts)
        : args.table === "oauthAccessToken"
          ? await paginator(ctx.db, schema)
              .query("oauthAccessToken")
              .paginate(args.paginationOpts)
          : await paginator(ctx.db, schema)
              .query("oauthConsent")
              .paginate(args.paginationOpts);
    for (const record of result.page) {
      await ctx.db.delete(args.table, record._id);
    }
    return {
      continueCursor: result.isDone ? completeCursor : result.continueCursor,
      isDone: result.isDone,
      deleted: result.page.length,
    };
  },
});
