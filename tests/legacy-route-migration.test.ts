import { describe, expect, it } from "vitest";
import {
  hasLegacyRouteShadow,
  isLegacyRouteConfig,
  migrateLegacyRouteConfiguration,
} from "../src/services/legacy-route-migration";

describe("legacy route migration", () => {
  it("moves one inline route into a collision-safe provider without changing route policy", () => {
    const config = {
      providers: {
        "writer-provider": {
          label: "Existing",
          type: "openai-chat" as const,
          baseUrl: "https://existing.example/v1",
        },
      },
      routes: {
        writer: {
          enabled: false,
          label: "Writer",
          type: "openai-chat" as const,
          baseUrl: "https://legacy.example/v1/",
          model: "writer-v1",
          apiKey: "inline-secret",
          apiKeyRef: "OLD_REF",
          headers: { "X-Private": "header-secret" },
          fallbacks: ["backup"],
          maxTokens: 2048,
          temperature: 0.3,
          allowUserKey: false,
          supportsImages: true,
          supportsTools: true,
        },
        backup: {
          label: "Backup",
          offerings: [{ providerId: "writer-provider", model: "backup-v1" }],
        },
      },
    };

    const result = migrateLegacyRouteConfiguration(config, [{ routeId: "writer", apiKeyRef: "MANAGED_REF" }]);

    expect(result.migrated).toEqual([{ routeId: "writer", providerId: "writer-provider-2" }]);
    expect(result.config.routes.writer).toEqual({
      enabled: false,
      label: "Writer",
      offerings: [{ providerId: "writer-provider-2", model: "writer-v1" }],
      fallbacks: ["backup"],
      maxTokens: 2048,
      temperature: 0.3,
      allowUserKey: false,
      supportsImages: true,
      supportsTools: true,
    });
    expect(result.config.providers["writer-provider-2"]).toMatchObject({
      enabled: true,
      label: "Writer",
      type: "openai-chat",
      baseUrl: "https://legacy.example/v1/",
      apiKeyRef: "MANAGED_REF",
      headers: { "X-Private": "header-secret" },
      allowUserKey: false,
      supportsImages: true,
      supportsTools: true,
      concurrency: "unlimited",
      queueTimeoutMs: 10_000,
    });
    expect(result.config.providers["writer-provider-2"]).not.toHaveProperty("apiKey");
    expect(config.routes.writer.apiKey).toBe("inline-secret");
  });

  it("cleans stale transport shadows from provider-backed routes and is idempotent", () => {
    const config = {
      providers: {
        shared: { label: "Shared", type: "openai-chat" as const, baseUrl: "https://shared.example/v1" },
      },
      routes: {
        model: {
          label: "Model",
          offerings: [{ providerId: "shared", model: "shared-v1" }],
          type: "openai-chat" as const,
          baseUrl: "https://stale.example/v1",
          model: "stale-v1",
          apiKey: "stale-secret",
        },
      },
    };

    expect(isLegacyRouteConfig(config.routes.model)).toBe(true);
    expect(hasLegacyRouteShadow(config.routes.model)).toBe(true);
    const first = migrateLegacyRouteConfiguration(config, [{ routeId: "model" }]);
    expect(first.migrated).toEqual([{ routeId: "model" }]);
    expect(first.config.routes.model.offerings).toEqual([{ providerId: "shared", model: "shared-v1" }]);
    expect(hasLegacyRouteShadow(first.config.routes.model)).toBe(false);

    const second = migrateLegacyRouteConfiguration(first.config, [{ routeId: "model" }]);
    expect(second.migrated).toEqual([]);
    expect(second.config).toEqual(first.config);
  });

  it("normalizes unsafe route IDs into valid provider IDs", () => {
    const result = migrateLegacyRouteConfiguration({
      providers: {},
      routes: {
        " 中文 / model ": {
          label: "Unicode",
          type: "anthropic-messages",
          baseUrl: "https://anthropic.example/v1",
          model: "claude-local",
          requiresUserKey: true,
        },
      },
    }, [{ routeId: " 中文 / model " }]);

    expect(result.migrated[0].providerId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);
  });
});
