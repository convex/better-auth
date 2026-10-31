/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");
const listLegacyOAuthApplications = api.migrations.listLegacyOAuthApplications;
const clearLegacyOAuthProviderRecords =
  api.migrations.clearLegacyOAuthProviderRecords;

describe("legacy OAuth provider migrations", () => {
  it("treats completed cursors as terminal instead of restarting", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("account", {
        accountId: "github-subject",
        providerId: "github",
        userId: "user-1",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("oauthApplication", {
        clientId: "legacy-client",
        clientSecret: "legacy-secret",
      });
    });
    const initialPage = { cursor: null, numItems: 10 };

    const exported = await t.query(listLegacyOAuthApplications, {
      paginationOpts: initialPage,
    });
    expect(exported.isDone).toBe(true);
    await expect(
      t.query(listLegacyOAuthApplications, {
        paginationOpts: { cursor: exported.continueCursor, numItems: 10 },
      })
    ).resolves.toMatchObject({ isDone: true, page: [] });

    const cleared = await t.mutation(clearLegacyOAuthProviderRecords, {
      table: "oauthApplication",
      paginationOpts: initialPage,
    });
    expect(cleared.isDone).toBe(true);
    await expect(
      t.mutation(clearLegacyOAuthProviderRecords, {
        table: "oauthApplication",
        paginationOpts: { cursor: cleared.continueCursor, numItems: 10 },
      })
    ).resolves.toMatchObject({ isDone: true, deleted: 0 });
  });

  it("rejects terminal cursors from other migrations and tables", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("account", {
        accountId: "github-subject",
        providerId: "github",
        userId: "user-1",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("oauthConsent", {
        clientId: "legacy-client",
        userId: "user-1",
        scopes: "openid",
        consentGiven: true,
      });
    });
    const paginationOpts = { cursor: null, numItems: 10 };

    const clearedApplications = await t.mutation(
      clearLegacyOAuthProviderRecords,
      {
        table: "oauthApplication",
        paginationOpts,
      }
    );
    await expect(
      t.mutation(clearLegacyOAuthProviderRecords, {
        table: "oauthConsent",
        paginationOpts: {
          cursor: clearedApplications.continueCursor,
          numItems: 10,
        },
      })
    ).rejects.toThrow(
      "Migration cursor is not valid for clearLegacyOAuthProviderRecords:oauthConsent"
    );

    const [account] = await t.run((ctx) => ctx.db.query("account").collect());
    expect(account?.accountId).toBe("github-subject");
    const consents = await t.run((ctx) =>
      ctx.db.query("oauthConsent").collect()
    );
    expect(consents).toHaveLength(1);
  });

  it("accepts, exports, and clears legacy OAuth provider records", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("oauthApplication", {
        clientId: "legacy-client",
        clientSecret: "legacy-secret",
        redirectUrls: "https://example.com/callback",
      });
      await ctx.db.insert("oauthAccessToken", {
        accessToken: "legacy-access-token",
        refreshToken: "legacy-refresh-token",
        clientId: "legacy-client",
        scopes: "openid profile",
      });
      await ctx.db.insert("oauthAccessToken", {
        accessToken: "second-legacy-access-token",
        clientId: "legacy-client",
        scopes: "openid",
      });
      await ctx.db.insert("oauthConsent", {
        clientId: "legacy-client",
        userId: "user-1",
        scopes: "openid profile",
        consentGiven: true,
      });
      await ctx.db.insert("oauthConsent", {
        clientId: "legacy-client",
        userId: "user-2",
        scopes: "openid",
        consentGiven: true,
      });
    });

    const clients = await t.query(listLegacyOAuthApplications, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(clients.page).toEqual([
      expect.objectContaining({
        clientId: "legacy-client",
        redirectUrls: "https://example.com/callback",
        hadClientSecret: true,
      }),
    ]);
    expect(clients.page[0]).not.toHaveProperty("clientSecret");

    for (const table of [
      "oauthApplication",
      "oauthAccessToken",
      "oauthConsent",
    ] as const) {
      let cursor: string | null = null;
      let deleted = 0;
      do {
        const result: {
          deleted: number;
          isDone: boolean;
          continueCursor: string;
        } = await t.mutation(clearLegacyOAuthProviderRecords, {
          table,
          paginationOpts: { cursor, numItems: 1 },
        });
        deleted += result.deleted;
        cursor = result.isDone ? null : result.continueCursor;
        if (result.isDone) break;
      } while (cursor);
      expect(deleted).toBe(table === "oauthApplication" ? 1 : 2);
    }
    const remaining = await t.run(async (ctx) => ({
      applications: await ctx.db.query("oauthApplication").collect(),
      tokens: await ctx.db.query("oauthAccessToken").collect(),
      consents: await ctx.db.query("oauthConsent").collect(),
    }));
    expect(remaining).toEqual({ applications: [], tokens: [], consents: [] });
  });
});
