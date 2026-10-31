/// <reference types="vite/client" />

/**
 * Convex semantics suite.
 *
 * The upstream `@better-auth/test-utils` adapter suite assumes SQL semantics
 * on tiny datasets: its null tests write explicit nulls, no scan exceeds the
 * 200-row page the component reads per query, and no plugin schema with
 * table-level indexes is exercised. This suite pins down the places where
 * Convex differs, asserting the behaviour Better Auth expects of every adapter
 * (its memory adapter and the 1.7 adapter factory are the reference):
 *
 * - An optional field that was never written (Convex omits it) is the same
 *   thing as an explicit null for every operator, on indexed and unindexed
 *   fields alike. Better Auth 1.7's factory skips undefined values on write,
 *   so rows routinely lack optional fields.
 * - Filtered scans that cross the 200-row page must visit every matching row
 *   exactly once, including when the page is split because rejected rows
 *   pushed the row budget past the page size.
 * - `sortBy` orders by the requested field whether or not it is indexed and
 *   whether or not every row has a value (nulls first ascending, last
 *   descending, as in the memory adapter).
 * - Uniqueness declared through table-level `indexes: [{ fields, unique }]`
 *   (Better Auth 1.7 plugins) is enforced and emitted by the schema generator,
 *   and null values never collide.
 * - `incrementOne` / `consumeOne` honour their guards, including `eq null`
 *   guards on fields that were never written.
 *
 * Every test builds a fresh database, seeds it in one transaction and drives
 * the real client adapter through convex-test, so these tests run on any Node
 * version the rest of the convex-test suite runs on.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { getAuthTables } from "better-auth/db";
import type { Where } from "better-auth/types";
import { api, internal } from "../component/_generated/api.js";
import type { ComponentApi } from "../component/_generated/component.js";
import schema from "../component/testProfiles/schema.profile-convex-semantics.js";
import { convexSemanticsProfileOptions } from "../component/testProfiles/auth-options.profile-convex-semantics.js";
import { convexAdapter } from "./adapter.js";
import { createSchema } from "./create-schema.js";

const modules = import.meta.glob("../component/**/*.*s");

type AdapterModule = ComponentApi["adapter"];
const profileApi = {
  adapter: (
    api as unknown as {
      testProfiles: { adapterConvexSemantics: AdapterModule };
    }
  ).testProfiles.adapterConvexSemantics,
};

// The page size `handlePagination` reads per component call, and the row
// budget `paginate` gives each page. A filtered scan that rejects rows inside
// the first page exhausts the budget before the page fills and is split.
const PAGE_SIZE = 200;

const setup = () => {
  const t = convexTest(schema, modules);
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as any;
  const adapter = convexAdapter(ctx, profileApi)(convexSemanticsProfileOptions);
  return { t, adapter };
};
type Harness = ReturnType<typeof setup>;
type Adapter = Harness["adapter"];

type Row = { id: string } & Record<string, any>;
const sortedIds = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
const uniqueIds = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));

// ---------------------------------------------------------------------------
// 1. Omitted vs explicit null, per operator, per field kind, per operation
// ---------------------------------------------------------------------------

type NullField = "plain" | "indexed" | "uniq";
const NULL_FIELDS: { field: NullField; kind: string }[] = [
  { field: "plain", kind: "unindexed" },
  { field: "indexed", kind: "indexed" },
  { field: "uniq", kind: "unique" },
];

const seedNullRows = (t: Harness["t"]) =>
  t.run(async (ctx) => ({
    // Never written: Convex stores no key at all for these fields.
    omitted: String(await ctx.db.insert("nullable", {})),
    // Written as null: Convex stores the key with a null value.
    explicitNull: String(
      await ctx.db.insert("nullable", {
        plain: null,
        indexed: null,
        uniq: null,
      })
    ),
    valued: String(
      await ctx.db.insert("nullable", { plain: "a", indexed: "a", uniq: "a" })
    ),
  }));
type NullRowKey = keyof Awaited<ReturnType<typeof seedNullRows>>;

// Expected matches follow the memory adapter, with one deliberate reading:
// an omitted field and an explicit null are the same value, so `ne null`
// matches neither (the memory adapter's `undefined !== null` is an accident of
// JavaScript, not a semantic Better Auth relies on; every SQL adapter and the
// Mongo adapter treat a missing column as null).
const NULL_CASES: {
  label: string;
  where: (field: NullField) => Where;
  expected: NullRowKey[];
}[] = [
  {
    label: "eq null",
    where: (field) => ({ field, operator: "eq", value: null }),
    expected: ["omitted", "explicitNull"],
  },
  {
    label: "eq value",
    where: (field) => ({ field, operator: "eq", value: "a" }),
    expected: ["valued"],
  },
  {
    label: "ne null",
    where: (field) => ({ field, operator: "ne", value: null }),
    expected: ["valued"],
  },
  {
    label: "ne value",
    where: (field) => ({ field, operator: "ne", value: "a" }),
    expected: ["omitted", "explicitNull"],
  },
  {
    label: "in [value]",
    where: (field) => ({ field, operator: "in", value: ["a", "zzz"] }),
    expected: ["valued"],
  },
  {
    label: "not_in [value]",
    where: (field) => ({ field, operator: "not_in", value: ["a", "zzz"] }),
    expected: ["omitted", "explicitNull"],
  },
];

