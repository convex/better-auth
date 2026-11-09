// @vitest-environment node
import { getAuthTables } from "better-auth/db";
import { afterEach, expect, it, vi } from "vitest";
import { options } from "../auth-options.js";
import { withTableLevelUniqueFields } from "../client/adapter-utils.js";

afterEach(() => {
  vi.doUnmock("../auth-options.js");
  vi.doUnmock("../client/index.js");
  vi.resetModules();
});

// Convex evaluates this module for every adapter call, so anything it imports
// is paid per call. The sample options pull in every Better Auth plugin.
it("loads without the sample auth options or the client index", async () => {
  const fail = (name: string) => () => {
    throw new Error(`component/adapter loaded ${name}`);
  };
  vi.resetModules();
  vi.doMock("../auth-options.js", fail("auth-options"));
  vi.doMock("../client/index.js", fail("client/index"));

  const adapter = await import("./adapter.js");

  expect(adapter.findOne).toBeDefined();
});

const describeTables = (tables: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(tables).map(([key, table]) => [
      key,
      {
        modelName: table.modelName,
        unique: Object.entries<any>(table.fields)
          .filter(([, field]) => field.unique)
          .map(([name]) => name)
          .sort(),
        renamed: Object.entries<any>(table.fields)
          .filter(([name, field]) => (field.fieldName ?? name) !== name)
          .map(([name]) => name),
      },
    ])
  );

// Catches upstream schema changes on a Better Auth upgrade. To fix a failure,
// update adapter-tables.ts to match the default auth options.
it("describes the same tables as the default auth options", async () => {
  const { adapterTables } = await import("../adapter-tables.js");

  expect(describeTables(adapterTables)).toEqual(
    describeTables(withTableLevelUniqueFields(getAuthTables(options)))
  );
});
