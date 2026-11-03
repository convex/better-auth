import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt as jwtPlugin } from "better-auth/plugins/jwt";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { getAuthConfigProvider } from "../../auth-config.js";

const SITE_URL = "https://happy-animal-123.convex.site";
process.env.CONVEX_SITE_URL = SITE_URL;

const PASSWORD = "correct horse battery staple";

type Order = "convex,jwt" | "jwt,convex";

// Both plugins keep their keys in the shared jwks table. The auth config
// expects RS256; Better Auth's jwt plugin mints EdDSA by default.
const makeAuth = async (order: Order) => {
  // Imported after CONVEX_SITE_URL is set.
  const { convex } = await import("./index.js");
  const db: Record<string, any[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };
  const convexPlugin = convex({
    authConfig: { providers: [getAuthConfigProvider()] },
  });
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-very-long-test-secret-that-is-at-least-32-chars",
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    // The memory adapter has no Convex ctx; mark it as a mutation ctx so the
    // Convex plugin's query-context before hook doesn't no-op writes.
    database: (options: any) => {
      const adapter = memoryAdapter(db)(options);
      return {
        ...adapter,
        options: { ...(adapter as any).options, isRunMutationCtx: true },
      };
    },
    plugins:
      order === "convex,jwt"
        ? [convexPlugin, jwtPlugin()]
        : [jwtPlugin(), convexPlugin],
  });
  const { headers } = await auth.api.signUpEmail({
    body: { email: "user@example.com", password: PASSWORD, name: "Test" },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const get = (path: string) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        headers: { cookie },
      })
    );
  return { auth, db, get };
};

describe("convex plugin next to Better Auth's jwt plugin", () => {
  // Either plugin may create the first key in the shared jwks table
  for (const order of ["convex,jwt", "jwt,convex"] as const) {
    for (const firstKey of ["/convex/jwks", "/jwks"]) {
      it(`keeps both plugins working with ${order}, first key from ${firstKey}`, async () => {
        const { get } = await makeAuth(order);
        expect((await get(firstKey)).status).toBe(200);
        for (const path of [
          "/convex/token",
          "/convex/jwks",
          "/convex/.well-known/openid-configuration",
          "/token",
          "/jwks",
        ]) {
          const res = await get(path);
          expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
        }
        // Convex only accepts the algorithm in its auth config
        const convexJwks = await (await get("/convex/jwks")).json();
        expect(convexJwks.keys.map((k: { alg: string }) => k.alg)).toEqual([
          "RS256",
        ]);
        const { token: convexToken } = await (
          await get("/convex/token")
        ).json();
        expect(decodeProtectedHeader(convexToken).alg).toBe("RS256");
        await expect(
          jwtVerify(convexToken, createLocalJWKSet(convexJwks), {
            algorithms: ["RS256"],
          })
        ).resolves.toBeTruthy();
        // The jwt plugin keeps working with its own JWKS
        const { token } = await (await get("/token")).json();
        await expect(
          jwtVerify(token, createLocalJWKSet(await (await get("/jwks")).json()))
        ).resolves.toBeTruthy();
      });
    }
  }

  it("sets the get-session JWT cookie with the configured algorithm", async () => {
    const { get } = await makeAuth("jwt,convex");
    // The jwt plugin's EdDSA key is the only key in the table
    expect((await get("/jwks")).status).toBe(200);
    const session = await get("/get-session");
    const jwtCookie = /better-auth\.convex_jwt=([^;]*)/.exec(
      session.headers.getSetCookie().join("\n")
    )?.[1];
    expect(jwtCookie).toMatch(/^ey/);
    expect(decodeProtectedHeader(jwtCookie!).alg).toBe("RS256");
  });

  it("rotates and exports only the Convex keys", async () => {
    const { auth, db, get } = await makeAuth("jwt,convex");
    await get("/jwks");
    await get("/convex/token");
    const otherKeys = () =>
      (db.jwks as { id: string; alg: string }[])
        .filter((k) => k.alg !== "RS256")
        .map((k) => k.id);
    const before = otherKeys();
    expect(before).toHaveLength(1);
    const rotated = await auth.api.rotateKeys();
    expect(otherKeys()).toEqual(before);
    expect(rotated).toHaveLength(1);
    expect(rotated[0].alg).toBe("RS256");
    expect(db.jwks.filter((k) => k.alg === "RS256")).toHaveLength(1);
    // A newer key of the jwt plugin isn't exported as the Convex key
    db.jwks.push({
      ...db.jwks.find((k: { alg: string }) => k.alg !== "RS256"),
      id: "newer-eddsa",
      createdAt: new Date(Date.now() + 60_000),
    });
    const latest = await auth.api.getLatestJwks();
    expect(latest[0].id).toBe(rotated[0].id);
    expect(latest[0].alg).toBe("RS256");
  });
});
