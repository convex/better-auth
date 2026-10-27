/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import type { FunctionReference, GenericQueryCtx } from "convex/server";
import schema from "../component/schema.js";
import { api } from "../component/_generated/api.js";
import { createClient } from "./create-client.js";

const component = { adapter: api.adapter, session: api.session } as any;

const sessionApiClient = createClient(component);
const adapterClient = createClient(component, { local: { schema } });

const setup = async () => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("user", {
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const goneUserId = await ctx.db.insert("user", {
      name: "Gone",
      email: "gone@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.delete("user", goneUserId);
    const session = (expiresAt: number, token: string, user: string) =>
      ctx.db.insert("session", {
        expiresAt,
        token,
        userId: user,
        ipAddress: "203.0.113.7",
        createdAt: now,
        updatedAt: now,
      });
    const liveSessionId = await session(now + 60_000, "live", userId);
    const expiredSessionId = await session(now - 60_000, "expired", userId);
    const goneUserSessionId = await session(
      now + 60_000,
      "gone-user",
      goneUserId
    );
    const deletedSessionId = await session(now + 60_000, "deleted", userId);
    await ctx.db.delete("session", deletedSessionId);
    return {
      userId,
      goneUserId,
      liveSessionId,
      expiredSessionId,
      goneUserSessionId,
      deletedSessionId,
    };
  });
  return { t, ids };
};

const recordingQueries = (ctx: GenericQueryCtx<any>) => {
  const called: string[] = [];
  const runQuery = (ref: FunctionReference<"query", any>, args: any) => {
    called.push(getFunctionName(ref));
    return ctx.runQuery(ref, args);
  };
  return { ctx: { ...ctx, auth: ctx.auth, runQuery } as any, called };
};

describe("createSessionApi", () => {
  it("safeGetAuthUser matches the adapter path for every session state", async () => {
    const { t, ids } = await setup();
    const identities = {
      live: { sessionId: ids.liveSessionId, subject: ids.userId },
      expired: { sessionId: ids.expiredSessionId, subject: ids.userId },
      deletedSession: { sessionId: ids.deletedSessionId, subject: ids.userId },
      deletedUser: {
        sessionId: ids.goneUserSessionId,
        subject: ids.goneUserId,
      },
    };
    for (const [name, identity] of Object.entries(identities)) {
      const asUser = t.withIdentity(identity);
      const light = await asUser.run((ctx) =>
        sessionApiClient.safeGetAuthUser(ctx as any)
      );
      const adapter = await asUser.run((ctx) =>
        adapterClient.safeGetAuthUser(ctx as any)
      );
      expect(light, name).toEqual(adapter);
      expect(light?._id, name).toBe(name === "live" ? ids.userId : undefined);
    }
    expect(
      await t.run(
        async (ctx) =>
          (await sessionApiClient.safeGetAuthUser(ctx as any)) === undefined
      )
    ).toBe(true);
  });

  it("getAuthUser resolves the session and user in one component call", async () => {
    const { t, ids } = await setup();
    const result = await t
      .withIdentity({ sessionId: ids.liveSessionId, subject: ids.userId })
      .run(async (ctx) => {
        const recorded = recordingQueries(ctx);
        const user = await sessionApiClient.getAuthUser(recorded.ctx);
        return { userId: user._id, called: recorded.called };
      });
    expect(result).toEqual({
      userId: ids.userId,
      called: ["session:getSessionUser"],
    });
  });

  it("a local install keeps the adapter unless it opts in", async () => {
    const { t, ids } = await setup();
    const identity = { sessionId: ids.liveSessionId, subject: ids.userId };
    const optedIn = createClient(component, {
      local: { schema, sessionApi: true },
    });
    const called = await t.withIdentity(identity).run(async (ctx) => {
      const viaAdapter = recordingQueries(ctx);
      await adapterClient.getAuthUser(viaAdapter.ctx);
      const viaSessionApi = recordingQueries(ctx);
      await optedIn.getAuthUser(viaSessionApi.ctx);
      return { adapter: viaAdapter.called, sessionApi: viaSessionApi.called };
    });
    expect(called).toEqual({
      adapter: ["adapter:findOne", "adapter:findOne"],
      sessionApi: ["session:getSessionUser"],
    });
  });

  it("getHeaders matches the adapter path", async () => {
    const { t, ids } = await setup();
    for (const sessionId of [ids.liveSessionId, ids.deletedSessionId]) {
      const asUser = t.withIdentity({ sessionId, subject: ids.userId });
      const light = await asUser.run(async (ctx) => [
        ...(await sessionApiClient.getHeaders(ctx as any)).entries(),
      ]);
      const adapter = await asUser.run(async (ctx) => [
        ...(await adapterClient.getHeaders(ctx as any)).entries(),
      ]);
      expect(light).toEqual(adapter);
    }
    const live = await t
      .withIdentity({ sessionId: ids.liveSessionId, subject: ids.userId })
      .run(async (ctx) =>
        Object.fromEntries(
          (await sessionApiClient.getHeaders(ctx as any)).entries()
        )
      );
    expect(live).toEqual({
      authorization: "Bearer live",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("getAnyUserById matches the adapter for user ids", async () => {
    const { t, ids } = await setup();
    for (const id of [ids.userId, ids.goneUserId]) {
      const light = await t.run((ctx) =>
        sessionApiClient.getAnyUserById(ctx as any, id)
      );
      const adapter = await t.run((ctx) =>
        adapterClient.getAnyUserById(ctx as any, id)
      );
      expect(light).toEqual(adapter);
    }
  });

  it("getAnyUserById only returns documents from the user table", async () => {
    const { t, ids } = await setup();
    const result = await t.run((ctx) =>
      sessionApiClient.getAnyUserById(ctx as any, ids.liveSessionId)
    );
    expect(result).toBeNull();
  });
});
