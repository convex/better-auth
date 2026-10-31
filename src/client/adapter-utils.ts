import { fieldValue } from "./index-stream.js";
import type { QueryStream } from "convex-helpers/server/stream";
import { asyncMap } from "convex-helpers";
import { compareValues, ConvexError, v } from "convex/values";
import type { GenericId, Infer } from "convex/values";
import type {
  DocumentByName,
  GenericDataModel,
  GenericQueryCtx,
  PaginationOptions,
  PaginationResult,
  SchemaDefinition,
  TableNamesInDataModel,
} from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { mergedStream } from "convex-helpers/server/stream";
import { stripIndent } from "common-tags";
import type { BetterAuthDBSchema } from "better-auth/db";

export const adapterWhereValidator = v.object({
  field: v.string(),
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

export const adapterArgsValidator = v.object({
  model: v.string(),
  where: v.optional(v.array(adapterWhereValidator)),
  sortBy: v.optional(
    v.object({
      field: v.string(),
      direction: v.union(v.literal("asc"), v.literal("desc")),
    })
  ),
  select: v.optional(v.array(v.string())),
  limit: v.optional(v.number()),
  offset: v.optional(v.number()),
});

const getUniqueConstraints = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string
) => {
  const table = Object.values(betterAuthSchema).find(
    (value) => value.modelName === model
  );
  if (!table) {
    return [];
  }
  const singleFieldConstraints = Object.entries(table.fields)
    .filter(([, value]) => value.unique)
    .map(([key, value]) => [value.fieldName ?? key]);
  const tableConstraints =
    table.indexes
      ?.filter((index) => index.unique)
      .map((index) =>
        index.fields.map((field) => table.fields[field]?.fieldName ?? field)
      ) ?? [];
  return [...singleFieldConstraints, ...tableConstraints];
};
const isUniqueField = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  field: string
) =>
  getUniqueConstraints(betterAuthSchema, model).some(
    (constraint) => constraint.length === 1 && constraint[0] === field
  );
export const hasUniqueFields = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  input: Record<string, any>
) => {
  const inputFields = new Set(Object.keys(input));
  return getUniqueConstraints(betterAuthSchema, model).some((constraint) =>
    constraint.every((field) => inputFields.has(field))
  );
};
export const touchesUniqueFields = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  input: Record<string, any>
) => {
  const inputFields = new Set(Object.keys(input));
  return getUniqueConstraints(betterAuthSchema, model).some((constraint) =>
    constraint.some((field) => inputFields.has(field))
  );
};

