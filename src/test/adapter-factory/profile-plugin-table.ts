import { createTestSuite } from "@better-auth/test-utils/adapter";
import { getNormalTestSuiteTests } from "./basic.js";

export const PLUGIN_TABLE_NORMAL_TESTS = [
  "create - should apply default values to fields",
  "create - should return null for nullable foreign keys",
  "create - should support arrays",
  "create - should support json",
  "create - should support json arrays",
  "findMany - should find many with both one-to-one and one-to-many joins",
  "findMany - should find many with one-to-one join",
  "findMany - should handle mixed joins correctly when some are missing",
  "findMany - should return empty array when base records don't exist with joins",
  "findMany - should return null for one-to-one join when joined records don't exist",
  "findMany - should select fields with one-to-one join",
  "findOne - should not apply defaultValue if value not found",
  "findOne - should return an object for one-to-one joins",
  "findOne - should return null for one-to-one join when joined record doesn't exist",
  "findOne - should select fields with one-to-one join",
  "findOne - should work with both one-to-one and one-to-many joins",
] as const;

const pickTests = (
  tests: ReturnType<typeof getNormalTestSuiteTests>,
  testNames: readonly string[],
) => {
  const picked = Object.fromEntries(
    Object.entries(tests).filter(([testName]) => testNames.includes(testName)),
  );
  const missing = testNames.filter((name) => !(name in picked));
  if (missing.length > 0) {
    throw new Error(
      `Upstream test name drift: ${missing.length} test(s) not found: ${missing.join(", ")}`,
    );
  }
  return picked;
};

export const pluginTableNormalTestSuite = createTestSuite(
  "normal-plugin-table",
  {},
  (helpers, debugTools) => {
    const tests = getNormalTestSuiteTests(helpers, debugTools);
    return pickTests(tests, PLUGIN_TABLE_NORMAL_TESTS);
  },
);
