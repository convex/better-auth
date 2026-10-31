import { defineTable } from "convex/server";
import { v } from "convex/values";
const optional = () => v.optional(v.union(v.string(), v.null()));
export const filterTables = {
  filterItem: defineTable({
    group: optional(),
    category: v.string(),
    rank: v.number(),
    flag: v.optional(v.boolean()),
  }).index("group_rank", ["group", "rank"]),
  nestedItem: defineTable({
    profile: v.optional(
      v.union(
        v.null(),
        v.object({
          name: optional(),
          contact: v.optional(
            v.union(v.null(), v.object({ city: optional() }))
          ),
        })
      )
    ),
    unindexed: v.optional(v.object({ tag: optional() })),
    rank: v.number(),
    counter: v.optional(v.number()),
    flag: v.optional(v.boolean()),
  })
    .index("name_rank", ["profile.name", "rank"])
    .index("city_rank", ["profile.contact.city", "rank"])
    .index("rank", ["rank"]),
};