const findIndex = (
  schema: SchemaDefinition<any, any>,
  args: {
    model: string;
    where?: {
      field: string;
      operator?:
        | "lt"
        | "lte"
        | "gt"
        | "gte"
        | "eq"
        | "in"
        | "not_in"
        | "ne"
        | "contains"
        | "starts_with"
        | "ends_with";
      value: string | number | boolean | null | string[] | number[];
      connector?: "AND" | "OR";
      mode?: "sensitive" | "insensitive";
    }[];
    sortBy?: {
      field: string;
      direction: "asc" | "desc";
    };
  }
) => {
  if (
    (args.where?.length ?? 0) > 1 &&
    args.where?.some((w) => w.connector === "OR")
  ) {
    throw new Error(
      `OR connector not supported with multiple where statements in findIndex, split up the where statements before calling findIndex: ${JSON.stringify(args.where)}`
    );
  }
  const where = args.where?.filter((w) => {
    return (
      (!w.operator ||
        ["lt", "lte", "gt", "gte", "eq", "in", "not_in"].includes(
          w.operator
        )) &&
      w.field !== "_id"
    );
  });
  if (!where?.length && !args.sortBy) {
    return;
  }
  const lowerBounds =
    where?.filter((w) => w.operator === "lt" || w.operator === "lte") ?? [];
  if (lowerBounds.length > 1) {
    throw new Error(
      `cannot have more than one lower bound where clause: ${JSON.stringify(where)}`
    );
  }
  const upperBounds =
    where?.filter((w) => w.operator === "gt" || w.operator === "gte") ?? [];
  if (upperBounds.length > 1) {
    throw new Error(
      `cannot have more than one upper bound where clause: ${JSON.stringify(where)}`
    );
  }
  const lowerBound = lowerBounds[0];
  const upperBound = upperBounds[0];
  if (lowerBound && upperBound && lowerBound.field !== upperBound.field) {
    throw new Error(
      `lower bound and upper bound must have the same field: ${JSON.stringify(where)}`
    );
  }
  const boundField = lowerBound?.field || upperBound?.field;
  if (
    boundField &&
    where?.some(
      (w) => w.field === boundField && w !== lowerBound && w !== upperBound
    )
  ) {
    throw new Error(
      `too many where clauses on the bound field: ${JSON.stringify(where)}`
    );
  }
  const indexEqFields =
    where
      ?.filter((w) => !w.operator || w.operator === "eq")
      .map((w) => [w.field, w.value] as const) ?? [];
  if (!indexEqFields?.length && !boundField && !args.sortBy) {
    return;
  }
  const table = schema.tables[args.model as keyof typeof schema.tables];
  if (!table) {
    throw new Error(`Table ${args.model} not found`);
  }
  const indexes = table[" indexes"]();
  const sortField = args.sortBy?.field;

  // We internally use _creationTime in place of Better Auth's createdAt
  const eqFields = indexEqFields.map(([field]) => field);
  const eqValues = new Map(indexEqFields);
  const suffixFields = [
    boundField && boundField !== "createdAt" ? boundField : "",
    sortField && sortField !== "createdAt" && boundField !== sortField
      ? sortField
      : "",
  ].filter(Boolean);
  const indexFields = [...eqFields]
    .sort((a, b) => a.localeCompare(b))
    .concat(boundField && boundField !== "createdAt" ? boundField : "")
    .concat(
      sortField && sortField !== "createdAt" && boundField !== sortField
        ? sortField
        : ""
    )
    .filter(Boolean);
  if (!indexFields.length && !boundField && !sortField) {
    return;
  }
  // Use the built in _creationTime index if bounding or sorting by createdAt
  // with no other fields
  const index = !indexFields.length
    ? {
        indexDescriptor: "by_creation_time",
        fields: [],
      }
    : (indexes.find(({ fields }: { fields: string[] }) =>
        matchesIndex(fields, true)
      ) ??
      indexes.find(({ fields }: { fields: string[] }) =>
        matchesIndex(fields, false)
      ));

  function matchesIndex(fields: string[], requireExactEqOrder: boolean) {
    if (
      eqValues.size !== eqFields.length ||
      fields.length < eqFields.length + suffixFields.length
    ) {
      return false;
    }
    const eqPrefix = fields.slice(0, eqFields.length);
    const eqFieldsMatch = requireExactEqOrder
      ? eqPrefix.every((field, index) => field === eqFields[index])
      : eqPrefix.every((field) => eqValues.has(field));
    const suffixFieldsMatch = suffixFields.every(
      (field, index) => field === fields[eqFields.length + index]
    );
    // If sorting by createdAt, no intermediate fields can be on the index
    // as they may override the createdAt sort order.
    const createdAtFieldMatch =
      boundField === "createdAt" || sortField === "createdAt"
        ? eqFields.length + suffixFields.length === fields.length
        : true;
    return eqFieldsMatch && suffixFieldsMatch && createdAtFieldMatch;
  }
  if (!index) {
    return { indexFields };
  }
  return {
    index: {
      indexDescriptor: index.indexDescriptor,
      fields: [...index.fields, "_creationTime"],
    },
    boundField,
    sortField,
    values: {
      eq: index.fields
        .slice(0, eqFields.length)
        .map((field: string) => [field, eqValues.get(field)!] as const),
      lt: lowerBound?.operator === "lt" ? lowerBound.value : undefined,
      lte: lowerBound?.operator === "lte" ? lowerBound.value : undefined,
      gt: upperBound?.operator === "gt" ? upperBound.value : undefined,
      gte: upperBound?.operator === "gte" ? upperBound.value : undefined,
    },
  };
};

export const checkUniqueFields = async <
  Schema extends SchemaDefinition<any, any>,
