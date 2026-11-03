/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth";
import { jwt as jwtPlugin } from "better-auth/plugins/jwt";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { internal } from "../../component/_generated/api.js";
import schema from "../../component/testProfiles/schema.profile-plugin-table.js";
import { createClient } from "../../client/index.js";
import type { DataModel } from "../../component/_generated/dataModel.js";
import { getAuthConfigProvider } from "../../auth-config.js";

const SITE_URL = "https://happy-animal-123.convex.site";
process.env.CONVEX_SITE_URL = SITE_URL;

const PASSWORD = "correct horse battery staple";

// The same flows as jwt-plugin.test.ts, through the real Convex adapter
// (convex-test), which stores dates as numbers and maps id to _id.
const makeAuth = async (opts?: {
  jwksRotateOnTokenGenerationError?: boolean;
}) => {
  const { convex } = await import("./index.js");
  const t = convexTest(schema, import.meta.glob("../../component/**/*.*s"));
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as any;
  const client = createClient<DataModel>(
    { adapter: (internal as any).adapter },
    { verbose: false }
  );
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-very-long-test-secret-that-is-at-least-32-chars",
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    database: client.adapter(ctx),
    plugins: [
      jwtPlugin(),
      convex({
        authConfig: { providers: [getAuthConfigProvider()] },
        ...opts,
      }),
    ],
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
  const jwksRows = () =>
    t.run(async (ctx) => (await ctx.db.query("jwks").collect()) as any[]);
  return { auth, t, get, jwksRows };
};

describe("convex plugin next to the jwt plugin, on the Convex adapter", () => {
  it("signs RS256 and publishes, rotates and exports only RS256 keys", async () => {
    const { auth, get, jwksRows } = await makeAuth();
    // The jwt plugin mints the first (EdDSA) key
    expect((await get("/jwks")).status).toBe(200);
    expect((await jwksRows()).map((k) => k.alg)).toEqual(["EdDSA"]);

    const tokenRes = await get("/convex/token");
    expect(tokenRes.status, await tokenRes.clone().text()).toBe(200);
    const { token } = await tokenRes.json();
    expect(decodeProtectedHeader(token).alg).toBe("RS256");
    const convexJwks = await (await get("/convex/jwks")).json();
    expect(convexJwks.keys.map((k: { alg: string }) => k.alg)).toEqual([
      "RS256",
    ]);
    await expect(
      jwtVerify(token, createLocalJWKSet(convexJwks), { algorithms: ["RS256"] })
    ).resolves.toBeTruthy();
    // Dates come back as numbers from the adapter
    const rows = await jwksRows();
    expect(rows.map((k) => k.alg).sort()).toEqual(["EdDSA", "RS256"]);
    expect(rows.every((k) => typeof k.createdAt === "number")).toBe(true);

    const session = await get("/get-session");
    const jwtCookie = /better-auth\.convex_jwt=([^;]*)/.exec(
      session.headers.getSetCookie().join("\n")
    )?.[1];
    expect(decodeProtectedHeader(jwtCookie!).alg).toBe("RS256");

    const eddsaId = rows.find((k) => k.alg === "EdDSA")._id;
    const rotated = await auth.api.rotateKeys();
    expect(rotated).toHaveLength(1);
    expect(rotated[0].alg).toBe("RS256");
    expect(typeof rotated[0].createdAt).toBe("number");
    const after = await jwksRows();
    expect(after.map((k) => k.alg).sort()).toEqual(["EdDSA", "RS256"]);
    expect(after.find((k) => k.alg === "EdDSA")._id).toBe(eddsaId);
    expect(after.find((k) => k.alg === "RS256")._id).not.toBe(
      rows.find((k) => k.alg === "RS256")._id
    );
    const latest = await auth.api.getLatestJwks();
    expect(latest[0].id).toBe(after.find((k) => k.alg === "RS256")._id);
    expect(latest[0].alg).toBe("RS256");
    // Both plugins still sign after the rotation
    expect((await get("/convex/token")).status).toBe(200);
    expect((await get("/token")).status).toBe(200);
  });

  it("recovers from a legacy key of the wrong material with jwksRotateOnTokenGenerationError", async () => {
    const { t, get, jwksRows } = await makeAuth({
      jwksRotateOnTokenGenerationError: true,
    });
    // A 0.10-era key: EdDSA material stored without an alg
    expect((await get("/jwks")).status).toBe(200);
    const [legacy] = await jwksRows();
    await t.run(async (ctx) => {
      await ctx.db.patch(legacy._id, { alg: null });
    });
    const res = await get("/convex/token");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(decodeProtectedHeader((await res.json()).token).alg).toBe("RS256");
    const rows = await jwksRows();
    expect(rows.map((k) => k.alg)).toEqual(["RS256"]);
  });
});
