import { makeFunctionReference } from "convex/server";
import { expectTypeOf, it } from "vitest";
import { createTypedAdapter } from './create-typed-adapter.js';
import type { AdapterFunctions } from './create-typed-adapter.js';
import type { Doc } from "../component/_generated/dataModel.js";
import schema from "../component/schema.js";

const fns = {
  findOne: makeFunctionReference<"query">("adapter:findOne"),
  findMany: makeFunctionReference<"query">("adapter:findMany"),
  create: makeFunctionReference<"mutation">("adapter:create"),
  updateOne: makeFunctionReference<"mutation">("adapter:updateOne"),
  updateMany: makeFunctionReference<"mutation">("adapter:updateMany"),
  deleteOne: makeFunctionReference<"mutation">("adapter:deleteOne"),
  deleteMany: makeFunctionReference<"mutation">("adapter:deleteMany"),
} satisfies AdapterFunctions;

const adapter = createTypedAdapter(schema, fns);

const queryCtx = {
  runQuery: async () =>
    ({ page: [] as never, isDone: true as const, continueCursor: "" }) as never,
};

const mutationCtx = {
  runMutation: async () => ({}) as never,
};

it("infers doc type from model on findOne", async () => {
  const user = await adapter.findOne(queryCtx, {
    model: "user",
    where: [{ field: "email", value: "a@b.c" }],
  });
  expectTypeOf(user).toEqualTypeOf<Doc<"user"> | null>();

  const session = await adapter.findOne(queryCtx, {
    model: "session",
    where: [{ field: "userId", value: "u1" }],
  });
  expectTypeOf(session).toEqualTypeOf<Doc<"session"> | null>();
});

it("infers doc type from model on create", async () => {
  const created = await adapter.create(mutationCtx, {
    input: {
      model: "session",
      data: {
        expiresAt: 0,
        token: "t",
        createdAt: 0,
        updatedAt: 0,
        userId: "u" as Doc<"user">["_id"],
      },
    },
  });
  expectTypeOf(created).toEqualTypeOf<Doc<"session">>();
});

it("infers page doc type from model on findMany", async () => {
  const result = await adapter.findMany(queryCtx, {
    model: "account",
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expectTypeOf(result.page).toEqualTypeOf<Array<Doc<"account">>>();
});

it("narrows where field and value from model", () => {
  adapter.findOne(queryCtx, {
    model: "user",
    where: [{ field: "email", value: "a@b.c" }],
  });

  adapter.findOne(queryCtx, {
    model: "user",
    // @ts-expect-error token is not a user field
    where: [{ field: "token", value: "x" }],
  });

  adapter.findOne(queryCtx, {
    model: "session",
    // @ts-expect-error expiresAt expects a number
    where: [{ field: "expiresAt", value: "not-a-number" }],
  });
});

it("narrows findOne and findMany return type from select", async () => {
  const user = await adapter.findOne(queryCtx, {
    model: "user",
    select: ["email", "name"],
  });
  expectTypeOf(user).toEqualTypeOf<Pick<Doc<"user">, "email" | "name"> | null>();

  const users = await adapter.findMany(queryCtx, {
    model: "user",
    select: ["email"],
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expectTypeOf(users.page).toEqualTypeOf<Array<Pick<Doc<"user">, "email">>>();

  adapter.findOne(queryCtx, {
    model: "user",
    // @ts-expect-error token is not a user field
    select: ["token"],
  });
});

it("narrows sortBy field from model on findMany", () => {
  adapter.findMany(queryCtx, {
    model: "user",
    sortBy: { field: "email", direction: "asc" },
    paginationOpts: { cursor: null, numItems: 10 },
  });

  adapter.findMany(queryCtx, {
    model: "user",
    // @ts-expect-error token is not a user field
    sortBy: { field: "token", direction: "desc" },
    paginationOpts: { cursor: null, numItems: 10 },
  });
});
