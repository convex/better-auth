/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { createFunctionHandle } from "convex/server";
import schema from "../component/testProfiles/schema.constraints.js";
import { api, internal } from "../component/_generated/api.js";

const baseSessionData = () => ({
  expiresAt: Date.now() + 60_000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  userId: "user-1",
  userAgent: "original",
});

const accountData = ({
  issuer,
  accountId,
  providerId,
  userId,
}: {
  issuer: string;
  accountId: string;
  providerId: string;
  userId: string;
}) => ({
  issuer,
  accountId,
  providerId,
  userId,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe("trigger result propagation", () => {
  it("api.testProfiles.adapterConstraints.create returns the doc reflecting onCreateHandle writes", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const result = await t.run(async (ctx) => {
      const handle = await createFunctionHandle(
        internal.testTriggerHandlers.sessionOnCreateUpdater
      );
      return await ctx.runMutation(api.testProfiles.adapterConstraints.create, {
        input: {
          model: "session",
          data: { ...baseSessionData(), token: "create-token-1" },
        },
        onCreateHandle: handle,
      });
    });
    expect(result.userAgent).toBe("trigger-ran-on-create");
  });

  it("api.testProfiles.adapterConstraints.updateOne returns the doc reflecting onUpdateHandle writes", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const result = await t.run(async (ctx) => {
      await ctx.runMutation(api.testProfiles.adapterConstraints.create, {
        input: {
          model: "session",
          data: { ...baseSessionData(), token: "update-token-1" },
        },
      });
      const handle = await createFunctionHandle(
        internal.testTriggerHandlers.sessionOnUpdateUpdater
      );
      return await ctx.runMutation(
        api.testProfiles.adapterConstraints.updateOne,
        {
          input: {
            model: "session",
            update: { userAgent: "set-by-update" },
            where: [
              { field: "token", operator: "eq", value: "update-token-1" },
            ],
          },
          onUpdateHandle: handle,
        }
      );
    });
    expect(result).toMatchObject({ userAgent: "trigger-ran-on-update" });
  });

  it("api.testProfiles.adapterConstraints.incrementOne returns the doc reflecting onUpdateHandle writes", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const result = await t.run(async (ctx) => {
      await ctx.runMutation(api.testProfiles.adapterConstraints.create, {
        input: {
          model: "session",
          data: {
            ...baseSessionData(),
            expiresAt: 100,
            token: "increment-token-1",
          },
        },
      });
      const handle = await createFunctionHandle(
        internal.testTriggerHandlers.sessionOnUpdateUpdater
      );
      return await ctx.runMutation(
        api.testProfiles.adapterConstraints.incrementOne,
        {
          input: {
            model: "session",
            increment: { expiresAt: 1 },
            where: [
              {
                field: "token",
                operator: "eq",
                value: "increment-token-1",
              },
            ],
          },
          onUpdateHandle: handle,
        }
      );
    });
    expect(result).toMatchObject({
      expiresAt: 101,
      userAgent: "trigger-ran-on-update",
    });
  });

  it("api.testProfiles.adapterConstraints.updateMany runs onUpdateHandle for every updated doc", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const result = await t.run(async (ctx) => {
      for (const token of ["bulk-update-token-1", "bulk-update-token-2"]) {
        await ctx.runMutation(api.testProfiles.adapterConstraints.create, {
          input: {
            model: "session",
            data: { ...baseSessionData(), token },
          },
        });
      }
      const handle = await createFunctionHandle(
        internal.testTriggerHandlers.sessionOnUpdateUpdater
      );
      return await ctx.runMutation(
        api.testProfiles.adapterConstraints.updateMany,
        {
          input: {
            model: "session",
            update: { userAgent: "set-by-update" },
            where: [{ field: "userId", operator: "eq", value: "user-1" }],
          },
          paginationOpts: { cursor: null, numItems: 10 },
          onUpdateHandle: handle,
        }
      );
    });
    expect(result.count).toBe(2);

    const sessions = await t.run((ctx) => ctx.db.query("session").collect());
    expect(sessions).toHaveLength(2);
    expect(
      sessions.every(({ userAgent }) => userAgent === "trigger-ran-on-update")
    ).toBe(true);
  });
});

