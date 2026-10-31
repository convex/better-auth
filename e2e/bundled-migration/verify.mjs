import fs from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const managedSchema = fs.readFileSync("managed-schema-original.ts.txt", "utf8");
const oldSchema = fs.readFileSync("legacy-schema.ts.txt", "utf8");
const backendUrl = process.env.CONVEX_TEST_BACKEND_URL;
assert(backendUrl, "Run the migration fixture through the backend harness");
function deploy(label) {
  const result = spawnSync(
    "../node_modules/.bin/convex",
    [
      "deploy",
      "--url",
      backendUrl,
      "--admin-key",
      process.env.CONVEX_ADMIN_KEY,
      "--typecheck",
      "enable",
      "-y",
    ],
    { encoding: "utf8", env: process.env }
  );
  fs.appendFileSync(
    "bundled-deploy.log",
    `\n${label}\n` + result.stdout + result.stderr
  );
  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-4000));
  console.log("BUNDLED DEPLOY", label);
}
const client = new ConvexHttpClient(backendUrl);
const read = (operation, args, empty = false) =>
  client.query(makeFunctionReference("probe:read"), { operation, args, empty });
const write = async (operation, args, empty = false) => {
  // Large indexed fixtures consume write throughput; do not test burst rate here.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return client.mutation(makeFunctionReference("probe:write"), {
    operation,
    args,
    empty,
  });
};

const user = (name, username) => ({
  name,
  email: `${name}@example.com`,
  emailVerified: false,
  createdAt: 0,
  updatedAt: 0,
  ...(username === undefined ? {} : { username }),
});
const nullArgs = { model: "user", where: [{ field: "username", value: null }] };
async function rows() {
  const result = [];
  let cursor = null;
  for (let i = 0; i < 100; i++) {
    const page = await read("findMany", {
      ...nullArgs,
      paginationOpts: { cursor, numItems: 2 },
    });
    result.push(...page.page);
    if (page.isDone) return result;
    assert.notEqual(page.continueCursor, cursor);
    cursor = page.continueCursor;
  }
  throw Error("Pages did not finish");
}
try {
  fs.writeFileSync("../src/component/schema.ts", oldSchema);
  deploy("supported 1.6 schema");
  await write("seed", {
    rows: Array.from({ length: 12 }, (_, i) =>
      user(`legacy-${i}`, i === 10 ? null : i === 11 ? "present" : undefined)
    ),
  });
  await write("seedLarge", { bytes: 600_000, name: "large" });
  // Test a valid indexed value close to the document-size boundary.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await write("seedLarge", { bytes: 1_048_300, name: "near-limit" });
  await write("seed", {
    model: "oauthApplication",
    rows: [
      {
        name: "legacy-client",
        clientId: "legacy-client",
        clientSecret: "private-test-secret",
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  });
  await write("seed", {
    model: "account",
    rows: [
      {
        accountId: "legacy-user",
        providerId: "credential",
        userId: "legacy-user",
        password: "existing-hash",
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  });
  await write("seed", {
    model: "session",
    rows: [
      {
        userId: "legacy-user",
        token: "existing-token",
        expiresAt: 100000,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  });
  const beforeAccount = await read("inspect", { model: "account" });
  const beforeSession = await read("inspect", { model: "session" });
  const before = await read("inspect", { model: "user" });
  assert.equal(before.length, 14);
  fs.writeFileSync("../src/component/schema.ts", managedSchema);
  deploy("updated schema with preserved documents");
  const after = await read("inspect", { model: "user" });
  assert.deepEqual(after, before);
  assert.deepEqual(await read("inspect", { model: "account" }), beforeAccount);
  assert.deepEqual(await read("inspect", { model: "session" }), beforeSession);
  assert(after.every((doc) => !("betterAuthNullIndexes" in doc)));
  assert.equal((await rows()).length, 1);
  assert.equal(new Set((await rows()).map((doc) => doc._id)).size, 1);
  console.log(
    "BUNDLED PASS: populated upgrade preserves every document byte, including 600k and near-1MiB indexed values; explicit-null pagination remains available"
  );
  assert.equal(
    (
      await read(
        "findMany",
        { ...nullArgs, paginationOpts: { cursor: null, numItems: 1 } },
        true
      )
    ).page.length,
    0
  );
  // Use the fresh component so this unique username can transition to null
  // without colliding with the explicit-null legacy fixture in bundledAuth.
  const created = await write(
    "create",
    {
      input: { model: "user", data: user("new-large", "y".repeat(600_000)) },
    },
    true
  );
  assert.equal(created.username.length, 600_000);
  const updated = await write(
    "updateOne",
    {
      input: {
        model: "user",
        where: [{ field: "_id", value: created._id }],
        update: { username: null },
      },
    },
    true
  );
  assert.equal(updated.username, null);
  assert.equal(
    (
      await read(
        "findMany",
        { ...nullArgs, paginationOpts: { cursor: null, numItems: 2 } },
        true
      )
    ).page.length,
    1
  );
  await write(
    "deleteOne",
    {
      input: { model: "user", where: [{ field: "_id", value: created._id }] },
    },
    true
  );
  assert.equal(
    (
      await read(
        "findMany",
        { ...nullArgs, paginationOpts: { cursor: null, numItems: 2 } },
        true
      )
    ).page.length,
    0
  );
  assert.equal((await rows()).length, 1);
  const near = before.find((doc) => doc.name === "near-limit");
  const nearUpdated = await write("updateOne", {
    input: {
      model: "user",
      where: [{ field: "_id", value: near._id }],
      update: { updatedAt: 1 },
    },
  });
  assert.equal(nearUpdated.username, near.username);
  const exported = await read("legacyExport", {
    paginationOpts: { cursor: null, numItems: 10 },
  });
  assert(!JSON.stringify(exported).includes("private-test-secret"));
  console.log(
    "BUNDLED PASS: large-value create/update/delete, near-limit update, fresh installation, and sanitized legacy client export"
  );
} finally {
  fs.writeFileSync("../src/component/schema.ts", managedSchema);
}
