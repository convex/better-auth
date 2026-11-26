/// <reference types="vite/client" />

import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { getAuthTables } from "better-auth/db";
import { defineSchema, defineTable } from "convex/server";
import type { DataModelFromSchemaDefinition } from "convex/server";
import { v } from "convex/values";
import { paginate } from "./adapter-utils.js";

const fields = {
  token: v.string(),
  userId: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
const sessionTable = () =>
  defineTable(fields).index("token_expiresAt", ["token", "expiresAt"]);
const indexedSchema = defineSchema({
  session: sessionTable().index("token", ["token"]),
});
const rangeOnlySchema = defineSchema({ session: sessionTable() });
type Session = DataModelFromSchemaDefinition<
  typeof indexedSchema
>["session"]["document"];
const authSchema = getAuthTables({});
const modules = import.meta.glob("../component/**/*.*s");
const tokens = ["new", "expired", "old", "middle", "old", "absent"];

afterEach(() => vi.useRealTimers());

async function fixture(tokenIndex = true) {
  const schema = tokenIndex ? indexedSchema : rangeOnlySchema;
  const t = convexTest(schema, modules);
  const base = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  const rows = [
    { token: "old", userId: "owner", expiresAt: 400 },
    { token: "expired", userId: "owner", expiresAt: 10 },
    { token: "other-owner", userId: "someone-else", expiresAt: 500 },
    { token: "middle", userId: "owner", expiresAt: 200 },
    { token: "new", userId: "owner", expiresAt: 300 },
    { token: "unselected", userId: "owner", expiresAt: 999 },
  ];
  for (const [index, row] of rows.entries()) {
    vi.setSystemTime(base + index * 1_000);
    await t.run((ctx) =>
      ctx.db.insert("session", {
        ...row,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
  }
  vi.useRealTimers();
  return { schema, t };
}

test.each(["asc", "desc"] as const)(
  "paginates unique session tokens by creation time (%s), retaining expiry filters",
  async (direction) => {
    const { schema, t } = await fixture();
    let cursor: string | null = null;
    const found: string[] = [];
    let done = false;
    for (let page = 0; page < 20 && !done; page += 1) {
      const result = await t.run((ctx) =>
        paginate<Session, "session">(ctx, schema, authSchema, {
          model: "session",
          where: [
            { field: "token", operator: "in", value: tokens },
            { field: "expiresAt", operator: "gt", value: 50 },
          ],
          sortBy: { field: "createdAt", direction },
          paginationOpts: { cursor, numItems: 1 },
        })
      );
      expect(result).not.toHaveProperty("unservedSort");
      expect(result.page.length).toBeLessThanOrEqual(1);
      found.push(...result.page.map((session) => session.token));
      done = result.isDone;
      if (!done) expect(result.continueCursor).not.toBe(cursor);
      cursor = result.continueCursor;
    }
    expect(done).toBe(true);
    expect(found).toEqual(
      direction === "asc" ? ["old", "middle", "new"] : ["new", "middle", "old"]
    );
  }
);

test("keeps additional ownership predicates on unique token branches", async () => {
  const { schema, t } = await fixture();
  const result = await t.run((ctx) =>
    paginate<Session, "session">(ctx, schema, authSchema, {
      model: "session",
      where: [
        { field: "token", operator: "in", value: [...tokens, "other-owner"] },
        { field: "expiresAt", operator: "gt", value: 50 },
        { field: "userId", value: "owner" },
      ],
      sortBy: { field: "createdAt", direction: "asc" },
      paginationOpts: { cursor: null, numItems: 10 },
    })
  );
  expect(result).not.toHaveProperty("unservedSort");
  expect(result.page.map((session) => session.token)).toEqual([
    "old",
    "middle",
    "new",
  ]);
});

test("preserves the unsupported-sort contract for other fields", async () => {
  const { schema, t } = await fixture();
  const result = await t.run((ctx) =>
    paginate<Session, "session">(ctx, schema, authSchema, {
      model: "session",
      where: [
        { field: "token", operator: "in", value: tokens },
        { field: "expiresAt", operator: "gt", value: 50 },
      ],
      sortBy: { field: "userId", direction: "asc" },
      paginationOpts: { cursor: null, numItems: 10 },
    })
  );
  expect(result).toHaveProperty("unservedSort");
});

test("requires the token-only index before using unique token branches", async () => {
  const { schema, t } = await fixture(false);
  const result = await t.run((ctx) =>
    paginate<Session, "session">(ctx, schema, authSchema, {
      model: "session",
      where: [
        { field: "token", operator: "in", value: tokens },
        { field: "expiresAt", operator: "gt", value: 50 },
      ],
      sortBy: { field: "createdAt", direction: "asc" },
      paginationOpts: { cursor: null, numItems: 10 },
    })
  );
  expect(result).toHaveProperty("unservedSort");
});
