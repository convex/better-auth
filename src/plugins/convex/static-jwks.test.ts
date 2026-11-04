import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

const SITE_URL = "https://happy-animal-123.convex.site";
process.env.CONVEX_SITE_URL = SITE_URL;

// A stored jwks row as `npx convex run auth:rotateKeys` prints it. Rotation
// never reads the static key, so its material is irrelevant here.
const STATIC_JWKS = JSON.stringify([
  { id: "k1", publicKey: "{}", privateKey: "{}", createdAt: 0, alg: "RS256" },
]);
const authConfig = {
  providers: [
    {
      type: "customJwt",
      applicationID: "convex",
      issuer: SITE_URL,
      algorithm: "RS256",
      jwks: `data:text/plain;base64,${btoa(STATIC_JWKS)}`,
    },
  ],
} as unknown as AuthConfig;

const makeAuth = async () => {
  // Imported after CONVEX_SITE_URL is set.
  const { convex } = await import("./index.js");
  const db: Record<string, any[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-very-long-test-secret-that-is-at-least-32-chars",
    logger: { disabled: true },
    database: (options: any) => {
      const adapter = memoryAdapter(db)(options);
      return {
        ...adapter,
        options: { ...(adapter as any).options, isRunMutationCtx: true },
      };
    },
    plugins: [convex({ authConfig, jwks: STATIC_JWKS })],
  });
  return { auth: auth as any, db };
};

describe("convex plugin key rotation with a static JWKS", () => {
  it("rotateKeys writes a new key to the database and returns it", async () => {
    const { auth, db } = await makeAuth();
    const rotated = await auth.api.rotateKeys();
    expect(rotated).toHaveLength(1);
    expect(rotated[0].alg).toBe("RS256");
    expect(db.jwks).toHaveLength(1);
    expect(rotated[0].id).toBe(db.jwks[0].id);
  });

  it("getLatestJwks creates a key when the table is empty", async () => {
    const { auth, db } = await makeAuth();
    const latest = await auth.api.getLatestJwks();
    expect(latest).toHaveLength(1);
    expect(latest[0].alg).toBe("RS256");
    expect(db.jwks).toHaveLength(1);
  });
});
