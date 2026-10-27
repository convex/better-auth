import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  FunctionReference,
  PaginationOptions,
  PaginationResult,
  SchemaDefinition,
  TableNamesInDataModel,
} from "convex/server";
import type { Infer } from "convex/values";
import type { adapterWhereValidator } from "./adapter-utils.js";

type AdapterWhereBase = Infer<typeof adapterWhereValidator>;

type AdapterWhereOperator = NonNullable<AdapterWhereBase["operator"]>;

type AdapterWhereValue<V> =
  | Exclude<V, undefined>
  | (Exclude<V, undefined> extends string ? string | Array<string> : never)
  | (Exclude<V, undefined> extends number ? Array<number> : never)
  | null;

type ModelAdapterWhere<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
> = {
  [F in keyof AdapterDoc<S, T>]: {
    field: F;
    operator?: AdapterWhereOperator;
    value: AdapterWhereValue<AdapterDoc<S, T>[F]>;
    connector?: AdapterWhereBase["connector"];
    mode?: AdapterWhereBase["mode"];
  };
}[keyof AdapterDoc<S, T>];

/** Where-clause for a single table; `field` and `value` narrow with `T`. */
export type AdapterWhere<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
> = string extends SchemaTables<S>
  ? AdapterWhereBase
  : string extends keyof AdapterDoc<S, T>
    ? AdapterWhereBase
    : ModelAdapterWhere<S, T>;

/** Function references for the adapter API created by {@link createApi}. */
export type AdapterFunctions = {
  findOne: FunctionReference<"query", "public" | "internal", any, any>;
  findMany: FunctionReference<"query", "public" | "internal", any, any>;
  create: FunctionReference<"mutation", "public" | "internal", any, any>;
  updateOne: FunctionReference<"mutation", "public" | "internal", any, any>;
  updateMany: FunctionReference<"mutation", "public" | "internal", any, any>;
  deleteOne: FunctionReference<"mutation", "public" | "internal", any, any>;
  deleteMany: FunctionReference<"mutation", "public" | "internal", any, any>;
};

type SchemaTables<S extends SchemaDefinition<any, boolean>> =
  TableNamesInDataModel<DataModelFromSchemaDefinition<S>>;

type AdapterDoc<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
> = DocumentByName<DataModelFromSchemaDefinition<S>, T>;

type AdapterInsert<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
> = Omit<AdapterDoc<S, T>, "_id" | "_creationTime">;

type AdapterUpdate<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
> = Partial<AdapterInsert<S, T>>;

type QueryRunner = {
  runQuery: <Q extends FunctionReference<"query", any, any, any>>(
    query: Q,
    args: Q["_args"]
  ) => Promise<Q["_returnType"]>;
};

type MutationRunner = {
  runMutation: <M extends FunctionReference<"mutation", any, any, any>>(
    mutation: M,
    args: M["_args"]
  ) => Promise<M["_returnType"]>;
};

type AdapterDocKey<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
> = string extends keyof AdapterDoc<S, T> ? string : keyof AdapterDoc<S, T>;

type AdapterSelectResult<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
  Sel extends ReadonlyArray<AdapterDocKey<S, T>> | undefined,
> = Sel extends ReadonlyArray<AdapterDocKey<S, T>>
  ? string extends AdapterDocKey<S, T>
    ? Partial<AdapterDoc<S, T>>
    : Pick<AdapterDoc<S, T>, Sel[number] & keyof AdapterDoc<S, T>>
  : AdapterDoc<S, T>;

type FindOneArgs<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
  Sel extends ReadonlyArray<AdapterDocKey<S, T>> | undefined,
> = {
  model: T;
  where?: Array<AdapterWhere<S, T>>;
  select?: Sel;
  join?: unknown;
};

type FindManyArgs<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
  Sel extends ReadonlyArray<AdapterDocKey<S, T>> | undefined,
> = {
  model: T;
  where?: Array<AdapterWhere<S, T>>;
  select?: Sel;
  limit?: number;
  sortBy?: SortBy<S, T>;
  offset?: number;
  join?: unknown;
  paginationOpts: PaginationOptions;
};

type SortByBase = { direction: "asc" | "desc"; field: string };

/** Sort option for `findMany`; `field` narrows with table `T`. */
export type SortBy<
  S extends SchemaDefinition<any, boolean>,
  T extends SchemaTables<S>,
