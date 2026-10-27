import type { BetterAuthPlugin } from "better-auth";
import { getAuthTables } from "@better-auth/core/db";
import { organization } from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { createSchema } from "./create-schema.js";

const tableBlock = (code: string, table: string): string => {
  const marker = `  ${table}: defineTable({`;
  const start = code.indexOf(marker);
  expect(start, `table "${table}"`).toBeGreaterThanOrEqual(0);
  const searchFrom = start + marker.length;
  const nextTable = code.slice(searchFrom).search(/\n {2}\w+: defineTable\(\{/);
  const end =
    nextTable === -1 ? code.indexOf("\n};", start) : searchFrom + nextTable;
  expect(end, `end of table "${table}"`).toBeGreaterThan(start);
  return code.slice(start, end);
};

describe("createSchema", () => {
  it("emits v.id() for core FK fields", async () => {
    const tables = getAuthTables({});
    const { code } = await createSchema({ tables, file: "generatedSchema.ts" });

    expect(tableBlock(code, "session")).toContain('userId: v.id("user")');
    expect(tableBlock(code, "account")).toContain('userId: v.id("user")');
    expect(tableBlock(code, "account")).toContain("accountId: v.string()");
    expect(tableBlock(code, "account")).toContain("providerId: v.string()");
    expect(tableBlock(code, "session")).toContain("token: v.string()");
  });

  it("keeps user.userId as v.string() without references metadata", async () => {
    const tables = getAuthTables({
      user: {
        additionalFields: {
          userId: { type: "string", required: false },
        },
      },
    });
    const { code } = await createSchema({ tables, file: "generatedSchema.ts" });

    expect(tableBlock(code, "user")).toContain(
      "userId: v.optional(v.union(v.null(), v.string()))"
    );
  });

  it("emits v.id() for organization plugin FK fields", async () => {
    const tables = getAuthTables({
      plugins: [organization()],
    });
    const { code } = await createSchema({ tables, file: "generatedSchema.ts" });

    expect(tableBlock(code, "member")).toContain(
      'organizationId: v.id("organization")'
    );
    expect(tableBlock(code, "member")).toContain('userId: v.id("user")');
    expect(tableBlock(code, "invitation")).toContain(
      'organizationId: v.id("organization")'
    );
    expect(tableBlock(code, "invitation")).toContain('inviterId: v.id("user")');
    expect(tableBlock(code, "session")).toContain(
      "activeOrganizationId: v.optional(v.union(v.null(), v.string()))"
    );
  });

  it("uses renamed modelName in v.id()", async () => {
    const tables = getAuthTables({
      user: { modelName: "users" },
    });
    const { code } = await createSchema({ tables, file: "generatedSchema.ts" });

    expect(tableBlock(code, "session")).toContain('userId: v.id("users")');
    expect(tableBlock(code, "account")).toContain('userId: v.id("users")');
    expect(code).toMatch(/users: defineTable/);
  });

  it("keeps v.string() when referenced table is absent from schema", async () => {
    const plugin = {
      id: "external-ref-test",
      schema: {
        widget: {
          fields: {
            ownerId: {
              type: "string",
              required: true,
              references: { field: "id", model: "externalAppUser" },
            },
          },
        },
      },
    } satisfies BetterAuthPlugin;
    const tables = getAuthTables({ plugins: [plugin] });
    const { code } = await createSchema({ tables, file: "generatedSchema.ts" });

    expect(tableBlock(code, "widget")).toContain("ownerId: v.string()");
  });

  it("wraps optional FKs with v.optional(v.union(v.null(), v.id(...)))", async () => {
    const plugin = {
      id: "optional-fk-test",
      schema: {
        optionalRef: {
          fields: {
            userId: {
              type: "string",
              required: false,
              references: { field: "id", model: "user" },
            },
          },
        },
      },
    } satisfies BetterAuthPlugin;
    const tables = getAuthTables({ plugins: [plugin] });
    const { code } = await createSchema({ tables, file: "generatedSchema.ts" });

    expect(tableBlock(code, "optionalRef")).toContain(
      'userId: v.optional(v.union(v.null(), v.id("user")))'
    );
  });
});
