import type { BetterAuthPlugin } from "@better-auth/core";
import type { Session, User } from "@better-auth/core/db";
import type { createTestSuite } from "@better-auth/test-utils/adapter";
import { getNormalTestSuiteTests as getUpstreamNormalTestSuiteTests } from "@better-auth/test-utils/adapter";
import { expect } from "vitest";

type Helpers = Parameters<Parameters<typeof createTestSuite>[2]>[0];
type DebugTools = { showDB?: () => Promise<void> };

const toMillis = (value: Date | number) =>
  value instanceof Date ? value.getTime() : value;

export const getNormalTestSuiteTests = (
  helpers: Helpers,
  debugTools?: DebugTools,
) => {
  const tests = getUpstreamNormalTestSuiteTests(helpers, debugTools);
  const {
    adapter,
    generate,
    insertRandom,
    modifyBetterAuthOptions,
    sortModels,
    transformGeneratedModel,
  } = helpers;

  return {
    ...tests,
    "create - should create a model": async () => {
      const user = await generate("user");
      const result = await adapter.create<User>({
        model: "user",
        data: user,
        forceAllowId: true,
      });
      // Convex assigns the document id, so the supplied id is dropped.
      user.id = result.id;

      expect(typeof result.id).toEqual("string");
      const transformed = transformGeneratedModel(user);
      expect(result).toEqual({
        ...transformed,
        createdAt: new Date(user.createdAt).getTime(),
        updatedAt: new Date(user.updatedAt).getTime(),
      });
    },
    "findOne - should find model with date field": async () => {
      const [user] = await insertRandom("user");
      const result = await adapter.findOne<User>({
        model: "user",
        where: [{ field: "createdAt", value: user.createdAt, operator: "eq" }],
      });
      expect(result).toEqual(user);
      expect(typeof result?.createdAt).toBe("number");
      expect(result?.createdAt).toEqual(user.createdAt);
    },
    "findOne - should work with both one-to-one and one-to-many joins":
      async () => {
        await modifyBetterAuthOptions(
          {
            plugins: [
              {
                id: "one-to-one-test",
                schema: {
                  oneToOneTable: {
                    fields: {
                      oneToOne: {
                        type: "string",
                        required: true,
                        references: { field: "id", model: "user" },
                        unique: true,
                      },
                    },
                  },
                },
              } satisfies BetterAuthPlugin,
            ],
          },
          true,
        );
        type OneToOneTable = { oneToOne: string };
        const users = (await insertRandom("user", 2)).map((entry) => entry[0]);
        const oneToOne = await adapter.create<OneToOneTable>({
          model: "oneToOneTable",
          data: {
            oneToOne: users[0]!.id,
          },
        });
        const session1 = await adapter.create<Session>({
          model: "session",
          data: {
            ...(await generate("session")),
            userId: users[0]!.id,
            createdAt: new Date(Date.now() - 3000),
          },
          forceAllowId: true,
        });
        const session2 = await adapter.create<Session>({
          model: "session",
          data: {
            ...(await generate("session")),
            userId: users[0]!.id,
            createdAt: new Date(Date.now() - 1000),
          },
          forceAllowId: true,
        });
        const result = await adapter.findOne<
          User & { oneToOneTable: OneToOneTable; session: Session[] }
        >({
          model: "user",
          where: [{ field: "id", value: users[0]!.id }],
          join: { oneToOneTable: true, session: true },
        });
        if (result?.session?.length) {
          result.session = result.session.sort(
            (a, b) => toMillis(a.createdAt) - toMillis(b.createdAt),
          );
        }

        expect(result).toEqual({
          ...users[0]!,
          oneToOneTable: oneToOne,
          session: [session1, session2],
        });
      },
    "findMany - should find many models with date fields": async () => {
      const users = (await insertRandom("user", 3)).map((entry) => entry[0]);
      const youngestUser = users.sort(
        (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt),
      )[0]!;
      const result = await adapter.findMany<User>({
        model: "user",
        where: [
          { field: "createdAt", value: youngestUser.createdAt, operator: "lt" },
        ],
      });
      expect(sortModels(result)).toEqual(
        sortModels(
          users.filter((user) => toMillis(user.createdAt) < toMillis(youngestUser.createdAt)),
        ),
      );
    },
    "findMany - should find many models with gt operator": async () => {
      const users = (await insertRandom("user", 3)).map((entry) => entry[0]);
      const oldestUser = users.sort(
        (a, b) => toMillis(a.createdAt) - toMillis(b.createdAt),
      )[0]!;
      const result = await adapter.findMany<User>({
        model: "user",
        where: [
          {
            field: "createdAt",
            value: oldestUser.createdAt,
            operator: "gt",
          },
        ],
      });
      const expectedResult = sortModels(
        users.filter((user) => toMillis(user.createdAt) > toMillis(oldestUser.createdAt)),
      );
      expect(result.length).not.toBe(0);
      expect(sortModels(result)).toEqual(expectedResult);
    },
    "findMany - should find many models with gte operator": async () => {
      const users = (await insertRandom("user", 3)).map((entry) => entry[0]);
      const oldestUser = users.sort(
        (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt),
      )[0]!;
      const result = await adapter.findMany<User>({
        model: "user",
        where: [
          {
            field: "createdAt",
            value: oldestUser.createdAt,
            operator: "gte",
          },
        ],
      });
      const expectedResult = users.filter(
        (user) => toMillis(user.createdAt) >= toMillis(oldestUser.createdAt),
      );
      expect(result.length).not.toBe(0);
      expect(sortModels(result)).toEqual(sortModels(expectedResult));
    },
  };
};
