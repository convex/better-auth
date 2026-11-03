/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { getAuthTables } from "better-auth/db";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { anyApi } from "convex/server";
import schema from "../component/testProfiles/schema.profile-plugin-table.js";
import { pluginTableProfileOptions } from "../component/testProfiles/auth-options.profile-plugin-table.js";
import { renameFieldProfileOptions } from "../component/testProfiles/auth-options.profile-rename-joins.js";
import { createClient } from "./index.js";
import { createSchema } from "./create-schema.js";
import { createApi } from "./create-api.js";
import type { DataModel } from "../component/_generated/dataModel.js";

/**
 * Better Auth 1.7 plugins can declare uniqueness with table-level
 * `indexes: [{ fields, unique: true }]` rather than field-level `unique`.
 * The schema generator emits those indexes. The adapter enforces single-field
 * unique indexes by treating the field as field-level unique; compound unique
 * indexes are rejected.
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
      code.indexOf("testModel: defineTable(")
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

  it("rejects compound unique indexes at schema generation and load", async () => {
    const options = {
      ...pluginTableProfileOptions,
      plugins: [
        {
          id: "compound-unique-test",
          schema: {
            pair: {
              fields: {
                left: { type: "string", required: true },
                right: { type: "string", required: true },
              },
              indexes: [{ fields: ["left", "right"], unique: true }],
            },
          },
        },
      ],
    } as BetterAuthOptions;
    const message =
      "pair: compound unique index [left, right] is not supported by the Convex adapter";
    await expect(
      createSchema({ tables: getAuthTables(options) })
    ).rejects.toThrow(message);
    expect(() => createApi(schema, () => options)).toThrow(message);
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
