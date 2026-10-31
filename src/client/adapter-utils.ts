import { asyncMap } from "convex-helpers";
import { v } from "convex/values";
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

// Unique constraints of a model, as tuples of Convex field names: field-level
// `unique: true` fields, plus table-level unique indexes (Better Auth 1.7
// `indexes: [{ fields, unique: true }]`, used by e.g. device-authorization
// and oauth-provider plugins).
const getUniqueConstraints = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string
): string[][] => {
  const table = Object.values(betterAuthSchema).find(
    (value) => value.modelName === model
  );
  if (!table) {
    return [];
  }
  const fieldName = (key: string) => table.fields[key]?.fieldName ?? key;
  const fieldConstraints = Object.entries(table.fields)
    .filter(([, value]) => value.unique)
    .map(([key]) => [fieldName(key)]);
  const indexConstraints = (table.indexes ?? [])
    .filter((index) => index.unique)
    .map((index) => index.fields.map(fieldName));
  return [...fieldConstraints, ...indexConstraints];
};
// A field is unique on its own only via a single-field constraint; being part
// of a compound unique index does not make its values unique.
const isUniqueField = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  field: string
) =>
  getUniqueConstraints(betterAuthSchema, model).some(
    (constraint) => constraint.length === 1 && constraint[0] === field
  );
// Whether the input sets every field of some unique constraint, i.e. writing
// it to more than one document would violate that constraint.
export const hasUniqueFields = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  input: Record<string, any>
) => {
  return getUniqueConstraints(betterAuthSchema, model).some((constraint) =>
    constraint.every((field) => field in input)
  );
};

// `eq null` must match unset fields as well as explicit nulls (SQL `IS NULL`):
// Convex omits never-written optional fields, and the 1.7 adapter factory
// drops undefined fields from writes. A Convex index range `q.eq(field, null)`
// only matches explicit nulls, so these clauses are always filtered statically.
const isNullEq = (w: { operator?: string; value: unknown }) =>
  (!w.operator || w.operator === "eq") && w.value === null;

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
      w.field !== "_id" &&
      !isNullEq(w)
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
      .sort((a, b) => {
        return a.field.localeCompare(b.field);
      })
      .map((w) => [w.field, w.value]) ?? [];
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
  const indexFields = indexEqFields
    .map(([field]) => field)
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
    : indexes.find(({ fields }: { fields: string[] }) => {
        const fieldsMatch = indexFields.every(
          (field, idx) => field === fields[idx]
        );
        // If sorting by createdAt, no intermediate fields can be on the index
        // as they may override the createdAt sort order.
        const boundFieldMatch =
          boundField === "createdAt" || sortField === "createdAt"
            ? indexFields.length === fields.length
            : true;
        return fieldsMatch && boundFieldMatch;
      });
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
      eq: indexEqFields.map(([, value]) => value),
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
  // On update, the constraint applies to the document as it will be after
  // the write.
  const merged: Record<string, any> = { ...doc, ...input };
  for (const constraint of getUniqueConstraints(betterAuthSchema, table)) {
    // Only constraints this write touches can newly conflict, and a tuple
    // with a missing or null member is not constrained (SQL semantics).
    if (
      !constraint.some((field) => field in input) ||
      constraint.some(
        (field) => merged[field] === undefined || merged[field] === null
      )
    ) {
      continue;
    }
    const { index } =
      findIndex(schema, {
        model: table,
        where: constraint.map((field) => ({
          field,
          operator: "eq" as const,
          value: merged[field],
        })),
      }) || {};
    if (!index) {
      throw new Error(`No index found for ${table}.${constraint.join("_")}`);
    }
    // findIndex matched the constraint fields as the index prefix.
    const prefixFields = index.fields.slice(0, constraint.length);
    const existingDocs = await ctx.db
      .query(table as any)
      .withIndex(index.indexDescriptor, (q) =>
        prefixFields.reduce(
          (range: any, field: string) => range.eq(field, merged[field]),
          q
        )
      )
      .take(2);
    if (existingDocs.some((existingDoc) => existingDoc._id !== doc?._id)) {
      throw new Error(`${table} ${constraint.join("_")} already exists`);
    }
  }
};

