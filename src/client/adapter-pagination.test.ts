/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";

/**
 * Regression test for get-convex/better-auth#392: count() is an unlimited
 * paginated findMany and must terminate over result sets larger than the
 * 200-row page size. The runQuery cap turns a non-terminating loop into a
 * fast, clear failure instead of running to the function's wall-clock limit,
 * so the test never hangs CI when the bug regresses.
 */
describe("count() pagination", () => {
  it("terminates over more than 200 rows", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    let paginatedQueries = 0;
    const ctx = {
      runMutation: t.mutation.bind(t),
      runQuery: async (...args: any[]) => {
        paginatedQueries += 1;
        if (paginatedQueries > 50) {
          throw new Error(
            `count() issued ${paginatedQueries} paginated queries without terminating (infinite pagination loop)`
          );
        }
        return (t.query as any)(...args);
      },
    } as any;

    // `.adapter(ctx)` returns a Better Auth adapter factory; resolve it with
    // options (the Convex adapter generates ids itself, so empty options are
    // enough to expose the core `user` model).
    const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    }).adapter(ctx)({} as BetterAuthOptions);

    for (let i = 0; i < 201; i++) {
      await adapter.create({
        model: "user",
        data: { name: `foo${i}`, email: `foo${i}@bar.com` },
      });
    }
    paginatedQueries = 0; // count only the pagination queries
    expect(await adapter.count({ model: "user" })).toBe(201);
  });
});
