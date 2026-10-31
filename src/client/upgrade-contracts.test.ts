/// <reference types="vite/client" />
import { describe, it, expect, vi } from "vitest";
import { createSchema } from "./create-schema.js";
import { convex } from "../plugins/convex/index.js";
import { handleCrossDomainCallback } from "../react/cross-domain.js";

describe("upgrade adapter boundaries", () => {
  it("maps table-level indexes to stored field names while preserving declared order and input", async () => {
    const tables = {
      ledger: {
        modelName: "mapped",
        fields: {
          tenant: {
            type: "string" as const,
            fieldName: "tenantKey",
            required: true,
          },
          subject: {
            type: "string" as const,
            fieldName: "subjectKey",
            required: true,
          },
        },
        indexes: [
          {
            fields: ["tenant", "subject"] as [string, ...string[]],
            unique: true,
          },
        ],
      },
    };
    const original = structuredClone(tables);
    const { code } = await createSchema({ tables });
    expect(code).toContain("mapped: defineTable");
    expect(code).toContain(
      '.index("tenantKey_subjectKey", ["tenantKey","subjectKey"])'
    );
    expect(code).toContain("tenantKey: v.string()");
    expect(tables).toEqual(original);
  });

  it("query contexts return null from new atomic write methods without invoking database writes", async () => {
    const plugin = convex({
      authConfig: {
        providers: [{ domain: "https://example.com", applicationID: "convex" }],
      },
    });
    const hook = plugin.hooks.before[plugin.hooks.before.length - 1]!;
    const consume = vi.fn();
    const increment = vi.fn();
    const deleteSession = vi.fn();
    const ctx = {
      path: "/api-key/list",
      query: {},
      context: {
        adapter: {
          options: { isRunMutationCtx: false },
          consumeOne: consume,
          incrementOne: increment,
        },
        internalAdapter: { deleteSession },
      },
    };
    expect(hook.matcher(ctx as any)).toBe(true);
    const result = await hook.handler(ctx as any);
    expect(await ctx.context.adapter.consumeOne()).toBeNull();
    expect(await ctx.context.adapter.incrementOne()).toBeNull();
    await ctx.context.internalAdapter.deleteSession();
    expect(consume).not.toHaveBeenCalled();
    expect(increment).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      context: { query: { disableRefresh: true } },
    });
    expect(
      hook.matcher({
        context: { adapter: { options: { isRunMutationCtx: true } } },
      } as any)
    ).toBe(false);
  });

  it("a rejected OTT never fetches an authenticated session or announces a session update", async () => {
    const client = {
      useSession: () => ({ data: null, isPending: false }),
      convex: { token: vi.fn() },
      crossDomain: {
        oneTimeToken: {
          verify: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "invalid token" },
          }),
        },
      },
      getSession: vi.fn(),
      updateSession: vi.fn(),
    };
    const replace = vi.fn();
    await handleCrossDomainCallback(
      client,
      "https://example.com/callback?ott=invalid&next=%2Fsettings#anchor",
      replace
    );
    expect(client.getSession).not.toHaveBeenCalled();
    expect(client.updateSession).not.toHaveBeenCalled();
    expect(replace.mock.calls[0][0].href).toBe(
      "https://example.com/callback?next=%2Fsettings#anchor"
    );
  });
});
