import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";
import { TEST_COVERAGE_THRESHOLDS, WORKERS_TEST_FILES } from "./vitest.constants";

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
    projects: [
      {
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          exclude: [...sharedExclude, ...WORKERS_TEST_FILES],
        },
      },
      {
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
        test: {
          name: "workers",
          include: [...WORKERS_TEST_FILES],
          exclude: sharedExclude,
          // Miniflare opens an internal port per worker. Keep this project
          // serial so Windows never selects an undici-forbidden random port.
          maxWorkers: 1,
        },
      },
    ],
  },
});
