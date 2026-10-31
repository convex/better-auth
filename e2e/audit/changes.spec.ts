import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { randomUUID } from "node:crypto";
import { api } from "../convex/_generated/api";

const client = new ConvexHttpClient("http://127.0.0.1:3210");
const call = async <T = unknown>(
  operation: string,
  data: unknown,
  trigger = false
): Promise<T> =>
  (await client.action(api.audit.call, { operation, data, trigger })) as T;
const rows = (model: string) => client.query(api.audit.rows, { model });
const ledger = (tenant: string, subject: string, count: number | null = 0) =>
  call<{ id: string }>("create", {
    model: "ledger",
    data: { tenant, subject, count },
  });
const whereId = (id: string) => [{ field: "id", value: id }];

test("ordered compound uniqueness survives concurrent creates and partial updates", async () => {
  const tenant = randomUUID();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => ledger(tenant, "same"))
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const first = await call("findOne", {
    model: "ledger",
    where: [
      { field: "subject", value: "same" },
      { field: "tenant", value: tenant },
    ],
  });
  expect(first).toMatchObject({ tenant, subject: "same" });
  const second = await ledger(tenant, "second");
  await expect(
    call("update", {
      model: "ledger",
      where: whereId(second.id),
      update: { subject: "same" },
    })
  ).rejects.toThrow(/already exists/);
  expect(
    await call("findOne", { model: "ledger", where: whereId(second.id) })
  ).toMatchObject({ subject: "second" });
  await ledger(randomUUID(), "same");
});

test("atomic counter retains concurrent writes and enforces the guard", async () => {
  const row = await ledger(randomUUID(), "counter");
  const data = {
    model: "ledger",
    where: whereId(row.id),
    increment: { count: 1 },
  };
  await Promise.all(
    Array.from({ length: 20 }, () => call("incrementOne", data))
  );
  expect(
    await call("findOne", { model: "ledger", where: whereId(row.id) })
  ).toMatchObject({ count: 20 });
  const guarded = await Promise.all(
    Array.from({ length: 10 }, () =>
      call("incrementOne", {
        ...data,
        where: [...data.where, { field: "count", operator: "lt", value: 23 }],
        set: { memo: "claimed" },
      })
    )
  );
  expect(guarded.filter(Boolean)).toHaveLength(3);
  expect(
    await call("findOne", { model: "ledger", where: whereId(row.id) })
  ).toMatchObject({ count: 23, memo: "claimed" });
  for (const count of [null, undefined]) {
    const legacy = await call<{ id: string }>("create", {
      model: "ledger",
      data: {
        tenant: randomUUID(),
        subject: "nullable",
        ...(count === null ? { count } : {}),
      },
    });
    expect(
      await call("incrementOne", {
        model: "ledger",
        where: whereId(legacy.id),
        increment: { count: -2 },
      })
    ).toMatchObject({ count: -2 });
  }
});

test("atomic consume has one winner and preserves unmatched records", async () => {
  const row = await ledger(randomUUID(), "consume");
  expect(await call("consumeOne", { model: "ledger", where: [] })).toBeNull();
  expect(
    await call("consumeOne", {
      model: "ledger",
      where: [...whereId(row.id), { field: "count", value: 9 }],
    })
  ).toBeNull();
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      call("consumeOne", { model: "ledger", where: whereId(row.id) })
    )
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(
    await call("findOne", { model: "ledger", where: whereId(row.id) })
  ).toBeNull();
});

test("mapped required fields and trigger writes roll back the entire atomic mutation", async () => {
  const tenant = randomUUID();
  await ledger(tenant, "taken");
  const row = await ledger(tenant, "original", 5);
  for (const memo of ["collide", "clear-required", "throw"]) {
    await expect(
      call(
        "incrementOne",
        {
          model: "ledger",
          where: whereId(row.id),
          increment: { count: 1 },
          set: { memo },
        },
        true
      )
    ).rejects.toThrow();
    expect(
      await call("findOne", { model: "ledger", where: whereId(row.id) })
    ).toMatchObject({ subject: "original", count: 5, tenant });
  }
  expect(
    await call("count", {
      model: "ledger",
      where: [{ field: "tenant", value: tenant }],
    })
  ).toBe(2);
});

