import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { tables as baseTables } from "../schema.js";

const makeUserTable = () =>
  defineTable({
    name: v.string(),
    email: v.optional(v.union(v.null(), v.string())),
    email_address: v.optional(v.union(v.null(), v.string())),
    emailVerified: v.boolean(),
    image: v.optional(v.union(v.null(), v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
    twoFactorEnabled: v.optional(v.union(v.null(), v.boolean())),
    isAnonymous: v.optional(v.union(v.null(), v.boolean())),
    username: v.optional(v.union(v.null(), v.string())),
    displayUsername: v.optional(v.union(v.null(), v.string())),
    phoneNumber: v.optional(v.union(v.null(), v.string())),
    phoneNumberVerified: v.optional(v.union(v.null(), v.boolean())),
    userId: v.optional(v.union(v.null(), v.string())),
    testField: v.optional(v.union(v.null(), v.string())),
    cbDefaultValueField: v.optional(v.union(v.null(), v.string())),
    customField: v.optional(v.union(v.null(), v.string())),
    numericField: v.optional(v.union(v.null(), v.number())),
    dateField: v.optional(v.union(v.null(), v.number())),
  })
    .index("email_name", ["email", "name"])
    .index("email_address_name", ["email_address", "name"])
    .index("name", ["name"])
    .index("userId", ["userId"])
    .index("username", ["username"])
    .index("phoneNumber", ["phoneNumber"])
    .index("customField", ["customField"])
    .index("numericField", ["numericField"])
    .index("dateField", ["dateField"]);

const userTableWithProfileFields = makeUserTable();

const userCustomTable = makeUserTable();

const userTableRenamed = makeUserTable();

const oneToOneTable = defineTable({
  oneToOne: v.string(),
}).index("oneToOne", ["oneToOne"]);

const oneToOneTableRenamed = defineTable({
  oneToOne: v.optional(v.union(v.null(), v.string())),
  one_to_one: v.optional(v.union(v.null(), v.string())),
})
  .index("oneToOne", ["oneToOne"])
  .index("one_to_one", ["one_to_one"]);

const testModelTable = defineTable({
  nullableReference: v.optional(v.union(v.null(), v.string())),
  testField: v.optional(v.union(v.null(), v.string())),
  cbDefaultValueField: v.optional(v.union(v.null(), v.string())),
  stringArray: v.optional(v.union(v.null(), v.array(v.string()))),
  numberArray: v.optional(v.union(v.null(), v.array(v.number()))),
  json: v.optional(v.any()),
}).index("nullableReference", ["nullableReference"]);

const organizationTable = defineTable({
  name: v.string(),
  slug: v.string(),
  logo: v.optional(v.union(v.null(), v.string())),
  metadata: v.optional(v.union(v.null(), v.string())),
  createdAt: v.number(),
  updatedAt: v.optional(v.union(v.null(), v.number())),
})
  .index("slug", ["slug"])
  .index("name", ["name"]);

const memberTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  role: v.string(),
  createdAt: v.number(),
  updatedAt: v.optional(v.union(v.null(), v.number())),
})
  .index("organizationId", ["organizationId"])
  .index("userId", ["userId"]);

const teamTable = defineTable({
  name: v.string(),
  memberCount: v.number(),
  organizationId: v.string(),
  createdAt: v.number(),
  updatedAt: v.optional(v.union(v.null(), v.number())),
})
  .index("organizationId", ["organizationId"])
  .index("name", ["name"]);

const teamMemberTable = defineTable({
  teamId: v.string(),
  userId: v.string(),
  membershipKey: v.optional(v.union(v.null(), v.string())),
  createdAt: v.optional(v.union(v.null(), v.number())),
})
  .index("teamId", ["teamId"])
  .index("userId", ["userId"])
  .index("membershipKey", ["membershipKey"]);

const invitationTable = defineTable({
  email: v.optional(v.union(v.null(), v.string())),
  role: v.optional(v.union(v.null(), v.string())),
  status: v.optional(v.union(v.null(), v.string())),
  organizationId: v.optional(v.union(v.null(), v.string())),
  teamId: v.optional(v.union(v.null(), v.string())),
  inviterId: v.optional(v.union(v.null(), v.string())),
  expiresAt: v.optional(v.union(v.null(), v.number())),
  createdAt: v.optional(v.union(v.null(), v.number())),
  updatedAt: v.optional(v.union(v.null(), v.number())),
})
  .index("organizationId", ["organizationId"])
  .index("email", ["email"]);

const schema = defineSchema({
  ...baseTables,
  user: userTableWithProfileFields,
  user_custom: userCustomTable,
  user_table: userTableRenamed,
  oneToOneTable,
  one_to_one_table: oneToOneTableRenamed,
  testModel: testModelTable,
  organization: organizationTable,
  member: memberTable,
  team: teamTable,
  teamMember: teamMemberTable,
  invitation: invitationTable,
});

export default schema;
