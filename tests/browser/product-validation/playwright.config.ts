import { defineConfig } from "@playwright/test";

const baseURL = process.env.CHATUS_VALIDATION_BASE_URL;
if (!baseURL) throw new Error("CHATUS_VALIDATION_BASE_URL is required");

export default defineConfig({
  testDir: ".",
  testMatch: "product-direction.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["line"]],
  outputDir: process.env.CHATUS_VALIDATION_OUTPUT_DIR || "../../../test-results/product-validation/playwright",
  preserveOutput: "always",
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "light",
    viewport: { width: 1440, height: 900 },
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
