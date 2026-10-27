/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentApi } from "../component/_generated/component.js";
import schema from "../component/schema.js";

type DeleteMany = ComponentApi["adapter"]["deleteMany"];
const deleteMany = makeFunctionReference<
  "mutation",
  FunctionArgs<DeleteMany>,
  FunctionReturnType<DeleteMany>
>("adapter:deleteMany");

describe("rate limit cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the lastRequest index for range deletion", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimit", {
        key: "expired",
        count: 1,
        lastRequest: 100,
      });
      await ctx.db.insert("rateLimit", {
        key: "current",
        count: 1,
        lastRequest: 300,
      });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await t.mutation(deleteMany, {
      input: {
        model: "rateLimit",
        where: [{ field: "lastRequest", operator: "lt", value: 200 }],
      },
      paginationOpts: { cursor: null, numItems: 100 },
    });

    expect(result.count).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    await expect(
      t.run((ctx) => ctx.db.query("rateLimit").collect())
    ).resolves.toMatchObject([{ key: "current", lastRequest: 300 }]);
  });
});
