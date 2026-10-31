import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";

const client = new ConvexHttpClient("http://127.0.0.1:3210");
type Page = FunctionReturnType<typeof api.filterAudit.findMany>;
type MutationPage = FunctionReturnType<typeof api.filterAudit.updateMany>;
const clauses = () => [
  { field: "group", operator: "in" as const, value: ["b", "a", "a"] },
  { field: "category", operator: "in" as const, value: ["wanted"] },
];
test("multiple IN filters constrain paginated reads and bulk writes", async () => {
  await client.mutation(api.filterAudit.seed, {});
  const ranks: unknown[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const result: Page = await client.query(api.filterAudit.findMany, {
      model: "filterItem",
      where: clauses(),
      sortBy: { field: "rank", direction: "asc" },
      paginationOpts: { cursor, numItems: 17 },
    });
    ranks.push(...result.page.map((doc) => doc.rank));
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  expect(ranks).toEqual(Array.from({ length: 205 }, (_, i) => i));
  for (const operation of ["updateMany", "deleteMany"] as const) {
    cursor = null;
    let count = 0;
    for (let i = 0; i < 100; i++) {
      const result: MutationPage = await client.mutation(
        makeFunctionReference<"mutation">(`filterAudit:${operation}`),
        {
          input: {
            model: "filterItem",
            where: clauses(),
            ...(operation === "updateMany" ? { update: { flag: true } } : {}),
          },
          paginationOpts: { cursor, numItems: 40 },
        }
      );
      count += result.count;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(count).toBe(205);
    const { items } = await client.query(api.filterAudit.rows, {});
    expect(
      items.filter((doc) => doc.rank >= 205).map((doc) => doc.flag)
    ).toEqual([undefined, undefined]);
    if (operation === "updateMany")
      expect(items.filter((doc) => doc.flag)).toHaveLength(205);
    else expect(items.map((doc) => doc.rank)).toEqual([205, 206]);
  }
});

test("unknown nested paths and dotted update payloads are rejected before writes", async () => {
  await client.mutation(api.filterAudit.seed, {});
  const before = await client.query(api.filterAudit.rows, {});
  for (const operation of [
    "updateOne",
    "incrementOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
  ]) {
    await expect(
      client.mutation(
        makeFunctionReference<"mutation">(`filterAudit:${operation}`),
        {
          input: {
            model: "nestedItem",
            where: [{ field: "profile.typo", value: null }],
            ...(operation.startsWith("update")
              ? { update: { flag: true } }
              : {}),
            ...(operation === "incrementOne"
              ? { increment: { counter: 1 } }
              : {}),
          },
          ...(operation.endsWith("Many")
            ? { paginationOpts: { cursor: null, numItems: 10 } }
            : {}),
        }
      )
    ).rejects.toThrow("validator");
  }
  await expect(
    client.mutation(
      makeFunctionReference<"mutation">("filterAudit:updateOne"),
      {
        input: {
          model: "nestedItem",
          where: [{ field: "rank", value: 0 }],
          update: { "profile.name": "forged" },
        },
      }
    )
  ).rejects.toThrow("validator");
  expect(await client.query(api.filterAudit.rows, {})).toEqual(before);
});
