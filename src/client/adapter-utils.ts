import { asyncMap } from "convex-helpers";
import { v } from "convex/values";
import type { Infer } from "convex/values";
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

// Compound unique indexes can't be enforced by this adapter. Fail when the
// schema is generated or loaded rather than accept writes that violate them.
export const assertNoCompoundUniqueIndexes = (
  betterAuthSchema: BetterAuthDBSchema
) => {
  for (const [key, table] of Object.entries(betterAuthSchema)) {
    for (const index of table.indexes ?? []) {
      if (index.unique && index.fields.length > 1) {
        throw new Error(
          `${table.modelName ?? key}: compound unique index [${index.fields.join(", ")}] is not supported by the Convex adapter`
        );
      }
    }
  }
};

// Better Auth 1.7 plugins can declare uniqueness as a table-level index
// (`indexes: [{ fields: ["deviceCode"], unique: true }]`, e.g.
// device-authorization) instead of field-level `unique: true`. Mark the field
// of each single-field unique index as unique so the field-level checks below
// enforce it. Compound unique indexes throw (assertNoCompoundUniqueIndexes).
export const withTableLevelUniqueFields = (
  betterAuthSchema: BetterAuthDBSchema
): BetterAuthDBSchema => {
  assertNoCompoundUniqueIndexes(betterAuthSchema);
  return Object.fromEntries(
    Object.entries(betterAuthSchema).map(([key, table]) => {
      const uniqueFields = (table.indexes ?? [])
        .filter((index) => index.unique && index.fields.length === 1)
        .map((index) => index.fields[0]);
      if (!uniqueFields.length) {
        return [key, table];
      }
      return [
        key,
        {
          ...table,
          fields: Object.fromEntries(
            Object.entries(table.fields).map(([field, attribute]) => [
              field,
              uniqueFields.includes(field)
                ? { ...attribute, unique: true }
                : attribute,
            ])
          ),
        },
      ];
    })
  );
};

const isUniqueField = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  field: string
) => {
  const fields = Object.values(betterAuthSchema).find(
    (value) => value.modelName === model
  )?.fields;
  if (!fields) {
    return false;
  }
  // Adapter inputs and where clauses use the stored (Convex) field name.
  return Object.entries(fields)
    .filter(([, value]) => value.unique)
    .map(([key, value]) => value.fieldName ?? key)
    .includes(field);
};
// Null and unset values are never unique-constrained (SQL unique index
// semantics), so they don't count as setting a unique field.
export const hasUniqueFields = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  input: Record<string, any>
) => {
  for (const [field, value] of Object.entries(input)) {
    if (value != null && isUniqueField(betterAuthSchema, model, field)) {
      return true;
    }
  }
  return false;
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
  if (!hasUniqueFields(betterAuthSchema, table, input)) {
    return;
  }
  for (const [field, value] of Object.entries(input)) {
    // Null and unset values never collide (SQL unique index semantics).
    if (value == null || !isUniqueField(betterAuthSchema, table, field)) {
      continue;
    }
    const { index } =
      findIndex(schema, {
        model: table,
        where: [{ field, operator: "eq", value }],
      }) || {};
    if (!index) {
      throw new Error(`No index found for ${table}.${field}`);
    }
    // take(2) rather than unique(): pre-existing duplicates must not crash
    // the check, and the document being updated is not a conflict.
    const existingDocs = await ctx.db
      .query(table as any)
      .withIndex(index.indexDescriptor, (q) => q.eq(field, value))
      .take(2);
    if (existingDocs.some((existingDoc) => existingDoc._id !== doc?._id)) {
      throw new Error(`${table} ${field} already exists`);
    }
  }
};

// Reject the write if another document already has one of these field values.
// Unlike checkUniqueFields, the fields needn't be unique in the schema.
export const checkFieldsAvailable = async (
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  table: string,
  input: Record<string, any>,
  fields: string[]
) => {
  for (const field of fields) {
    const value = input[field];
    if (value === null || value === undefined) {
      continue;
    }
    const { index } =
      findIndex(schema, {
        model: table,
        where: [{ field, operator: "eq", value }],
      }) || {};
    if (!index) {
      throw new Error(`No index found for ${table}.${field}`);
    }
    const existingDoc = await ctx.db
      .query(table as any)
      .withIndex(index.indexDescriptor, (q) => q.eq(field, value))
      .first();
    if (existingDoc) {
      throw new Error(`${table} ${field} already exists`);
    }
  }
};

