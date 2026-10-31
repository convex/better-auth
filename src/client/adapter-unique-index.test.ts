/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { getAuthTables } from "better-auth/db";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { anyApi } from "convex/server";
import schema from "../component/testProfiles/schema.profile-plugin-table.js";
import { pluginTableProfileOptions } from "../component/testProfiles/auth-options.profile-plugin-table.js";
import { createClient } from "./index.js";
import { createSchema } from "./create-schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";

/**
 * Better Auth 1.7 plugins declare uniqueness with table-level
 * `indexes: [{ fields, unique: true }]` rather than field-level `unique`.
 * The schema generator must emit those indexes and the adapter must enforce
 * the (possibly compound) constraints on create and update.
 */
describe("table-level indexes", () => {
  it("generates Convex indexes from table-level indexes", async () => {
    const { code } = await createSchema({
      tables: getAuthTables(pluginTableProfileOptions),
    });
    const compoundUnique = code.slice(
      code.indexOf("compoundUnique: defineTable("),
      code.indexOf("testModel: defineTable(")
    );
    expect(compoundUnique).toContain(
      '.index("groupId_slot", ["groupId","slot"])'
    );
    expect(compoundUnique.match(/\.index\(/g)).toHaveLength(1);

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

  describe("compound unique constraints", () => {
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

    it("rejects a duplicate tuple on create", async () => {
      const { adapter } = setup();
      await adapter.create({
        model: "compoundUnique",
        data: { groupId: "g1", slot: "s1" },
      });
      // Same slot in another group and another slot in the same group are
      // fine: neither field is unique on its own.
      await adapter.create({
        model: "compoundUnique",
        data: { groupId: "g2", slot: "s1" },
      });
      await adapter.create({
        model: "compoundUnique",
        data: { groupId: "g1", slot: "s2" },
      });
      await expect(
        adapter.create({
          model: "compoundUnique",
          data: { groupId: "g1", slot: "s1" },
        })
      ).rejects.toThrow("compoundUnique groupId_slot already exists");
    });

    it("rejects a duplicate tuple on update", async () => {
      const { adapter } = setup();
      await adapter.create({
        model: "compoundUnique",
        data: { groupId: "g1", slot: "s1" },
      });
      const other = await adapter.create({
        model: "compoundUnique",
        data: { groupId: "g1", slot: "s2" },
      });
      await expect(
        adapter.update({
          model: "compoundUnique",
          where: [{ field: "id", value: other.id }],
          update: { slot: "s1" },
        })
      ).rejects.toThrow("compoundUnique groupId_slot already exists");
      // Updating a field outside the constraint, or to a free tuple, or to
      // the row's own current tuple is allowed.
      await adapter.update({
        model: "compoundUnique",
        where: [{ field: "id", value: other.id }],
        update: { label: "renamed" },
      });
      await adapter.update({
        model: "compoundUnique",
        where: [{ field: "id", value: other.id }],
        update: { groupId: "g2", slot: "s1" },
      });
      const updated = await adapter.update<{ groupId: string; slot: string }>({
        model: "compoundUnique",
        where: [{ field: "id", value: other.id }],
        update: { slot: "s1" },
      });
      expect(updated).toMatchObject({ groupId: "g2", slot: "s1" });
    });

    it("rejects updateMany that sets a whole unique tuple on several rows", async () => {
      const { adapter } = setup();
      await adapter.create({
        model: "compoundUnique",
        data: { groupId: "g1", slot: "s1" },
      });
      await adapter.create({
        model: "compoundUnique",
        data: { groupId: "g1", slot: "s2" },
      });
      await expect(
        adapter.updateMany({
          model: "compoundUnique",
          where: [{ field: "groupId", value: "g1" }],
          update: { groupId: "g3", slot: "s9" },
        })
      ).rejects.toThrow(/unique fields in multiple documents/);
      // Setting only part of the tuple on several rows is fine when the
      // resulting tuples stay distinct.
      expect(
        await adapter.updateMany({
          model: "compoundUnique",
          where: [{ field: "groupId", value: "g1" }],
          update: { groupId: "g3" },
        })
      ).toBe(2);
    });
  });
});