>(
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: Schema,
  betterAuthSchema: BetterAuthDBSchema,
  table: string,
  input: Record<string, any>,
  doc?: Record<string, any>
) => {
  const mergedDoc = { ...doc, ...input };
  for (const constraint of getUniqueConstraints(betterAuthSchema, table)) {
    if (
      !constraint.some((field) => field in input) ||
      !constraint.every((field) => mergedDoc[field] !== undefined)
    ) {
      continue;
    }
    const { index } = findIndex(schema, {
      model: table,
      where: constraint.map((field) => ({
        field,
        operator: "eq" as const,
        value: mergedDoc[field],
      })),
    }) || { index: undefined };
    if (!index) {
      throw new Error(
        `No index found for unique constraint ${table}.${constraint.join("+")}`
      );
    }
    const indexConstraintFields = index.fields.slice(0, constraint.length);
    if (
      indexConstraintFields.length !== constraint.length ||
      !indexConstraintFields.every((field) => constraint.includes(field))
    ) {
      throw new Error(
        `Index ${index.indexDescriptor} does not match unique constraint ${table}.${constraint.join("+")}`
      );
    }
    const existingDocs = await ctx.db
      .query(table as any)
      .withIndex(index.indexDescriptor, (q) =>
        indexConstraintFields.reduce(
          (query: any, field: string) => query.eq(field, mergedDoc[field]),
          q
        )
      )
      .take(2);
    if (existingDocs.some((existingDoc) => existingDoc._id !== doc?._id)) {
      const constraintName =
        constraint.length === 1
          ? constraint[0]
          : `unique constraint ${constraint.join("+")}`;
      throw new Error(`${table} ${constraintName} already exists`);
    }
  }
};

// This handles basic select (stripping out the other fields if there
// is a select arg).
export const selectFields = <
  T extends TableNamesInDataModel<GenericDataModel>,
  D extends DocumentByName<GenericDataModel, T>,
>(
  doc: D | null,
  select?: string[]
) => {
  if (!doc) {
    return null;
  }
  if (!select?.length) {
    return doc;
  }
  return select.reduce((acc, field) => {
    // Better Auth may request "id" while Convex stores it as "_id".
    // Keep the raw field key here and let Better Auth map "_id" -> "id".
    const sourceField = field === "id" && "_id" in doc ? "_id" : field;
    (acc as any)[sourceField] = doc[sourceField as keyof typeof doc];
    return acc;
  }, {} as D);
};

// Manually filter an individual document by where clauses. This is used to
// simplify queries that can only return 0 or 1 documents, or "in" clauses that
// query multiple single documents in parallel.
const filterByWhere = <
  T extends TableNamesInDataModel<GenericDataModel>,
  D extends DocumentByName<GenericDataModel, T>,
>(
  doc: D | null,
  where?: Infer<typeof adapterWhereValidator>[],
  // Optionally filter which where clauses to apply.
  filterWhere?: (w: Infer<typeof adapterWhereValidator>) => any,
  matchMissingNull = false
) => {
  if (!doc) {
    return false;
  }
  for (const w of where ?? []) {
    if (filterWhere && !filterWhere(w)) {
      continue;
    }
    const value = fieldValue(doc, w.field) as Infer<
      typeof adapterWhereValidator
    >["value"];
    const filter = (w: Infer<typeof adapterWhereValidator>) => {
      switch (w.operator) {
        case undefined:
        case "eq": {
          // Convex omits unset optional fields; Better Auth's null guards must
          // also match those fields (for example, unrevoked refresh tokens).
          return matchMissingNull && w.value === null
            ? value == null
            : value === w.value;
        }
        case "in": {
          return Array.isArray(w.value) && (w.value as any[]).includes(value);
        }
        case "not_in": {
          const result =
            Array.isArray(w.value) && !(w.value as any[]).includes(value);
          return result;
        }
        case "lt": {
          return compareValues(value, w.value) < 0;
        }
        case "lte": {
          return compareValues(value, w.value) <= 0;
        }
        case "gt": {
          return compareValues(value, w.value) > 0;
        }
        case "gte": {
          return compareValues(value, w.value) >= 0;
        }
        case "ne": {
          return value !== w.value;
        }
        case "contains": {
          return typeof value === "string" && value.includes(w.value as string);
        }
        case "starts_with": {
          return (
            typeof value === "string" && value.startsWith(w.value as string)
          );
        }
        case "ends_with": {
          return typeof value === "string" && value.endsWith(w.value as string);
        }
      }
    };
    if (!filter(w)) {
      return false;
    }
  }
  return true;
};

