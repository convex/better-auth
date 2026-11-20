/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { getAuthTables } from "better-auth/db";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { anyApi, defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import schema from "../component/testProfiles/schema.profile-plugin-table.js";
import { pluginTableProfileOptions } from "../component/testProfiles/auth-options.profile-plugin-table.js";
import { renameFieldProfileOptions } from "../component/testProfiles/auth-options.profile-rename-joins.js";
import { createClient } from "./index.js";
import { createSchema } from "./create-schema.js";
import { createApi } from "./create-api.js";
import { checkCompoundUniqueOnCreate } from "./adapter-utils.js";
import type { DataModel } from "../component/_generated/dataModel.js";

/**
 * Better Auth 1.7 plugins can declare uniqueness with table-level
 * `indexes: [{ fields, unique: true }]` rather than field-level `unique`.
 * The schema generator emits those indexes. The adapter enforces single-field
 * unique indexes by treating the field as field-level unique, and compound
 * unique indexes on create (updates to their fields are refused).
 */
const setup = () => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as any;
  const adapter = createClient<DataModel>(
    { adapter: anyApi.testProfiles.adapterPluginTable } as any,
    { verbose: false }
  ).adapter(ctx)(pluginTableProfileOptions);
  return { t, adapter };
};

describe("table-level indexes", () => {
  it("generates Convex indexes from table-level indexes", async () => {
    const { code } = await createSchema({
      tables: getAuthTables(pluginTableProfileOptions),
    });
    const compoundIndex = code.slice(
      code.indexOf("compoundIndex: defineTable("),
      code.indexOf("compoundUnique: defineTable(")
    );
    expect(compoundIndex).toContain(
      '.index("groupId_slot", ["groupId","slot"])'
    );
    expect(compoundIndex.match(/\.index\(/g)).toHaveLength(1);

    const { code: deviceCode } = await createSchema({
      tables: getAuthTables({
        ...pluginTableProfileOptions,
        plugins: [deviceAuthorization()],
      } as BetterAuthOptions),
    });
    const deviceCodeTable = deviceCode.slice(
      deviceCode.indexOf("deviceCode: defineTable(")
    );
    expect(deviceCodeTable).toContain('.index("deviceCode", ["deviceCode"])');
    expect(deviceCodeTable).toContain('.index("userCode", ["userCode"])');
  });

  it("accepts compound unique indexes at schema generation and load", async () => {
    const { code } = await createSchema({
      tables: getAuthTables(pluginTableProfileOptions),
    });
    const table = code.slice(
      code.indexOf("compoundUnique: defineTable("),
      code.indexOf("testModel: defineTable(")
    );
    expect(table).toContain(
      '.index("clientId_resourceId", ["clientId","resourceId"])'
    );
    expect(() =>
      createApi(schema, () => pluginTableProfileOptions)
    ).not.toThrow();
  });
});

describe("compound unique indexes (oauth-provider's oauthClientResource)", () => {
  const link = (clientId: string, resourceId: string) => ({
    model: "compoundUnique",
    data: { clientId, resourceId },
  });
  const duplicate =
    "compoundUnique clientId, resourceId already exists (unique constraint)";

  it("rejects a create that duplicates the pair", async () => {
    const { adapter } = setup();
    await adapter.create(link("a", "r1"));
    const error = await adapter.create(link("a", "r1")).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(duplicate);
    // oauth-provider's link endpoint and isUniqueConstraintError patterns.
    expect(error.message).toMatch(/unique|duplicate|UNIQUE/i);
    expect(error.message).toMatch(
      /(?:duplicate|unique constraint|unique key)/i
    );
    // Pairs that share one field are distinct.
    await adapter.create(link("a", "r2"));
    await adapter.create(link("b", "r1"));
    expect(
      await adapter.count({
        model: "compoundUnique",
        where: [{ field: "clientId", value: "a" }],
      })
    ).toBe(2);
  });

  it("allows the pair again after the row is deleted", async () => {
    const { adapter } = setup();
    await adapter.create(link("a", "r1"));
    // oauth-provider's unlink endpoint.
    await adapter.deleteMany({
      model: "compoundUnique",
      where: [
        { field: "clientId", value: "a" },
        { field: "resourceId", value: "r1" },
      ],
    });
    await expect(adapter.create(link("a", "r1"))).resolves.toMatchObject({
      clientId: "a",
      resourceId: "r1",
    });
  });

  it("refuses updates that change a field of the index", async () => {
    const { t, adapter } = setup();
    const row = await adapter.create<{ id: string }>(link("a", "r1"));
    await adapter.create(link("b", "r1"));
    const refused = "Cannot update compoundUnique.clientId";
    await expect(
      adapter.update({
        model: "compoundUnique",
        where: [{ field: "id", value: row.id }],
        update: { clientId: "b" },
      })
    ).rejects.toThrow(refused);
    await expect(
      adapter.updateMany({
        model: "compoundUnique",
        where: [{ field: "resourceId", value: "r1" }],
        update: { resourceId: "r2" },
      })
    ).rejects.toThrow("Cannot update compoundUnique.resourceId");
    // Fields outside the index, and the row's own values, can be written.
    await expect(
      adapter.update({
        model: "compoundUnique",
        where: [{ field: "id", value: row.id }],
        update: { clientId: "a", resourceId: "r1", label: "x" },
      })
    ).resolves.toMatchObject({ clientId: "a", resourceId: "r1", label: "x" });
    await expect(
      adapter.updateMany({
        model: "compoundUnique",
        where: [{ field: "resourceId", value: "r1" }],
        update: { label: "y" },
      })
    ).resolves.toBe(2);
    // The refused writes changed nothing.
    const rows = await t.run((ctx) => ctx.db.query("compoundUnique").collect());
    expect(rows.map((r) => [r.clientId, r.resourceId, r.label]).sort()).toEqual(
      [
        ["a", "r1", "y"],
        ["b", "r1", "y"],
      ]
    );
  });
});

describe("field-level unique checks", () => {
  const user = (email: string, username?: string | null) => ({
    model: "user",
    data: {
      name: email,
      email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(username === undefined ? {} : { username }),
    },
  });

  it("lets several rows hold a null or unset unique value", async () => {
    const { adapter } = setup();
    // username plugin: optional, field-level unique.
    const a = await adapter.create<{ id: string }>(user("a@x.com", null));
    const b = await adapter.create<{ id: string }>(user("b@x.com", null));
    await adapter.create(user("c@x.com"));
    await adapter.update({
      model: "user",
      where: [{ field: "id", value: a.id }],
      update: { username: "taken" },
    });
    await expect(adapter.create(user("d@x.com", "taken"))).rejects.toThrow(
      "user username already exists"
    );
    // Clearing the value on one row, then several, is not a collision.
    await adapter.update({
      model: "user",
      where: [{ field: "id", value: a.id }],
      update: { username: null },
    });
    await adapter.update({
      model: "user",
      where: [{ field: "id", value: b.id }],
      update: { username: null },
    });
    await expect(
      adapter.updateMany({
        model: "user",
        where: [{ field: "emailVerified", value: false }],
        update: { username: null },
      })
    ).resolves.toBe(3);
  });

  it("checks against pre-existing duplicates without crashing", async () => {
    const { t, adapter } = setup();
    // Duplicates written before the constraint was enforced.
    const [a] = await t.run(async (ctx) =>
      Promise.all(
        ["a@x.com", "b@x.com"].map((email) =>
          ctx.db.insert("user", {
            name: email,
            email,
            emailVerified: false,
            username: "dup",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        )
      )
    );
    await expect(adapter.create(user("c@x.com", "dup"))).rejects.toThrow(
      "user username already exists"
    );
    // The other duplicate still conflicts with this row.
    await expect(
      adapter.update({
        model: "user",
        where: [{ field: "id", value: a }],
        update: { username: "dup" },
      })
    ).rejects.toThrow("user username already exists");
    // Moving off the duplicate value works.
    await expect(
      adapter.update({
        model: "user",
        where: [{ field: "id", value: a }],
        update: { username: "fresh" },
      })
    ).resolves.toMatchObject({ username: "fresh" });
    // With the duplicate gone, writing a row's own value is not a conflict.
    await expect(
      adapter.update({
        model: "user",
        where: [{ field: "id", value: a }],
        update: { username: "fresh" },
      })
    ).resolves.toMatchObject({ username: "fresh" });
  });

  it("checks unique fields stored under a renamed field", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const adapter = createClient<DataModel>(
      { adapter: anyApi.testProfiles.adapterRenameField } as any,
      { verbose: false }
    ).adapter(ctx)(renameFieldProfileOptions);
    // `email` is stored as `email_address`.
    await adapter.create(user("a@x.com"));
    await expect(adapter.create(user("a@x.com"))).rejects.toThrow(
      "user email_address already exists"
    );
    const b = await adapter.create<{ id: string }>(user("b@x.com"));
    await expect(
      adapter.update({
        model: "user",
        where: [{ field: "id", value: b.id }],
        update: { email: "a@x.com" },
      })
    ).rejects.toThrow("user email_address already exists");
  });
});

describe("account provider key", () => {
  const account = (userId: string, providerId: string, accountId: string) => ({
    model: "account",
    data: {
      userId,
      providerId,
      accountId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  it("rejects a second account with the same providerId and accountId", async () => {
    const { adapter } = setup();
    const a = await adapter.create<{ id: string }>({
      model: "user",
      data: {
        name: "a",
        email: "a@x.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await adapter.create(account(a.id, "github", "123"));
    // Same pair, same or another user.
    await expect(
      adapter.create(account(a.id, "github", "123"))
    ).rejects.toThrow(
      'account with providerId "github" and accountId "123" already exists'
    );
    await expect(
      adapter.create(account("someone-else", "github", "123"))
    ).rejects.toThrow("already exists");
    // Same accountId at another provider, or another accountId, is fine.
    await adapter.create(account(a.id, "google", "123"));
    await adapter.create(account(a.id, "github", "456"));
  });
});

describe("compound unique index field order", () => {
  it("enforces an index whose fields sort differently by locale", async () => {
    // Schema generation sorts by code unit, which puts clientId first. A
    // locale sort puts client_id first.
    const linkSchema = defineSchema({
      link: defineTable({
        clientId: v.string(),
        client_id: v.string(),
      }).index("clientId_client_id", ["clientId", "client_id"]),
    });
    const tables: any = {
      link: {
        modelName: "link",
        fields: {
          clientId: { type: "string" },
          client_id: { type: "string" },
        },
        indexes: [{ fields: ["client_id", "clientId"], unique: true }],
      },
    };
    const t = convexTest(linkSchema, import.meta.glob("../component/**/*.*s"));
    await t.run(async (ctx) => {
      const row = { clientId: "a", client_id: "b" };
      const check = () =>
        checkCompoundUniqueOnCreate(
          ctx as any,
          linkSchema,
          tables,
          "link",
          row
        );
      await check();
      await ctx.db.insert("link", row);
      await expect(check()).rejects.toThrow("unique constraint");
    });
  });
});

describe("manual indexes", () => {
  it("indexes the OAuth Provider consent lookup", async () => {
    const { code } = await createSchema({
      tables: getAuthTables({
        ...pluginTableProfileOptions,
        plugins: [
          {
            // Shaped like @better-auth/oauth-provider 1.7's `oauthConsent`.
            id: "consent-test",
            schema: {
              oauthConsent: {
                fields: {
                  clientId: { type: "string", required: true },
                  userId: { type: "string", required: false },
                  referenceId: { type: "string", required: false },
                },
              },
            },
          },
        ],
      } as BetterAuthOptions),
    });
    const consent = code.slice(code.indexOf("oauthConsent: defineTable("));
    expect(consent).toContain(
      '.index("clientId_userId", ["clientId","userId"])'
    );
    expect(consent).toContain(
      '.index("clientId_referenceId_userId", ["clientId","referenceId","userId"])'
    );
  });

  it("indexes the tokens OAuth Provider deletes for a replayed code", async () => {
    const token = {
      fields: { authorizationCodeId: { type: "string", required: false } },
    };
    const { code } = await createSchema({
      tables: getAuthTables({
        ...pluginTableProfileOptions,
        plugins: [
          {
            // Shaped like @better-auth/oauth-provider 1.7's token tables.
            id: "token-test",
            schema: { oauthAccessToken: token, oauthRefreshToken: token },
          },
        ],
      } as BetterAuthOptions),
    });
    expect(
      code.match(/\.index\("authorizationCodeId", \["authorizationCodeId"\]\)/g)
    ).toHaveLength(2);
  });
});