// Better Auth looks accounts up by providerId and accountId and, since 1.7,
// fails the lookup when more than one row matches, but it never declares the
// pair unique and reads then inserts in two calls. Reject a second account
// with the same pair here: a Convex mutation is a transaction, so the check
// and the insert can't interleave.
export const checkAccountKeyAvailable = async (
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  betterAuthSchema: BetterAuthDBSchema,
  table: string,
  input: Record<string, any>
) => {
  const account = betterAuthSchema.account;
  if (!account || (account.modelName ?? "account") !== table) {
    return;
  }
  const providerIdField = account.fields.providerId?.fieldName ?? "providerId";
  const accountIdField = account.fields.accountId?.fieldName ?? "accountId";
  const providerId = input[providerIdField];
  const accountId = input[accountIdField];
  if (providerId == null || accountId == null) {
    return;
  }
  const found = findIndex(schema, {
    model: table,
    where: [
      { field: accountIdField, operator: "eq", value: accountId },
      { field: providerIdField, operator: "eq", value: providerId },
    ],
  });
  if (!found?.index) {
    throw new Error(
      `No index found for ${table}.${accountIdField}, ${providerIdField}`
    );
  }
  const { index, values } = found;
  const existingDoc = await ctx.db
    .query(table as any)
    .withIndex(index.indexDescriptor, (q: any) => {
      for (const [idx, value] of values.eq.entries()) {
        q = q.eq(index.fields[idx], value);
      }
      return q;
    })
    .first();
  if (existingDoc) {
    throw new Error(
      `${table} with ${providerIdField} ${JSON.stringify(providerId)} and ${accountIdField} ${JSON.stringify(accountId)} already exists`
    );
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

// The fields a query returns rows ordered by: the fields of its index after
// the equality prefix, ending in _creationTime, or creation order when it
// uses no index.
const queryOrder = (found: ReturnType<typeof findIndex>) =>
  found?.index && found.index.indexDescriptor !== "by_creation_time"
    ? found.index.fields.slice(found.values.eq.length)
    : ["_creationTime"];

// Set on a page when the query's order doesn't follow sortBy, which happens
// when no index serves the sort. The client refuses the query then (see
// assertSortServed in the client).
// `indexFields` is the index that would serve the sort. When none can, it is
// left out, and `rangeField` names the range on another field that orders
// the rows first, if that is why.
export type UnservedSort = { indexFields?: string[]; rangeField?: string };

const unservedSort = (
  args: Infer<typeof adapterArgsValidator>,
  found: ReturnType<typeof findIndex>
): { unservedSort?: UnservedSort } => {
  if (!args.sortBy) {
    return {};
  }
  const { field } = args.sortBy;
  // An equality on the sort field leaves every matching row with one value.
  if (
    args.where?.some(
      (w) => (!w.operator || w.operator === "eq") && w.field === field
    )
  ) {
    return {};
  }
  // createdAt is served by _creationTime, as in findIndex.
  const sortKey = field === "createdAt" ? "_creationTime" : field;
  if (queryOrder(found)[0] === sortKey) {
    return {};
  }
  const range = args.where?.find(
    (w) => w.operator && ["lt", "lte", "gt", "gte"].includes(w.operator)
  );
  if (range && range.field !== field) {
    return { unservedSort: { rangeField: range.field } };
  }
  // `in` branches merge on the index fields after the equality prefix, which
  // never include the `in` field itself, so no index serves this sort.
  if (args.where?.some((w) => w.operator === "in" && w.field === field)) {
    return { unservedSort: {} };
  }
  return {
    unservedSort: {
      indexFields:
        found && "indexFields" in found && found.indexFields
          ? found.indexFields.map(String)
          : [field],
    },
  };
};

// Look a document up by an id Better Auth passed in. Ids come from requests
// (admin and organization routes take them from the body), so one may be
// malformed or belong to another table; both mean "no such document" rather
// than an error or another table's document.
const getById = async (
  ctx: GenericQueryCtx<GenericDataModel>,
  table: string,
  value: unknown
) => {
  if (typeof value !== "string") {
    return null;
  }
  const id = ctx.db.normalizeId(table as any, value);
  return id ? await ctx.db.get(table as any, id) : null;
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
      throw new Error(`No index found for ${args.model}.${uniqueWhere.field}`);
    }
    const doc =
      uniqueWhere.field === "_id"
        ? await getById(ctx, args.model, uniqueWhere.value)
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
        return getById(ctx, args.model, value);
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
    // A repeated value would be a repeated stream, and so repeated rows.
    const inValues = inWhere.value.filter(
      (value, idx, all) => all.indexOf(value) === idx
    );
    if (!inValues.length) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    // Each unique session token owns at most one row. Look it up through
    // the token-only index and filter expiry afterward, so creation-order
    // merging cannot be replaced by an unrelated expiration range order.
    // Other models and unindexed sorts keep the native unservedSort contract.
    const table = schema.tables[args.model];
    const uniqueSessionTokens =
      args.model === "session" &&
      inWhere.field === "token" &&
      isUniqueField(betterAuthSchema, args.model, "token") &&
      (!args.sortBy || args.sortBy.field === "createdAt") &&
      table !== undefined &&
      table[" indexes"]().some(
        ({ fields }: { fields: string[] }) =>
          fields.length === 1 && fields[0] === "token"
      );
    const branchArgs = (value: (typeof inValues)[number]) => ({
      ...args,
      where: uniqueSessionTokens
        ? [{ ...inWhere, operator: "eq" as const, value }]
        : args.where?.map((w) =>
            w === inWhere ? { ...w, operator: "eq" as const, value } : w
          ),
    });
    const streams = inValues.map((value) => {
      const query = generateQuery(ctx, schema, branchArgs(value));
      return uniqueSessionTokens
        ? query.filterWith(async (doc) =>
            filterByWhere(doc, args.where, (w) => w !== inWhere)
          )
        : query;
    });
    // Every branch binds the same fields, so generateQuery picks the same
    // index for each of them. convex-helpers merges streams on a key that
    // must be a suffix of the stream's index fields keeping every field after
    // the equality prefix, so order the merge by exactly those fields (ending
    // in _creationTime). `_creationTime` alone is only right when the `in`
    // field is the last field of its index.
    const found = findIndex(schema, branchArgs(inValues[0]!));
    const result = await mergedStream(streams, queryOrder(found)).paginate(
      paginationOpts
    );
    return {
      ...result,
      page: result.page.map((doc) => selectFields(doc, args.select)),
      // Judged on args, not the branch: an `in` on the sort field is not an
      // equality, so the merged rows are not sorted by it.
      ...unservedSort(args, found),
    };
  }

  const query = generateQuery(ctx, schema, args);
  const result = await query.paginate(paginationOpts);
  return {
    ...result,
    page: result.page.map((doc) => selectFields(doc, args.select)),
    ...unservedSort(args, findIndex(schema, args)),
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
  // A page comes back empty but not done when the static filter rejected
  // every row in its budget (maximumRowsRead in paginate), so keep reading
  // until a row turns up or the query is done. Each page reads a bounded
  // number of rows and the cursor has to move, so the loop ends within the
  // table.
  let cursor: string | null = null;
  for (;;) {
    const result: PaginationResult<Doc> = await paginate(
      ctx,
      schema,
      betterAuthSchema,
      {
        ...args,
        paginationOpts: { numItems: 1, cursor },
      }
    );
    if (result.page.length) {
      return result.page[0]!;
    }
    if (result.isDone) {
      return null;
    }
    if (result.continueCursor === cursor) {
      throw new Error(
        `Pagination cursor did not advance while reading ${args.model}`
      );
    }
    cursor = result.continueCursor;
  }
};
