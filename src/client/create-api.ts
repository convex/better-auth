import {
  mutationGeneric,
  paginationOptsValidator,
  queryGeneric,
} from "convex/server";
import type {
  FunctionHandle,
  GenericDataModel,
  GenericMutationCtx,
  SchemaDefinition,
} from "convex/server";
import { v } from "convex/values";
import type { GenericId, GenericValidator } from "convex/values";
import { asyncMap } from "convex-helpers";
import { partial } from "convex-helpers/validators";
import {
  adapterWhereValidator,
  checkUniqueFields,
  hasUniqueFields,
  listOne,
  paginate,
  selectFields,
  touchesUniqueFields,
} from "./adapter-utils.js";
import { getAuthTables } from "better-auth/db";
import type { BetterAuthDBSchema } from "better-auth/db";
import type { BetterAuthOptions } from "better-auth/minimal";

// Enumerate declared paths instead of accepting arbitrary strings in write
// guards: a typo combined with eq null must never become a broad mutation.
const declaredFieldPaths = (
  validator: GenericValidator,
  prefix = ""
): string[] => {
  if (validator.kind === "union")
    return validator.members.flatMap((member: GenericValidator) =>
      declaredFieldPaths(member, prefix)
    );
  if (validator.kind !== "object") return [];
  return Object.entries(validator.fields).flatMap(([field, child]) => {
    const path = prefix ? `${prefix}.${field}` : field;
    return [path, ...declaredFieldPaths(child as GenericValidator, path)];
  });
};

const whereValidator = (
  schema: SchemaDefinition<any, any>,
  tableName: string
) =>
  v.object({
    field: v.union(
      ...[
        ...new Set(declaredFieldPaths(schema.tables[tableName].validator)),
      ].map((field) => v.literal(field)),
      v.literal("_id")
    ),
    operator: v.optional(
      v.union(
        v.literal("lt"),
        v.literal("lte"),
        v.literal("gt"),
        v.literal("gte"),
        v.literal("eq"),
        v.literal("in"),
        v.literal("not_in"),
        v.literal("ne"),
        v.literal("contains"),
        v.literal("starts_with"),
        v.literal("ends_with")
      )
    ),
    value: v.union(
      v.string(),
      v.number(),
      v.boolean(),
      v.array(v.string()),
      v.array(v.number()),
      v.null()
    ),
    connector: v.optional(v.union(v.literal("AND"), v.literal("OR"))),
    mode: v.optional(v.union(v.literal("sensitive"), v.literal("insensitive"))),
  });

const requiredFieldNames = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string
) => {
  const table = Object.values(betterAuthSchema).find(
    (value) => value.modelName === model
  );
  if (!table) {
    return [];
  }
  return Object.entries(table.fields)
    .filter(([, field]) => field.required)
    .map(([fieldName, field]) => field.fieldName ?? fieldName);
};

const assertRequiredUpdateFields = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  update: Record<string, unknown>
) => {
  for (const fieldName of requiredFieldNames(betterAuthSchema, model)) {
    if (
      Object.prototype.hasOwnProperty.call(update, fieldName) &&
      update[fieldName] == null
    ) {
      throw new Error(`Cannot clear required field ${model}.${fieldName}`);
    }
  }
};

const assertRequiredFieldTransitions = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) => {
  for (const fieldName of requiredFieldNames(betterAuthSchema, model)) {
    if (
      after[fieldName] == null &&
      (before[fieldName] != null ||
        (!Object.prototype.hasOwnProperty.call(before, fieldName) &&
          Object.prototype.hasOwnProperty.call(after, fieldName)))
    ) {
      throw new Error(`Trigger cleared required field ${model}.${fieldName}`);
    }
  }
};

