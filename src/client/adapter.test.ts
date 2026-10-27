/// <reference types="vite/client" />

import { describe, it } from "vitest";
import { convexTest } from "convex-test";
import {
  caseInsensitiveTestSuite,
  testAdapter,
  transactionsTestSuite,
} from "@better-auth/test-utils/adapter";
import type { BetterAuthOptions } from "better-auth";
import { internal } from "../component/_generated/api.js";
import schema from "../component/testProfiles/schema.profile-plugin-table.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import type { ComponentApi } from "../component/_generated/component.js";
import {
  additionalFieldsAuthFlowTestSuite,
  additionalFieldsNormalTestSuite,
  convexCustomTestSuite,
  coreAuthFlowTestSuite,
  coreNormalTestSuite,
  multiJoinsMissingRowsTestSuite,
  pluginTableNormalTestSuite,
  renameFieldAndJoinTestSuite,
  renameModelUserCustomTestSuite,
  renameModelUserTableTestSuite,
} from "../test/adapter-factory/index.js";

const MIN_NODE_MAJOR = 24;
const currentNodeMajor = Number.parseInt(
  process.versions.node.split(".")[0] ?? "0",
  10
);

const NORMAL_DISABLED_TESTS = [
  // dynamic-schema-plugin-table/dynamic-schema-additional-fields:
  // Convex validators are static in this harness, so runtime schema mutation
  // tests are validated in dedicated profiles instead.
  "create - should apply default values to fields",
  "create - should return null for nullable foreign keys",
  "create - should support arrays",
  "create - should support json",
  // convex-id-generation:
  // Convex controls generated IDs at write time.
  "create - should use generateId if provided",
  // offset-unsupported:
  // Convex adapter rejects offset pagination.
  "findMany - should be able to perform a complex limited join",
  "findMany - should find many models with limit and offset",
  "findMany - should find many models with offset",
  "findMany - should find many models with sortBy and limit and offset",
  "findMany - should find many models with sortBy and limit and offset and where",
  "findMany - should find many models with sortBy and offset",
  "findMany - should find many with both one-to-one and one-to-many joins",
  "findMany - should find many with join and offset",
  "findMany - should find many with join, where, limit, and offset",
  "findMany - should find many with one-to-one join",
  "findMany - should handle mixed joins correctly when some are missing",
  "findMany - should return empty array when base records don't exist with joins",
  "findMany - should return null for one-to-one join when joined records don't exist",
  "findMany - should select fields with one-to-one join",
  // profile-specific coverage:
  // These are intentionally exercised in dedicated profile suites.
  "findOne - backwards join with modified field name (session base, users-table join)",
  "findOne - multiple joins should return result even when some joined tables have no matching rows",
  "findOne - should find a model with modified field name",
  "findOne - should find a model with modified model name",
  "findOne - should join a model with modified field name",
  "findOne - should not apply defaultValue if value not found",
  "findOne - should return an object for one-to-one joins",
  "findOne - should return null for failed base model lookup that has joins",
  "findOne - should return null for one-to-one join when joined record doesn't exist",
  "findOne - should select fields with one-to-one join",
  "findOne - should work with both one-to-one and one-to-many joins",
] as const;

const toDisableMap = (testNames: readonly string[]) =>
  Object.fromEntries(testNames.map((testName) => [testName, true]));

const getOverrideBetterAuthOptions = (
  opts: BetterAuthOptions
): BetterAuthOptions => ({
  ...opts,
  advanced: {
    ...opts.advanced,
    database: {
      ...opts.advanced?.database,
      generateId: "uuid",
    },
  },
});

type AdapterModule = ComponentApi["adapter"];
type TestProfileName =
  | "adapterAdditionalFields"
  | "adapterPluginTable"
  | "adapterRenameField"
  | "adapterRenameUserCustom"
  | "adapterRenameUserTable"
  | "adapterOrganizationJoins";

type InternalWithTestProfiles = {
  adapter: AdapterModule;
  testProfiles: Record<TestProfileName, AdapterModule>;
};

