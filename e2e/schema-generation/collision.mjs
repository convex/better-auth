import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createSchema } from "../../dist/client/create-schema.js";
import { getAuthTables } from "@better-auth/core/db";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "schema-index-regression-")
);
try {
  const component = path.join(scratch, "convex/component");
  fs.mkdirSync(component, { recursive: true });
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(scratch, "node_modules")
  );
  fs.writeFileSync(
    path.join(scratch, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { convex: "1.46.0" },
    })
  );
  fs.writeFileSync(
    path.join(scratch, "convex/tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        lib: ["ESNext", "DOM"],
      },
      include: ["./**/*"],
    })
  );
  fs.writeFileSync(
    path.join(scratch, "convex/convex.config.ts"),
    'import { defineApp } from "convex/server"; import c from "./component/convex.config"; const app = defineApp(); app.use(c); export default app;'
  );
  fs.writeFileSync(
    path.join(component, "convex.config.ts"),
    'import { defineComponent } from "convex/server"; export default defineComponent("collision");'
  );
  fs.writeFileSync(
    path.join(component, "fixtures.ts"),
    `
import { mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import type { GenericDocument, IndexRangeBuilder } from "convex/server";
import { v } from "convex/values";
export const seed = mutation({ args: { model: v.union(v.literal("custom"), v.literal("longCustom")), rows: v.array(v.any()) }, handler: async (ctx, { model, rows }) => { for (const row of rows) await ctx.db.insert(model, row); } });
export const lookup = query({ args: { model: v.union(v.literal("custom"), v.literal("longCustom")), index: v.string(), fields: v.array(v.string()), values: v.array(v.string()) }, handler: (ctx, args) => ctx.db.query(args.model).withIndex(args.index, q => args.fields.length === 1 ? q.eq(args.fields[0], args.values[0]) : (q as IndexRangeBuilder<GenericDocument, [string, string]>).eq(args.fields[0], args.values[0]).eq(args.fields[1], args.values[1])).collect() });
`
  );
  fs.writeFileSync(
    path.join(scratch, "convex/probe.ts"),
    `
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
export const seed = mutation({ args: { model: v.union(v.literal("custom"), v.literal("longCustom")), rows: v.array(v.any()) }, handler: (ctx, args) => ctx.runMutation(components.collision.fixtures.seed, args) });
export const lookup = query({ args: { model: v.union(v.literal("custom"), v.literal("longCustom")), index: v.string(), fields: v.array(v.string()), values: v.array(v.string()) }, handler: (ctx, args) => ctx.runQuery(components.collision.fixtures.lookup, args) });
`
  );
  const fields = Object.fromEntries(
    ["tenant_id", "subject", "tenant", "id_subject"].map((field) => [
      field,
      { type: "string", required: true },
    ])
  );
  fields.tenant_id_subject_2 = { type: "string", required: true, unique: true };
  fields.tenant_id_subject_3 = { type: "string", required: true, unique: true };
  const indexes = [
    {
      name: "by_tenant_id_subject",
      fields: ["tenant_id", "subject"],
      unique: true,
    },
    {
      name: "by_tenant_idsubject",
      fields: ["tenant", "id_subject"],
      unique: true,
    },
  ];
  const generate = (count) =>
    createSchema({
      tables: {
        custom: {
          modelName: "custom",
          fields,
          indexes: indexes.slice(0, count),
        },
      },
    });
  // Upgrade a populated component at the 64-character boundary. Natural
  // truncated _2/_3 names already exist and must retain their definitions.
  const longFields = { ...fields };
  const a = "a".repeat(20),
    b = "b".repeat(20),
    c = "c".repeat(22);
  const natural = `${a}_${b}_${c}`;
  const reserved2 = natural.slice(0, 62) + "_2";
  const reserved3 = natural.slice(0, 62) + "_3";
  const boundedCollision = natural.slice(0, 62) + "_4";
  for (const field of [`${a}_${b}`, c, a, `${b}_${c}`])
    longFields[field] = { type: "string", required: false };
  longFields[reserved2] = { type: "string", required: false, unique: true };
  longFields[reserved3] = { type: "string", required: false, unique: true };
  const longIndexes = [
    { name: "long_collision_first", fields: [`${a}_${b}`, c] },
    { name: "long_collision_second", fields: [a, `${b}_${c}`] },
  ];
  const generateLong = (count) =>
    createSchema({
      tables: {
        custom: {
          modelName: "custom",
          fields: longFields,
          indexes: [...indexes, ...longIndexes.slice(0, count)],
        },
      },
    });
  const generateBoth = (count) =>
    createSchema({
      tables: {
        custom: {
          modelName: "custom",
          fields,
          indexes: indexes.slice(0, count),
        },
        longCustom: {
          modelName: "longCustom",
          fields: longFields,
          indexes: [
            ...indexes.map((index) => ({ ...index, name: `long_${index.name}` })),
            ...longIndexes.slice(0, count),
          ],
        },
      },
    });
  // Better Auth validates explicit index names across the entire schema before
  // invoking the adapter generator. Check the fixture through that same path.
  getAuthTables({
    plugins: [{
      id: "schema-collision-fixture",
      schema: {
        custom: { fields, indexes },
        longCustom: {
          fields: longFields,
          indexes: [
            ...indexes.map((index) => ({ ...index, name: `long_${index.name}` })),
            ...longIndexes,
          ],
        },
      },
    }],
  });
  const deploy = (code) => {
    fs.writeFileSync(path.join(component, "schema.ts"), code);
    const result = spawnSync(
      path.join(root, "node_modules/.bin/convex"),
      [
        "deploy",
        "--url",
        "http://127.0.0.1:3210",
        "--admin-key",
        process.env.CONVEX_ADMIN_KEY,
        "--typecheck",
        "enable",
        "-y",
      ],
      { cwd: scratch, encoding: "utf8", env: process.env }
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  const { code: legacyCode } = await generate(1);
  deploy((await generateBoth(1)).code);
  const client = new ConvexHttpClient("http://127.0.0.1:3210");
  const rows = [
    { tenant_id: "north", subject: "item", tenant: "a", id_subject: "one" },
    { tenant_id: "south", subject: "item", tenant: "a", id_subject: "two" },
    { tenant_id: "north", subject: "other", tenant: "b", id_subject: "one" },
  ].map((row, i) => ({
    ...row,
    tenant_id_subject_2: `row-${i}`,
    tenant_id_subject_3: `row-${i}`,
  }));
  await client.mutation(makeFunctionReference("probe:seed"), {
    model: "custom",
    rows,
  });

  const longRow = {
    ...rows[0],
    tenant_id_subject_2: "long-row-2",
    tenant_id_subject_3: "long-row-3",
    [`${a}_${b}`]: "first",
    [c]: "second",
    [a]: "third",
    [`${b}_${c}`]: "fourth",
    [reserved2]: "reserved-two",
    [reserved3]: "reserved-three",
  };
  await client.mutation(makeFunctionReference("probe:seed"), {
    model: "longCustom",
    rows: [longRow],
  });

  const { code } = await generate(2);
  const names = [...code.matchAll(/\.index\("([^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(names, [
    "tenant_id_subject",
    "tenant_id_subject_4",
    "tenant_id_subject_2",
    "tenant_id_subject_3",
  ]);
  const oldNames = [...legacyCode.matchAll(/\.index\("([^"]+)"/g)].map(
    (match) => match[1]
  );
  assert(oldNames.every((name) => names.includes(name)));
  deploy((await generateBoth(2)).code);
  for (const [index, queryFields, values, expected] of [
    ["tenant_id_subject", ["tenant_id", "subject"], ["north", "item"], 0],
    ["tenant_id_subject_4", ["tenant", "id_subject"], ["a", "two"], 1],
    ["tenant_id_subject_2", ["tenant_id_subject_2"], ["row-2"], 2],
    ["tenant_id_subject_3", ["tenant_id_subject_3"], ["row-2"], 2],
  ]) {
    const found = await client.query(makeFunctionReference("probe:lookup"), {
      model: "custom",
      index,
      fields: queryFields,
      values,
    });
    assert.equal(found.length, 1);
    for (const [key, value] of Object.entries(rows[expected]))
      assert.equal(found[0][key], value);
  }
  console.log(
    "PASS: generated colliding indexes deploy over populated data; both compound indexes return the correct existing rows."
  );
  console.log(
    "PASS: existing names, including natural _2/_3 suffixes, remain queryable; only the new collision uses _4."
  );

  const afterLong = (await generateLong(2)).code;
  const longNames = [...afterLong.matchAll(/\.index\("([^"]+)"/g)].map(
    (m) => m[1]
  );
  assert(longNames.every((name) => name.length <= 64));
  assert(longNames.includes(natural));
  assert(longNames.includes(boundedCollision));
  for (const [index, queryFields, values] of [
    [natural, [`${a}_${b}`, c], ["first", "second"]],
    [boundedCollision, [a, `${b}_${c}`], ["third", "fourth"]],
    [reserved2, [reserved2], ["reserved-two"]],
    [reserved3, [reserved3], ["reserved-three"]],
  ]) {
    const found = await client.query(makeFunctionReference("probe:lookup"), {
      model: "longCustom",
      index,
      fields: queryFields,
      values,
    });
    assert.equal(found.length, 1);
    for (const [field, value] of Object.entries(longRow))
      assert.equal(found[0][field], value);
  }
  console.log(
    "PASS: 64-character collision names deploy over populated data; original and reserved natural names remain queryable."
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
