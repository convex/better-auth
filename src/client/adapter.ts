import { createAdapterFactory } from "better-auth/adapters";
import type { DBAdapterDebugLogOption } from "better-auth/adapters";
import { createFunctionHandle } from "convex/server";
import type {
  FunctionHandle,
  GenericActionCtx,
  GenericDataModel,
  PaginationOptions,
  PaginationResult,
  SchemaDefinition,
  WithoutSystemFields,
} from "convex/server";
import type { SetOptional } from "type-fest";
import type defaultSchema from "../component/schema.js";
import type { Where } from "better-auth/types";
import { asyncMap } from "convex-helpers";
import { isRunMutationCtx } from "../utils/index.js";
import { compareSortValues } from "./adapter-utils.js";
import type { Doc, TableNames } from "../component/_generated/dataModel.js";
import type { ComponentApi } from "../component/_generated/component.js";
import type { AuthFunctions, GenericCtx, Triggers } from "./index.js";

const handlePagination = async (
  next: ({
    paginationOpts,
  }: {
    paginationOpts: PaginationOptions;
  }) => Promise<
    SetOptional<PaginationResult<any>, "page"> & { count?: number }
  >,
  { limit, numItems }: { limit?: number; numItems?: number } = {}
) => {
  const state: {
    isDone: boolean;
    cursor: string | null;
    docs: any[];
    count: number;
  } = {
    isDone: false,
    cursor: null,
    docs: [],
    count: 0,
  };
  const onResult = (
    result: SetOptional<PaginationResult<any>, "page"> & { count?: number }
  ) => {
    // Always continue from continueCursor. splitCursor points mid-page, so
    // resuming from it re-reads the second half of a split page and returns
    // (or updates/deletes) those rows twice.
    state.cursor = result.continueCursor;
    if (result.page) {
      state.docs.push(...result.page);
      state.isDone = (limit && state.docs.length >= limit) || result.isDone;
      return;
    }
    // Update and delete only return a count
    if (result.count) {
      state.count += result.count;
      state.isDone = (limit && state.count >= limit) || result.isDone;
      return;
    }
    state.isDone = result.isDone;
  };

  do {
    const cursorBeforePage = state.cursor;
    const result = await next({
      paginationOpts: {
        // Subtract collected rows so the last page doesn't over-fetch past a
        // caller limit. No limit means an unbounded budget (Infinity, not 200,
        // or collecting 200 makes numItems 0 and the cursor never advances; #392).
        numItems: Math.min(
          numItems ?? 200,
          limit !== undefined ? limit - state.docs.length : Infinity,
          200
        ),
        cursor: state.cursor,
      },
    });
    onResult(result);
    // A page that returns nothing and doesn't advance the cursor while !isDone
    // can never terminate; fail loudly instead of looping forever.
    const advanced = state.cursor !== cursorBeforePage;
    const produced =
      (result.page?.length ?? 0) > 0 || (result.count ?? 0) > 0;
    if (!state.isDone && !advanced && !produced) {
      throw new Error(
        "handlePagination made no forward progress; aborting to avoid an infinite pagination loop"
      );
    }
  } while (!state.isDone);
  return state;
};

type ConvexCleanedWhere<TableName extends TableNames = TableNames> = Where & {
  value: string | number | boolean | string[] | number[] | null;
  field: keyof WithoutSystemFields<Doc<TableName>> & string;
};

const parseWhere = (
  where?: (Where & { join?: undefined }) | (Where & { join?: undefined })[]
): ConvexCleanedWhere[] => {
  if (!where) {
    return [];
  }
  const whereArray = Array.isArray(where) ? where : [where];
  for (const w of whereArray) {
    if (w.mode === "insensitive") {
      throw new Error(
        `Case-insensitive queries (mode: "insensitive") are not supported by the Convex adapter. Store values in a normalized form (e.g. lowercase on write) and query against the normalized value. Field: ${w.field}`
      );
    }
  }
  return whereArray.map((w) => {
    if (w.value instanceof Date) {
      return {
        ...w,
        value: w.value.getTime(),
      };
    }
    return w;
  }) as ConvexCleanedWhere[];
};

type DocWithFlexibleId = {
  _id?: string | null;
  id?: string | null;
};

