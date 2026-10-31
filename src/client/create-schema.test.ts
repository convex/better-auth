import { describe, expect, it } from "vitest";
import type { BetterAuthDBSchema } from "better-auth/db";
import { createSchema } from "./create-schema.js";

describe("createSchema", () => {
  it("generates the Better Auth credential account lookup index", async () => {
    const tables = {
      account: {
        modelName: "account",
        fields: {
          userId: {
            type: "string",
            required: true,
            references: { field: "id", model: "user" },
          },
          providerId: { type: "string", required: true },
          accountId: { type: "string", required: true },
        },
      },
    } satisfies BetterAuthDBSchema;

    const { code } = await createSchema({ tables });

    expect(code).toContain(
      '.index("userId_providerId_accountId", ["userId","providerId","accountId"])'
    );
    expect(code).toContain('.index("userId", ["userId"])');
  });

  it("generates table-level compound indexes without mutating their order", async () => {
    const indexFields = ["issuer", "accountId"] as [string, ...string[]];
    const tables = {
      account: {
        modelName: "account",
        fields: {
          issuer: { type: "string", required: true },
          accountId: { type: "string", required: true },
        },
        indexes: [{ fields: indexFields, unique: true }],
      },
    } satisfies BetterAuthDBSchema;

    const { code } = await createSchema({ tables });

    expect(code).toContain(
      '.index("issuer_accountId", ["issuer","accountId"])'
    );
    expect(indexFields).toEqual(["issuer", "accountId"]);
  });

  it("does not add a standalone index covered by a compound prefix", async () => {
    const tables = {
      user: {
        modelName: "user",
        fields: {
          email: { type: "string", required: true, unique: true },
          name: { type: "string", required: true },
        },
      },
    } satisfies BetterAuthDBSchema;

    const { code } = await createSchema({ tables });

    expect(code).toContain('.index("email_name", ["email","name"])');
    expect(code).not.toContain('.index("email", ["email"])');
  });

  it("keeps reversed compound indexes distinct", async () => {
    const tables = {
      account: {
        modelName: "account",
        fields: {
          issuer: { type: "string", required: true },
          accountId: { type: "string", required: true },
        },
        indexes: [
          { fields: ["issuer", "accountId"], unique: true },
          { fields: ["accountId", "issuer"], unique: false },
        ],
      },
    } satisfies BetterAuthDBSchema;

    const { code } = await createSchema({ tables });

    expect(code).toContain(
      '.index("issuer_accountId", ["issuer","accountId"])'
    );
    expect(code).toContain(
      '.index("accountId_issuer", ["accountId","issuer"])'
    );
  });
});

describe("generated index name collisions", () => {
  const indexesFrom = (code: string) =>
    [...code.matchAll(/\.index\("([^"]+)", (\[[^\n]+?\])\)/g)].map(
      ([, name, fields]) => ({ name, fields: JSON.parse(fields!) as string[] })
    );
  const fields = {
    tenant_id: { type: "string" as const, required: true },
    subject: { type: "string" as const, required: true },
    tenant: { type: "string" as const, required: true },
    id_subject: { type: "string" as const, required: true },
  };

  it.each([false, true])(
    "keeps distinct tuples with colliding names (explicit names: %s)",
    async (named) => {
      const tables: BetterAuthDBSchema = {
        custom: {
          modelName: "custom",
          fields,
          indexes: [
            {
              fields: ["tenant_id", "subject"],
              ...(named ? { name: "first" } : {}),
            },
            {
              fields: ["tenant", "id_subject"],
              ...(named ? { name: "second" } : {}),
            },
            { fields: ["tenant_id", "subject"] },
          ],
        },
      };
      const original = structuredClone(tables);
      const result = await createSchema({ tables });
      expect(indexesFrom(result.code)).toEqual([
        { name: "tenant_id_subject", fields: ["tenant_id", "subject"] },
        { name: "tenant_id_subject_2", fields: ["tenant", "id_subject"] },
      ]);
      expect((await createSchema({ tables })).code).toBe(result.code);
      expect(tables).toEqual(original);
    }
  );

  it("reserves natural names before allocating suffixes, including special-field indexes", async () => {
    const tables: BetterAuthDBSchema = {
      custom: {
        modelName: "custom",
        fields: {
          ...fields,
          tenant_id_subject_2: { type: "string", unique: true },
          tenant_id_subject_3: { type: "string", unique: true },
        },
        indexes: [
          { fields: ["tenant_id", "subject"] },
          { fields: ["tenant", "id_subject"] },
        ],
      },
    };
    expect(indexesFrom((await createSchema({ tables })).code)).toEqual([
      { name: "tenant_id_subject", fields: ["tenant_id", "subject"] },
      { name: "tenant_id_subject_4", fields: ["tenant", "id_subject"] },
      { name: "tenant_id_subject_2", fields: ["tenant_id_subject_2"] },
      { name: "tenant_id_subject_3", fields: ["tenant_id_subject_3"] },
    ]);
  });

  it("handles stored-field aliases and scopes names to each table", async () => {
    const table = {
      modelName: "first",
      fields: {
        a: { type: "string" as const, fieldName: "tenant_id" },
        b: { type: "string" as const, fieldName: "subject" },
        c: { type: "string" as const, fieldName: "tenant" },
        d: { type: "string" as const, fieldName: "id_subject" },
      },
      indexes: [
        { fields: ["a", "b"] as [string, ...string[]] },
        { fields: ["c", "d"] as [string, ...string[]] },
      ],
    };
    expect(
      indexesFrom(
        (
          await createSchema({
            tables: { first: table, second: { ...table, modelName: "second" } },
          })
        ).code
      )
    ).toEqual([
      { name: "tenant_id_subject", fields: ["tenant_id", "subject"] },
      { name: "tenant_id_subject_2", fields: ["tenant", "id_subject"] },
      { name: "tenant_id_subject", fields: ["tenant_id", "subject"] },
      { name: "tenant_id_subject_2", fields: ["tenant", "id_subject"] },
    ]);
  });
});