export const createApi = <Schema extends SchemaDefinition<any, any>>(
  schema: Schema,
  createAuthOptions: (ctx: any) => BetterAuthOptions
) => {
  type TableNames = Extract<keyof Schema["tables"], string>;
  const betterAuthSchema = getAuthTables(createAuthOptions({} as any));
  const checkPersistedUniqueFields = async (
    ctx: GenericMutationCtx<GenericDataModel>,
    model: string,
    doc: Record<string, any>
  ) => {
    await checkUniqueFields(ctx, schema, betterAuthSchema, model, doc, doc);
  };
  const readUpdatedDoc = async <Doc extends Record<string, any>>(
    ctx: GenericMutationCtx<GenericDataModel>,
    model: TableNames,
    doc: Doc
  ): Promise<Doc> => {
    const updatedDoc = await ctx.db.get(
      model,
      doc._id as GenericId<TableNames>
    );
    if (!updatedDoc) throw new Error(`Failed to update ${model}`);
    return updatedDoc as Doc;
  };
  const applyUpdate = async <Doc extends Record<string, any>>(
    ctx: GenericMutationCtx<GenericDataModel>,
    model: TableNames,
    doc: Doc,
    update: Record<string, any>,
    onUpdateHandle?: string,
    validateRequired = false
  ): Promise<Doc | undefined> => {
    if (validateRequired)
      assertRequiredUpdateFields(betterAuthSchema, model, update);
    await checkUniqueFields(ctx, schema, betterAuthSchema, model, update, doc);
    await ctx.db.patch(model, doc._id as GenericId<TableNames>, update as any);
    if (!onUpdateHandle) {
      return;
    }
    const updatedDoc = await readUpdatedDoc(ctx, model, doc);
    await ctx.runMutation(onUpdateHandle as FunctionHandle<"mutation">, {
      model,
      newDoc: updatedDoc,
      oldDoc: doc,
    });
    const triggeredDoc = await ctx.db.get(
      model,
      doc._id as GenericId<TableNames>
    );
    if (!triggeredDoc) {
      throw new Error(
        `Failed to update ${model} (deleted by onUpdate trigger?)`
      );
    }
    if (validateRequired)
      assertRequiredFieldTransitions(
        betterAuthSchema,
        model,
        updatedDoc,
        triggeredDoc
      );
    await checkPersistedUniqueFields(ctx, model, triggeredDoc);
    return triggeredDoc as Doc;
  };

  return {
    create: mutationGeneric({
      args: {
        input: v.union(
          ...Object.entries(schema.tables).map(([model, table]) =>
            v.object({
              model: v.literal(model),
              data: v.object((table as any).validator.fields),
            })
          )
        ),
        select: v.optional(v.array(v.string())),
        onCreateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        await checkUniqueFields(
          ctx,
          schema,
          betterAuthSchema,
          args.input.model,
          args.input.data
        );
        const id = await ctx.db.insert(
          args.input.model as any,
          args.input.data
        );
        const doc = await ctx.db.get(args.input.model, id);
        if (!doc) {
          throw new Error(`Failed to create ${args.input.model}`);
        }
        const result = selectFields(doc, args.select);
        if (args.onCreateHandle) {
          await ctx.runMutation(
            args.onCreateHandle as FunctionHandle<"mutation">,
            {
              model: args.input.model,
              doc,
            }
          );
          const updatedDoc = await ctx.db.get(args.input.model, id);
          if (!updatedDoc) {
            throw new Error(
              `Failed to create ${args.input.model} (deleted by onCreate trigger?)`
            );
          }
          await checkPersistedUniqueFields(ctx, args.input.model, updatedDoc);
          return selectFields(updatedDoc, args.select);
        }
        return result;
      },
    }),
    findOne: queryGeneric({
      args: {
        model: v.union(
          ...Object.keys(schema.tables).map((model) => v.literal(model))
        ),
        where: v.optional(v.array(adapterWhereValidator)),
        select: v.optional(v.array(v.string())),
        join: v.optional(v.any()),
      },
      handler: async (ctx, args) => {
        return await listOne(ctx, schema, betterAuthSchema, args);
      },
    }),
    findMany: queryGeneric({
      args: {
        model: v.union(
          ...Object.keys(schema.tables).map((model) => v.literal(model))
        ),
        where: v.optional(v.array(adapterWhereValidator)),
        select: v.optional(v.array(v.string())),
        limit: v.optional(v.number()),
        sortBy: v.optional(
          v.object({
            direction: v.union(v.literal("asc"), v.literal("desc")),
            field: v.string(),
          })
        ),
        offset: v.optional(v.number()),
        join: v.optional(v.any()),
        paginationOpts: paginationOptsValidator,
      },
      handler: async (ctx, args) => {
        return await paginate(ctx, schema, betterAuthSchema, args);
      },
    }),
    updateOne: mutationGeneric({
      args: {
        input: v.union(
          ...Object.entries(schema.tables).map(
            ([name, table]: [string, Schema["tables"][string]]) => {
              const tableName = name as TableNames;
              const fields = partial(table.validator.fields);
              return v.object({
                model: v.literal(tableName),
                update: v.object(fields),
                where: v.optional(v.array(whereValidator(schema, tableName))),
              });
            }
          )
        ),
        onUpdateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const doc = await listOne(ctx, schema, betterAuthSchema, args.input);
        if (!doc) {
          return null;
        }
        return (
          (await applyUpdate(
            ctx,
            args.input.model,
            doc,
            args.input.update,
            args.onUpdateHandle
          )) ?? (await readUpdatedDoc(ctx, args.input.model, doc))
        );
      },
    }),
    incrementOne: mutationGeneric({
      args: {
        input: v.union(
          ...Object.entries(schema.tables).map(
            ([name, table]: [string, Schema["tables"][string]]) => {
              const tableName = name as TableNames;
              return v.object({
                model: v.literal(tableName),
                where: v.array(whereValidator(schema, tableName)),
                increment: v.record(v.string(), v.number()),
                set: v.optional(v.object(partial(table.validator.fields))),
              });
            }
          )
        ),
        onUpdateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        if (!args.input.where.length) {
          return null;
        }
        const doc = await listOne(
          ctx,
          schema,
          betterAuthSchema,
          args.input,
          true
        );
        if (!doc) {
          return null;
        }

        const update: Record<string, unknown> = { ...args.input.set };
        for (const [field, delta] of Object.entries(args.input.increment)) {
          const current = doc[field];
          if (
            current !== undefined &&
            current !== null &&
            typeof current !== "number"
          ) {
            throw new Error(
              `Cannot increment non-numeric field ${args.input.model}.${field}`
            );
          }
          const previous = current ?? 0;
          const next = previous + delta;
          if (
            !Number.isFinite(previous) ||
            !Number.isFinite(delta) ||
            !Number.isFinite(next) ||
            (delta !== 0 && next === previous)
          ) {
            throw new Error(
              `Cannot safely increment field ${args.input.model}.${field}`
            );
          }
          update[field] = next;
        }
        return (
          (await applyUpdate(
            ctx,
            args.input.model,
            doc,
            update,
            args.onUpdateHandle,
            true
          )) ?? (await readUpdatedDoc(ctx, args.input.model, doc))
        );
      },
    }),
    updateMany: mutationGeneric({
      args: {
        input: v.union(
          ...Object.entries(schema.tables).map(
            ([name, table]: [string, Schema["tables"][string]]) => {
              const tableName = name as TableNames;
              const fields = partial(table.validator.fields);
              return v.object({
                model: v.literal(tableName),
                update: v.object(fields),
                where: v.optional(v.array(whereValidator(schema, tableName))),
              });
            }
          )
        ),
        paginationOpts: paginationOptsValidator,
        onUpdateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const uniqueFieldsTouched = touchesUniqueFields(
          betterAuthSchema,
          args.input.model,
          args.input.update ?? {}
        );
        const firstInWhere = args.input.where?.find(
          (where) => where.operator === "in"
        );
        const usesAtomicIdSet = firstInWhere?.field === "_id";
        const requestedPageSize = args.paginationOpts.numItems;
        const { page, ...result } = await paginate(
          ctx,
          schema,
          betterAuthSchema,
          {
            ...args.input,
            paginationOpts: uniqueFieldsTouched
              ? {
                  ...args.paginationOpts,
                  numItems: requestedPageSize + 1,
                }
              : args.paginationOpts,
          }
        );
        if (args.input.update) {
          if (
            uniqueFieldsTouched &&
            !usesAtomicIdSet &&
            (page.length > requestedPageSize || !result.isDone)
          ) {
            throw new Error(
              `Cannot update unique fields across multiple pages in ${args.input.model}`
            );
          }
          if (
            hasUniqueFields(
              betterAuthSchema,
              args.input.model,
              args.input.update ?? {}
            ) &&
            page.length > 1
          ) {
            throw new Error(
              `Attempted to set unique fields in multiple documents in ${args.input.model} with the same value. Fields: ${Object.keys(args.input.update ?? {}).join(", ")}`
            );
          }
          const updateDoc = (doc: (typeof page)[number]) =>
            applyUpdate(
              ctx,
              args.input.model,
              doc,
              args.input.update ?? {},
              args.onUpdateHandle
            );
          if (uniqueFieldsTouched) {
            for (const doc of page) {
              await updateDoc(doc);
            }
          } else {
            await asyncMap(page, updateDoc);
          }
        }
        return {
          ...result,
          count: page.length,
          ids: page.map((doc) => doc._id),
        };
      },
    }),
    deleteOne: mutationGeneric({
      args: {
        input: v.union(
          ...Object.keys(schema.tables).map((name: string) => {
            const tableName = name as TableNames;
            return v.object({
              model: v.literal(tableName),
              where: v.optional(v.array(whereValidator(schema, tableName))),
            });
          })
        ),
        onDeleteHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const doc = await listOne(ctx, schema, betterAuthSchema, args.input);
        if (!doc) {
          return;
        }
        await ctx.db.delete(args.input.model, doc._id as GenericId<TableNames>);
        if (args.onDeleteHandle) {
          await ctx.runMutation(
            args.onDeleteHandle as FunctionHandle<"mutation">,
            { model: args.input.model, doc }
          );
        }
        return doc;
      },
    }),
    deleteMany: mutationGeneric({
      args: {
        input: v.union(
          ...Object.keys(schema.tables).map((name: string) => {
            const tableName = name as TableNames;
            return v.object({
              model: v.literal(tableName),
              where: v.optional(v.array(whereValidator(schema, tableName))),
            });
          })
        ),
        paginationOpts: paginationOptsValidator,
        onDeleteHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const { page, ...result } = await paginate(
          ctx,
          schema,
          betterAuthSchema,
          {
            ...args.input,
            paginationOpts: args.paginationOpts,
          }
        );
        await asyncMap(page, async (doc) => {
          if (args.onDeleteHandle) {
            await ctx.runMutation(
              args.onDeleteHandle as FunctionHandle<"mutation">,
              {
                model: args.input.model,
                doc,
              }
            );
          }
          await ctx.db.delete(
            args.input.model,
            doc._id as GenericId<TableNames>
          );
        });
        return {
          ...result,
          count: page.length,
          ids: page.map((doc) => doc._id),
        };
      },
    }),
  };
};
