/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { options } from "../auth-options.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";

/**
 * `eq null` must match fields that were never written: Convex omits them and
 * the Better Auth 1.7 adapter factory drops undefined fields from input, so
 * optional fields are usually absent rather than null. These cases need
 * plugin models (twoFactor, username), so they run against the component's
 * own schema and options rather than the upstream adapter harness.
 */
describe("eq null guards on plugin fields", () => {
  const setup = () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    }).adapter(ctx)(options);
    return { adapter };
  };

  it("increments under an eq null guard on an unset numeric field", async () => {
    const { adapter } = setup();
    // Mirrors @better-auth/oauth-provider refresh-token rotation, which
    // increments under a `revoked eq null` guard on a never-set field.
    const user = await adapter.create({
      model: "user",
      data: { name: "foo", email: "foo@bar.com" },
    });
    const twoFactor = await adapter.create({
      model: "twoFactor",
      data: { secret: "secret", backupCodes: "codes", userId: user.id },
    });
    type TwoFactor = { id: string; failedVerificationCount: number };
    const where = [
      { field: "id", value: twoFactor.id },
      { field: "lockedUntil", value: null },
    ];
    const incremented = await adapter.incrementOne<TwoFactor>({
      model: "twoFactor",
      where,
      increment: { failedVerificationCount: 1 },
      set: {},
    });
    expect(incremented?.id).toBe(twoFactor.id);
    expect(incremented?.failedVerificationCount).toBe(1);
    await adapter.update({
      model: "twoFactor",
      where: [{ field: "id", value: twoFactor.id }],
      update: { lockedUntil: new Date() },
    });
    expect(
      await adapter.incrementOne<TwoFactor>({
        model: "twoFactor",
        where,
        increment: { failedVerificationCount: 1 },
        set: {},
      })
    ).toBeNull();
    expect(
      (
        await adapter.findOne<TwoFactor>({
          model: "twoFactor",
          where: [{ field: "id", value: twoFactor.id }],
        })
      )?.failedVerificationCount
    ).toBe(1);
  });

  it("does not take the unique-field shortcut for eq null", async () => {
    const { adapter } = setup();
    // `username` is unique and indexed. The single-document shortcut would
    // query the index for explicit nulls only and miss unset usernames.
    for (const name of ["a", "b"]) {
      await adapter.create({
        model: "user",
        data: { name, email: `${name}@bar.com` },
      });
    }
    await adapter.create({
      model: "user",
      data: { name: "c", email: "c@bar.com", username: null },
    });
    await adapter.create({
      model: "user",
      data: { name: "d", email: "d@bar.com", username: "d" },
    });
    expect(
      await adapter.count({
        model: "user",
        where: [{ field: "username", value: null }],
      })
    ).toBe(3);
    expect(
      await adapter.findMany<{ name: string }>({
        model: "user",
        where: [{ field: "username", operator: "ne", value: null }],
      })
    ).toMatchObject([{ name: "d" }]);
  });
});
