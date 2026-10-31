import type { createTestSuite } from "@better-auth/test-utils/adapter";
import type { BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { expect } from "vitest";
import { constraintsProfileOptions } from "../../component/testProfiles/auth-options.constraints.js";

type Helpers = Parameters<Parameters<typeof createTestSuite>[2]>[0];

const withBetterAuthOptions =
  (
    modifyBetterAuthOptions: (
      options: BetterAuthOptions,
      shouldRunMigrations: boolean
    ) => Promise<unknown>,
    options: BetterAuthOptions,
    test: () => Promise<void>
  ) =>
  async () => {
    await modifyBetterAuthOptions(options, true);
    try {
      await test();
    } finally {
      await modifyBetterAuthOptions({}, true);
    }
  };

export const getAtomicTests = ({
  adapter,
  getBetterAuthOptions,
  modifyBetterAuthOptions,
}: Pick<
  Helpers,
  "adapter" | "getBetterAuthOptions" | "modifyBetterAuthOptions"
>) => ({
  "should consume a matching record only once": async () => {
    const user = await adapter.create({
      model: "user",
      data: { name: "consume", email: "consume@example.com" },
    });
    const where = [{ field: "id", value: user.id }];

    const consumed = await Promise.all([
      adapter.consumeOne({ model: "user", where }),
      adapter.consumeOne({ model: "user", where }),
    ]);
    expect(consumed.filter(Boolean)).toEqual([user]);
    await expect(
      adapter.consumeOne({ model: "user", where })
    ).resolves.toBeNull();
  },

  "should apply a guarded increment only once": withBetterAuthOptions(
    modifyBetterAuthOptions,
    { rateLimit: { enabled: true, storage: "database" } },
    async () => {
      const rateLimit = await adapter.create({
        model: "rateLimit",
        data: { key: "guarded-counter", count: 0, lastRequest: 0 },
      });
      const where = [
        { field: "id", value: rateLimit.id },
        { field: "count", operator: "lt" as const, value: 1 },
      ];

      const increments = await Promise.all([
        adapter.incrementOne({
          model: "rateLimit",
          where,
          increment: { count: 1 },
          set: { lastRequest: 42 },
        }),
        adapter.incrementOne({
          model: "rateLimit",
          where,
          increment: { count: 1 },
          set: { lastRequest: 42 },
        }),
      ]);
      expect(increments.filter(Boolean)).toEqual([
        expect.objectContaining({ count: 1, lastRequest: 42 }),
      ]);
      await expect(
        adapter.incrementOne({
          model: "rateLimit",
          where,
          increment: { count: 1 },
        })
      ).resolves.toBeNull();
    }
  ),

  "should increment a nullable legacy counter from zero": withBetterAuthOptions(
    modifyBetterAuthOptions,
    { plugins: [twoFactor()] },
    async () => {
      const factor = await adapter.create({
        model: "twoFactor",
        data: {
          secret: "secret",
          backupCodes: "[]",
          userId: "legacy-counter-user",
          failedVerificationCount: null,
        },
      });

      await expect(
        adapter.incrementOne({
          model: "twoFactor",
          where: [{ field: "id", value: factor.id }],
          increment: { failedVerificationCount: 1 },
        })
      ).resolves.toMatchObject({ failedVerificationCount: 1 });
    }
  ),

  "should restore Better Auth options after a custom test": async () => {
    expect(getBetterAuthOptions().plugins).toEqual(
      constraintsProfileOptions.plugins
    );
    expect(getBetterAuthOptions().rateLimit).toBeUndefined();
  },
});
