import { describe, expect, it } from "vitest";
import {
  isAdminConfigSnapshot,
  isAdminModelDiscoveryResponse,
  isAdminReliabilitySnapshot,
  isAdminRouteSecretsSnapshot,
  type AdminConfig,
} from "../client/src/lib/api";
import {
  applyLogicalModelDraft,
  applyProviderDraft,
  canDeleteProvider,
  createLogicalModelDraft,
  createProviderDraft,
  hasLogicalModelIdConflict,
  hasProviderIdConflict,
  mergeDiscoveredOfferings,
  projectAdminLogicalModels,
  projectAdminProviders,
  projectLegacyRouteMigrations,
  rebaseAdminConfigDraft,
  validateLogicalModelDraft,
  validateProviderDraft,
} from "../client/src/lib/admin-provider";

function fixture(): AdminConfig {
  return {
    providers: {
      slow: {
        label: "Slow provider",
        type: "openai-chat",
        baseUrl: "https://slow.example/v1",
        apiKeyRef: "SLOW_KEY",
        concurrency: "bounded",
        maxConcurrent: 2,
        queueTimeoutMs: 500,
        priority: 10,
      },
      shared: {
        label: "Shared provider",
        type: "openai-chat",
        baseUrl: "https://shared.example/v1",
        apiKeyRef: "SHARED_KEY",
        concurrency: "exclusive",
        priority: 1,
      },
    },
    routes: {
      writer: {
        label: "Writer",
        offerings: [{ providerId: "shared", model: "writer-v1" }],
        fallbacks: ["backup"],
        supportsTools: true,
      },
      backup: {
        label: "Backup",
        offerings: [{ providerId: "slow", model: "backup-v1" }],
      },
    },
    users: {
      bill: { defaultRoute: "writer", allowedRoutes: ["writer"] },
    },
    defaults: { defaultRoute: "writer", allowedRoutes: ["writer", "backup"] },
    publicAccess: {
      enabled: true,
      routeId: "writer",
      sessionTtlSeconds: 86_400,
      dailyMessageLimit: 20,
      minuteMessageLimit: 6,
      sourceDailyMessageLimit: 200,
      sourceMinuteMessageLimit: 30,
    },
    skills: {},
    tools: {},
    mcpServers: {},
  };
}

