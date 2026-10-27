import { getAuthTables } from "better-auth/db";
import { describe, expect, it } from "vitest";
import { options } from "../auth-options.js";
import { createSchema } from "./create-schema.js";

describe("createSchema", () => {
  it("generates the index used to clean up expired rate limits", async () => {
    const { code } = await createSchema({
      tables: getAuthTables(options),
    });

    expect(code).toContain('.index("lastRequest", ["lastRequest"])');
  });
});
