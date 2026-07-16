import { describe, expect, it, vi } from "vitest";
import type { RouteConfig } from "../src/contracts/provider";
import {
  buildProviderRoutePlan,
  isTerminalProviderFailure,
  resolveProviderCredential,
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

  it("resolves credentials using user, user-required, legacy, managed, Worker, and missing precedence", async () => {
    const loadManagedSecret = vi.fn(async (apiKeyRef: string) => apiKeyRef === "MANAGED_KEY" ? "managed-key" : null);
    const common = {
      bindings: { MANAGED_KEY: "worker-shadowed", WORKER_KEY: "worker-key" },
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
