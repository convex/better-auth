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
import type { adapterArgsValidator } from "./adapter-utils.js";
import type { Infer } from "convex/values";
import { createApi } from "./create-api.js";

const optional = () => v.optional(v.union(v.string(), v.null()));
const schema = defineSchema({
  item: defineTable({
    group: optional(),
    category: v.string(),
    rank: v.number(),
    flag: v.optional(v.boolean()),
  }).index("group_rank", ["group", "rank"]),
});
const functions = createApi(schema, () => ({
  plugins: [
    {
      id: "multiple-in-test",
      schema: {
        item: {
          fields: {
            group: { type: "string", required: false },
            category: { type: "string", required: true },
            rank: { type: "number", required: true },
            flag: { type: "boolean", required: false },
          },
        },
      },
    },
  ],
}));
const modules = {
  ...import.meta.glob("../component/**/*.*s"),
  "../component/multipleInTest.ts": async () => functions,
};
const where = (): NonNullable<Infer<typeof adapterArgsValidator>["where"]> => [
  { field: "group", operator: "in", value: ["b", "a", "a"] },
  { field: "category", operator: "in", value: ["wanted", "wanted"] },
];

async function fixture() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let rank = 0; rank < 205; rank++)
      await ctx.db.insert("item", {
        group: rank % 2 ? "b" : "a",
        category: "wanted",
        rank,
      });
    await ctx.db.insert("item", {
      group: "b",
      category: "excluded",
      rank: 205,
    });
    await ctx.db.insert("item", { group: "c", category: "wanted", rank: 206 });
  });
  return t;
}
it("applies both IN filters before paging indexed results", async () => {
  for (const direction of ["asc", "desc"] as const) {
    const t = await fixture();
    const ranks: unknown[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 500; i++) {
      const page = await t.run((ctx) =>
        paginate(
          ctx,
          schema,
          {},
          {
            model: "item",
            where: where(),
            sortBy: { field: "rank", direction },
            paginationOpts: { cursor, numItems: 17, maximumBytesRead: 200 },
          }
        )
      );
      ranks.push(...page.page.map((doc) => doc.rank));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    const expected = Array.from({ length: 205 }, (_, i) => i);
    expect(ranks).toEqual(direction === "asc" ? expected : expected.reverse());
  }
});
it("bulk writes preserve rows excluded by the second IN filter", async () => {
  const t = await fixture();
  for (const operation of ["updateMany", "deleteMany"] as const) {
    let cursor: string | null = null;
    let count = 0;
    for (let i = 0; i < 100; i++) {
      const page: { count: number; isDone: boolean; continueCursor: string } =
        await t.mutation(
          makeFunctionReference<"mutation">(`multipleInTest:${operation}`),
          {
            input: {
              model: "item",
              where: where(),
              ...(operation === "updateMany" ? { update: { flag: true } } : {}),
            },
            paginationOpts: { cursor, numItems: 40 },
          }
        );
      count += page.count;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(count).toBe(205);
    const docs = await t.run((ctx) => ctx.db.query("item").collect());
    expect(
      docs.filter((doc) => doc.rank >= 205).map((doc) => doc.flag)
    ).toEqual([undefined, undefined]);
    if (operation === "updateMany")
      expect(docs.filter((doc) => doc.flag)).toHaveLength(205);
    else expect(docs.map((doc) => doc.rank)).toEqual([205, 206]);
  }
});
it.each([
  [
    { field: "group", operator: "in" as const, value: ["a", "b"] },
    { field: "category", operator: "in" as const, value: [] },
  ],
  [
    { field: "group", operator: "in" as const, value: [] },
    { field: "category", operator: "in" as const, value: ["wanted"] },
  ],
  [
    { field: "group", operator: "in" as const, value: ["a"] },
    { field: "group", operator: "in" as const, value: ["c"] },
  ],
])(
  "empty or disjoint IN predicates match no rows (%#)",
  async (first, second) => {
    const t = await fixture();
    const page = await t.run((ctx) =>
      paginate(
        ctx,
        schema,
        {},
        {
          model: "item",
          where: [first, second],
          paginationOpts: { cursor: null, numItems: 300 },
        }
      )
    );
    expect(page.page).toEqual([]);
  }
);