const getDocId = (doc: DocWithFlexibleId) => {
  if (doc?._id !== undefined && doc?._id !== null) {
    return String(doc._id);
  }
  if (doc?.id !== undefined && doc?.id !== null) {
    return String(doc.id);
  }
  return undefined;
};

const dedupeDocsById = <T extends DocWithFlexibleId>(docs: T[]) => {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const doc of docs) {
    const id = getDocId(doc);
    if (!id) {
      deduped.push(doc);
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(doc);
  }
  return deduped;
};

const selectDocFields = (
  doc: DocWithFlexibleId & Record<string, unknown>,
  select?: string[]
) => {
  if (!select?.length) {
    return doc;
  }
  return select.reduce(
    (acc, field) => {
      // Better Auth may request "id" while Convex stores it as "_id".
      // Keep "_id" so Better Auth output mapping can translate to "id".
      const sourceField = field === "id" && "_id" in doc ? "_id" : field;
      acc[sourceField] = doc[sourceField];
      return acc;
    },
    {} as Record<string, unknown>
  );
};

export const convexAdapter = <
  DataModel extends GenericDataModel,
  Ctx extends GenericCtx<DataModel> = GenericActionCtx<DataModel>,
  Schema extends SchemaDefinition<any, any> = typeof defaultSchema,