describe.each(NULL_FIELDS)(
  "omitted vs explicit null on $kind field `$field`",
  ({ field }) => {
    describe.each(NULL_CASES)("$label", ({ where, expected }) => {
      const prepare = async () => {
        const harness = setup();
        const rows = await seedNullRows(harness.t);
        const expectedIds = expected.map((key) => rows[key]).sort();
        const readCounters = () =>
          harness.t.run(async (ctx) =>
            Object.fromEntries(
              (await ctx.db.query("nullable").collect()).map((doc) => [
                String(doc._id),
                doc.counter ?? null,
              ])
            )
          );
        const remainingIds = () =>
          harness.t.run(async (ctx) =>
            (await ctx.db.query("nullable").collect())
              .map((doc) => String(doc._id))
              .sort()
          );
        return {
          ...harness,
          rows,
          expectedIds,
          allIds: Object.values(rows).sort(),
          clause: where(field),
          readCounters,
          remainingIds,
        };
      };

      it("findMany, count and findOne agree", async () => {
        const { adapter, expectedIds, clause } = await prepare();
        const found = await adapter.findMany<Row>({
          model: "nullable",
          where: [clause],
        });
        expect(sortedIds(found)).toEqual(expectedIds);
        expect(
          await adapter.count({ model: "nullable", where: [clause] })
        ).toBe(expectedIds.length);
        const one = await adapter.findOne<Row>({
          model: "nullable",
          where: [clause],
        });
        if (expectedIds.length === 0) {
          expect(one).toBeNull();
        } else {
          expect(expectedIds).toContain(one?.id);
        }
      });

      it("updateMany touches exactly the matching rows", async () => {
        const { adapter, expectedIds, allIds, clause, readCounters } =
          await prepare();
        const count = await adapter.updateMany({
          model: "nullable",
          where: [clause],
          update: { counter: 7 },
        });
        expect(count).toBe(expectedIds.length);
        const counters = await readCounters();
        for (const id of allIds) {
          expect(counters[id]).toBe(expectedIds.includes(id) ? 7 : null);
        }
      });

      it("deleteMany removes exactly the matching rows", async () => {
        const { adapter, expectedIds, allIds, clause, remainingIds } =
          await prepare();
        const count = await adapter.deleteMany({
          model: "nullable",
          where: [clause],
        });
        expect(count).toBe(expectedIds.length);
        expect(await remainingIds()).toEqual(
          allIds.filter((id) => !expectedIds.includes(id))
        );
      });

      it("incrementOne applies to one matching row, or none", async () => {
        const { adapter, expectedIds, allIds, clause, readCounters } =
          await prepare();
        const result = await adapter.incrementOne<Row>({
          model: "nullable",
          where: [clause],
          increment: { counter: 1 },
        });
        const counters = await readCounters();
        if (expectedIds.length === 0) {
          expect(result).toBeNull();
          for (const id of allIds) {
            expect(counters[id]).toBeNull();
          }
          return;
        }
        expect(expectedIds).toContain(result?.id);
        expect(result?.counter).toBe(1);
        for (const id of allIds) {
          expect(counters[id]).toBe(id === result?.id ? 1 : null);
        }
      });

      it("consumeOne consumes one matching row, or none", async () => {
        const { adapter, expectedIds, allIds, clause, remainingIds } =
          await prepare();
        const result = await adapter.consumeOne<Row>({
          model: "nullable",
          where: [clause],
        });
        if (expectedIds.length === 0) {
          expect(result).toBeNull();
          expect(await remainingIds()).toEqual(allIds);
          return;
        }
        expect(expectedIds).toContain(result?.id);
        expect(await remainingIds()).toEqual(
          allIds.filter((id) => id !== result?.id)
        );
      });
    });
  }
);

