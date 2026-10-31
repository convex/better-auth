import { defineTable } from "convex/server";
import { v } from "convex/values";
const child = () => v.optional(v.union(v.null(), v.number()));
export const nestedValueTable = defineTable({
  label: v.string(),
  rank: v.number(),
  count: v.number(),
  rangeValue: v.optional(
    v.union(v.number(), v.string(), v.boolean(), v.null())
  ),
  profile: v.optional(
    v.union(
      v.null(),
      v.string(),
      v.array(v.number()),
      v.bytes(),
      v.number(),
      v.int64(),
      v.boolean(),
      v.object({ length: child(), byteLength: child(), toString: child() })
    )
  ),
})
  .index("length_rank", ["profile.length", "rank"])
  .index("bytes_rank", ["profile.byteLength", "rank"])
  .index("method_rank", ["profile.toString", "rank"])
  .index("range_value_rank", ["rangeValue", "rank"]);
