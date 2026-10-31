/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import {
  defineSchema,
  defineTable,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { fieldValue } from "./index-stream.js";
import { createApi } from "./create-api.js";

it("nested fields only traverse own object properties", () => {
  for (const profile of [
    "abc",
    [1, 2, 3],
    new ArrayBuffer(3),
    null,
    undefined,
    3,
    3n,
    true,
    {},
  ]) {
    for (const child of ["length", "byteLength", "toString"])
      expect(fieldValue({ profile }, `profile.${child}`)).toBeUndefined();
  }
  expect(fieldValue({ profile: { length: 3 } }, "profile.length")).toBe(3);
  expect(
    fieldValue({ profile: { length: null } }, "profile.length")
  ).toBeNull();
  expect(
    fieldValue({ profile: { contact: { city: "A" } } }, "profile.contact.city")
  ).toBe("A");
  expect(fieldValue({ profile: [1, 2, 3] }, "profile")).toEqual([1, 2, 3]);
});

const schema = defineSchema({
  item: defineTable({
    count: v.number(),
    profile: v.union(
      v.string(),
      v.array(v.number()),
      v.bytes(),
      v.object({ length: v.optional(v.number()) })
    ),
  }),
});
const functions = createApi(schema, () => ({
  plugins: [
    {
      id: "nested-values-test",
      schema: {
        item: {
          fields: {
            count: { type: "number", required: true },
            profile: { type: "json", required: false },
          },
        },
      },
    },
  ],
}));
const modules = {
  ...import.meta.glob("../component/**/*.*s"),
  "../component/nestedValuesTest.ts": async () => functions,
};
for (const operation of [
  "updateOne",
  "updateMany",
  "incrementOne",
  "deleteOne",
  "deleteMany",
] as const) {
  it(`${operation} cannot match string/array/bytes properties in nested guards`, async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const ids = [];
      for (const profile of ["abc", [1, 2, 3], new ArrayBuffer(3)])
        ids.push(await ctx.db.insert("item", { count: 0, profile }));
      return ids;
    });
    const input = {
      model: "item",
      where: [
        { field: "_id", operator: "in", value: ids },
        { field: "profile.length", value: 3 },
      ],
    };
    const before = await t.run((ctx) => ctx.db.query("item").collect());
    await t.mutation(
      makeFunctionReference<"mutation">(`nestedValuesTest:${operation}`),
      {
        input: {
          ...input,
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
    expect(await t.run((ctx) => ctx.db.query("item").collect())).toEqual(
      before
    );
  });
}