describe("typed provider administration helpers", () => {
  it("projects providers and logical models without credentials", () => {
    const config = fixture();
    const providers = projectAdminProviders(config, [
      {
        apiKeyRef: "SHARED_KEY",
        source: "managed",
        status: "configured",
        managed: true,
        environmentFallback: false,
        revision: "rev-1",
      },
    ]);
    expect(providers.map((provider) => provider.id)).toEqual(["shared", "slow"]);
    expect(providers[0]).toMatchObject({ credentialStatus: "configured", referencedBy: ["writer"], concurrency: "exclusive" });
    expect(providers[0]).not.toHaveProperty("apiKey");

    const models = projectAdminLogicalModels(config);
    expect(models.map((model) => model.id)).toEqual(["backup", "writer"]);
    expect(models.find((model) => model.id === "writer")).toMatchObject({ referencedBy: ["bill", "defaults", "公开访问"], supportsTools: true });
  });

  it("projects legacy route migration readiness without exposing endpoint details", () => {
    const config = fixture();
    config.routes.legacy = {
      label: "Legacy inline",
      type: "openai-chat",
      baseUrl: "https://private-provider.example/v1",
      model: "private-model",
      apiKeyRef: "LEGACY_KEY",
      hasLegacyKey: true,
    };
    config.routes.byok = {
      label: "BYOK legacy",
      type: "anthropic-messages",
      baseUrl: "https://byok.example/v1",
      model: "byok-model",
      requiresUserKey: true,
    };
    config.routes.writer = {
      ...config.routes.writer,
      type: "openai-chat",
      baseUrl: "https://stale.example/v1",
      model: "stale-model",
      hasLegacyKey: true,
    };

    const blocked = projectLegacyRouteMigrations(config, []);
    expect(blocked.map((candidate) => candidate.routeId)).toEqual(["byok", "legacy", "writer"]);
    expect(blocked.find((candidate) => candidate.routeId === "legacy")).toMatchObject({
      apiKeyRef: "LEGACY_KEY",
      status: "blocked",
      reason: "credential_missing",
      needsCredential: true,
    });
    expect(blocked.find((candidate) => candidate.routeId === "byok")).toMatchObject({ status: "ready", reason: "user_key_required" });
    expect(blocked.find((candidate) => candidate.routeId === "writer")).toMatchObject({ status: "ready", reason: "provider_backed" });
    expect(JSON.stringify(blocked)).not.toContain("private-provider.example");
    expect(JSON.stringify(blocked)).not.toContain("private-model");

    const ready = projectLegacyRouteMigrations(config, [{
      apiKeyRef: "NEW_LEGACY_KEY",
      source: "managed",
      status: "configured",
      managed: true,
      environmentFallback: false,
    }], { legacy: "NEW_LEGACY_KEY" });
    expect(ready.find((candidate) => candidate.routeId === "legacy")).toMatchObject({
      apiKeyRef: "NEW_LEGACY_KEY",
      status: "ready",
      reason: "credential_configured",
      needsCredential: false,
    });
  });

  it("guards provider deletion and validates duplicate or missing offerings", () => {
    const config = fixture();
    expect(canDeleteProvider(config, "shared")).toEqual({ ok: false, referencedBy: ["writer"] });
    expect(canDeleteProvider(config, "unused")).toEqual({ ok: true });
    expect(validateProviderDraft({ ...config.providers.shared, id: "bad id" })).toMatchObject({ ok: false });
    expect(validateProviderDraft({ ...config.providers.shared, id: "valid", concurrency: "bounded", maxConcurrent: 0 })).toMatchObject({ ok: false });
    expect(validateLogicalModelDraft({
      ...config.routes.writer,
      id: "writer",
      offerings: [
        { providerId: "shared", model: "a" },
        { providerId: "shared", model: "b" },
      ],
    }, config)).toMatchObject({ ok: false });
    expect(hasProviderIdConflict(config, "shared", "slow")).toBe(true);
    expect(hasProviderIdConflict(config, "shared", "new-provider")).toBe(false);
    expect(hasLogicalModelIdConflict(config, "writer", "backup")).toBe(true);
    expect(hasLogicalModelIdConflict(config, "writer", "new-model")).toBe(false);
    expect(validateLogicalModelDraft({
      ...config.routes.writer,
      id: "writer",
      offerings: [{ providerId: "missing", model: "a" }],
    }, config)).toMatchObject({ ok: false });
  });

  it("merges one discovered offering without duplicating a provider", () => {
    const config = fixture();
    const merged = mergeDiscoveredOfferings(config, "backup", "shared", ["new-model", "second-model"]);
    expect(merged.added).toEqual(["new-model"]);
    expect(merged.config.routes.backup.offerings).toEqual([
      { providerId: "slow", model: "backup-v1" },
      { providerId: "shared", model: "new-model", enabled: true, priority: 0 },
    ]);
    expect(mergeDiscoveredOfferings(merged.config, "backup", "shared", ["third-model"]).added).toEqual([]);
  });

  it("rebases only touched provider and route drafts", () => {
    const local = fixture();
    local.providers.shared = { ...local.providers.shared, label: "Local shared" };
    local.routes.writer = { ...local.routes.writer, label: "Local writer" };
    const latest = fixture();
    latest.providers.slow = { ...latest.providers.slow, priority: 99 };
    latest.routes.backup = { ...latest.routes.backup, label: "Server backup" };
    const rebased = rebaseAdminConfigDraft(latest, local, ["shared"], ["writer"]);
    expect(rebased.providers.shared.label).toBe("Local shared");
    expect(rebased.providers.slow.priority).toBe(99);
    expect(rebased.routes.writer.label).toBe("Local writer");
    expect(rebased.routes.backup.label).toBe("Server backup");
  });

  it("preserves safe provider and legacy route fields through draft round trips", () => {
    const config = fixture();
    config.providers.shared = {
      ...config.providers.shared,
      authHeader: "X-Api-Key",
      authPrefix: "Token ",
      hasCustomHeaders: true,
      headerSourceRouteId: "legacy-source",
    };
    const providerDraft = createProviderDraft(config.providers.shared, "shared");
    expect(providerDraft).toMatchObject({
      authHeader: "X-Api-Key",
      authPrefix: "Token ",
      hasCustomHeaders: true,
      headerSourceRouteId: "legacy-source",
    });
    const providerRoundTrip = applyProviderDraft(config, "shared", { ...providerDraft, label: "Renamed shared" });
    expect(providerRoundTrip.providers.shared).toMatchObject({
      label: "Renamed shared",
      authHeader: "X-Api-Key",
      authPrefix: "Token ",
      hasCustomHeaders: true,
      headerSourceRouteId: "legacy-source",
    });

    const legacyRoute = {
      ...config.routes.writer,
      type: "openai-chat" as const,
      baseUrl: "https://legacy.example/v1",
      model: "legacy-writer",
      apiKeyRef: "SHARED_KEY",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      directEndpoint: true,
      maxTokens: 2048,
      temperature: 0.2,
      allowUserKey: false,
      requiresUserKey: true,
      hasLegacyKey: true,
      hasCustomHeaders: true,
    };
    const routeDraft = createLogicalModelDraft(legacyRoute, "writer");
    expect(routeDraft).toMatchObject({
      maxTokens: 2048,
      temperature: 0.2,
      allowUserKey: false,
      requiresUserKey: true,
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      directEndpoint: true,
      hasLegacyKey: true,
      hasCustomHeaders: true,
    });
    const routeRoundTrip = applyLogicalModelDraft(config, "writer", { ...routeDraft, label: "Renamed writer" });
    expect(routeRoundTrip.routes.writer).toMatchObject({
      label: "Renamed writer",
      maxTokens: 2048,
      temperature: 0.2,
      allowUserKey: false,
      requiresUserKey: true,
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      directEndpoint: true,
    });
    expect(routeRoundTrip.routes.writer.offerings).not.toBe(legacyRoute.offerings);
  });

  it("preserves optional offering capability overrides through draft round trips", () => {
    const config = fixture();
    config.routes.writer.offerings = [{
      providerId: "shared",
      model: "writer-v1",
      enabled: true,
      priority: 2,
      supportsImages: false,
      supportsTools: true,
    }];
    const draft = createLogicalModelDraft(config.routes.writer, "writer");
    expect(draft.offerings?.[0]).toMatchObject({ supportsImages: false, supportsTools: true });
    const roundTrip = applyLogicalModelDraft(config, "writer", draft);
    expect(roundTrip.routes.writer.offerings?.[0]).toMatchObject({ supportsImages: false, supportsTools: true });
  });

  it("rewrites the public guest route when a logical model is renamed", () => {
    const config = fixture();
    const draft = { ...createLogicalModelDraft(config.routes.writer, "writer"), id: "author" };
    const renamed = applyLogicalModelDraft(config, "writer", draft);
    expect(renamed.publicAccess.routeId).toBe("author");
    expect(renamed.routes).not.toHaveProperty("writer");
    expect(renamed.routes.author).toBeDefined();
    expect(renamed.users.bill.defaultRoute).toBe("author");
    expect(renamed.defaults.allowedRoutes).toEqual(["author", "backup"]);
  });
});

