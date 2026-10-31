import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./browser-surfaces",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5176 --clearScreen false",
    cwd: path.resolve(import.meta.dirname, "../examples/react"),
    url: "http://localhost:5176",
    reuseExistingServer: false,
    env: {
      VITE_CONVEX_URL: "http://127.0.0.1:3210",
      VITE_CONVEX_SITE_URL: "http://127.0.0.1:3211",
      VITE_SITE_URL: "http://localhost:5176",
    },
  },
});