> = string extends SchemaTables<S>
  ? SortByBase
  : string extends keyof AdapterDoc<S, T>
    ? SortByBase
    : { direction: "asc" | "desc"; field: keyof AdapterDoc<S, T> };

export type BatchResult = {
  count: number;
  ids: Array<unknown>;
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};

/**
 * Typed wrappers around the Better Auth adapter API.
 *
 * Convex function references have a fixed return type, so `model` on the args
 * does not narrow `findOne` / `create` results. These helpers infer the doc
 * type from the `model` literal at the call site.
 *
 * @example
 * ```ts
 * import schema from "./betterAuth/schema";
 * import { createTypedAdapter } from "@convex-dev/better-auth";
 * import { components } from "./_generated/api";
 *
 * export const adapter = createTypedAdapter(schema, components.betterAuth.adapter);
 *
 * const user = await adapter.findOne(ctx, {
 *   model: "user",
 *   where: [{ field: "email", value: email }],
 *   select: ["email", "name"],
 * });
 * // user: Pick<Doc<"user">, "email" | "name"> | null
 * ```
 */
export function createTypedAdapter<S extends SchemaDefinition<any, boolean>>(
  _schema: S,
  fns: AdapterFunctions
) {
  return {
    findOne<
      T extends SchemaTables<S>,
      const Sel extends ReadonlyArray<AdapterDocKey<S, T>> | undefined = undefined,
    >(
      ctx: QueryRunner,
      args: FindOneArgs<S, T, Sel>
    ): Promise<AdapterSelectResult<S, T, Sel> | null> {
      return ctx.runQuery(fns.findOne, args) as Promise<
        AdapterSelectResult<S, T, Sel> | null
      >;
    },

    findMany<
      T extends SchemaTables<S>,
      const Sel extends ReadonlyArray<AdapterDocKey<S, T>> | undefined = undefined,
    >(
      ctx: QueryRunner,
      args: FindManyArgs<S, T, Sel>
    ): Promise<PaginationResult<AdapterSelectResult<S, T, Sel>>> {
      return ctx.runQuery(fns.findMany, args) as Promise<
        PaginationResult<AdapterSelectResult<S, T, Sel>>
      >;
    },

    create<T extends SchemaTables<S>>(
      ctx: MutationRunner,
      args: {
        input: { model: T; data: AdapterInsert<S, T> };
        select?: Array<string>;
        onCreateHandle?: string;
      }
    ): Promise<AdapterDoc<S, T>> {
      return ctx.runMutation(fns.create, args) as Promise<AdapterDoc<S, T>>;
    },

    updateOne<T extends SchemaTables<S>>(
      ctx: MutationRunner,
      args: {
        input: {
          model: T;
          update: AdapterUpdate<S, T>;
          where?: Array<AdapterWhere<S, T>>;
        };
        onUpdateHandle?: string;
      }
    ): Promise<AdapterDoc<S, T>> {
      return ctx.runMutation(fns.updateOne, args) as Promise<AdapterDoc<S, T>>;
    },

    updateMany<T extends SchemaTables<S>>(
      ctx: MutationRunner,
      args: {
        input: {
          model: T;
          update: AdapterUpdate<S, T>;
          where?: Array<AdapterWhere<S, T>>;
        };
        paginationOpts: PaginationOptions;
        onUpdateHandle?: string;
      }
    ): Promise<BatchResult> {
      return ctx.runMutation(fns.updateMany, args) as Promise<BatchResult>;
    },

    deleteOne<T extends SchemaTables<S>>(
      ctx: MutationRunner,
      args: {
        input: { model: T; where?: Array<AdapterWhere<S, T>> };
        onDeleteHandle?: string;
      }
    ): Promise<AdapterDoc<S, T> | undefined> {
      return ctx.runMutation(fns.deleteOne, args) as Promise<
        AdapterDoc<S, T> | undefined
      >;
    },

    deleteMany<T extends SchemaTables<S>>(
      ctx: MutationRunner,
      args: {
        input: { model: T; where?: Array<AdapterWhere<S, T>> };
        paginationOpts: PaginationOptions;
        onDeleteHandle?: string;
      }
    ): Promise<BatchResult> {
      return ctx.runMutation(fns.deleteMany, args) as Promise<BatchResult>;
    },
  };
}

export type TypedAdapter<S extends SchemaDefinition<any, boolean>> = ReturnType<
  typeof createTypedAdapter<S>
>;
