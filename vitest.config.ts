import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    typecheck: {
      tsconfig: "./tsconfig.test.json",
      include: [
        "**/*.{test,spec}-d.?(c|m)[jt]s?(x)",
        "**/*.types.test.ts",
      ],
    },
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/e2e/**", "**/examples/**"],
  },
});
