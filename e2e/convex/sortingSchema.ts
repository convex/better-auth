import { defineTable } from "convex/server";
import { v } from "convex/values";
export const sortingTable = defineTable({
  group: v.string(),
  rank: v.number(),
  keep: v.boolean(),
  profile: v.optional(
    v.union(
      v.null(),
      v.object({ score: v.optional(v.union(v.number(), v.null())) })
    )
  ),
})
  .index("nested", ["profile.score", "rank"])
  .index("group_nested", ["group", "profile.score", "rank"]);
