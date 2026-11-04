// @vitest-environment node
import { readFileSync } from "node:fs";
import { getAuthTables } from "better-auth/db";
import { expect, it } from "vitest";
import { options } from "../auth-options.js";
import { createSchema } from "../client/create-schema.js";

// Catches upstream schema changes on a Better Auth upgrade. To fix a failure,
// regenerate: npx auth generate --output src/component/schema.ts
it("matches the schema generated from the default auth options", async () => {
  const { code } = await createSchema({
    tables: getAuthTables(options),
    file: "src/component/schema.ts",
  });
  expect(code).toBe(
    readFileSync(new URL("./schema.ts", import.meta.url), "utf8")
  );
});

// Better Auth 1.7's findCredentialAccount runs on every set, change and reset
// password. Without this index it scans the whole account table.
it("indexes the credential account lookup", async () => {
  const { code } = await createSchema({
    tables: getAuthTables(options),
    file: "src/component/schema.ts",
  });
  expect(code).toContain(
    '.index("accountId_providerId_userId", ["accountId","providerId","userId"])'
  );
});
