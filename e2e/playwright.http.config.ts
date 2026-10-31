import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3211",
    extraHTTPHeaders: { origin: "http://127.0.0.1:3211" },
  },
  projects: [
    {
      name: "oauth",
      testMatch: ["oauth-provider/**/*.spec.ts"],
      timeout: 60_000,
    },
    {
      name: "adapter",
      testMatch: ["adapter/**/*.spec.ts", "audit/**/*.spec.ts"],
      testIgnore: ["audit/custom-path.spec.ts", "audit/eddsa.spec.ts"],
      timeout: 120_000,
    },
    {
      name: "routes",
      testMatch: ["audit/custom-path.spec.ts", "audit/eddsa.spec.ts"],
      timeout: 120_000,
    },
  ],
});