describe("trigger unique constraint enforcement", () => {
  it("rolls back an onCreate trigger that creates an account identity collision", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run((ctx) =>
      ctx.runMutation(api.testProfiles.adapterConstraints.create, {
        input: {
          model: "account",
          data: accountData({
            issuer: "collision-issuer",
            accountId: "collision-account",
            providerId: "existing-provider",
            userId: "existing-user",
          }),
        },
      })
    );

    await expect(
      t.run(async (ctx) => {
        const handle = await createFunctionHandle(
          internal.testTriggerHandlers.accountOnCreateIssuerCollider
        );
        return await ctx.runMutation(
          api.testProfiles.adapterConstraints.create,
          {
            input: {
              model: "account",
              data: accountData({
                issuer: "safe-issuer",
                accountId: "collision-account",
                providerId: "candidate-provider",
                userId: "candidate-user",
              }),
            },
            onCreateHandle: handle,
          }
        );
      })
    ).rejects.toThrow(
      "account unique constraint issuer+accountId already exists"
    );

    const accounts = await t.run((ctx) => ctx.db.query("account").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      issuer: "collision-issuer",
      accountId: "collision-account",
      providerId: "existing-provider",
    });
  });

  it("rolls back an onUpdate trigger that creates an account identity collision", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run(async (ctx) => {
      for (const data of [
        accountData({
          issuer: "collision-issuer",
          accountId: "collision-account",
          providerId: "existing-provider",
          userId: "existing-user",
        }),
        accountData({
          issuer: "collision-issuer",
          accountId: "safe-account",
          providerId: "candidate-provider",
          userId: "candidate-user",
        }),
      ]) {
        await ctx.runMutation(api.testProfiles.adapterConstraints.create, {
          input: { model: "account", data },
        });
      }
    });

    await expect(
      t.run(async (ctx) => {
        const handle = await createFunctionHandle(
          internal.testTriggerHandlers.accountOnUpdateAccountIdCollider
        );
        return await ctx.runMutation(
          api.testProfiles.adapterConstraints.updateOne,
          {
            input: {
              model: "account",
              update: { scope: "updated-scope" },
              where: [
                {
                  field: "providerId",
                  operator: "eq",
                  value: "candidate-provider",
                },
              ],
            },
            onUpdateHandle: handle,
          }
        );
      })
    ).rejects.toThrow(
      "account unique constraint issuer+accountId already exists"
    );

    const candidate = await t.run((ctx) =>
      ctx.db
        .query("account")
        .withIndex("providerId_userId", (q) =>
          q
            .eq("providerId", "candidate-provider")
            .eq("userId", "candidate-user")
        )
        .unique()
    );
    expect(candidate).toMatchObject({
      accountId: "safe-account",
      issuer: "collision-issuer",
    });
    expect(candidate?.scope).toBeUndefined();
  });

  it("rolls back updateMany when a trigger creates an account identity collision", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run(async (ctx) => {
      for (const data of [
        accountData({
          issuer: "collision-issuer",
          accountId: "collision-account",
          providerId: "existing-provider",
          userId: "existing-user",
        }),
        accountData({
          issuer: "collision-issuer",
          accountId: "safe-account",
          providerId: "candidate-provider",
          userId: "candidate-user",
        }),
      ]) {
        await ctx.runMutation(api.testProfiles.adapterConstraints.create, {
          input: { model: "account", data },
        });
      }
    });

    await expect(
      t.run(async (ctx) => {
        const handle = await createFunctionHandle(
          internal.testTriggerHandlers.accountOnUpdateAccountIdCollider
        );
        return await ctx.runMutation(
          api.testProfiles.adapterConstraints.updateMany,
          {
            input: {
              model: "account",
              update: { scope: "updated-scope" },
              where: [
                {
                  field: "providerId",
                  operator: "eq",
                  value: "candidate-provider",
                },
              ],
            },
            paginationOpts: { cursor: null, numItems: 10 },
            onUpdateHandle: handle,
          }
        );
      })
    ).rejects.toThrow(
      "account unique constraint issuer+accountId already exists"
    );

    const accounts = await t.run((ctx) => ctx.db.query("account").collect());
    expect(accounts).toHaveLength(2);
    const candidate = accounts.find(
      ({ providerId }) => providerId === "candidate-provider"
    );
    expect(candidate).toMatchObject({
      accountId: "safe-account",
      issuer: "collision-issuer",
    });
    expect(candidate?.scope).toBeUndefined();
  });
});
