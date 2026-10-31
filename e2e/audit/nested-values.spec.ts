import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

const client = new ConvexHttpClient("http://127.0.0.1:3210");
type Input = Omit<
  FunctionArgs<typeof api.nestedValues.findMany>,
  "model" | "paginationOpts"
>;

async function read(input: Input) {
  const rows: FunctionReturnType<typeof api.nestedValues.findMany>["page"] = [];
  let cursor: string | null = null;
  const cursors = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const page: FunctionReturnType<typeof api.nestedValues.findMany> =
      await client.query(api.nestedValues.findMany, {
        ...input,
        model: "nestedValueItem",
        paginationOpts: { cursor, numItems: 2, maximumBytesRead: 128 },
      });
    rows.push(...page.page);
    if (page.isDone) return rows;
    expect(cursors.has(page.continueCursor)).toBe(false);
    cursors.add(page.continueCursor);
    cursor = page.continueCursor;
  }
  throw Error("Nested-value pagination did not terminate");
}

test("nested numeric predicates agree with native fields for non-object parents", async () => {
  await client.mutation(api.nestedValues.seed, {});
  const all = await client.query(api.nestedValues.native, {
    field: "length",
    direction: "asc",
  });
  for (const field of ["length", "byteLength", "toString"] as const) {
    const value = 3;
    const native = await client.query(api.nestedValues.native, {
      field,
      direction: "asc",
      guard: value,
    });
    for (const byIds of [false, true])
      expect(
        (
          await read({
            where: [
              ...(byIds
                ? [
                    {
                      field: "_id",
                      operator: "in" as const,
                      value: all.map((row) => row._id),
                    },
                  ]
                : []),
              { field: `profile.${field}`, value },
            ],
            sortBy: { field: `profile.${field}`, direction: "asc" },
          })
        )
          .map((row) => row._id)
          .sort()
      ).toEqual(native.map((row) => row._id).sort());
  }
});

test("all guarded mutations preserve non-object and inherited-property rows", async () => {
  for (const field of ["length", "byteLength", "toString"] as const)
    for (const op of [
      "updateOne",
      "incrementOne",
      "deleteOne",
      "updateMany",
      "deleteMany",
    ] as const) {
      await client.mutation(api.nestedValues.seed, {});
      const before = await client.query(api.nestedValues.native, {
        field,
        direction: "asc",
      });
      const expected = await client.query(api.nestedValues.native, {
        field,
        direction: "asc",
        guard: 3,
      });
      expect(expected.map((row) => row.label)).toEqual(["object3"]);
      const input = {
        model: "nestedValueItem" as const,
        where: [
          {
            field: "_id",
            operator: "in" as const,
            value: before.map((row) => row._id),
          },
          { field: `profile.${field}`, value: 3 },
        ],
      };
      if (op === "updateMany")
        expect(
          (
            await client.mutation(api.nestedValues.updateMany, {
              input: { ...input, update: { count: 1 } },
              paginationOpts: { cursor: null, numItems: 2 },
            })
          ).ids
        ).toEqual(expected.map((row) => row._id));
      else if (op === "deleteMany")
        expect(
          (
            await client.mutation(api.nestedValues.deleteMany, {
              input,
              paginationOpts: { cursor: null, numItems: 2 },
            })
          ).ids
        ).toEqual(expected.map((row) => row._id));
      else if (op === "incrementOne")
        expect(
          (
            await client.mutation(api.nestedValues.incrementOne, {
              input: { ...input, increment: { count: 1 } },
            })
          )?._id
        ).toBe(expected[0]._id);
      else if (op === "updateOne")
        expect(
          (
            await client.mutation(api.nestedValues.updateOne, {
              input: { ...input, update: { count: 1 } },
            })
          )?._id
        ).toBe(expected[0]._id);
      else
        expect(
          (await client.mutation(api.nestedValues.deleteOne, { input }))?._id
        ).toBe(expected[0]._id);
      const after = await client.query(api.nestedValues.native, {
        field,
        direction: "asc",
      });
      expect(after.filter((r) => r.label !== "object3")).toEqual(
        before.filter((r) => r.label !== "object3")
      );
      if (!op.startsWith("delete"))
        expect(after.find((r) => r.label === "object3")?.count).toBe(1);
    }
});

type RangeWhere = NonNullable<
  FunctionArgs<typeof api.nestedValues.findMany>["where"]