test("legacy export and paged cleanup preserve unrelated auth records and make terminal cursors idempotent", async () => {
  const beforeUsers = (await rows("user")).length;
  await client.mutation(api.audit.seed, {
    model: "oauthApplication",
    rows: Array.from({ length: 7 }, (_, i) => ({
      clientId: `legacy-${i}`,
      clientSecret: "fixture-secret",
    })),
  });
  let cursor: string | null = null;
  const exported = [];
  while (true) {
    const page: {
      page: Array<{ _id: string; hadClientSecret: boolean }>;
      continueCursor: string;
      isDone: boolean;
    } = await client.query(api.audit.exportClients, {
      cursor,
      numItems: 2,
    });
    exported.push(...page.page);
    cursor = page.continueCursor;
    if (page.isDone) break;
  }
  expect(exported).toHaveLength(7);
  expect(new Set(exported.map((row) => row._id)).size).toBe(7);
  for (const row of exported) {
    expect(row).not.toHaveProperty("clientSecret");
    expect(row.hadClientSecret).toBe(true);
  }
  expect(
    (await client.query(api.audit.exportClients, { cursor, numItems: 2 })).page
  ).toEqual([]);
  await expect(
    client.mutation(api.audit.raw, {
      operation: "clear",
      data: {
        table: "oauthApplication",
        paginationOpts: { cursor, numItems: 2 },
      },
    })
  ).rejects.toThrow(/not valid/);
  cursor = null;
  let deleted = 0;
  while (true) {
    const page: { deleted: number; continueCursor: string; isDone: boolean } =
      await client.mutation(api.audit.raw, {
        operation: "clear",
        data: {
          table: "oauthApplication",
          paginationOpts: { cursor, numItems: 2 },
        },
      });
    deleted += page.deleted;
    cursor = page.continueCursor;
    if (page.isDone) break;
  }
  expect(deleted).toBe(7);
  expect(
    (
      await client.mutation(api.audit.raw, {
        operation: "clear",
        data: {
          table: "oauthApplication",
          paginationOpts: { cursor, numItems: 2 },
        },
      })
    ).deleted
  ).toBe(0);
  expect((await rows("user")).length).toBe(beforeUsers);
});

test("consume trigger failure restores the consumed credential", async () => {
  const row = await call<{ id: string }>("create", {
    model: "ledger",
    data: { tenant: randomUUID(), subject: "rollback", memo: "throw" },
  });
  await expect(
    call("consumeOne", { model: "ledger", where: whereId(row.id) }, true)
  ).rejects.toThrow(/trigger rejected/);
  expect(
    await call("findOne", { model: "ledger", where: whereId(row.id) })
  ).toMatchObject({ id: row.id, subject: "rollback" });
  expect(
    await call("consumeOne", { model: "ledger", where: whereId(row.id) })
  ).toMatchObject({ id: row.id });
});

test("unique bulk updates refuse split pages before writing but accept an explicit atomic ID set", async () => {
  const tenant = randomUUID();
  await client.mutation(api.audit.seed, {
    model: "mapped",
    rows: Array.from({ length: 205 }, (_, i) => ({
      tenantKey: tenant,
      subjectKey: `subject-${i}`,
      count: 0,
    })),
  });
  const data = {
    input: {
      model: "mapped",
      where: [{ field: "tenantKey", value: tenant }],
      update: { tenantKey: `${tenant}-new` },
    },
    paginationOpts: { cursor: null, numItems: 200 },
  };
  await expect(
    client.mutation(api.audit.raw, { operation: "updateMany", data })
  ).rejects.toThrow(/unique fields across multiple pages/);
  const before = await call<Array<{ id: string }>>("findMany", {
    model: "ledger",
    where: [{ field: "tenant", value: tenant }],
    limit: 1000,
  });
  expect(before).toHaveLength(205);
  expect(
    await call("updateMany", {
      model: "ledger",
      where: [
        { field: "id", operator: "in", value: before.map((row) => row.id) },
      ],
      update: { tenant: `${tenant}-new` },
    })
  ).toBe(205);
  expect(
    await call("count", {
      model: "ledger",
      where: [{ field: "tenant", value: tenant }],
    })
  ).toBe(0);
});