describe("typed provider admin response decoders", () => {
  it("rejects secret-bearing metadata and accepts write-only status", () => {
    const metadata = {
      apiKeyRef: "SHARED_KEY",
      source: "managed",
      status: "configured",
      managed: true,
      environmentFallback: false,
      revision: "rev-1",
    };
    expect(isAdminRouteSecretsSnapshot({ masterKeyReady: true, items: [metadata] })).toBe(true);
    expect(isAdminRouteSecretsSnapshot({ masterKeyReady: true, items: [{ ...metadata, ciphertext: "secret" }] })).toBe(false);
    expect(isAdminRouteSecretsSnapshot({ masterKeyReady: true, items: [metadata], apiKey: "secret" })).toBe(false);
  });

  it("validates bounded discovery and passive reliability envelopes", () => {
    expect(isAdminModelDiscoveryResponse({ models: ["a", "b"], count: 2, endpoint: "https://provider.example/v1/models" })).toBe(true);
    expect(isAdminModelDiscoveryResponse({ models: ["a", "a"], count: 2, endpoint: "https://provider.example/v1/models" })).toBe(false);
    expect(isAdminModelDiscoveryResponse({ models: ["a"], count: 1, endpoint: "file:///secret" })).toBe(false);
    expect(isAdminReliabilitySnapshot({
      generatedAt: "2026-07-25T00:00:00.000Z",
      providers: [{
        providerId: "shared",
        label: "Shared",
        enabled: true,
        credentialStatus: "configured",
        concurrency: "exclusive",
        queueTimeoutMs: 0,
        routes: [{
          routeId: "writer",
          model: "writer-v1",
          enabled: true,
          attempts: 2,
          successes: 1,
          averageLatencyMs: 120,
          lastOutcome: "upstream_server",
          lastFallback: true,
          fallbackCount: 1,
        }],
      }],
    })).toBe(true);
    expect(isAdminReliabilitySnapshot({ generatedAt: "now", providers: [] })).toBe(false);
  });

  it("continues to reject secret fields in the full config projection", () => {
    const config = fixture();
    expect(isAdminConfigSnapshot({ config, source: "kv", revision: "rev" })).toBe(true);
    expect(isAdminConfigSnapshot({
      config: { ...config, providers: { ...config.providers, shared: { ...config.providers.shared, headers: { Authorization: "secret" } } } },
      source: "kv",
      revision: "rev",
    })).toBe(false);
  });
});