type Equality = readonly (readonly [string, unknown])[];
type IndexMatch = NonNullable<ReturnType<typeof findIndex>>;
type IndexedPlan = {
  indexName: string;
  bounds: IndexMatch["values"];
  boundField: string | undefined;
  mergeFields: string[];
  inMode: "shared" | "branches";
};
type QueryPlan =
  | { kind: "scan"; indexFields?: string[]; inMode: "shared" }
  | (IndexedPlan & { kind: "direct"; equality: Equality });

const queryPlan = (
  schema: SchemaDefinition<any, any>,
  args: Infer<typeof adapterArgsValidator>
): QueryPlan => {
  const { index, values, boundField, indexFields } =
    findIndex(schema, args) ?? {};
  if (!index || index.indexDescriptor === "by_creation_time")
    return { kind: "scan", indexFields, inMode: "shared" };
  const equality: Equality = values?.eq ?? [];
  return {
    kind: "direct",
    indexName: index.indexDescriptor,
    bounds: values,
    boundField,
    mergeFields: index.fields.slice(equality.length),
    inMode: "branches",
    equality,
  };
};

// All values in an IN predicate are non-null; only its fixed equality value
// changes between physical ranges, so the same plan can serve every branch.
const bindInValue = (
  plan: QueryPlan,
  field: string,
  value: string | number
): QueryPlan => {
  const bind = (equality: Equality): Equality =>
    equality.map(([key, original]) => [key, key === field ? value : original]);
  switch (plan.kind) {
    case "scan":
      return plan;
    case "direct":
      return { ...plan, equality: bind(plan.equality) };
  }
};

const generateQuery = (
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  args: Infer<typeof adapterArgsValidator>,
  plan: QueryPlan,
  staticWhere = args.where,
  matchMissingNull = false
): QueryStream<any> => {
  const direction = args.sortBy?.direction === "desc" ? "desc" : "asc";
  if (plan.kind === "scan") {
    if (plan.indexFields?.length) {
      // eslint-disable-next-line no-console
      console.warn(stripIndent`Querying without an index on table "${args.model}".
        Add an index that begins with [${plan.indexFields.join(", ")}].`);
    }
    return stream(ctx.db as any, schema)
      .query(args.model as any)
      .order(direction)
      .filterWith(async (doc) =>
        filterByWhere(doc, staticWhere, undefined, matchMissingNull)
      );
  }
  const build = (equality: Equality) => {
    const query = stream(ctx.db as any, schema).query(args.model as any);
    return query
      .withIndex(plan.indexName, (q: any) => {
        for (const [field, value] of equality) q = q.eq(field, value);
        if (plan.bounds?.lt !== undefined)
          q = q.lt(plan.boundField, plan.bounds.lt);
        if (plan.bounds?.lte !== undefined)
          q = q.lte(plan.boundField, plan.bounds.lte);
        if (plan.bounds?.gt !== undefined)
          q = q.gt(plan.boundField, plan.bounds.gt);
        if (plan.bounds?.gte !== undefined)
          q = q.gte(plan.boundField, plan.bounds.gte);
        return q;
      })
      .order(direction);
  };
  const query = build(plan.equality);
  return query.filterWith(async (doc) =>
    filterByWhere(
      doc,
      staticWhere,
      (w) =>
        !!w.operator &&
        ["contains", "starts_with", "ends_with", "ne", "in", "not_in"].includes(
          w.operator
        ),
      matchMissingNull
    )
  );
};

const CURSOR_PREFIX = "better-auth:1:";
const restartPagination = () =>
  new ConvexError({
    code: "BETTER_AUTH_PAGINATION_RESTART_REQUIRED",
    message:
      "This pagination cursor belongs to an older or invalid query format. Discard prior pages and restart with cursor: null.",
  });