// Compare two field values for an in-memory sortBy. A missing or null value
// sorts before every present value (nulls first ascending, last descending,
// as in Better Auth's memory adapter) and missing values compare equal to
// each other, so the comparator stays consistent when only one side is set.
export const compareSortValues = (
  a: unknown,
  b: unknown,
  direction: "asc" | "desc"
) => {
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  const result =
    aMissing && bMissing
      ? 0
      : aMissing
        ? -1
        : bMissing
          ? 1
          : (a as any) < (b as any)
            ? -1
            : (a as any) > (b as any)
              ? 1
              : 0;
  return direction === "asc" ? result : -result;
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
  filterWhere?: (w: Infer<typeof adapterWhereValidator>) => any
) => {
  if (!doc) {
    return false;
  }
  for (const w of where ?? []) {
    if (filterWhere && !filterWhere(w)) {
      continue;
    }
    const value = doc[w.field as keyof typeof doc] as Infer<
      typeof adapterWhereValidator
    >["value"];
    const isLessThan = (val: typeof value, wVal: typeof w.value) => {
      if (wVal === undefined || wVal === null) {
        return false;
      }
      if (val === undefined || val === null) {
        return true;
      }
      return val < wVal;
    };
    const isGreaterThan = (val: typeof value, wVal: typeof w.value) => {
      if (val === undefined || val === null) {
        return false;
      }
      if (wVal === undefined || wVal === null) {
        return true;
      }
      return val > wVal;
    };
    const filter = (w: Infer<typeof adapterWhereValidator>) => {
      switch (w.operator) {
        case undefined:
        case "eq": {
          return w.value === null ? value == null : value === w.value;
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
          return isLessThan(value, w.value);
        }
        case "lte": {
          return value === w.value || isLessThan(value, w.value);
        }
        case "gt": {
          return isGreaterThan(value, w.value);
        }
        case "gte": {
          return value === w.value || isGreaterThan(value, w.value);
        }
        case "ne": {
          // `ne null` is SQL `IS NOT NULL`: unset fields don't match either.
          return w.value === null ? value != null : value !== w.value;
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

const generateQuery = (
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  args: Infer<typeof adapterArgsValidator>
) => {
  const { index, values, boundField, indexFields } =
    findIndex(schema, args) ?? {};
  const usableIndex =
    index?.indexDescriptor === "by_creation_time" ? undefined : index;
  const query = stream(ctx.db as any, schema).query(args.model as any);
  const hasValues =
    (values?.eq?.length ?? 0) > 0 ||
    values?.lt !== undefined ||
    values?.lte !== undefined ||
    values?.gt !== undefined ||
    values?.gte !== undefined;
  const indexedQuery = usableIndex
    ? query.withIndex(
        usableIndex.indexDescriptor,
        hasValues
          ? (q: any) => {
              for (const [idx, value] of (values?.eq ?? []).entries()) {
                q = q.eq(usableIndex.fields[idx], value);
              }
              if (values?.lt !== undefined) {
                q = q.lt(boundField, values.lt);
              }
              if (values?.lte !== undefined) {
                q = q.lte(boundField, values.lte);
              }
              if (values?.gt !== undefined) {
                q = q.gt(boundField, values.gt);
              }
              if (values?.gte !== undefined) {
                q = q.gte(boundField, values.gte);
              }
              return q;
            }
          : undefined
      )
    : query;
  const orderedQuery = args.sortBy
    ? indexedQuery.order(args.sortBy.direction === "desc" ? "desc" : "asc")
    : indexedQuery;
  if (!usableIndex && indexFields?.length) {
    // eslint-disable-next-line no-console
    console.warn(
      stripIndent`
        Querying without an index on table "${args.model}".
        This can cause performance issues, and may hit the document read limit.
        To fix, add an index that begins with the following fields in order:
        [${indexFields.join(", ")}]
      `
    );
  }
  const filteredQuery = orderedQuery.filterWith(async (doc) => {
    if (!usableIndex) {
      // No usable index, handle all where clauses statically.
      return filterByWhere(doc, args.where);
    }
    return filterByWhere(
      doc,
      args.where,
      // Index used for all eq and range clauses, apply remaining clauses
      // incompatible with Convex statically.
      (w) =>
        isNullEq(w) ||
        (w.operator &&
          ["contains", "starts_with", "ends_with", "ne", "not_in"].includes(
            w.operator
          ))
    );
  });
  return filteredQuery;
};

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
  }
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
      // `eq null` can't use the index (see isNullEq) and may match many docs.
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
      throw new Error(
        `No index found for ${args.model}.${uniqueWhere.field}`
      );
    }
    const doc =
      uniqueWhere.field === "_id"
        ? // Unfortunately this is one place where tests pass in UUIDs as values and convex-test doesn't support them
          // eslint-disable-next-line @convex-dev/explicit-table-ids
          await ctx.db.get(uniqueWhere.value as GenericId<T>)
        : await ctx.db
            .query(args.model as any)
            .withIndex(index?.indexDescriptor as any, (q) =>
              q.eq(index?.fields[0], uniqueWhere.value)
            )
            .unique();

    // Apply all other clauses as static filters to our 0 or 1 result.
    if (filterByWhere(doc, args.where, (w) => w !== uniqueWhere)) {
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
        .filter((doc) => filterByWhere(doc, args.where, (w) => w !== inWhere));

      return {
        page: filteredDocs
          .sort((a, b) => {
            if (args.sortBy?.field === "createdAt") {
              return args.sortBy.direction === "asc"
                ? (a._creationTime as number) - (b._creationTime as number)
                : (b._creationTime as number) - (a._creationTime as number);
            }
            if (args.sortBy) {
              return compareSortValues(
                a[args.sortBy.field as keyof typeof a],
                b[args.sortBy.field as keyof typeof b],
                args.sortBy.direction
              );
            }
            return 0;
          })
          .map((doc) => selectFields(doc, args.select))
          .flatMap((doc) => (doc ? [doc] : [])) as Doc[],
        isDone: true,
        continueCursor: "",
      };
    }
    const streams = inWhere.value.map((value) => {
      return generateQuery(ctx, schema, {
        ...args,
        where: args.where?.map((w) => {
          if (w === inWhere) {
            return { ...w, operator: "eq", value };
          }
          return w;
        }),
      });
    });
    const result = await mergedStream(
      streams,
      [
        args.sortBy?.field !== "createdAt" && args.sortBy?.field,
        "_creationTime",
      ].flatMap((f) => (f ? [f] : []))
    ).paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map((doc) => selectFields(doc, args.select)),
    };
  }

  const query = generateQuery(ctx, schema, args);
  const result = await query.paginate(paginationOpts);
  return {
    ...result,
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
  args: Infer<typeof adapterArgsValidator>
): Promise<Doc | null> => {
  return (
    await paginate(ctx, schema, betterAuthSchema, {
      ...args,
      paginationOpts: {
        numItems: 1,
        cursor: null,
      },
    })
  ).page[0] as Doc | null;
};