it("assigns distinct suffixes to three different tuples with the same natural name", async () => {
  const { code } = await createSchema({
    tables: {
      custom: {
        modelName: "custom",
        fields: Object.fromEntries(
          ["a_b", "c", "a", "b_c", "a_b_c"].map((field) => [
            field,
            { type: "string" as const },
          ])
        ),
        indexes: [
          { fields: ["a_b", "c"] },
          { fields: ["a", "b_c"] },
          { fields: ["a_b_c"] },
        ],
      },
    },
  });
  expect(code).toContain('.index("a_b_c", ["a_b","c"])');
  expect(code).toContain('.index("a_b_c_2", ["a","b_c"])');
  expect(code).toContain('.index("a_b_c_3", ["a_b_c"])');
});

it("bounds collision names at 64 characters while preserving reserved natural suffixes", async () => {
  const a = "a".repeat(20),
    b = "b".repeat(20),
    c = "c".repeat(22);
  const natural = `${a}_${b}_${c}`;
  const reserved2 = natural.slice(0, 62) + "_2",
    reserved3 = natural.slice(0, 62) + "_3";
  const fields = Object.fromEntries(
    [`${a}_${b}`, c, a, `${b}_${c}`].map((field) => [
      field,
      { type: "string" as const, required: true },
    ])
  );
  const tables = {
    custom: {
      modelName: "custom",
      fields: {
        ...fields,
        [reserved2]: { type: "string" as const, unique: true },
        [reserved3]: { type: "string" as const, unique: true },
      },
      indexes: [
        { fields: [`${a}_${b}`, c] as [string, ...string[]] },
        { fields: [a, `${b}_${c}`] as [string, ...string[]] },
      ],
    },
  };
  const { code } = await createSchema({ tables });
  const names = [...code.matchAll(/\.index\("([^"]+)"/g)].map((m) => m[1]);
  expect(names).toEqual([
    natural,
    natural.slice(0, 62) + "_4",
    reserved2,
    reserved3,
  ]);
  expect(names.every((name) => name.length <= 64)).toBe(true);
  expect((await createSchema({ tables })).code).toBe(code);
});

it("shortens overlong natural names without stealing valid 64-character names", async () => {
  const a = "a".repeat(40),
    b = "b".repeat(30),
    c = "b".repeat(29) + "c";
  const prefix = `${a}_${b}`.slice(0, 64),
    reserved = prefix.slice(0, 62) + "_2";
  const fields = Object.fromEntries(
    [a, b, c].map((field) => [
      field,
      { type: "string" as const, required: true },
    ])
  );
  const tables = {
    custom: {
      modelName: "custom",
      fields: {
        ...fields,
        [prefix]: { type: "string" as const, unique: true },
        [reserved]: { type: "string" as const, unique: true },
      },
      indexes: [
        { fields: [a, b] as [string, ...string[]] },
        { fields: [a, c] as [string, ...string[]] },
      ],
    },
  };
  const { code } = await createSchema({ tables });
  const names = [...code.matchAll(/\.index\("([^"]+)"/g)].map((m) => m[1]);
  expect(names).toHaveLength(4);
  expect(new Set(names).size).toBe(4);
  expect(names.every((name) => name.length <= 64)).toBe(true);
  expect(names.slice(2)).toEqual([prefix, reserved]);
  expect((await createSchema({ tables })).code).toBe(code);
});