const decodeCursor = (cursor: string | null | undefined) => {
  if (cursor == null) return cursor;
  if (!cursor.startsWith(CURSOR_PREFIX)) throw restartPagination();
  const raw = cursor.slice(CURSOR_PREFIX.length);
  try {
    if (!Array.isArray(JSON.parse(raw))) throw restartPagination();
  } catch {
    throw restartPagination();
  }
  return raw;
};
const encodePage = <T>(result: PaginationResult<T>): PaginationResult<T> => ({
  ...result,
  continueCursor: CURSOR_PREFIX + result.continueCursor,
  ...(result.splitCursor != null
    ? { splitCursor: CURSOR_PREFIX + result.splitCursor }
    : {}),
});

// This is the core function for reading from the database, it parses and
// validates where conditions, selects indexes, and allows the caller to
// optionally paginate as needed. Every response is a pagination result.
export const paginate = async <
  Doc extends DocumentByName<GenericDataModel, T>,
  T extends TableNamesInDataModel<GenericDataModel>,
>(
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  betterAuthSchema: BetterAuthDBSchema,
  args: Infer<typeof adapterArgsValidator> & {
    paginationOpts: PaginationOptions;
  },
  matchMissingNull = false
): Promise<PaginationResult<Doc>> => {
  if (args.offset) {
    throw new Error(`offset not supported: ${JSON.stringify(args.offset)}`);
  }
  if (args.where?.some((w) => w.connector === "OR") && args.where?.length > 1) {
    throw new Error(
      `OR connector not supported with multiple where statements in paginate, split up the where statements before calling paginate: ${JSON.stringify(args.where)}`
    );
  }
  if (
    args.where?.some(
      (w) =>
        w.field === "_id" &&
        w.operator &&
        !["eq", "in", "not_in"].includes(w.operator)
    )
  ) {
    throw new Error(
      `_id can only be used with eq, in, or not_in operator: ${JSON.stringify(args.where)}`
    );
  }
  if (args.where?.some((w) => w.mode === "insensitive")) {
    throw new Error(
      `Case-insensitive queries (mode: "insensitive") are not supported by the Convex adapter. Store values in a normalized form (e.g. lowercase on write) and query against the normalized value.`
    );
  }
  // If any where clause is "eq" (or missing operator) on a unique field,
  // we can only return a single document, so we get it and use any other
  // where clauses as static filters.
  const uniqueWhere = args.where?.find(
    (w) =>
      (!w.operator || w.operator === "eq") &&
      w.value !== null &&
      (isUniqueField(betterAuthSchema, args.model, w.field) ||
        w.field === "_id")
  );
  if (uniqueWhere) {
    const { index } =
      findIndex(schema, {
        model: args.model,
        where: [uniqueWhere],
      }) || {};
    if (uniqueWhere.field !== "_id" && !index) {
      throw new Error(`No index found for ${args.model}.${uniqueWhere.field}`);
    }
    const doc =
      uniqueWhere.field === "_id"
        ? // Unfortunately this is one place where tests pass in UUIDs as values and convex-test doesn't support them
          // eslint-disable-next-line @convex-dev/explicit-table-ids
          await ctx.db.get(uniqueWhere.value as GenericId<T>)
        : await ctx.db
            .query(args.model as any)
            .withIndex(index?.indexDescriptor as any, (q) =>
              q.eq(uniqueWhere.field, uniqueWhere.value)
            )
            .unique();

    // Apply all other clauses as static filters to our 0 or 1 result.
    if (
      filterByWhere(doc, args.where, (w) => w !== uniqueWhere, matchMissingNull)
    ) {
      return {
        page: [selectFields(doc, args.select)].filter(Boolean) as Doc[],
        isDone: true,
        continueCursor: "",
      };
    }
    return {
      page: [],
      isDone: true,
      continueCursor: "",
    };
  }

  const paginationOpts = {
    ...args.paginationOpts,
    cursor: decodeCursor(args.paginationOpts.cursor) ?? null,
    endCursor: decodeCursor(args.paginationOpts.endCursor),
    maximumBytesRead: Math.min(
      args.paginationOpts.maximumBytesRead ?? 4 * 1024 * 1024,
      4 * 1024 * 1024
    ),
    // If maximumRowsRead is not at least 1 higher than numItems, bad cursors
    // and incorrect paging will result (at least with convex-test).
    maximumRowsRead: Math.max((args.paginationOpts.numItems ?? 0) + 1, 200),
  };

  // Large queries using "in" clause will crash, but these are only currently
  // possible with the organization plugin listing all members with a high
  // limit. For cases like this we need to create proper convex queries in
  // the component as an alternative to using Better Auth api's.
  const inWhere = args.where?.find((w) => w.operator === "in");
  if (inWhere) {
    if (!Array.isArray(inWhere.value)) {
      throw new Error("in clause value must be an array");
    }
    // For ids, just use asyncMap + .get()
    if (inWhere.field === "_id") {
      const docs = await asyncMap(inWhere.value as any[], async (value) => {
        return ctx.db.get(args.model, value as GenericId<T>);
      });
      const filteredDocs = docs
        .flatMap((doc) => (doc ? [doc] : []))
        .filter((doc) =>
          filterByWhere(doc, args.where, (w) => w !== inWhere, matchMissingNull)
        );

      return {
        page: filteredDocs
          .sort((a, b) => {
            if (args.sortBy?.field === "createdAt") {
              return args.sortBy.direction === "asc"
                ? (a._creationTime as number) - (b._creationTime as number)
                : (b._creationTime as number) - (a._creationTime as number);
            }
            if (args.sortBy) {
              const aValue = a[args.sortBy.field as keyof typeof a];
              const bValue = b[args.sortBy.field as keyof typeof b];
              if (aValue === bValue) {
                return 0;
              }
              return args.sortBy.direction === "asc"
                ? aValue! > bValue!
                  ? 1
                  : -1
                : aValue! > bValue!
                  ? -1
                  : 1;
            }
            return 0;
          })
          .map((doc) => selectFields(doc, args.select))
          .flatMap((doc) => (doc ? [doc] : [])) as Doc[],
        isDone: true,
        continueCursor: "",
      };
    }
    // Avoid creating duplicate indexed branches for repeated IN values.
    const inValues = [...new Set<string | number>(inWhere.value)];
    if (!inValues.length) return { page: [], isDone: true, continueCursor: "" };
    const branchArgs = (value: string | number) => ({
      ...args,
      where: args.where?.map((w) =>
        w === inWhere ? { ...w, operator: "eq" as const, value } : w
      ),
    });
    const first = branchArgs(inValues[0]!);
    const plan = queryPlan(schema, first);
    if (plan.inMode === "shared") {
      // Multiple filtered streams over the same physical range can checkpoint
      // a rejected copy of a row before another stream emits its matching copy.
      // Query this range once and evaluate IN as a single static predicate.
      const result = await generateQuery(
        ctx,
        schema,
        first,
        plan,
        args.where,
        matchMissingNull
      ).paginate(paginationOpts);
      return {
        ...encodePage(result),
        page: result.page.map((doc) => selectFields(doc, args.select)),
      };
    }
    const streams = inValues.map((value) =>
      generateQuery(
        ctx,
        schema,
        branchArgs(value),
        bindInValue(plan, inWhere.field, value),
        undefined,
        matchMissingNull
      )
    );
    const result = await mergedStream(streams, plan.mergeFields).paginate(
      paginationOpts
    );
    return {
      ...encodePage(result),
      page: result.page.map((doc) => selectFields(doc, args.select)),
    };
  }

  const query = generateQuery(
    ctx,
    schema,
    args,
    queryPlan(schema, args),
    args.where,
    matchMissingNull
  );
  const result = await query.paginate(paginationOpts);
  return {
    ...encodePage(result),
    page: result.page.map((doc) => selectFields(doc, args.select)),
  };
};

export const listOne = async <
  Doc extends DocumentByName<GenericDataModel, T>,
  T extends TableNamesInDataModel<GenericDataModel>,
>(
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  betterAuthSchema: BetterAuthDBSchema,
  args: Infer<typeof adapterArgsValidator>,
  matchMissingNull = false
): Promise<Doc | null> => {
  let cursor: string | null = null;
  for (;;) {
    const result: PaginationResult<Doc> = await paginate(
      ctx,
      schema,
      betterAuthSchema,
      {
        ...args,
        paginationOpts: { numItems: 1, cursor },
      },
      matchMissingNull
    );
    if (result.page.length) return result.page[0]!;
    if (result.isDone) return null;
    if (result.continueCursor === cursor)
      throw new Error("Pagination cursor did not advance");
    cursor = result.continueCursor;
  }
};
