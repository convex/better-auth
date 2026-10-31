import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { tables } from "../../node_modules/@convex-dev/better-auth/src/component/schema";
export default defineSchema({
  ...tables,
  mapped: defineTable({
    tenantKey: v.optional(v.union(v.string(), v.null())),
    subjectKey: v.optional(v.union(v.string(), v.null())),
    count: v.optional(v.union(v.number(), v.null())),
    triggerCount: v.optional(v.number()),
    memo: v.optional(v.union(v.string(), v.null())),
  })
    .index("subject_tenant", ["subjectKey", "tenantKey"])
    .index("tenantKey", ["tenantKey"]),
});
