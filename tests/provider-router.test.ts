import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, RouteConfig } from "../src/contracts/provider";
import {
  buildResolvedProviderPlan,
  buildProviderRoutePlan,
  isTerminalProviderFailure,
  legacyProviderId,
  orderProviderRouteCandidates,
  resolveProviderRouteCandidates,
  resolveProviderCredential,
  routeProviderKey,
} from "../src/services/provider-router";

function route(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    label: "Primary",
    type: "openai-chat",
    baseUrl: "https://provider.example/v1",
    model: "model-a",
    ...overrides,
  };
}

describe("provider router", () => {
  it("builds a deduplicated fallback plan limited to the member allow-list", () => {
    const routes = {
      primary: route({ fallbacks: ["backup", "blocked", "backup"] }),
      backup: route({ label: "Backup" }),
      blocked: route({ label: "Blocked" }),
    };
    const access = { defaultRoute: "primary", routes: [{ id: "primary" }, { id: "backup" }] };

    expect(buildProviderRoutePlan("primary", routes, access)).toEqual(["primary", "backup"]);
    expect(buildProviderRoutePlan("not-allowed", routes, access)).toEqual(["primary", "backup"]);
  });

  it("projects a legacy route into one stable unlimited provider candidate", () => {
    const candidate = resolveProviderRouteCandidates("primary", route(), {})[0];

    expect(candidate).toMatchObject({
      routeId: "primary",
      providerId: legacyProviderId("primary"),
      type: "openai-chat",
      baseUrl: "https://provider.example/v1",
      model: "model-a",
      concurrency: "unlimited",
    });
  });

  it("expands provider offerings without duplicating endpoint credentials", () => {
    const providers: Record<string, ProviderConfig> = {
      shared: {
        label: "Shared",
        type: "openai-chat",
        baseUrl: "https://shared.example/v1",
        apiKeyRef: "SHARED_KEY",
        concurrency: "exclusive",
        priority: 20,
      },
    };
    const logical: RouteConfig = {
      label: "Reasoning",
      offerings: [{ providerId: "shared", model: "reasoning-v2", priority: 5 }],
      supportsTools: true,
    };

    expect(resolveProviderRouteCandidates("reasoning", logical, providers)).toEqual([
      expect.objectContaining({
        routeId: "reasoning",
        providerId: "shared",
        model: "reasoning-v2",
        apiKeyRef: "SHARED_KEY",
        concurrency: "exclusive",
        maxConcurrent: 1,
        priority: 5,
      }),
    ]);
  });

  it("does not treat inherited object properties as provider registrations", () => {
    const logical: RouteConfig = {
      label: "Invalid",
      offerings: [{ providerId: "constructor", model: "invalid-model" }],
    };

    expect(resolveProviderRouteCandidates("invalid", logical, {})).toEqual([]);
  });

  it("keeps administrator priority authoritative and uses passive quality only for ties", () => {
    const candidates = resolveProviderRouteCandidates("main", {
      label: "Main",
      offerings: [
        { providerId: "slow", model: "model" },
        { providerId: "fast", model: "model" },
        { providerId: "preferred", model: "model", priority: 10 },
      ],
    }, {
      slow: provider(),
      fast: provider(),
      preferred: provider(),
    });
    const ordered = orderProviderRouteCandidates(candidates, new Map([
      ["slow", { attempts: 10, successes: 9, averageLatencyMs: 900, observedAt: "2026-07-21T00:00:00Z" }],
      ["fast", { attempts: 10, successes: 9, averageLatencyMs: 100, observedAt: "2026-07-21T00:00:00Z" }],
      ["preferred", { attempts: 10, successes: 0, averageLatencyMs: 10_000, observedAt: "2026-07-21T00:00:00Z" }],
    ]));

    expect(ordered.map((candidate) => candidate.providerId)).toEqual(["preferred", "fast", "slow"]);
  });

  it("preserves one provider across distinct logical fallback models", () => {
    const providers = { shared: provider(), backup: provider() };
    const routes = {
      main: { label: "Main", offerings: [{ providerId: "shared", model: "main" }] },
      fallback: {
        label: "Fallback",
        offerings: [
          { providerId: "shared", model: "fallback-shared" },
          { providerId: "backup", model: "fallback-backup" },
        ],
      },
    } satisfies Record<string, RouteConfig>;

    const plan = buildResolvedProviderPlan(
      ["main", "fallback"],
      routes,
      providers,
      new Map([[routeProviderKey("fallback", "backup"), null]]),
    );
    expect(plan.map(({ routeId, providerId, model }) => `${routeId}:${providerId}:${model}`)).toEqual([
      "main:shared:main",
      "fallback:backup:fallback-backup",
      "fallback:shared:fallback-shared",
    ]);
  });

  it("resolves credentials using user, user-required, legacy, managed, Worker, and missing precedence", async () => {
    const loadManagedSecret = vi.fn(async (apiKeyRef: string) => apiKeyRef === "MANAGED_KEY" ? "managed-key" : null);
    const common = {
      bindings: { MANAGED_KEY: "worker-shadowed", WORKER_KEY: "  worker-key  ", BLANK_KEY: "   " },
      isManagedReference: (apiKeyRef: string) => /^[A-Z][A-Z0-9_]+$/.test(apiKeyRef),
      loadManagedSecret,
    };

    await expect(resolveProviderCredential({
      ...common,
      route: route({ apiKey: "legacy-key", apiKeyRef: "MANAGED_KEY" }),
      userApiKey: "user-key",
    })).resolves.toEqual({ apiKey: "user-key", source: "user", usedUserKey: true });

    await expect(resolveProviderCredential({
      ...common,
      route: route({ requiresUserKey: true, apiKey: "legacy-key", apiKeyRef: "MANAGED_KEY" }),
      userApiKey: "",
    })).resolves.toEqual({ apiKey: "", source: "missing", usedUserKey: false });

    await expect(resolveProviderCredential({
      ...common,
      route: route({ apiKey: "legacy-key", apiKeyRef: "MANAGED_KEY" }),
      userApiKey: "",
    })).resolves.toEqual({ apiKey: "legacy-key", source: "legacy", usedUserKey: false });

    await expect(resolveProviderCredential({
      ...common,
      route: route({ apiKeyRef: "MANAGED_KEY" }),
      userApiKey: "",
    })).resolves.toEqual({ apiKey: "managed-key", source: "managed", usedUserKey: false });

    await expect(resolveProviderCredential({
      ...common,
      route: route({ apiKeyRef: "WORKER_KEY" }),
      userApiKey: "",
    })).resolves.toEqual({ apiKey: "worker-key", source: "worker", usedUserKey: false });

    await expect(resolveProviderCredential({
      ...common,
      route: route({ apiKeyRef: "MISSING_KEY" }),
      userApiKey: "",
    })).resolves.toEqual({ apiKey: "", source: "missing", usedUserKey: false });

    await expect(resolveProviderCredential({
      ...common,
      route: route({ apiKeyRef: "BLANK_KEY" }),
      userApiKey: "",
    })).resolves.toEqual({ apiKey: "", source: "missing", usedUserKey: false });
  });

  it("does not hide managed-secret failures behind a Worker binding", async () => {
    const error = new Error("managed secret cannot be decrypted");
    await expect(resolveProviderCredential({
      route: route({ apiKeyRef: "BROKEN_KEY" }),
      userApiKey: "",
      bindings: { BROKEN_KEY: "worker-key" },
      isManagedReference: () => true,
      loadManagedSecret: async () => { throw error; },
    })).rejects.toBe(error);
  });

  it.each([
    { status: 400, usedUserKey: false, terminal: true },
    { status: 422, usedUserKey: false, terminal: true },
    { status: 401, usedUserKey: true, terminal: true },
    { status: 403, usedUserKey: true, terminal: true },
    { status: 401, usedUserKey: false, terminal: false },
    { status: 429, usedUserKey: false, terminal: false },
    { status: 503, usedUserKey: false, terminal: false },
  ])("classifies fallback eligibility for HTTP $status", ({ status, usedUserKey, terminal }) => {
    expect(isTerminalProviderFailure(status, usedUserKey)).toBe(terminal);
  });
});

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    label: "Provider",
    type: "openai-chat",
    baseUrl: "https://provider.example/v1",
    ...overrides,
  };
}
