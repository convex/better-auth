import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import type { Validator } from "convex/values";
import { tables as baseTables } from "../schema.js";

// Schema for the "Convex semantics" suite. See
// auth-options.profile-convex-semantics.ts for the matching Better Auth
// options. The indexes below are the ones the schema generator must emit for
// table-level `indexes` declared by plugins; the suite checks the generator
// separately, and the runtime looks indexes up by their fields, not their
// names, so the names here are not load-bearing.

const optional = <T extends Validator<any, "required", any>>(validator: T) =>
  v.optional(v.union(v.null(), validator));

// Mirrors `deviceAuthorization()`'s `deviceCode` table. `deviceCode` and
// `userCode` are unique through table-level indexes only.
const deviceCodeTable = defineTable({
  deviceCode: v.string(),
  userCode: v.string(),
  userId: optional(v.string()),
  expiresAt: v.number(),
  status: v.string(),
  lastPolledAt: optional(v.number()),
  pollingInterval: optional(v.number()),
  clientId: optional(v.string()),
  scope: optional(v.string()),
})
  .index("deviceCode", ["deviceCode"])
  .index("userCode", ["userCode"]);

const nullableTable = defineTable({
  plain: optional(v.string()),
  indexed: optional(v.string()),
  uniq: optional(v.string()),
  counter: optional(v.number()),
})
  .index("indexed", ["indexed"])
  .index("uniq", ["uniq"]);

const clientResourceTable = defineTable({
  clientId: v.string(),
  resourceId: v.string(),
  label: optional(v.string()),
}).index("clientId_resourceId", ["clientId", "resourceId"]);

const schema = defineSchema({
  ...baseTables,
  deviceCode: deviceCodeTable,
  nullable: nullableTable,
  clientResource: clientResourceTable,
});

export default schema;
