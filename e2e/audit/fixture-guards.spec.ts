import { expect, test } from "@playwright/test";
import {
  seed as componentSeed,
  trigger,
} from "../convex/auditComponent/fixtures";

const fixtures = [
  [componentSeed, { model: "user", rows: [] }],
  [trigger, { model: "user" }],
] as const;

test("fixture mutations reject non-local targets before reading or writing", async () => {
  const previous = process.env.CONVEX_SITE_URL;
  try {
    process.env.CONVEX_SITE_URL = "https://example.invalid";
    for (const [fixture, args] of fixtures) {
      const handler = (
        fixture as unknown as {
          _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        }
      )._handler;
      await expect(handler({}, args)).rejects.toThrow(
        "Disposable local audit only"
      );
    }
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previous;
  }
});

test("fixture mutations accept the disposable local target", async () => {
  const previous = process.env.CONVEX_SITE_URL;
  const db = {
    query: () => ({ collect: async () => [], take: async () => [] }),
    insert: async () => undefined,
  };
  try {
    process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
    for (const [fixture, args] of fixtures) {
      const handler = (
        fixture as unknown as {
          _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        }
      )._handler;
      await expect(handler({ db }, args)).resolves.not.toThrow();
    }
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previous;
  }
});