describe("null handling on unique fields", () => {
  it("eq null tolerates several rows with a null unique value", async () => {
    const { t, adapter } = setup();
    const ids = await t.run(async (ctx) => [
      String(await ctx.db.insert("nullable", { uniq: null })),
      String(await ctx.db.insert("nullable", { uniq: null })),
      String(await ctx.db.insert("nullable", {})),
    ]);
    const where: Where[] = [{ field: "uniq", operator: "eq", value: null }];
    const found = await adapter.findMany<Row>({ model: "nullable", where });
    expect(sortedIds(found)).toEqual(ids.sort());
    expect(await adapter.count({ model: "nullable", where })).toBe(3);
    const one = await adapter.findOne<Row>({ model: "nullable", where });
    expect(ids).toContain(one?.id);
  });

  it("null values never collide on a unique field", async () => {
    const { adapter } = setup();
    const first = await adapter.create<Row>({
      model: "nullable",
      data: { uniq: null },
    });
    const second = await adapter.create<Row>({
      model: "nullable",
      data: { uniq: null },
    });
    const third = await adapter.create<Row>({
      model: "nullable",
      data: { uniq: "taken" },
    });
    await expect(
      adapter.update({
        model: "nullable",
        where: [{ field: "id", value: third.id }],
        update: { uniq: null },
      })
    ).resolves.toMatchObject({ id: third.id, uniq: null });
    const found = await adapter.findMany<Row>({
      model: "nullable",
      where: [{ field: "uniq", operator: "eq", value: null }],
    });
    expect(sortedIds(found)).toEqual([first.id, second.id, third.id].sort());
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. Filtered scans past a page, with rejected rows interleaved
// ---------------------------------------------------------------------------

// 209 rows, 4 of which are rejected by the filter. The rejected rows sit inside
// the first page, so the row budget runs out at 200 rows read with only 196
// accepted, and the page is split; the split lands in the middle of a run of
// matching rows (rows 61..149).
const SCAN_TOTAL = PAGE_SIZE + 9;
const REJECTED_INSIDE_FIRST_PAGE = [10, 60, 150, 190];
const REJECTED_AFTER_FIRST_PAGE = [201, 202, 203, 204];
const MATCHING = SCAN_TOTAL - REJECTED_INSIDE_FIRST_PAGE.length;

const seedUsers = (
  t: Harness["t"],
  rejectedPositions: number[] = REJECTED_INSIDE_FIRST_PAGE
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const matching: string[] = [];
    const other: string[] = [];
    for (let i = 0; i < SCAN_TOTAL; i++) {
      const isMatch = !rejectedPositions.includes(i);
      const id = String(
        await ctx.db.insert("user", {
          name: `user-${i}`,
          email: isMatch
            ? `fixture-${i}@example.test`
            : `other-${i}@example.test`,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
      );
      (isMatch ? matching : other).push(id);
    }
    return { matching: matching.sort(), other: other.sort() };
  });
const fixtureWhere: Where[] = [
  { field: "email", operator: "starts_with", value: "fixture-" },
];

const readUsers = (t: Harness["t"]) =>
  t.run(async (ctx) =>
    (await ctx.db.query("user").collect()).map((doc) => ({
      ...doc,
      id: String(doc._id),
    }))
  );

describe("filtered scans past a page (unindexed path)", () => {
  it("count visits every matching row once when the page is split", async () => {
    const { t, adapter } = setup();
    await seedUsers(t);
    expect(await adapter.count({ model: "user", where: fixtureWhere })).toBe(
      MATCHING
    );
  });

  it("findMany returns every matching row exactly once", async () => {
    const { t, adapter } = setup();
    const { matching } = await seedUsers(t);
    const found = await adapter.findMany<Row>({
      model: "user",
      where: fixtureWhere,
      limit: 1000,
    });
    expect(found).toHaveLength(MATCHING);
    expect(sortedIds(found)).toEqual(matching);
  });

  it("findMany with a limit past the split returns that many distinct rows", async () => {
    const { t, adapter } = setup();
    const { matching } = await seedUsers(t);
    // Exactly one page: the split happens inside it.
    const page = await adapter.findMany<Row>({
      model: "user",
      where: fixtureWhere,
      limit: PAGE_SIZE,
    });
    expect(page).toHaveLength(PAGE_SIZE);
    expect(uniqueIds(page).size).toBe(PAGE_SIZE);
    // More than one page, limit above the number of matches.
    const all = await adapter.findMany<Row>({
      model: "user",
      where: fixtureWhere,
      limit: PAGE_SIZE + 50,
    });
    expect(sortedIds(all)).toEqual(matching);
    // Less than a page: no split, acts as the control.
    const some = await adapter.findMany<Row>({
      model: "user",
      where: fixtureWhere,
      limit: 150,
    });
    expect(some).toHaveLength(150);
    expect(uniqueIds(some).size).toBe(150);
  });

  it("updateMany counts and updates every matching row once", async () => {
    const { t, adapter } = setup();
    const { matching, other } = await seedUsers(t);
    const count = await adapter.updateMany({
      model: "user",
      where: fixtureWhere,
      update: { name: "updated" },
    });
    expect(count).toBe(MATCHING);
    const users = await readUsers(t);
    expect(sortedIds(users.filter((user) => user.name === "updated"))).toEqual(
      matching
    );
    expect(sortedIds(users.filter((user) => user.name !== "updated"))).toEqual(
      other
    );
  });

  it("updateMany fires onUpdate exactly once per matching row", async () => {
    // The adapter runs inside a single mutation here so the component can
    // resolve the trigger handle; the paginated reads and writes are the same
    // as from an action. The marker trigger appends one "x" per firing.
    const t = convexTest(schema, modules);
    const { matching, other } = await seedUsers(t);
    const count = await t.run(async (ctx) => {
      const adapter = convexAdapter(ctx as any, profileApi, {
        authFunctions: {
          onUpdate: internal.testTriggerHandlers.userOnUpdateMarker,
        },
        triggers: { user: { onUpdate: async () => {} } },
      })(convexSemanticsProfileOptions);
      return adapter.updateMany({
        model: "user",
        where: fixtureWhere,
        update: { name: "updated" },
      });
    });
    expect(count).toBe(MATCHING);
    const users = await readUsers(t);
    expect(sortedIds(users.filter((user) => user.image === "x"))).toEqual(
      matching
    );
    expect(sortedIds(users.filter((user) => user.image === undefined))).toEqual(
      other
    );
  });

  it("deleteMany deletes every matching row and nothing else", async () => {
    const { t, adapter } = setup();
    const { other } = await seedUsers(t);
    const count = await adapter.deleteMany({
      model: "user",
      where: fixtureWhere,
    });
    expect(count).toBe(MATCHING);
    expect(sortedIds(await readUsers(t))).toEqual(other);
  });

  it("control: rejected rows after the first page need no split", async () => {
    const { t, adapter } = setup();
    const { matching } = await seedUsers(t, REJECTED_AFTER_FIRST_PAGE);
    expect(await adapter.count({ model: "user", where: fixtureWhere })).toBe(
      MATCHING
    );
    const found = await adapter.findMany<Row>({
      model: "user",
      where: fixtureWhere,
      limit: 1000,
    });
    expect(sortedIds(found)).toEqual(matching);
  });

  it("offset is rejected loudly rather than silently ignored", async () => {
    const { t, adapter } = setup();
    await seedUsers(t);
    await expect(
      adapter.findMany({ model: "user", where: fixtureWhere, offset: 5 })
    ).rejects.toThrow(/offset/);
  });
});

describe("filtered scans past a page (indexed path with a static filter)", () => {
  // `userId eq` is served by the `userId` index; `userAgent ne` is applied as
  // a static filter on top of the index range, rejecting rows inside the page.
  const seedSessions = (t: Harness["t"]) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const matching: string[] = [];
      const other: string[] = [];
      for (let i = 0; i < SCAN_TOTAL; i++) {
        const isMatch = !REJECTED_INSIDE_FIRST_PAGE.includes(i);
        const id = String(
          await ctx.db.insert("session", {
            token: `token-${i}`,
            userId: "scan-user",
            userAgent: isMatch ? "browser" : "bot",
            expiresAt: now + 60_000,
            createdAt: now,
            updatedAt: now,
          })
        );
        (isMatch ? matching : other).push(id);
      }
      // Rows for another user share the index but are outside the range.
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("session", {
          token: `other-token-${i}`,
          userId: "another-user",
          expiresAt: now + 60_000,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { matching: matching.sort(), other: other.sort() };
    });
  const where: Where[] = [
    { field: "userId", operator: "eq", value: "scan-user" },
    { field: "userAgent", operator: "ne", value: "bot" },
  ];

  it("count visits every matching row once", async () => {
    const { t, adapter } = setup();
    await seedSessions(t);
    expect(await adapter.count({ model: "session", where })).toBe(MATCHING);
  });

  it("findMany returns every matching row exactly once", async () => {
    const { t, adapter } = setup();
    const { matching } = await seedSessions(t);
    const found = await adapter.findMany<Row>({
      model: "session",
      where,
      limit: 1000,
    });
    expect(sortedIds(found)).toEqual(matching);
  });

  it("updateMany and deleteMany count every matching row once", async () => {
    const { t, adapter } = setup();
    const { other } = await seedSessions(t);
    expect(
      await adapter.updateMany({
        model: "session",
        where,
        update: { ipAddress: "10.0.0.1" },
      })
    ).toBe(MATCHING);
    expect(await adapter.deleteMany({ model: "session", where })).toBe(
      MATCHING
    );
    const remaining = await t.run((ctx) =>
      ctx.db
        .query("session")
        .withIndex("userId", (q) => q.eq("userId", "scan-user"))
        .collect()
    );
    expect(remaining.map((doc) => String(doc._id)).sort()).toEqual(other);
  });
});

// ---------------------------------------------------------------------------
// 4. sortBy on a field some rows lack
// ---------------------------------------------------------------------------

describe("sortBy on a field some rows lack", () => {
  // Insertion order deliberately disagrees with every sort order, and the
  // nulls are split between an omitted field and an explicit null.
  const SORT_VALUES: (string | null | undefined)[] = [
    "b",
    undefined,
    "a",
    null,
    "c",
  ];
  const seedSortRows = (t: Harness["t"]) =>
    t.run(async (ctx) => {
      const ids: string[] = [];
      for (const value of SORT_VALUES) {
        ids.push(
          String(
            await ctx.db.insert(
              "nullable",
              value === undefined ? {} : { plain: value, indexed: value }
            )
          )
        );
      }
      return ids;
    });
  const values = (rows: Row[], field: string) =>
    rows.map((row) => row[field] ?? null);
  const ASC = [null, null, "a", "b", "c"];
  const DESC = ["c", "b", "a", null, null];

  describe.each([
    { field: "indexed", kind: "indexed" },
    { field: "plain", kind: "unindexed" },
  ])("$kind field `$field`", ({ field }) => {
    it("sorts ascending with nulls first and descending with nulls last", async () => {
      const { t, adapter } = setup();
      await seedSortRows(t);
      const asc = await adapter.findMany<Row>({
        model: "nullable",
        sortBy: { field, direction: "asc" },
      });
      expect(values(asc, field)).toEqual(ASC);
      const desc = await adapter.findMany<Row>({
        model: "nullable",
        sortBy: { field, direction: "desc" },
      });
      expect(values(desc, field)).toEqual(DESC);
    });

    it("applies the limit after sorting", async () => {
      const { t, adapter } = setup();
      await seedSortRows(t);
      const asc = await adapter.findMany<Row>({
        model: "nullable",
        sortBy: { field, direction: "asc" },
        limit: 2,
      });
      expect(values(asc, field)).toEqual([null, null]);
      const desc = await adapter.findMany<Row>({
        model: "nullable",
        sortBy: { field, direction: "desc" },
        limit: 2,
      });
      expect(values(desc, field)).toEqual(["c", "b"]);
    });

    it("sorts an `id in` lookup", async () => {
      const { t, adapter } = setup();
      const ids = await seedSortRows(t);
      const where: Where[] = [{ field: "id", operator: "in", value: ids }];
      const asc = await adapter.findMany<Row>({
        model: "nullable",
        where,
        sortBy: { field, direction: "asc" },
      });
      expect(values(asc, field)).toEqual(ASC);
      const desc = await adapter.findMany<Row>({
        model: "nullable",
        where,
        sortBy: { field, direction: "desc" },
      });
      expect(values(desc, field)).toEqual(DESC);
    });

    it("sorts an OR union", async () => {
      const { t, adapter } = setup();
      await seedSortRows(t);
      // Both branches together cover every row; the union must still sort.
      const where: Where[] = [
        { field: "indexed", operator: "eq", value: "a", connector: "OR" },
        { field: "plain", operator: "ne", value: "a", connector: "OR" },
      ];
      const asc = await adapter.findMany<Row>({
        model: "nullable",
        where,
        sortBy: { field, direction: "asc" },
      });
      expect(values(asc, field)).toEqual(ASC);
      const desc = await adapter.findMany<Row>({
        model: "nullable",
        where,
        sortBy: { field, direction: "desc" },
      });
      expect(values(desc, field)).toEqual(DESC);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Uniqueness from table-level `indexes`
// ---------------------------------------------------------------------------

describe("table-level unique indexes", () => {
  it("schema generator emits an index for every table-level plugin index", async () => {
    const { code } = await createSchema({
      tables: getAuthTables(convexSemanticsProfileOptions),
    });
    const indexOn = (fields: string[]) =>
      new RegExp(
        `\\.index\\("[^"]+", \\[${fields.map((f) => `"${f}"`).join(",\\s*")}\\]\\)`
      );
    // Real plugin: `deviceAuthorization()` declares both as unique indexes.
    expect(code).toMatch(indexOn(["deviceCode"]));
    expect(code).toMatch(indexOn(["userCode"]));
    // Compound unique index (`@better-auth/oauth-provider` pattern).
    expect(code).toMatch(indexOn(["clientId", "resourceId"]));
    // Non-unique table-level index.
    expect(code).toMatch(indexOn(["indexed"]));
    // Field-level `unique` keeps working alongside.
    expect(code).toMatch(indexOn(["uniq"]));
  });

  const clientResource = (clientId: string, resourceId: string) => ({
    model: "clientResource",
    data: { clientId, resourceId },
  });

  it("create rejects a duplicate pair and allows new pairs", async () => {
    const { adapter } = setup();
    await adapter.create(clientResource("client-1", "resource-1"));
    await expect(
      adapter.create(clientResource("client-1", "resource-1"))
    ).rejects.toThrow();
    // Each field alone may repeat; only the pair is unique.
    await expect(
      adapter.create(clientResource("client-1", "resource-2"))
    ).resolves.toMatchObject({
      clientId: "client-1",
      resourceId: "resource-2",
    });
    await expect(
      adapter.create(clientResource("client-2", "resource-1"))
    ).resolves.toMatchObject({
      clientId: "client-2",
      resourceId: "resource-1",
    });
    expect(await adapter.count({ model: "clientResource" })).toBe(3);
  });

  it("update rejects moving a row onto an existing pair", async () => {
    const { adapter } = setup();
    await adapter.create(clientResource("client-1", "resource-1"));
    const movable = await adapter.create<Row>(
      clientResource("client-2", "resource-1")
    );
    await expect(
      adapter.update({
        model: "clientResource",
        where: [{ field: "id", value: movable.id }],
        update: { clientId: "client-1" },
      })
    ).rejects.toThrow();
    // Updating a row to its own values is not a collision.
    await expect(
      adapter.update({
        model: "clientResource",
        where: [{ field: "id", value: movable.id }],
        update: { clientId: "client-2", label: "same pair" },
      })
    ).resolves.toMatchObject({ id: movable.id, label: "same pair" });
    // Moving to a free pair is allowed.
    await expect(
      adapter.update({
        model: "clientResource",
        where: [{ field: "id", value: movable.id }],
        update: { resourceId: "resource-2" },
      })
    ).resolves.toMatchObject({
      clientId: "client-2",
      resourceId: "resource-2",
    });
  });

  it("incrementOne with `set` rejects moving a row onto an existing pair", async () => {
    const { adapter } = setup();
    await adapter.create(clientResource("client-1", "resource-1"));
    const movable = await adapter.create<Row>(
      clientResource("client-2", "resource-1")
    );
    await expect(
      adapter.incrementOne({
        model: "clientResource",
        where: [{ field: "id", value: movable.id }],
        increment: {},
        set: { clientId: "client-1" },
      })
    ).rejects.toThrow();
    const rows = await adapter.findMany<Row>({
      model: "clientResource",
      limit: 10,
    });
    expect(
      rows.map((row) => `${row.clientId}/${row.resourceId}`).sort()
    ).toEqual(["client-1/resource-1", "client-2/resource-1"]);
  });

  // 230 rows with distinct clientIds and the same resourceId span two pages.
  const seedClientResources = (t: Harness["t"], extra: [string, string][]) =>
    t.run(async (ctx) => {
      for (let i = 0; i < PAGE_SIZE + 30; i++) {
        await ctx.db.insert("clientResource", {
          clientId: `client-${i}`,
          resourceId: "resource-1",
        });
      }
      for (const [clientId, resourceId] of extra) {
        await ctx.db.insert("clientResource", { clientId, resourceId });
      }
    });
  const readPairs = (t: Harness["t"]) =>
    t.run(async (ctx) =>
      (await ctx.db.query("clientResource").collect()).map(
        (doc) => `${doc.clientId}/${doc.resourceId}`
      )
    );

  it("updateMany spanning pages never produces a duplicate pair", async () => {
    const { t, adapter } = setup();
    // The collision is on the second page: client-215 already has resource-2.
    await seedClientResources(t, [["client-215", "resource-2"]]);
    await expect(
      adapter.updateMany({
        model: "clientResource",
        where: [{ field: "resourceId", operator: "eq", value: "resource-1" }],
        update: { resourceId: "resource-2" },
      })
    ).rejects.toThrow();
    const pairs = await readPairs(t);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("updateMany spanning pages succeeds when every pair stays unique", async () => {
    const { t, adapter } = setup();
    await seedClientResources(t, []);
    await expect(
      adapter.updateMany({
        model: "clientResource",
        where: [{ field: "resourceId", operator: "eq", value: "resource-1" }],
        update: { resourceId: "resource-2" },
      })
    ).resolves.toBe(PAGE_SIZE + 30);
    const pairs = await readPairs(t);
    expect(pairs).toHaveLength(PAGE_SIZE + 30);
    expect(pairs.every((pair) => pair.endsWith("/resource-2"))).toBe(true);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  describe("deviceAuthorization() plugin table", () => {
    const deviceCode = (deviceCode: string, userCode: string) => ({
      model: "deviceCode",
      data: {
        deviceCode,
        userCode,
        status: "pending",
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    it("rejects duplicate deviceCode and userCode values", async () => {
      const { adapter } = setup();
      await adapter.create(deviceCode("device-1", "USER-1"));
      await expect(
        adapter.create(deviceCode("device-1", "USER-2"))
      ).rejects.toThrow();
      await expect(
        adapter.create(deviceCode("device-2", "USER-1"))
      ).rejects.toThrow();
      await expect(
        adapter.create(deviceCode("device-2", "USER-2"))
      ).resolves.toMatchObject({ deviceCode: "device-2", userCode: "USER-2" });
      await expect(
        adapter.update({
          model: "deviceCode",
          where: [{ field: "deviceCode", value: "device-2" }],
          update: { userCode: "USER-1" },
        })
      ).rejects.toThrow();
      expect(await adapter.count({ model: "deviceCode" })).toBe(2);
    });

    it("looks up and consumes rows by the table-level unique fields", async () => {
      const { adapter } = setup();
      const created = await adapter.create<Row>(
        deviceCode("device-1", "USER-1")
      );
      await adapter.create(deviceCode("device-2", "USER-2"));
      await expect(
        adapter.findOne<Row>({
          model: "deviceCode",
          where: [{ field: "userCode", value: "USER-1" }],
        })
      ).resolves.toMatchObject({ id: created.id });
      // Approval claims a code that nobody has approved yet (`userId eq null`
      // on a never-written field) and fails the second time.
      await expect(
        adapter.incrementOne<Row>({
          model: "deviceCode",
          where: [
            { field: "userCode", value: "USER-1" },
            { field: "userId", operator: "eq", value: null },
          ],
          increment: {},
          set: { userId: "user-a", status: "approved" },
        })
      ).resolves.toMatchObject({ id: created.id, userId: "user-a" });
      await expect(
        adapter.incrementOne<Row>({
          model: "deviceCode",
          where: [
            { field: "userCode", value: "USER-1" },
            { field: "userId", operator: "eq", value: null },
          ],
          increment: {},
          set: { userId: "user-b", status: "approved" },
        })
      ).resolves.toBeNull();
      await expect(
        adapter.consumeOne<Row>({
          model: "deviceCode",
          where: [{ field: "deviceCode", value: "device-1" }],
        })
      ).resolves.toMatchObject({ id: created.id, userId: "user-a" });
      await expect(
        adapter.consumeOne<Row>({
          model: "deviceCode",
          where: [{ field: "deviceCode", value: "device-1" }],
        })
      ).resolves.toBeNull();
      expect(await adapter.count({ model: "deviceCode" })).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. incrementOne and consumeOne
// ---------------------------------------------------------------------------

describe("incrementOne", () => {
  const readCounter = (t: Harness["t"], id: string) =>
    t.run(async (ctx) =>
      (await ctx.db.query("nullable").collect()).find(
        (doc) => String(doc._id) === id
      )
    );

  it("increments a field that was never written, starting from 0", async () => {
    const { t, adapter } = setup();
    const row = await adapter.create<Row>({ model: "nullable", data: {} });
    const first = await adapter.incrementOne<Row>({
      model: "nullable",
      where: [{ field: "id", value: row.id }],
      increment: { counter: 1 },
    });
    expect(first?.counter).toBe(1);
    expect((await readCounter(t, row.id))?.counter).toBe(1);
    const second = await adapter.incrementOne<Row>({
      model: "nullable",
      where: [{ field: "id", value: row.id }],
      increment: { counter: 2 },
    });
    expect(second?.counter).toBe(3);
    expect((await readCounter(t, row.id))?.counter).toBe(3);
  });

  it("applies `set` with an empty `increment`", async () => {
    const { t, adapter } = setup();
    const row = await adapter.create<Row>({ model: "nullable", data: {} });
    const result = await adapter.incrementOne<Row>({
      model: "nullable",
      where: [{ field: "id", value: row.id }],
      increment: {},
      set: { plain: "set-only" },
    });
    expect(result).toMatchObject({ id: row.id, plain: "set-only" });
    expect(result?.counter ?? null).toBeNull();
    const stored = await readCounter(t, row.id);
    expect(stored?.plain).toBe("set-only");
    expect(stored?.counter ?? null).toBeNull();
  });

  it("applies `increment` and `set` together", async () => {
    const { adapter } = setup();
    const row = await adapter.create<Row>({
      model: "nullable",
      data: { counter: 5 },
    });
    const result = await adapter.incrementOne<Row>({
      model: "nullable",
      where: [{ field: "id", value: row.id }],
      increment: { counter: -2 },
      set: { plain: "both" },
    });
    expect(result).toMatchObject({ id: row.id, counter: 3, plain: "both" });
  });

  describe.each([
    { field: "plain", kind: "unindexed" },
    { field: "indexed", kind: "indexed" },
  ])("`eq null` guard on $kind field `$field`", ({ field }) => {
    it("claims a never-written row once", async () => {
      const { t, adapter } = setup();
      const row = await adapter.create<Row>({ model: "nullable", data: {} });
      const claim = () =>
        adapter.incrementOne<Row>({
          model: "nullable",
          where: [
            { field: "id", value: row.id },
            { field, operator: "eq", value: null },
          ],
          increment: { counter: 1 },
          set: { [field]: "claimed" },
        });
      await expect(claim()).resolves.toMatchObject({
        id: row.id,
        counter: 1,
        [field]: "claimed",
      });
      await expect(claim()).resolves.toBeNull();
      expect((await readCounter(t, row.id))?.counter).toBe(1);
    });

    it("claims a never-written row by the guard alone", async () => {
      const { adapter } = setup();
      const row = await adapter.create<Row>({ model: "nullable", data: {} });
      await expect(
        adapter.incrementOne<Row>({
          model: "nullable",
          where: [{ field, operator: "eq", value: null }],
          increment: { counter: 1 },
          set: { [field]: "claimed" },
        })
      ).resolves.toMatchObject({ id: row.id, counter: 1 });
      await expect(
        adapter.incrementOne<Row>({
          model: "nullable",
          where: [{ field, operator: "eq", value: null }],
          increment: { counter: 1 },
        })
      ).resolves.toBeNull();
    });

    it("does not claim a row whose field is set", async () => {
      const { adapter } = setup();
      const row = await adapter.create<Row>({
        model: "nullable",
        data: { [field]: "taken" },
      });
      await expect(
        adapter.incrementOne<Row>({
          model: "nullable",
          where: [
            { field: "id", value: row.id },
            { field, operator: "eq", value: null },
          ],
          increment: { counter: 1 },
        })
      ).resolves.toBeNull();
    });
  });

  it("supports the rate limiter's guarded window update", async () => {
    const { adapter } = setup();
    const start = Date.now() - 1_000;
    await adapter.create({
      model: "rateLimit",
      data: { key: "ip:1", count: 1, lastRequest: start },
    });
    const inWindow = () =>
      adapter.incrementOne<Row>({
        model: "rateLimit",
        where: [
          { field: "key", value: "ip:1" },
          { field: "lastRequest", operator: "gt", value: start - 60_000 },
          { field: "count", operator: "lt", value: 3 },
        ],
        increment: { count: 1 },
      });
    await expect(inWindow()).resolves.toMatchObject({ count: 2 });
    await expect(inWindow()).resolves.toMatchObject({ count: 3 });
    // Limit reached: the `count lt 3` guard fails.
    await expect(inWindow()).resolves.toBeNull();
    // New window: reset through `set` with an empty `increment`.
    const now = Date.now();
    await expect(
      adapter.incrementOne<Row>({
        model: "rateLimit",
        where: [
          { field: "key", value: "ip:1" },
          { field: "lastRequest", operator: "lte", value: start },
        ],
        increment: {},
        set: { count: 1, lastRequest: now },
      })
    ).resolves.toMatchObject({ count: 1, lastRequest: now });
  });
});

describe("consumeOne", () => {
  const remaining = (t: Harness["t"]) =>
    t.run(async (ctx) =>
      (await ctx.db.query("nullable").collect())
        .map((doc) => String(doc._id))
        .sort()
    );

  it("returns null and deletes nothing with 0 matches", async () => {
    const { t, adapter } = setup();
    const ids = await t.run(async (ctx) => [
      String(await ctx.db.insert("nullable", { indexed: "solo" })),
    ]);
    await expect(
      adapter.consumeOne({
        model: "nullable",
        where: [{ field: "indexed", value: "none" }],
      })
    ).resolves.toBeNull();
    expect(await remaining(t)).toEqual(ids);
  });

  it("returns and deletes the row with 1 match", async () => {
    const { t, adapter } = setup();
    const [solo, keep] = await t.run(async (ctx) => [
      String(await ctx.db.insert("nullable", { indexed: "solo" })),
      String(await ctx.db.insert("nullable", { indexed: "keep" })),
    ]);
    await expect(
      adapter.consumeOne<Row>({
        model: "nullable",
        where: [{ field: "indexed", value: "solo" }],
      })
    ).resolves.toMatchObject({ id: solo, indexed: "solo" });
    expect(await remaining(t)).toEqual([keep]);
    await expect(
      adapter.consumeOne({
        model: "nullable",
        where: [{ field: "indexed", value: "solo" }],
      })
    ).resolves.toBeNull();
  });

  it("consumes exactly one row with 2 matches", async () => {
    const { t, adapter } = setup();
    const dups = await t.run(async (ctx) => [
      String(await ctx.db.insert("nullable", { indexed: "dup" })),
      String(await ctx.db.insert("nullable", { indexed: "dup" })),
    ]);
    const first = await adapter.consumeOne<Row>({
      model: "nullable",
      where: [{ field: "indexed", value: "dup" }],
    });
    expect(dups).toContain(first?.id);
    expect(await remaining(t)).toEqual(dups.filter((id) => id !== first?.id));
    const second = await adapter.consumeOne<Row>({
      model: "nullable",
      where: [{ field: "indexed", value: "dup" }],
    });
    expect(second?.id).toBe(dups.find((id) => id !== first?.id));
    expect(await remaining(t)).toEqual([]);
  });

  it("honours an `eq null` guard on a never-written field", async () => {
    const { t, adapter } = setup();
    const [fresh, used] = await t.run(async (ctx) => [
      String(await ctx.db.insert("nullable", { indexed: "code" })),
      String(
        await ctx.db.insert("nullable", { indexed: "code", plain: "used" })
      ),
    ]);
    await expect(
      adapter.consumeOne<Row>({
        model: "nullable",
        where: [
          { field: "indexed", value: "code" },
          { field: "plain", operator: "eq", value: null },
        ],
      })
    ).resolves.toMatchObject({ id: fresh });
    await expect(
      adapter.consumeOne<Row>({
        model: "nullable",
        where: [
          { field: "indexed", value: "code" },
          { field: "plain", operator: "eq", value: null },
        ],
      })
    ).resolves.toBeNull();
    expect(await remaining(t)).toEqual([used]);
  });
});

// ---------------------------------------------------------------------------
// 7. OR connectors mixing indexed and unindexed fields
// ---------------------------------------------------------------------------

describe("OR connectors mixing indexed and unindexed fields", () => {
  const seedOrRows = (t: Harness["t"]) =>
    t.run(async (ctx) => ({
      both: String(
        await ctx.db.insert("nullable", { indexed: "i", plain: "p" })
      ),
      indexedOnly: String(await ctx.db.insert("nullable", { indexed: "i" })),
      plainOnly: String(await ctx.db.insert("nullable", { plain: "p" })),
      uniqOnly: String(await ctx.db.insert("nullable", { uniq: "u" })),
      neither: String(
        await ctx.db.insert("nullable", { indexed: "other", plain: "q" })
      ),
      empty: String(await ctx.db.insert("nullable", {})),
    }));
  type OrRowKey = keyof Awaited<ReturnType<typeof seedOrRows>>;
  const indexedOrPlain: Where[] = [
    { field: "indexed", operator: "eq", value: "i", connector: "OR" },
    { field: "plain", operator: "eq", value: "p", connector: "OR" },
  ];
  const uniqOrPlain: Where[] = [
    { field: "uniq", operator: "eq", value: "u", connector: "OR" },
    { field: "plain", operator: "eq", value: "p", connector: "OR" },
  ];
  const nullOrPlain: Where[] = [
    { field: "indexed", operator: "eq", value: null, connector: "OR" },
    { field: "plain", operator: "eq", value: "q", connector: "OR" },
  ];
  const expectRows = async (
    adapter: Adapter,
    rows: Record<OrRowKey, string>,
    where: Where[],
    expected: OrRowKey[]
  ) => {
    const expectedIds = expected.map((key) => rows[key]).sort();
    const found = await adapter.findMany<Row>({ model: "nullable", where });
    expect(sortedIds(found)).toEqual(expectedIds);
    expect(await adapter.count({ model: "nullable", where })).toBe(
      expectedIds.length
    );
    const one = await adapter.findOne<Row>({ model: "nullable", where });
    expect(expectedIds).toContain(one?.id);
  };

  it("unions an indexed branch with an unindexed branch without duplicates", async () => {
    const { t, adapter } = setup();
    const rows = await seedOrRows(t);
    await expectRows(adapter, rows, indexedOrPlain, [
      "both",
      "indexedOnly",
      "plainOnly",
    ]);
  });

  it("unions a unique branch with an unindexed branch", async () => {
    const { t, adapter } = setup();
    const rows = await seedOrRows(t);
    await expectRows(adapter, rows, uniqOrPlain, [
      "both",
      "plainOnly",
      "uniqOnly",
    ]);
  });

  it("unions an `eq null` branch on a never-written indexed field", async () => {
    const { t, adapter } = setup();
    const rows = await seedOrRows(t);
    await expectRows(adapter, rows, nullOrPlain, [
      "plainOnly",
      "uniqOnly",
      "neither",
      "empty",
    ]);
  });

  it("updateMany and deleteMany apply once per row of the union", async () => {
    const { t, adapter } = setup();
    const rows = await seedOrRows(t);
    expect(
      await adapter.updateMany({
        model: "nullable",
        where: indexedOrPlain,
        update: { counter: 7 },
      })
    ).toBe(3);
    const counters = await t.run(async (ctx) =>
      Object.fromEntries(
        (await ctx.db.query("nullable").collect()).map((doc) => [
          String(doc._id),
          doc.counter ?? null,
        ])
      )
    );
    for (const [key, id] of Object.entries(rows)) {
      expect(counters[id]).toBe(
        ["both", "indexedOnly", "plainOnly"].includes(key) ? 7 : null
      );
    }
    expect(
      await adapter.deleteMany({ model: "nullable", where: indexedOrPlain })
    ).toBe(3);
    const remaining = await t.run(async (ctx) =>
      (await ctx.db.query("nullable").collect())
        .map((doc) => String(doc._id))
        .sort()
    );
    expect(remaining).toEqual([rows.uniqOnly, rows.neither, rows.empty].sort());
  });

  it("unions past a page with rejected rows in the scan", async () => {
    const { t, adapter } = setup();
    const { matching, other } = await seedUsers(t);
    // `user-10` is one of the rejected rows; the union adds it back.
    const where: Where[] = [
      {
        field: "email",
        operator: "starts_with",
        value: "fixture-",
        connector: "OR",
      },
      { field: "name", operator: "eq", value: "user-10", connector: "OR" },
    ];
    const users = await readUsers(t);
    const user10 = users.find((user) => user.name === "user-10")!.id;
    const expected = [...matching, user10].sort();
    expect(await adapter.count({ model: "user", where })).toBe(MATCHING + 1);
    const found = await adapter.findMany<Row>({
      model: "user",
      where,
      limit: 1000,
    });
    expect(sortedIds(found)).toEqual(expected);
    // Update a field neither branch filters on so the union stays the same.
    expect(
      await adapter.updateMany({
        model: "user",
        where,
        update: { emailVerified: true },
      })
    ).toBe(MATCHING + 1);
    expect(await adapter.deleteMany({ model: "user", where })).toBe(
      MATCHING + 1
    );
    expect(sortedIds(await readUsers(t))).toEqual(
      other.filter((id) => id !== user10)
    );
  });
});