>;
const readRange = (where: RangeWhere) =>
  read({ where, sortBy: { field: "rangeValue", direction: "asc" } });

for (const mixed of [false, true])
  test(`ID and indexed range guards match native order (mixed ${mixed})`, async () => {
    await client.mutation(api.nestedValues.seedRanges, { mixed });
    // A range above the largest fixture value provides the full native table.
    const all = await client.query(api.nestedValues.nativeRange, {
      operator: "lt",
      bound: "\u{10FFFF}",
    });
    for (const bound of mixed ? [0, false, "2", null] : ["\uE000", "\u{10000}"])
      for (const operator of ["lt", "lte", "gt", "gte"] as const) {
        const native = await client.query(api.nestedValues.nativeRange, {
          operator,
          bound,
        });
        const guard = { field: "rangeValue", operator, value: bound };
        expect(await readRange([guard])).toEqual(native);
        expect(
          (
            await readRange([
              {
                field: "_id",
                operator: "in",
                value: all.map((row) => row._id).reverse(),
              },
              guard,
            ])
          )
            .map((row) => row._id)
            .sort()
        ).toEqual(native.map((row) => row._id).sort());
        for (const row of all) {
          const found = await readRange([
            { field: "_id", value: row._id },
            guard,
          ]);
          expect(found).toEqual(
            native.some((doc) => doc._id === row._id) ? [row] : []
          );
        }
      }
  });
for (const mixed of [false, true])
  test(`all guarded writes preserve excluded range rows (mixed ${mixed})`, async () => {
    for (const operation of [
      "updateOne",
      "updateMany",
      "incrementOne",
      "deleteOne",
      "deleteMany",
    ] as const) {
      await client.mutation(api.nestedValues.seedRanges, { mixed });
      const before = await client.query(api.nestedValues.nativeRange, {
        operator: "lt",
        bound: "\u{10FFFF}",
      });
      const operator = mixed ? "gt" : "lt",
        bound = mixed ? false : "\uE000";
      const expected = await client.query(api.nestedValues.nativeRange, {
        operator,
        bound,
      });
      const input: { model: "nestedValueItem"; where: RangeWhere } = {
        model: "nestedValueItem" as const,
        where: [
          {
            field: "_id",
            operator: "in" as const,
            value: before.map((row) => row._id).reverse(),
          },
          { field: "rangeValue", operator, value: bound },
        ],
      };
      let changed: string[] = [];
      if (operation === "updateMany")
        changed = (
          await client.mutation(api.nestedValues.updateMany, {
            input: { ...input, update: { count: 1 } },
            paginationOpts: { cursor: null, numItems: 2 },
          })
        ).ids.map(String);
      else if (operation === "deleteMany")
        changed = (
          await client.mutation(api.nestedValues.deleteMany, {
            input,
            paginationOpts: { cursor: null, numItems: 2 },
          })
        ).ids.map(String);
      else if (operation === "incrementOne") {
        const row = await client.mutation(api.nestedValues.incrementOne, {
          input: { ...input, increment: { count: 1 } },
        });
        changed = row ? [String(row._id)] : [];
      } else if (operation === "updateOne") {
        const row = await client.mutation(api.nestedValues.updateOne, {
          input: { ...input, update: { count: 1 } },
        });
        changed = row ? [String(row._id)] : [];
      } else {
        const row = await client.mutation(api.nestedValues.deleteOne, {
          input,
        });
        changed = row ? [String(row._id)] : [];
      }
      if (operation.endsWith("Many"))
        expect(changed.sort()).toEqual(expected.map((row) => row._id).sort());
      else {
        expect(changed).toHaveLength(1);
        expect(expected.map((row) => row._id)).toContain(changed[0]);
      }
      const after = await client.query(api.nestedValues.nativeRange, {
        operator: "lt",
        bound: "\u{10FFFF}",
      });
      expect(after.filter((row) => !changed.includes(row._id))).toEqual(
        before.filter((row) => !changed.includes(row._id))
      );
      const changedRows = after.filter((row) => changed.includes(row._id));
      if (operation.startsWith("delete")) expect(changedRows).toHaveLength(0);
      else {
        expect(changedRows).toHaveLength(changed.length);
        expect(changedRows.every((row) => row.count === 1)).toBe(true);
      }
    }
  });