>(
  ctx: Ctx,
  api: {
    adapter: ComponentApi["adapter"];
  },
  config: {
    debugLogs?: DBAdapterDebugLogOption;
    authFunctions?: AuthFunctions;
    triggers?: Triggers<DataModel, Schema>;
  } = {}
) => {
  return createAdapterFactory({
    config: {
      adapterId: "convex",
      adapterName: "Convex Adapter",
      debugLogs: config.debugLogs || false,
      disableIdGeneration: true,
      transaction: false,
      supportsNumericIds: false,
      supportsJSON: false,
      supportsDates: false,
      supportsArrays: true,
      usePlural: false,
      mapKeysTransformInput: {
        id: "_id",
      },
      mapKeysTransformOutput: {
        _id: "id",
      },
      // Convert dates to numbers. This aligns with how
      // Convex stores _creationTime and avoids a breaking change.
      customTransformInput: ({ data, fieldAttributes }) => {
        if (data && fieldAttributes.type === "date") {
          return new Date(data).getTime();
        }
        return data;
      },
      customTransformOutput: ({ data, fieldAttributes }) => {
        if (data && fieldAttributes.type === "date") {
          return new Date(data).getTime();
        }
        return data;
      },
    },
    adapter: ({ options }) => {
      // Disable telemetry in all cases because it requires Node
      options.telemetry = { enabled: false };

      const collectIdsForOrWhere = async (data: {
        model: string;
        where: (Where & { join?: undefined })[];
      }) => {
        const results = await asyncMap(data.where, async (w) =>
          handlePagination(
            async ({ paginationOpts }) => {
              return await ctx.runQuery(api.adapter.findMany, {
                model: data.model as TableNames,
                where: parseWhere(w),
                paginationOpts,
              });
            }
          )
        );
        const ids = dedupeDocsById(results.flatMap((r) => r.docs))
          .map((doc) => getDocId(doc))
          .flatMap((id) => (id ? [id] : []));
        return ids;
      };

      return {
        id: "convex",
        options: {
          isRunMutationCtx: isRunMutationCtx(ctx),
        },
        createSchema: async ({ file, tables }) => {
          const { createSchema } = await import("./create-schema.js");
          return createSchema({ file, tables });
        },
        create: async ({ model, data, select }): Promise<any> => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          const onCreateHandle =
            config.authFunctions?.onCreate && config.triggers?.[model]?.onCreate
              ? ((await createFunctionHandle(
                  config.authFunctions.onCreate
                )) as FunctionHandle<"mutation">)
              : undefined;
          return ctx.runMutation(api.adapter.create, {
            input: { model: model as any, data: data as any },
            select,
            onCreateHandle: onCreateHandle,
          });
        },
        // Better Auth 1.7 passes `modelKey` alongside `model` on every call.
        // Convex validates arguments strictly, so only the fields the
        // component functions declare are forwarded.
        findOne: async (data): Promise<any> => {
          if (data.where?.every((w) => w.connector === "OR")) {
            for (const w of data.where) {
              const result = await ctx.runQuery(api.adapter.findOne, {
                model: data.model as TableNames,
                where: parseWhere(w),
                select: data.select,
                join: data.join,
              });
              if (result) {
                return result;
              }
            }
          }
          return await ctx.runQuery(api.adapter.findOne, {
            model: data.model as TableNames,
            where: parseWhere(data.where),
            select: data.select,
            join: data.join,
          });
        },
        findMany: async (data): Promise<any[]> => {
          if (data.offset) {
            throw new Error("offset not supported");
          }

          if (data.where?.some((w) => w.connector === "OR")) {
            // Always fetch full docs for OR unions so we can dedupe
            // by id and sort/limit before trimming selected fields.
            const results = await asyncMap(data.where, async (w) =>
              handlePagination(
                async ({ paginationOpts }) => {
                  return await ctx.runQuery(api.adapter.findMany, {
                    model: data.model as TableNames,
                    where: parseWhere(w),
                    limit: data.limit,
                    sortBy: data.sortBy,
                    join: data.join,
                    paginationOpts,
                  });
                },
                { limit: data.limit }
              )
            );
            let docs = dedupeDocsById(results.flatMap((r) => r.docs));
            if (data.sortBy) {
              const { field, direction } = data.sortBy;
              docs = [...docs].sort((a, b) =>
                compareSortValues(a[field], b[field], direction)
              );
            }
            if (data.limit !== undefined) {
              docs = docs.slice(0, data.limit);
            }
            return docs.map((doc) => selectDocFields(doc, data.select));
          }

          const result = await handlePagination(
            async ({ paginationOpts }) => {
              return await ctx.runQuery(api.adapter.findMany, {
                model: data.model as TableNames,
                where: parseWhere(data.where),
                select: data.select,
                limit: data.limit,
                sortBy: data.sortBy,
                join: data.join,
                paginationOpts,
              });
            },
            { limit: data.limit }
          );
          // Pages should never overlap, but a duplicate here would be
          // returned to the caller (and consume its limit), so dedupe as the
          // OR path does.
          return dedupeDocsById(result.docs);
        },
        count: async (data) => {
          // Yes, count is just findMany returning a number.
          if (data.where?.some((w) => w.connector === "OR")) {
            const results = await asyncMap(data.where, async (w) =>
              handlePagination(async ({ paginationOpts }) => {
                return await ctx.runQuery(api.adapter.findMany, {
                  model: data.model as TableNames,
                  where: parseWhere(w),
                  paginationOpts,
                });
              })
            );
            const docs = dedupeDocsById(results.flatMap((r) => r.docs));
            return docs.length;
          }

          const result = await handlePagination(async ({ paginationOpts }) => {
            return await ctx.runQuery(api.adapter.findMany, {
              model: data.model as TableNames,
              where: parseWhere(data.where),
              paginationOpts,
            });
          });
          return dedupeDocsById(result.docs).length;
        },
        update: async (data): Promise<any> => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          // An empty where matches no single record, so there's nothing to
          // update. better-auth's adapter contract expects null here.
          if (!data.where?.length) {
            return null;
          }
          if (data.where.some((w) => w.connector === "OR")) {
            throw new Error("where clause not supported");
          }
          const onUpdateHandle =
            config.authFunctions?.onUpdate &&
            config.triggers?.[data.model]?.onUpdate
              ? ((await createFunctionHandle(
                  config.authFunctions.onUpdate
                )) as FunctionHandle<"mutation">)
              : undefined;
          return ctx.runMutation(api.adapter.updateOne, {
            input: {
              model: data.model as TableNames,
              where: parseWhere(data.where),
              update: data.update as any,
            },
            onUpdateHandle: onUpdateHandle,
          });
        },
        delete: async (data) => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          const onDeleteHandle =
            config.authFunctions?.onDelete &&
            config.triggers?.[data.model]?.onDelete
              ? ((await createFunctionHandle(
                  config.authFunctions.onDelete
                )) as FunctionHandle<"mutation">)
              : undefined;
          await ctx.runMutation(api.adapter.deleteOne, {
            input: {
              model: data.model as TableNames,
              where: parseWhere(data.where),
            },
            onDeleteHandle: onDeleteHandle,
          });
        },
        deleteMany: async (data) => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          const onDeleteHandle =
            config.authFunctions?.onDelete &&
            config.triggers?.[data.model as TableNames]?.onDelete
              ? ((await createFunctionHandle(
                  config.authFunctions.onDelete
                )) as FunctionHandle<"mutation">)
              : undefined;
          if (data.where?.some((w) => w.connector === "OR")) {
            const ids = await collectIdsForOrWhere({
              model: data.model as string,
              where: data.where,
            });
            await asyncMap(ids, async (id) => {
              await ctx.runMutation(api.adapter.deleteOne, {
                input: {
                  model: data.model as TableNames,
                  where: [{ field: "_id", operator: "eq", value: id }],
                },
                onDeleteHandle: onDeleteHandle,
              });
            });
            return ids.length;
          }
          const result = await handlePagination(async ({ paginationOpts }) => {
            return await ctx.runMutation(api.adapter.deleteMany, {
              input: {
                model: data.model as TableNames,
                where: parseWhere(data.where),
              },
              paginationOpts,
              onDeleteHandle: onDeleteHandle,
            });
          });
          return result.count;
        },
        updateMany: async (data) => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          const onUpdateHandle =
            config.authFunctions?.onUpdate &&
            config.triggers?.[data.model]?.onUpdate
              ? ((await createFunctionHandle(
                  config.authFunctions.onUpdate
                )) as FunctionHandle<"mutation">)
              : undefined;
          if (data.where?.some((w) => w.connector === "OR")) {
            const ids = await collectIdsForOrWhere({
              model: data.model as string,
              where: data.where,
            });
            if (!ids.length) {
              return 0;
            }
            const result = await handlePagination(
              async ({ paginationOpts }) => {
                return await ctx.runMutation(api.adapter.updateMany, {
                  input: {
                    model: data.model as TableNames,
                    where: [{ field: "_id", operator: "in", value: ids }],
                    update: data.update,
                  },
                  paginationOpts,
                  onUpdateHandle: onUpdateHandle,
                });
              },
              { limit: ids.length }
            );
            return result.count ?? 0;
          }
          const result = await handlePagination(async ({ paginationOpts }) => {
            return await ctx.runMutation(api.adapter.updateMany, {
              input: {
                model: data.model as TableNames,
                where: parseWhere(data.where),
                update: data.update,
              },
              paginationOpts,
              onUpdateHandle: onUpdateHandle,
            });
          });
          return result.count;
        },
        // Native atomic single-row consume. A Convex mutation is a
        // transaction, so the read and delete below cannot interleave with
        // another writer; this replaces Better Auth's snapshot-guard fallback,
        // whose guard includes Convex system fields the component rejects.
        consumeOne: async (data): Promise<any> => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          if (data.where.some((w) => w.connector === "OR")) {
            throw new Error("where clause not supported");
          }
          const onDeleteHandle =
            config.authFunctions?.onDelete &&
            config.triggers?.[data.model]?.onDelete
              ? ((await createFunctionHandle(
                  config.authFunctions.onDelete
                )) as FunctionHandle<"mutation">)
              : undefined;
          return ctx.runMutation(api.adapter.consumeOne, {
            input: {
              model: data.model as TableNames,
              where: parseWhere(data.where),
            },
            onDeleteHandle,
          });
        },
        // Native atomic guarded counter mutation, see consumeOne.
        incrementOne: async (data): Promise<any> => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          if (data.where.some((w) => w.connector === "OR")) {
            throw new Error("where clause not supported");
          }
          const onUpdateHandle =
            config.authFunctions?.onUpdate &&
            config.triggers?.[data.model]?.onUpdate
              ? ((await createFunctionHandle(
                  config.authFunctions.onUpdate
                )) as FunctionHandle<"mutation">)
              : undefined;
          return ctx.runMutation(api.adapter.incrementOne, {
            input: {
              model: data.model as TableNames,
              where: parseWhere(data.where),
              increment: data.increment,
              set: data.set as any,
            },
            onUpdateHandle,
          });
        },
      };
    },
  });
};
