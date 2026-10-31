/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { createFunctionHandle } from "convex/server";
import { constraintsProfileOptions } from "../component/testProfiles/auth-options.constraints.js";
import schema from "../component/testProfiles/schema.constraints.js";
import { api, internal } from "../component/_generated/api.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";

const accountData = () => ({
  issuer: "local:credential",
  accountId: "user-1",
  providerId: "credential",
  userId: "user-1",
  password: "password-hash",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const createAccount = async (
  t: ReturnType<typeof convexTest>,
  onCreateHandle?: string
) =>
  await t.run(async (ctx) =>
    ctx.runMutation(api.testProfiles.adapterConstraints.create, {
      input: { model: "account", data: accountData() },
      onCreateHandle,
    })
  );

const insertLegacyAccount = async (
  t: ReturnType<typeof convexTest>,
  suffix: string
) =>
  await t.run((ctx) =>
    ctx.db.insert("account", {
      accountId: `legacy-account-${suffix}`,
      providerId: "credential",
      userId: `legacy-user-${suffix}`,
      password: "password-hash",
      createdAt: Date.now(),
      updatedAt: 100,
    })
  );

describe("required fields", () => {
  it.each([
    [1, Infinity],
    [1, NaN],
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [2 ** 53, 1],
    [Infinity, 1],
  ])("rejects unsafe atomic counter arithmetic", async (initial, delta) => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run((ctx) =>
      ctx.db.insert("twoFactor", {
        secret: "secret",
        backupCodes: "[]",
        userId: "counter-probe",
        failedVerificationCount: initial,
      })
    );
    const adapter = createClient<DataModel>({
      adapter: api.testProfiles.adapterConstraints,
    } as any).adapter({
      runMutation: t.mutation.bind(t),
      runQuery: t.query.bind(t),
    } as any)(constraintsProfileOptions);
    await expect(
      adapter.incrementOne({
        model: "twoFactor",
        where: [{ field: "userId", value: "counter-probe" }],
        increment: { failedVerificationCount: delta },
      })
    ).rejects.toThrow("Cannot safely increment field");
    const records = await t.run((ctx) => ctx.db.query("twoFactor").collect());
    expect(records[0]?.failedVerificationCount).toBe(initial);
  });

  it.each([null, undefined, 3])(
    "allows zero increments and nullable counters",
    async (initial) => {
      const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
      await t.run((ctx) =>
        ctx.db.insert("twoFactor", {
          secret: "secret",
          backupCodes: "[]",
          userId: "nullable-counter",
          ...(initial === undefined
            ? {}
            : { failedVerificationCount: initial }),
        })
      );
      const adapter = createClient<DataModel>({
        adapter: api.testProfiles.adapterConstraints,
      } as any).adapter({
        runMutation: t.mutation.bind(t),
        runQuery: t.query.bind(t),
      } as any)(constraintsProfileOptions);
      await expect(
        adapter.incrementOne({
          model: "twoFactor",
          where: [{ field: "userId", value: "nullable-counter" }],
          increment: { failedVerificationCount: 0 },
        })
      ).resolves.toMatchObject({ failedVerificationCount: initial ?? 0 });
    }
  );

  it("rolls back every increment when one counter is unsafe", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run((ctx) =>
      ctx.db.insert("rateLimit", {
        key: "multi-counter",
        count: 5,
        lastRequest: 2 ** 53,
      })
    );
    const adapter = createClient<DataModel>({
      adapter: api.testProfiles.adapterConstraints,
    } as any).adapter({
      runMutation: t.mutation.bind(t),
      runQuery: t.query.bind(t),
    } as any)(constraintsProfileOptions);
    await expect(
      adapter.incrementOne({
        model: "rateLimit",
        where: [{ field: "key", value: "multi-counter" }],
        increment: { count: 1, lastRequest: 1 },
      })
    ).rejects.toThrow("Cannot safely increment field");
    const records = await t.run((ctx) => ctx.db.query("rateLimit").collect());
    expect(records[0]).toMatchObject({ count: 5, lastRequest: 2 ** 53 });
  });

  it("applies multiple safe increments together", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run((ctx) =>
      ctx.db.insert("rateLimit", {
        key: "multi-valid",
        count: 5,
        lastRequest: 3,
      })
    );
    const adapter = createClient<DataModel>({
      adapter: api.testProfiles.adapterConstraints,
    } as any).adapter({
      runMutation: t.mutation.bind(t),
      runQuery: t.query.bind(t),
    } as any)(constraintsProfileOptions);
    await expect(
      adapter.incrementOne({
        model: "rateLimit",
        where: [{ field: "key", value: "multi-valid" }],
        increment: { count: 2, lastRequest: -1 },
      })
    ).resolves.toMatchObject({ count: 7, lastRequest: 2 });
  });

  it("rejects clearing a required field in a new atomic increment", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await createAccount(t);
    await expect(
      t.run((ctx) =>
        ctx.runMutation(api.testProfiles.adapterConstraints.incrementOne, {
          input: {
            model: "account",
            increment: { updatedAt: 1 },
            set: { issuer: null },
            where: [{ field: "accountId", operator: "eq", value: "user-1" }],
          },
        })
      )
    ).rejects.toThrow("Cannot clear required field account.issuer");
    expect(
      (await t.run((ctx) => ctx.db.query("account").collect()))[0]?.issuer
    ).toBe("local:credential");
  });

  it.each(["updateOne", "incrementOne", "updateMany"] as const)(
    "allows an unrelated %s on a legacy account",
    async (operation) => {
      const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
      await insertLegacyAccount(t, operation);

      await t.run(async (ctx) => {
        const where = [
          {
            field: "accountId",
            operator: "eq" as const,
            value: `legacy-account-${operation}`,
          },
        ];
        if (operation === "updateOne") {
          await ctx.runMutation(api.testProfiles.adapterConstraints.updateOne, {
            input: {
              model: "account",
              update: { accessToken: "updated-token" },
              where,
            },
          });
          return;
        }
        if (operation === "incrementOne") {
          await ctx.runMutation(
            api.testProfiles.adapterConstraints.incrementOne,
            {
              input: {
                model: "account",
                increment: { updatedAt: 1 },
                where,
              },
            }
          );
          return;
        }
        await ctx.runMutation(api.testProfiles.adapterConstraints.updateMany, {
          input: {
            model: "account",
            update: { scope: "updated-scope" },
            where,
          },
          paginationOpts: { cursor: null, numItems: 10 },
        });
      });

      const accounts = await t.run((ctx) => ctx.db.query("account").collect());
      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.issuer).toBeUndefined();
      if (operation === "updateOne") {
        expect(accounts[0]?.accessToken).toBe("updated-token");
      } else if (operation === "incrementOne") {
        expect(accounts[0]?.updatedAt).toBe(101);
      } else {
        expect(accounts[0]?.scope).toBe("updated-scope");
      }
    }
  );

  it("updates multiple pages containing a legacy account", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run(async (ctx) => {
      for (let i = 0; i < 401; i += 1) {
        await ctx.db.insert("account", {
          ...(i === 250 ? {} : { issuer: `local:legacy-${i}` }),
          accountId: `legacy-bulk-account-${i}`,
          providerId: "legacy-bulk-provider",
          userId: `legacy-bulk-user-${i.toString().padStart(3, "0")}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });
    const adapter = createClient<DataModel>(
      { adapter: api.testProfiles.adapterConstraints } as any,
      {
        verbose: false,
      }
    ).adapter({
      runMutation: t.mutation.bind(t),
      runQuery: t.query.bind(t),
    } as any)(constraintsProfileOptions);

    await expect(
      adapter.updateMany({
        model: "account",
        where: [{ field: "providerId", value: "legacy-bulk-provider" }],
        update: { scope: "updated-scope" },
      })
    ).resolves.toBe(401);

    const accounts = await t.run((ctx) => ctx.db.query("account").collect());
    expect(accounts).toHaveLength(401);
    expect(accounts.every(({ scope }) => scope === "updated-scope")).toBe(true);
    expect(accounts.filter(({ issuer }) => issuer === undefined)).toHaveLength(
      1
    );
  });

  it("rolls back an onUpdate trigger that clears a required field", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await createAccount(t);

    await expect(
      t.run(async (ctx) => {
        const handle = await createFunctionHandle(
          internal.testTriggerHandlers.accountOnUpdateIssuerClearer
        );
        return await ctx.runMutation(
          api.testProfiles.adapterConstraints.incrementOne,
          {
            input: {
              model: "account",
              increment: { updatedAt: 1 },
              where: [{ field: "accountId", operator: "eq", value: "user-1" }],
            },
            onUpdateHandle: handle,
          }
        );
      })
    ).rejects.toThrow("Trigger cleared required field account.issuer");

    const accounts = await t.run((ctx) => ctx.db.query("account").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.issuer).toBe("local:credential");
  });

  it("allows a no-op trigger on a legacy account with a null issuer", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run((ctx) =>
      ctx.db.insert("account", {
        issuer: null,
        accountId: "legacy-null-account",
        providerId: "credential",
        userId: "legacy-null-user",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    await t.run(async (ctx) => {
      const handle = await createFunctionHandle(
        internal.testTriggerHandlers.accountOnUpdateNoop
      );
      await ctx.runMutation(api.testProfiles.adapterConstraints.updateOne, {
        input: {
          model: "account",
          update: { scope: "updated-scope" },
          where: [
            {
              field: "accountId",
              operator: "eq",
              value: "legacy-null-account",
            },
          ],
        },
        onUpdateHandle: handle,
      });
    });

    const accounts = await t.run((ctx) => ctx.db.query("account").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.issuer).toBeNull();
    expect(accounts[0]?.scope).toBe("updated-scope");
  });
});
