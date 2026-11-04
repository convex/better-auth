import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

const SITE_URL = "https://happy-animal-123.convex.site";
process.env.CONVEX_SITE_URL = SITE_URL;

const authConfig = {
  providers: [{ applicationID: "convex", domain: SITE_URL }],
} satisfies AuthConfig;

const makeAuth = async (generateId?: "uuid") => {
  // Imported after CONVEX_SITE_URL is set.
  const { convex } = await import("./index.js");
  const logs: { level: string; message: string }[] = [];
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-very-long-test-secret-that-is-at-least-32-chars",
    logger: {
      log: (level, message) => {
        logs.push({ level, message });
      },
    },
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
    }),
    ...(generateId ? { advanced: { database: { generateId } } } : {}),
    plugins: [convex({ authConfig })],
  });
  await auth.$context;
  return logs;
};

// Convex assigns document ids, and in "uuid" mode Better Auth drops the ids
// it reserves verification values by before the adapter sees them, so the
// single-use locks built on them aren't enforced.
describe("generateId uuid", () => {
  it("warns when the option is set", async () => {
    const logs = await makeAuth("uuid");
    expect(
      logs.filter(
        (log) =>
          log.level === "warn" &&
          /generateId: "uuid" has no effect/.test(log.message)
      )
    ).toHaveLength(1);
  });

  it("stays quiet otherwise", async () => {
    const logs = await makeAuth();
    expect(logs.filter((log) => /generateId/.test(log.message))).toEqual([]);
  });
});
