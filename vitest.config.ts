import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";
import { TEST_COVERAGE_THRESHOLDS } from "./vitest.constants";

const sharedExclude = [...configDefaults.exclude, "tests/browser/**"];

export default defineConfig({
  test: {
    exclude: sharedExclude,
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts", "client/src/**/*.{ts,tsx}"],
      exclude: ["src/worker-configuration.d.ts", "client/src/vite-env.d.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      thresholds: TEST_COVERAGE_THRESHOLDS,
    },
    // The measured Node/Workers split missed its final performance gate.
    // Keep the full Miniflare suite serial for Windows port stability.
    maxWorkers: 1,
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_TOKEN: "test-admin-token",
          TEST_ROUTE_KEY: "test-route-key",
          ROUTE_KEYS_MASTER_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        },
      },
    }),
  ],
});
