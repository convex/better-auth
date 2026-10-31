import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { tables } from "../schema.js";

const account = defineTable(
  v.object({
    ...tables.account.validator.fields,
    issuer: v.optional(v.union(v.null(), v.string())),
  })
)
  .index("issuer_accountId", ["issuer", "accountId"])
  .index("accountId", ["accountId"])
  .index("accountId_providerId", ["accountId", "providerId"])
  .index("providerId_userId", ["providerId", "userId"])
  .index("userId_providerId_accountId", ["userId", "providerId", "accountId"])
  .index("userId", ["userId"]);

export default defineSchema({ ...tables, account });
