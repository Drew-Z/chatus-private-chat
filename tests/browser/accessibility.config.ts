import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const baseURL = "http://127.0.0.1:4178";

export default defineConfig({
  testDir: ".",
  testMatch: "accessibility.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ["line"],
    ["json", { outputFile: resolve(process.cwd(), "test-results/workspace-accessibility/results.json") }],
  ],
  outputDir: "../../test-results/workspace-accessibility",
  preserveOutput: "always",
  use: {
    baseURL,
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "normal-motion", use: { browserName: "chromium", viewport: { width: 1280, height: 900 } } },
    { name: "reduced-motion", use: { browserName: "chromium", viewport: { width: 1280, height: 900 } } },
    { name: "firefox-smoke", use: { browserName: "firefox", viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: "npm exec vite -- --config workspace-fixture/vite.config.ts",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
