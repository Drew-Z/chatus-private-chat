import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "tests/browser/**"],
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
