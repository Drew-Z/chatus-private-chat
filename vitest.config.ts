import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "tests/browser/**"],
    // Cloudflare's worker pool opens an internal Miniflare port per worker.
    // Keep the pool serial so npm test does not intermittently hit an undici
    // forbidden random port on Windows.
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
