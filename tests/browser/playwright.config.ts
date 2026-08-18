import { defineConfig } from "@playwright/test";
import { workspaceFixtureBaseURL } from "./workspace-fixture/config";

const baseURL = workspaceFixtureBaseURL;

export default defineConfig({
  testDir: ".",
  testMatch: "workspace-visual.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["line"]],
  outputDir: "../../test-results/workspace-visual",
  preserveOutput: "always",
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "wide-1920", use: { viewport: { width: 1920, height: 1080 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "boundary-780", use: { viewport: { width: 780, height: 900 } } },
    { name: "mobile-480", use: { viewport: { width: 480, height: 844 } } },
    { name: "touch-390", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: "npm exec vite -- --config workspace-fixture/vite.config.ts",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
