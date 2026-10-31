/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import {
  defineSchema,
  defineTable,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { paginate } from "./adapter-utils.js";
import { createApi } from "./create-api.js";

const schema = defineSchema({
  item: defineTable({
    label: v.string(),
    count: v.number(),
    value: v.optional(v.union(v.number(), v.boolean(), v.string(), v.null())),
  }).index("value", ["value"]),
});
const functions = createApi(schema, () => ({
  plugins: [
    {
      id: "range-guards-test",
      schema: {
        item: {
          fields: {
            label: { type: "string", required: true },
            count: { type: "number", required: true },
            value: { type: "json", required: false },
          },
        },
      },
    },
  ],
}));
const modules = {
  ...import.meta.glob("../component/**/*.*s"),
  "../component/rangeGuardsTest.ts": async () => functions,
};

async function fixture(mixed = false) {
  const t = convexTest(schema, modules);
  const entries = mixed
    ? ([
        ["missing", undefined],
        ["null", null],
        ["negative", -1],
        ["zero", 0],
        ["two", 2],
        ["false", false],
        ["true", true],
        ["string-zero", "0"],
        ["string-two", "2"],
      ] as const)
    : ([
        ["ascii", "z"],
        ["private-use", "\uE000"],
        ["astral", "\u{10000}"],
      ] as const);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (const [label, value] of entries)
      ids.push(
        await ctx.db.insert("item", {
          label,
          count: 0,
          ...(value === undefined ? {} : { value }),
        })
      );
    return ids;
  });
  return { t, ids };
}
const unicode = {
  lt: ["ascii"],
  lte: ["ascii", "private-use"],
  gt: ["astral"],
  gte: ["private-use", "astral"],
};
const mixed = {
  lt: ["missing", "null", "negative"],
  lte: ["missing", "null", "negative", "zero"],
  gt: ["two", "false", "true", "string-zero", "string-two"],
  gte: ["zero", "two", "false", "true", "string-zero", "string-two"],
};
const nullBound = {
  lt: ["missing"],
  lte: ["missing", "null"],
  gt: ["negative", "zero", "two", "false", "true", "string-zero", "string-two"],
  gte: [
    "null",
    "negative",
    "zero",
    "two",
    "false",
    "true",
    "string-zero",
    "string-two",
  ],
};
for (const operator of ["lt", "lte", "gt", "gte"] as const)
  for (const variant of ["unicode", "mixed", "null"] as const) {
    it(`${operator} static guards match native ${variant} ordering`, async () => {
      const { t, ids } = await fixture(variant !== "unicode");
      const bound =
        variant === "unicode" ? "\uE000" : variant === "mixed" ? 0 : null;
      const expected = (
        variant === "unicode"
          ? unicode
          : variant === "mixed"
            ? mixed
            : nullBound
      )[operator];
      const guards = { field: "value", operator, value: bound };
      const found = await t.run((ctx) =>
        paginate(
          ctx,
          schema,
          {},
          {
            model: "item",
            where: [{ field: "_id", operator: "in", value: ids }, guards],
            paginationOpts: { cursor: null, numItems: 30 },
          }
        )
      );
      expect(found.page.map((row) => row.label)).toEqual(expected);
      for (const id of ids) {
        const page = await t.run((ctx) =>
          paginate(
            ctx,
            schema,
            {},
            {
              model: "item",
              where: [{ field: "_id", value: id }, guards],
              paginationOpts: { cursor: null, numItems: 1 },
            }
          )
        );
        expect(page.page.map((row) => row.label)).toEqual(
          expected.includes(
            (await t.run((ctx) => ctx.db.get("item", id)))!.label
          )
            ? [(await t.run((ctx) => ctx.db.get("item", id)))!.label]
            : []
        );
      }
    });
  }
for (const operation of [
  "updateOne",
  "updateMany",
  "incrementOne",
  "deleteOne",
  "deleteMany",
] as const) {
  it(`${operation} never applies a Unicode range guard using JavaScript order`, async () => {
    const { t, ids } = await fixture();
    const before = await t.run((ctx) => ctx.db.query("item").collect());
    const result = await t.mutation(
      makeFunctionReference<"mutation">(`rangeGuardsTest:${operation}`),
      {
        input: {
          model: "item",
          where: [
            { field: "_id", operator: "in", value: [...ids].reverse() },
            { field: "value", operator: "lt", value: "\uE000" },
          ],
          ...(operation === "incrementOne"
            ? { increment: { count: 1 } }
            : operation.startsWith("update")
              ? { update: { count: 1 } }
              : {}),
        },
        ...(operation.endsWith("Many")
          ? { paginationOpts: { cursor: null, numItems: 10 } }
          : {}),
      }
    );
    if (operation.endsWith("Many")) expect(result.count).toBe(1);
    else expect(result.label).toBe("ascii");
    const after = await t.run((ctx) => ctx.db.query("item").collect());
    expect(after.filter((row) => row.label !== "ascii")).toEqual(
      before.filter((row) => row.label !== "ascii")
    );
  });
}
