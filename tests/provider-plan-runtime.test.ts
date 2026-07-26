import { describe, expect, it, vi } from "vitest";
import type {
  ProviderConfig,
  ProviderCredential,
  ResolvedProviderRoute,
  RouteConfig,
} from "../src/contracts/provider";
import { createProviderPlanRuntime } from "../src/services/provider-plan-runtime";

describe("provider plan runtime", () => {
  it("orders candidates with injected passive quality for each exact route-provider pair", async () => {
    const loadQuality = vi.fn(async (candidate: ResolvedProviderRoute) => {
      if (candidate.providerId === "fast") {
        return { attempts: 8, successes: 8, averageLatencyMs: 100, observedAt: "2026-07-26T00:00:00Z" };
      }
      if (candidate.providerId === "slow") {
        return { attempts: 8, successes: 8, averageLatencyMs: 900, observedAt: "2026-07-26T00:00:00Z" };
      }
      return null;
    });
    const runtime = createProviderPlanRuntime({
      routes: {
        main: logicalRoute([
          { providerId: "slow", model: "main-slow" },
          { providerId: "fast", model: "main-fast" },
        ]),
        fallback: logicalRoute([{ providerId: "backup", model: "fallback" }]),
      },
      providers: {
        slow: provider(),
        fast: provider(),
        backup: provider(),
      },
      resolveCredential: async () => credential("server-key"),
      loadQuality,
    });

    const plan = await runtime.buildPlan(["main", "fallback"]);

    expect(plan.map(({ routeId, providerId }) => `${routeId}:${providerId}`)).toEqual([
      "main:fast",
      "main:slow",
      "fallback:backup",
    ]);
    expect(loadQuality.mock.calls.map(([candidate]) => `${candidate.routeId}:${candidate.providerId}`)).toEqual([
      "main:slow",
      "main:fast",
      "fallback:backup",
    ]);
  });

  it("filters inaccessible and incompatible candidates before resolving credentials", async () => {
    const resolveCredential = vi.fn(async () => credential("server-key"));
    const runtime = createProviderPlanRuntime({
      routes: {
        main: logicalRoute([
          { providerId: "no-tools", model: "plain", supportsTools: false },
          { providerId: "tools", model: "tools", supportsTools: true },
        ]),
        blocked: logicalRoute([{ providerId: "blocked", model: "blocked", supportsTools: true }]),
      },
      providers: {
        "no-tools": provider(),
        tools: provider(),
        blocked: provider(),
      },
      resolveCredential,
      loadQuality: async () => null,
    });

    const prepared = await runtime.preparePlan({
      routeIds: ["main", "blocked"],
      accessRoutes: [{ id: "main", allowUserKey: false, requiresUserKey: false }],
      userApiKey: "must-not-leak",
      accepts: (candidate) => candidate.supportsTools,
    });

    expect(prepared.candidates).toEqual([
      expect.objectContaining({ routeId: "main", providerId: "tools", planIndex: 0 }),
    ]);
    expect(resolveCredential).toHaveBeenCalledTimes(1);
    expect(resolveCredential).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "tools" }),
      "",
    );
  });

  it("preserves credential errors and original plan indexes while continuing fallback", async () => {
    const managedError = new Error("managed secret unavailable");
    const resolveCredential = vi.fn(async (candidate: ResolvedProviderRoute, userApiKey: string) => {
      expect(userApiKey).toBe("member-key");
      if (candidate.providerId === "broken") throw managedError;
      return credential("backup-key");
    });
    const runtime = createProviderPlanRuntime({
      routes: {
        main: logicalRoute([
          { providerId: "broken", model: "broken", priority: 10 },
          { providerId: "backup", model: "backup", priority: 0 },
        ]),
      },
      providers: { broken: provider(), backup: provider() },
      resolveCredential,
      loadQuality: async () => null,
      credentialErrorMessage: (error) => error === managedError ? managedError.message : "hidden error",
    });

    const prepared = await runtime.preparePlan({
      routeIds: ["main"],
      accessRoutes: [{ id: "main", allowUserKey: true, requiresUserKey: false }],
      userApiKey: "member-key",
    });

    expect(prepared.lastError).toEqual({ routeId: "main", message: "managed secret unavailable" });
    expect(prepared.candidates).toEqual([
      expect.objectContaining({ providerId: "backup", planIndex: 1, credential: credential("backup-key") }),
    ]);
  });

  it("stops preparation when the accessible route requires a missing user key", async () => {
    const resolveCredential = vi.fn(async () => credential(""));
    const runtime = createProviderPlanRuntime({
      routes: {
        required: logicalRoute([
          { providerId: "first", model: "first" },
          { providerId: "second", model: "second" },
        ]),
      },
      providers: { first: provider(), second: provider() },
      resolveCredential,
      loadQuality: async () => null,
    });

    const prepared = await runtime.preparePlan({
      routeIds: ["required"],
      accessRoutes: [{ id: "required", allowUserKey: true, requiresUserKey: true }],
      userApiKey: "",
    });

    expect(prepared).toEqual({ candidates: [], lastError: null, userKeyRequiredRouteId: "required" });
    expect(resolveCredential).toHaveBeenCalledTimes(1);
  });
});

function logicalRoute(offerings: NonNullable<RouteConfig["offerings"]>): RouteConfig {
  return { label: "Logical model", offerings };
}

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    label: "Provider",
    type: "openai-chat",
    baseUrl: "https://provider.example/v1",
    ...overrides,
  };
}

function credential(apiKey: string): ProviderCredential {
  return { apiKey, source: apiKey ? "managed" : "missing", usedUserKey: false };
}
