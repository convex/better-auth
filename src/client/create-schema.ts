import type { BetterAuthDBSchema, DBFieldAttribute } from "better-auth/db";

const resolveCdTarget = (
  relativeDir: string | null,
  cwdBasename: string
): string | null => {
  if (relativeDir === "") {
    return null;
  }
  if (relativeDir !== null) {
    return relativeDir;
  }
  return cwdBasename;
};

// Manually add fields to index on for schema generation,
// all fields in the schema specialFields are automatically indexed
export const indexFields = {
  account: ["accountId", ["accountId", "providerId"], ["providerId", "userId"]],
  rateLimit: ["key"],
  session: ["expiresAt", ["expiresAt", "userId"]],
  verification: ["expiresAt", "identifier"],
  user: [["email", "name"], "name", "userId"],
  oauthConsent: [["clientId", "userId"]],
};

// Return map of unique, sortable, and reference fields
const specialFields = (tables: BetterAuthDBSchema) =>
  Object.fromEntries(
    Object.entries(tables)
      .map(([key, table]) => {
        const fields = Object.fromEntries(
          Object.entries(table.fields)
            .map(([fieldKey, field]) => [
              field.fieldName ?? fieldKey,
              {
                ...(field.sortable ? { sortable: true } : {}),
                ...(field.unique ? { unique: true } : {}),
                ...(field.references ? { references: field.references } : {}),
              },
            ])
            .filter(([_key, value]) =>
              typeof value === "object" ? Object.keys(value).length > 0 : true
            )
        );
        return [key, fields];
      })
      .filter(([_key, value]) =>
        typeof value === "object" ? Object.keys(value).length > 0 : true
      )
  );

const resolveReferencedTableName = (
  refModel: string,
  tables: BetterAuthDBSchema
): string | null => {
  const byKey = tables[refModel];
  if (byKey) {
    return byKey.modelName;
  }
  const byModelName = Object.values(tables).find(
    (table) => table.modelName === refModel
  );
  return byModelName?.modelName ?? null;
};

const getFieldValidator = (
  field: DBFieldAttribute,
  tables: BetterAuthDBSchema
): string => {
  if (
    field.type === "string" &&
    field.references?.field === "id" &&
    field.references.model
  ) {
    const tableName = resolveReferencedTableName(
      field.references.model,
      tables
    );
    if (tableName) {
      return `v.id("${tableName}")`;
    }
  }

  const type = field.type as
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "json"
    | `${"string" | "number"}[]`;

  const typeMap: Record<typeof type, string> = {
    string: `v.string()`,
    boolean: `v.boolean()`,
    number: `v.number()`,
    date: `v.number()`,
    json: `v.string()`,
    "number[]": `v.array(v.number())`,
    "string[]": `v.array(v.string())`,
  } as const;
  return typeMap[type];
};

const mergedIndexFields = (tables: BetterAuthDBSchema) =>
  Object.fromEntries(
    Object.entries(tables).map(([key, table]) => {
      const manualIndexes =
        indexFields[key as keyof typeof indexFields]?.map((index) => {
          return typeof index === "string"
            ? (table.fields[index]?.fieldName ?? index)
            : index.map((i) => table.fields[i]?.fieldName ?? i);
        }) || [];
      const specialFieldIndexes = Object.keys(
        specialFields(tables)[key as keyof ReturnType<typeof specialFields>] ||
          {}
      ).filter(
        (index) =>
          !manualIndexes.some((m) =>
            Array.isArray(m) ? m[0] === index : m === index
          )
      );
      return [key, manualIndexes.concat(specialFieldIndexes)];
    })
  );

export const createSchema = async ({
  file,
  tables,
}: {
  tables: BetterAuthDBSchema;
  file?: string;
}) => {
  // Hide these node builtins from Convex's esbuild so it doesn't try to
  // resolve them at bundle time. Only runs from the better-auth CLI.
  const path = await import(["p", "a", "t", "h"].join(""));
  const fs = await import(["f", "s"].join(""));
  const cwd = process.cwd();
  const baseName = path.basename(path.resolve(cwd, file ?? ""));
  // if the target directory is named "convex", they're almost definitely
  // generating the schema in the wrong directory, likely would replace the
  // app schema
  if (baseName === "convex") {
    throw new Error(
      "Better Auth schema must be generated in the Better Auth component directory."
    );
  }

  const findProjectRoot = (dir: string): string | null => {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    return findProjectRoot(parent);
  };

  const projectRoot = findProjectRoot(cwd);
  const relativeDir =
    projectRoot !== null
      ? path.relative(projectRoot, cwd).split(path.sep).join("/")
      : null;
  const generateCommand = `npx auth generate${file ? ` --output ${file}` : ""}`;
  const cdTarget = resolveCdTarget(relativeDir, path.basename(cwd));
  const commandBlock = cdTarget
    ? ` *   cd ${cdTarget}\n *   ${generateCommand}`
    : ` *   ${generateCommand}`;

  let code: string = `/**
 * This file is auto-generated. Do not edit this file manually.
 * To regenerate the schema, from your project root:
 *
${commandBlock}
 *
 * To customize the schema, generate to an alternate file and import
 * the table definitions to your schema file. See
 * https://labs.convex.dev/better-auth/features/local-install#adding-custom-indexes.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const tables = {
`;

  for (const tableKey in tables) {
    const table = tables[tableKey]!;
    const modelName = table.modelName;

    // No id fields in Convex schema
    const fields = Object.fromEntries(
      Object.entries(table.fields).filter(([key]) => key !== "id")
    );

    const indexes =
      mergedIndexFields(tables)[
        tableKey as keyof typeof mergedIndexFields
      ]?.map((index) => {
        const indexArray = Array.isArray(index) ? index.sort() : [index];
        const indexName = indexArray.join("_");
        return `.index("${indexName}", ${JSON.stringify(indexArray)})`;
      }) || [];

    const schema = `${modelName}: defineTable({
${Object.keys(fields)
  .map((field) => {
    const attr = fields[field]!;
    const type = getFieldValidator(attr as DBFieldAttribute, tables);
    const optional = (fieldSchema: string) =>
      attr.required
        ? fieldSchema
        : `v.optional(v.union(v.null(), ${fieldSchema}))`;
    return `    ${attr.fieldName ?? field}: ${optional(type)},`;
  })
  .join("\n")}
  })${indexes.length > 0 ? `\n    ${indexes.join("\n    ")}` : ""},\n`;
    code += `  ${schema}`;
  }

  code += `};

const schema = defineSchema(tables);

export default schema;
`;

  return {
    code,
    path: file ?? "./schema.ts",
    overwrite: true,
  };
};
