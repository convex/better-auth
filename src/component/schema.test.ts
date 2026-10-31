import { describe, expect, it } from "vitest";
import schema from "./schema.js";

describe("account schema", () => {
  it("uses the current credential lookup fields without issuer indexes", () => {
    const indexes = schema.tables.account[" indexes"]();
    expect(indexes).toContainEqual({
      indexDescriptor: "userId_providerId_accountId",
      fields: ["userId", "providerId", "accountId"],
    });
    expect(indexes.every(({ fields }) => !fields.includes("issuer"))).toBe(
      true
    );
  });
});
