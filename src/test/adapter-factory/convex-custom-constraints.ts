import type { createTestSuite } from "@better-auth/test-utils/adapter";
import { expect } from "vitest";

type Helpers = Parameters<Parameters<typeof createTestSuite>[2]>[0];

export const getConstraintTests = (adapter: Helpers["adapter"]) => ({
  "should roll back single-page bulk updates that collide on a compound unique constraint":
    async () => {
      await adapter.create({
        model: "account",
        data: {
          issuer: "issuer-a",
          accountId: "shared-account",
          providerId: "provider-a",
          userId: "user-a",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      await adapter.create({
        model: "account",
        data: {
          issuer: "issuer-b",
          accountId: "shared-account",
          providerId: "provider-b",
          userId: "user-b",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });

      await expect(
        adapter.updateMany({
          model: "account",
          where: [{ field: "accountId", value: "shared-account" }],
          update: { issuer: "issuer-c" },
        })
      ).rejects.toThrow(
        "account unique constraint issuer+accountId already exists"
      );

      const accounts = await adapter.findMany({
        model: "account",
        where: [{ field: "accountId", value: "shared-account" }],
      });
      expect(accounts).toHaveLength(2);
      expect(accounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ issuer: "issuer-a" }),
          expect.objectContaining({ issuer: "issuer-b" }),
        ])
      );
    },

  "should allow a full-page unique update and reject larger updates":
    async () => {
      for (let i = 0; i < 200; i += 1) {
        await adapter.create({
          model: "account",
          data: {
            issuer: `original-${i}`,
            accountId: `bulk-account-${i}`,
            providerId: "bulk-provider",
            userId: `bulk-user-${i}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }

      await expect(
        adapter.updateMany({
          model: "account",
          where: [{ field: "providerId", value: "bulk-provider" }],
          update: { issuer: "full-page-issuer" },
        })
      ).resolves.toBe(200);
      await expect(
        adapter.findOne({
          model: "account",
          where: [{ field: "accountId", value: "bulk-account-0" }],
        })
      ).resolves.toMatchObject({ issuer: "full-page-issuer" });

      await adapter.create({
        model: "account",
        data: {
          issuer: "overflow-issuer",
          accountId: "bulk-overflow",
          providerId: "bulk-provider",
          userId: "bulk-user-overflow",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });

      await expect(
        adapter.updateMany({
          model: "account",
          where: [{ field: "providerId", value: "bulk-provider" }],
          update: { issuer: "updated-issuer" },
        })
      ).rejects.toThrow(
        "Cannot update unique fields across multiple pages in account"
      );

      await expect(
        adapter.findOne({
          model: "account",
          where: [{ field: "accountId", value: "bulk-account-0" }],
        })
      ).resolves.toMatchObject({ issuer: "full-page-issuer" });
    },

  "should allow atomic ID-set unique updates larger than one page":
    async () => {
      for (let i = 0; i < 201; i += 1) {
        await adapter.create({
          model: "account",
          data: {
            issuer: `original-${i}`,
            accountId: `or-bulk-account-${i}`,
            providerId: i % 2 === 0 ? "or-bulk-a" : "or-bulk-b",
            userId: `or-bulk-user-${i}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }

      await expect(
        adapter.updateMany({
          model: "account",
          where: [
            { field: "providerId", value: "or-bulk-a", connector: "OR" },
            { field: "providerId", value: "or-bulk-b", connector: "OR" },
          ],
          update: { issuer: "atomic-id-set-issuer" },
        })
      ).resolves.toBe(201);

      await expect(
        adapter.findOne({
          model: "account",
          where: [{ field: "accountId", value: "or-bulk-account-0" }],
        })
      ).resolves.toMatchObject({ issuer: "atomic-id-set-issuer" });
    },

});
