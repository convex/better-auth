import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { filterTables } from "./filterSchema";
import { sortingTable } from "./sortingSchema";
import { nestedValueTable } from "./nestedValueSchema";
export default defineSchema({
  ...filterTables,
  nestedValueItem: nestedValueTable,
  sortItem: sortingTable,
  outbox: defineTable({
    email: v.string(),
    kind: v.string(),
    value: v.string(),
  }).index("email_kind", ["email", "kind"]),
  oauthFixture: defineTable({
    code: v.string(),
    challenge: v.string(),
    email: v.string(),
  }).index("code", ["code"]),
});
