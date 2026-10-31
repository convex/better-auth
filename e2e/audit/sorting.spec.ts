import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

const client = new ConvexHttpClient("http://127.0.0.1:3210");
type Page = FunctionReturnType<typeof api.sorting.findMany>;

async function read(
  input: Omit<
    FunctionArgs<typeof api.sorting.findMany>,
    "model" | "paginationOpts"
  >
) {
  const docs: Page["page"] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 500; i++) {
    const page: Page = await client.query(api.sorting.findMany, {
      ...input,
      model: "sortItem",
      paginationOpts: { cursor, numItems: 5, maximumBytesRead: 300 },
    });
    docs.push(...page.page);
    if (page.isDone) return docs;
    expect(page.continueCursor).not.toBe(cursor);
    cursor = page.continueCursor;
  }
  throw new Error("Read did not terminate");
}

test("nested scans, prefix ranges and filtered byte-limited cursors match native queries", async () => {
  await client.mutation(api.sorting.seed, {});
  for (const direction of ["asc", "desc"] as const) {
    const native = await client.query(api.sorting.native, {
      index: "nested",
      direction,
    });
    expect(
      await read({ sortBy: { field: "profile.score", direction } })
    ).toEqual(native);
    expect(
      await read({
        where: [{ field: "keep", operator: "ne", value: false }],
        sortBy: { field: "profile.score", direction },
      })
    ).toEqual(native.filter((row) => row.keep));
    const bounded = await client.query(api.sorting.native, {
      index: "group_nested",
      direction,
      group: "b",
      bounded: true,
    });
    expect(
      await read({
        where: [
          { field: "group", value: "b" },
          { field: "profile.score", operator: "gte", value: -1 },
          { field: "profile.score", operator: "lte", value: 0 },
        ],
        sortBy: { field: "profile.score", direction },
      })
    ).toEqual(bounded);
    const first: Page = await client.query(api.sorting.findMany, {
      model: "sortItem",
      sortBy: { field: "profile.score", direction },
      paginationOpts: { cursor: null, numItems: 5, maximumBytesRead: 300 },
    });
    expect(first.splitCursor).toBeTruthy();
    const refreshed: Page = await client.query(api.sorting.findMany, {
      model: "sortItem",
      sortBy: { field: "profile.score", direction },
      paginationOpts: {
        cursor: null,
        numItems: 1,
        endCursor: first.continueCursor,
      },
    });
    expect(refreshed.page).toEqual(first.page);
  }
});

test("nested IN merges preserve ordering and filtered empty-page progress", async () => {
  await client.mutation(api.sorting.seed, {});
  for (const direction of ["asc", "desc"] as const) {
    const native = await client.query(api.sorting.native, {
      index: "nested",
      direction,
    });
    expect(
      await read({
        where: [
          { field: "group", operator: "in", value: ["b", "a", "a"] },
          { field: "keep", operator: "ne", value: false },
        ],
        sortBy: { field: "profile.score", direction },
      })
    ).toEqual(native.filter((row) => row.group !== "c" && row.keep));
  }
});

test("nested range bulk writes preserve excluded rows", async () => {
  await client.mutation(api.sorting.seed, {});
  const original = await client.query(api.sorting.native, {
    index: "nested",
    direction: "asc",
  });
  const expected = original.filter(
    (row) => (row.profile?.score ?? -Infinity) <= 0
  );
  const where = [
    { field: "profile.score", operator: "lte" as const, value: 0 },
  ];
  for (const operation of ["updateMany", "deleteMany"] as const) {
    let cursor: string | null = null;
    const ids: string[] = [];
    let done = false;
    for (let i = 0; i < 100; i++) {
      const args = {
        input: {
          model: "sortItem" as const,
          where,
        },
        paginationOpts: { cursor, numItems: 7, maximumBytesRead: 300 },
      };
      const result: {
        ids: unknown[];
        isDone: boolean;
        continueCursor: string;
      } =
        operation === "updateMany"
          ? await client.mutation(api.sorting.updateMany, {
              ...args,
              input: { ...args.input, update: { keep: false } },
            })
          : await client.mutation(api.sorting.deleteMany, args);
      ids.push(...result.ids.map(String));
      if (result.isDone) {
        done = true;
        break;
      }
      expect(result.continueCursor).not.toBe(cursor);
      cursor = result.continueCursor;
    }
    expect(done).toBe(true);
    expect(ids).toEqual(expected.map((row) => row._id));
    const remaining = await client.query(api.sorting.native, {
      index: "nested",
      direction: "asc",
    });
    if (operation === "updateMany")
      expect(
        remaining
          .filter((row) => expected.some((doc) => doc._id === row._id))
          .every((row) => row.keep === false)
      ).toBe(true);
    else
      expect(remaining).toEqual(
        original.filter((row) => !expected.some((doc) => doc._id === row._id))
      );
  }
});
