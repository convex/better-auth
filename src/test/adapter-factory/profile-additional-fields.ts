import { createTestSuite } from "@better-auth/test-utils/adapter";
import { expect } from "vitest";
import { getNormalTestSuiteTests } from "./basic.js";
import {
  AUTH_FLOW_DEFAULT_BETTER_AUTH_OPTIONS,
  getAuthFlowSuiteTests,
} from "./auth-flow.js";

export const ADDITIONAL_FIELDS_NORMAL_TESTS = [
  "deleteMany - should delete many models with numeric values",
  "findMany - should find many models with sortBy",
  "findMany - should find many models with sortBy and limit",
  "findMany - should find many models with sortBy and limit and offset",
  "findMany - should find many models with sortBy and limit and offset and where",
  "findMany - should find many models with sortBy and offset",
  "findMany - should find many with join and sortBy",
  "findOne - should find a model with additional fields",
] as const;

export const ADDITIONAL_FIELDS_AUTH_FLOW_TEST =
  "should sign up with additional fields" as const;

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

const omitTests = (
  tests: ReturnType<typeof getNormalTestSuiteTests>,
  testNames: readonly string[],
) =>
  Object.fromEntries(
    Object.entries(tests).filter(([testName]) => !testNames.includes(testName)),
  );

export const coreNormalTestSuite = createTestSuite(
  "normal",
  {},
  (helpers, debugTools) => {
    const tests = getNormalTestSuiteTests(helpers, debugTools);
    return {
      "init - tests": async () => {
        const opts = helpers.getBetterAuthOptions();
        expect(opts.advanced?.database?.generateId !== "serial").toBeTruthy();
      },
      ...omitTests(tests, ADDITIONAL_FIELDS_NORMAL_TESTS),
    };
  },
);

export const additionalFieldsNormalTestSuite = createTestSuite(
  "normal-additional-fields",
  {},
  (helpers, debugTools) => {
    const tests = getNormalTestSuiteTests(helpers, debugTools);
    return pickTests(tests, ADDITIONAL_FIELDS_NORMAL_TESTS);
  },
);

export const coreAuthFlowTestSuite = createTestSuite(
  "auth-flow",
  {
    defaultBetterAuthOptions: AUTH_FLOW_DEFAULT_BETTER_AUTH_OPTIONS,
  },
  (helpers) => {
    const tests = getAuthFlowSuiteTests(helpers);
    if (!(ADDITIONAL_FIELDS_AUTH_FLOW_TEST in tests)) {
      throw new Error(
        `Upstream test name drift: auth-flow test not found: ${ADDITIONAL_FIELDS_AUTH_FLOW_TEST}`,
      );
    }
    const { [ADDITIONAL_FIELDS_AUTH_FLOW_TEST]: _skip, ...remaining } = tests;
    return remaining;
  },
);

export const additionalFieldsAuthFlowTestSuite = createTestSuite(
  "auth-flow-additional-fields",
  {
    defaultBetterAuthOptions: AUTH_FLOW_DEFAULT_BETTER_AUTH_OPTIONS,
  },
  (helpers) => {
    const tests = getAuthFlowSuiteTests(helpers);
    if (!(ADDITIONAL_FIELDS_AUTH_FLOW_TEST in tests)) {
      throw new Error(
        `Upstream test name drift: auth-flow test not found: ${ADDITIONAL_FIELDS_AUTH_FLOW_TEST}`,
      );
    }
    return {
      [ADDITIONAL_FIELDS_AUTH_FLOW_TEST]:
        tests[ADDITIONAL_FIELDS_AUTH_FLOW_TEST],
    };
  },
);
