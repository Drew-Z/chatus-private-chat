import { defineConfig } from "@playwright/test";

const baseURL = process.env.CHATUS_E2E_BASE_URL;
if (!baseURL) throw new Error("CHATUS_E2E_BASE_URL is required");
const outputDir = process.env.CHATUS_E2E_OUTPUT_DIR || "../../../test-results/agent-e2e";

export default defineConfig({
  testDir: ".",
  testMatch: "agent-runtime.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["line"]],
  outputDir,
  preserveOutput: "always",
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "light",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