if (currentNodeMajor < MIN_NODE_MAJOR) {
  describe("Better Auth Adapter Tests", () => {
    it.skip(`requires Node ${MIN_NODE_MAJOR}+ (adapter test-utils uses explicit resource management syntax)`, () => {});
  });
} else {
  describe("Better Auth Adapter Tests", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));

    // Bridge `convexAdapter`'s ctx surface to `convexTest`. Each adapter call
    // re-enters convex-test's AsyncLocalStorage frame via t.query / t.mutation,
    // which is required by convex-test ≥0.0.45. State persists across calls
    // because the test database lives on `t`, not in ALS.
    const wrappedCtx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;

    const internalWithTestProfiles =
      internal as unknown as InternalWithTestProfiles;
    const profileApi = (name: TestProfileName): { adapter: AdapterModule } => ({
      adapter: internalWithTestProfiles.testProfiles[name],
    });

    const baseProfileClient = createClient<DataModel>(
      { adapter: internalWithTestProfiles.adapter },
      { verbose: false }
    );
    const additionalFieldsProfileClient = createClient<DataModel>(
      profileApi("adapterAdditionalFields"),
      { verbose: false }
    );
    const pluginTableProfileClient = createClient<DataModel>(
      profileApi("adapterPluginTable"),
      { verbose: false }
    );
    const renameFieldProfileClient = createClient<DataModel>(
      profileApi("adapterRenameField"),
      { verbose: false }
    );
    const renameUserCustomProfileClient = createClient<DataModel>(
      profileApi("adapterRenameUserCustom"),
      { verbose: false }
    );
    const renameUserTableProfileClient = createClient<DataModel>(
      profileApi("adapterRenameUserTable"),
      { verbose: false }
    );
    const organizationJoinsProfileClient = createClient<DataModel>(
      profileApi("adapterOrganizationJoins"),
      { verbose: false }
    );

    const noMigrations = () => {
      // Convex schema is static — no migrations needed.
    };

    const { execute: executeBaseProfile } = await testAdapter({
      adapter: () => baseProfileClient.adapter(wrappedCtx),
      runMigrations: noMigrations,
      overrideBetterAuthOptions: getOverrideBetterAuthOptions,
      tests: [
        coreNormalTestSuite({
          disableTests: toDisableMap(NORMAL_DISABLED_TESTS),
        }),
        transactionsTestSuite({ disableTests: { ALL: true } }),
        coreAuthFlowTestSuite(),
        caseInsensitiveTestSuite(),
        convexCustomTestSuite(),
      ],
    });

    const { execute: executeAdditionalFieldsProfile } = await testAdapter({
      adapter: () => additionalFieldsProfileClient.adapter(wrappedCtx),
      runMigrations: noMigrations,
      overrideBetterAuthOptions: getOverrideBetterAuthOptions,
      prefixTests: "profile:additional-fields",
      tests: [
        additionalFieldsNormalTestSuite(),
        additionalFieldsAuthFlowTestSuite(),
      ],
    });

    const { execute: executePluginTableProfile } = await testAdapter({
      adapter: () => pluginTableProfileClient.adapter(wrappedCtx),
      runMigrations: noMigrations,
      overrideBetterAuthOptions: getOverrideBetterAuthOptions,
      prefixTests: "profile:plugin-table",
      tests: [pluginTableNormalTestSuite()],
    });

    const { execute: executeRenameFieldProfile } = await testAdapter({
      adapter: () => renameFieldProfileClient.adapter(wrappedCtx),
      runMigrations: noMigrations,
      overrideBetterAuthOptions: getOverrideBetterAuthOptions,
      prefixTests: "profile:rename-field-join",
      tests: [renameFieldAndJoinTestSuite()],
    });

    const { execute: executeRenameUserCustomProfile } = await testAdapter({
      adapter: () => renameUserCustomProfileClient.adapter(wrappedCtx),
      runMigrations: noMigrations,
      overrideBetterAuthOptions: getOverrideBetterAuthOptions,
      prefixTests: "profile:rename-user-custom",
      tests: [renameModelUserCustomTestSuite()],
    });

    const { execute: executeRenameUserTableProfile } = await testAdapter({
      adapter: () => renameUserTableProfileClient.adapter(wrappedCtx),
      runMigrations: noMigrations,
      overrideBetterAuthOptions: getOverrideBetterAuthOptions,
      prefixTests: "profile:rename-user-table",
      tests: [renameModelUserTableTestSuite()],
    });

    const { execute: executeOrganizationJoinsProfile } = await testAdapter({
      adapter: () => organizationJoinsProfileClient.adapter(wrappedCtx),
      runMigrations: noMigrations,
      overrideBetterAuthOptions: getOverrideBetterAuthOptions,
      prefixTests: "profile:organization-joins",
      tests: [multiJoinsMissingRowsTestSuite()],
    });

    executeBaseProfile();
    executeAdditionalFieldsProfile();
    executePluginTableProfile();
    executeRenameFieldProfile();
    executeRenameUserCustomProfile();
    executeRenameUserTableProfile();
    executeOrganizationJoinsProfile();
  });
}
