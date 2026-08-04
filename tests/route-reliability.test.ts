import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRecentProviderRouteReliability,
  isRecentRouteReliability,
  loadProviderRouteReliability,
  loadRouteReliability,
  loadSkillSelectionTelemetry,
  recordRouteReliability,
  type ProviderRouteReliabilityRecord,
  type RouteReliabilityRecord,
} from "../src/services/route-reliability";

const ROUTE_RELIABILITY_PREFIX = "route-reliability:";
const PROVIDER_ROUTE_RELIABILITY_PREFIX = "route-provider-reliability:";
const SKILL_SELECTION_TELEMETRY_PREFIX = "route-provider-skill-selection:";

function reliabilityKey(routeId: string): string {
  return `${ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}`;
}

function providerReliabilityKey(routeId: string, providerId: string): string {
  return `${PROVIDER_ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}:${encodeURIComponent(providerId)}`;
}

async function clearRouteReliability(): Promise<void> {
  for (const prefix of [
    ROUTE_RELIABILITY_PREFIX,
    PROVIDER_ROUTE_RELIABILITY_PREFIX,
    SKILL_SELECTION_TELEMETRY_PREFIX,
  ]) {
    let cursor: string | undefined;
    do {
      const page = await env.CHAT_STORE.list({ prefix, cursor, limit: 100 });
      await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
}

function validRecord(routeId: string, overrides: Partial<RouteReliabilityRecord> = {}): RouteReliabilityRecord {
  return {
    version: 2,
    source: "real_task",
    routeId,
    ok: true,
    outcome: "success",
    observedAt: "2026-07-17T00:00:00.000Z",
    latencyMs: 120,
    fallback: false,
    ...overrides,
  };
}

function validProviderRecord(
  routeId: string,
  providerId: string,
  overrides: Partial<ProviderRouteReliabilityRecord> = {},
): ProviderRouteReliabilityRecord {
  return {
    version: 2,
    source: "real_task",
    routeId,
    providerId,
    attempts: 3,
    successes: 2,
    averageLatencyMs: 120,
    lastOutcome: "success",
    observedAt: "2026-07-17T00:00:00.000Z",
    lastFallback: false,
    fallbackCount: 0,
    ...overrides,
  };
}

describe("route reliability service", () => {
  beforeEach(clearRouteReliability);

  it("rejects malformed records and treats expired or future observations as unknown", async () => {
    const malformed = [
      "not-json",
      JSON.stringify(validRecord("other-route")),
      JSON.stringify({ ...validRecord("primary"), ok: "yes" }),
      JSON.stringify({ ...validRecord("primary"), fallback: 1 }),
      JSON.stringify({ ...validRecord("primary"), observedAt: "not-a-date" }),
      JSON.stringify({ ...validRecord("primary"), latencyMs: "120" }),
      JSON.stringify({ ...validRecord("primary"), latencyMs: 600_001 }),
      JSON.stringify({ ...validRecord("primary"), httpStatusClass: "3xx" }),
      JSON.stringify({ ...validRecord("primary"), firstVisibleLatencyMs: 20 }),
      JSON.stringify({ ...validRecord("primary"), streamShape: "progressive" }),
      JSON.stringify({ ...validRecord("primary"), firstVisibleLatencyMs: 20, streamShape: "buffered" }),
      JSON.stringify({ ...validRecord("primary", { ok: false, outcome: "network_error" }), firstVisibleLatencyMs: 20, streamShape: "single_chunk" }),
    ];

    for (const raw of malformed) {
      await env.CHAT_STORE.put(reliabilityKey("primary"), raw);
      await expect(loadRouteReliability(env, "primary")).resolves.toBeNull();
      await expect(env.CHAT_STORE.get(reliabilityKey("primary"))).resolves.toBeNull();
    }

    const expired = validRecord("primary", { observedAt: "2026-07-01T00:00:00.000Z" });
    const future = validRecord("primary", { observedAt: "2026-07-18T00:00:00.000Z" });
    expect(isRecentRouteReliability(expired, Date.parse("2026-07-17T00:00:00.000Z"))).toBe(false);
    expect(isRecentRouteReliability(future, Date.parse("2026-07-17T00:00:00.000Z"))).toBe(false);
  });

  it("does not surface invalid-record cleanup failures", async () => {
    const cleanupError = new Error("KV delete unavailable");
    const deleteRecord = vi.fn().mockRejectedValue(cleanupError);
    const cleanupEnv = {
      CHAT_STORE: {
        get: vi.fn().mockResolvedValue("not-json"),
        delete: deleteRecord,
      } as unknown as KVNamespace,
    };

    await expect(loadRouteReliability(cleanupEnv, "primary")).resolves.toBeNull();
    expect(deleteRecord).toHaveBeenCalledWith(reliabilityKey("primary"));
  });

  it.each([
    { routeId: "auth-401", status: 401, outcome: "upstream_auth", httpStatusClass: "4xx" },
    { routeId: "auth-403", status: 403, outcome: "upstream_auth", httpStatusClass: "4xx" },
    { routeId: "rate-limit", status: 429, outcome: "upstream_rate_limit", httpStatusClass: "4xx" },
    { routeId: "client", status: 422, outcome: "upstream_client", httpStatusClass: "4xx" },
    { routeId: "server", status: 503, outcome: "upstream_server", httpStatusClass: "5xx" },
  ] as const)("classifies HTTP failure for $routeId", async ({ routeId, status, outcome, httpStatusClass }) => {
    await recordRouteReliability(env, {
      routeId,
      ok: false,
      fallback: false,
      startedAt: Date.now() - 25,
      usedUserKey: false,
      status,
    });

    await expect(loadRouteReliability(env, routeId)).resolves.toMatchObject({
      routeId,
      ok: false,
      outcome,
      httpStatusClass,
    });
  });

  it.each([
    { case: "success", ok: true },
    { case: "authentication 401", ok: false, status: 401 },
    { case: "authentication 403", ok: false, status: 403 },
    { case: "rate limit", ok: false, status: 429 },
    { case: "server failure", ok: false, status: 503 },
    { case: "timeout", ok: false, errorName: "TimeoutError", errorMessage: "upstream timed out" },
    { case: "protocol failure", ok: false, status: 502, outcome: "protocol_error" as const },
    { case: "network failure", ok: false, errorName: "TypeError", errorMessage: "fetch failed" },
  ])("does not let BYOK $case change shared logical or exact quality", async (sample) => {
    const routeId = `member-byok-${crypto.randomUUID()}`;
    const providerId = "member-provider";
    const existing = validRecord(routeId);
    const existingProvider = validProviderRecord(routeId, providerId);
    await env.CHAT_STORE.put(reliabilityKey(routeId), JSON.stringify(existing));
    await env.CHAT_STORE.put(providerReliabilityKey(routeId, providerId), JSON.stringify(existingProvider));
    const error = sample.errorName
      ? Object.assign(new Error(sample.errorMessage), { name: sample.errorName })
      : undefined;

    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: sample.ok,
      fallback: false,
      startedAt: Date.now(),
      status: sample.status,
      error,
      outcome: sample.outcome,
      usedUserKey: true,
    });

    await expect(env.CHAT_STORE.get(reliabilityKey(routeId), "json")).resolves.toEqual(existing);
    await expect(env.CHAT_STORE.get(providerReliabilityKey(routeId, providerId), "json"))
      .resolves.toEqual(existingProvider);
  });

  it("keeps BYOK selector attempts in isolated skill-selection telemetry", async () => {
    const routeId = `selector-byok-${crypto.randomUUID()}`;
    const providerId = "selector-provider";
    await recordRouteReliability(env, {
      operation: "skill_selection",
      routeId,
      providerId,
      ok: false,
      fallback: true,
      startedAt: Date.now() - 20,
      status: 429,
      usedUserKey: true,
    });

    await expect(loadRouteReliability(env, routeId)).resolves.toBeNull();
    await expect(loadProviderRouteReliability(env, routeId, providerId)).resolves.toBeNull();
    await expect(loadSkillSelectionTelemetry(env, routeId, providerId)).resolves.toMatchObject({
      operation: "skill_selection",
      attempts: 1,
      successes: 0,
      lastOutcome: "upstream_rate_limit",
      lastFallback: true,
    });
  });

  it("distinguishes timeout, protocol, and network failures", async () => {
    const timeout = new Error("upstream request timed out");
    timeout.name = "TimeoutError";
    await recordRouteReliability(env, {
      routeId: "timeout",
      ok: false,
      fallback: false,
      startedAt: Date.now(),
      usedUserKey: false,
      error: timeout,
    });
    await recordRouteReliability(env, {
      routeId: "protocol",
      ok: false,
      fallback: true,
      startedAt: Date.now(),
      usedUserKey: false,
      status: 502,
      error: new Error("provider returned an invalid response shape"),
    });
    await recordRouteReliability(env, {
      routeId: "network",
      ok: false,
      fallback: false,
      startedAt: Date.now(),
      usedUserKey: false,
      error: new TypeError("fetch failed"),
    });

    await expect(loadRouteReliability(env, "timeout")).resolves.toMatchObject({ outcome: "timeout" });
    await expect(loadRouteReliability(env, "protocol")).resolves.toMatchObject({
      outcome: "protocol_error",
      fallback: true,
      httpStatusClass: "5xx",
    });
    await expect(loadRouteReliability(env, "network")).resolves.toMatchObject({ outcome: "network_error" });
  });

  it("aggregates passive quality independently for each provider offering", async () => {
    await recordRouteReliability(env, {
      routeId: "reasoning",
      providerId: "provider-a",
      ok: true,
      fallback: false,
      startedAt: Date.now() - 100,
      usedUserKey: false,
    });
    await recordRouteReliability(env, {
      routeId: "reasoning",
      providerId: "provider-a",
      ok: false,
      fallback: true,
      startedAt: Date.now() - 300,
      usedUserKey: false,
      status: 503,
    });
    await recordRouteReliability(env, {
      routeId: "reasoning",
      providerId: "provider-b",
      ok: true,
      fallback: false,
      startedAt: Date.now() - 50,
      usedUserKey: false,
    });

    await expect(loadProviderRouteReliability(env, "reasoning", "provider-a")).resolves.toMatchObject({
      attempts: 2,
      successes: 1,
      lastOutcome: "upstream_server",
      lastFallback: true,
      fallbackCount: 1,
    });
    await expect(loadProviderRouteReliability(env, "reasoning", "provider-b")).resolves.toMatchObject({
      attempts: 1,
      successes: 1,
      lastOutcome: "success",
      lastFallback: false,
      fallbackCount: 0,
    });
  });

  it("aggregates bounded first-visible latency and stream shape without losing it on later failures", async () => {
    const routeId = `stream-${crypto.randomUUID()}`;
    const providerId = "provider-stream";
    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: true,
      fallback: false,
      startedAt: Date.now() - 300,
      usedUserKey: false,
      firstVisibleLatencyMs: 200,
      streamShape: "progressive",
    });
    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: true,
      fallback: false,
      startedAt: Date.now() - 200,
      usedUserKey: false,
      firstVisibleLatencyMs: 100,
      streamShape: "single_chunk",
    });
    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: true,
      fallback: false,
      startedAt: Date.now() - 75,
      usedUserKey: false,
    });
    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: false,
      fallback: false,
      startedAt: Date.now() - 50,
      usedUserKey: false,
      status: 503,
      firstVisibleLatencyMs: 10,
      streamShape: "progressive",
    });

    await expect(loadRouteReliability(env, routeId)).resolves.toMatchObject({
      ok: false,
      outcome: "upstream_server",
    });
    await expect(loadRouteReliability(env, routeId)).resolves.not.toHaveProperty("streamShape");
    await expect(loadProviderRouteReliability(env, routeId, providerId)).resolves.toMatchObject({
      attempts: 4,
      successes: 3,
      streamSamples: 2,
      progressiveSamples: 1,
      averageFirstVisibleLatencyMs: 150,
      lastFirstVisibleLatencyMs: 100,
      lastStreamShape: "single_chunk",
    });
  });

  it("deletes legacy provider records and rejects partial stream evidence", async () => {
    const routeId = `legacy-${crypto.randomUUID()}`;
    const providerId = "provider-legacy";
    const key = `${PROVIDER_ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}:${encodeURIComponent(providerId)}`;
    const legacy = {
      version: 1,
      source: "real_task",
      routeId,
      providerId,
      attempts: 1,
      successes: 1,
      averageLatencyMs: 80,
      lastOutcome: "success",
      observedAt: new Date().toISOString(),
    };
    await env.CHAT_STORE.put(key, JSON.stringify(legacy));
    await expect(loadProviderRouteReliability(env, routeId, providerId)).resolves.toBeNull();
    await expect(env.CHAT_STORE.get(key)).resolves.toBeNull();

    const current = { ...legacy, version: 2 };
    await env.CHAT_STORE.put(key, JSON.stringify({ ...current, streamSamples: 1 }));
    await expect(loadProviderRouteReliability(env, routeId, providerId)).resolves.toBeNull();
    await expect(env.CHAT_STORE.get(key)).resolves.toBeNull();
    await env.CHAT_STORE.put(key, JSON.stringify({
      ...current,
      streamSamples: 1,
      progressiveSamples: 2,
      averageFirstVisibleLatencyMs: 30,
      lastFirstVisibleLatencyMs: 30,
      lastStreamShape: "progressive",
    }));
    await expect(loadProviderRouteReliability(env, routeId, providerId)).resolves.toBeNull();
    await env.CHAT_STORE.put(key, JSON.stringify({
      ...current,
      attempts: 2,
      streamSamples: 2,
      progressiveSamples: 1,
      averageFirstVisibleLatencyMs: 30,
      lastFirstVisibleLatencyMs: 30,
      lastStreamShape: "progressive",
    }));
    await expect(loadProviderRouteReliability(env, routeId, providerId)).resolves.toBeNull();
    await expect(env.CHAT_STORE.get(key)).resolves.toBeNull();
  });

  it("keeps stream aggregates bounded at one thousand samples", async () => {
    const routeId = `bounded-${crypto.randomUUID()}`;
    const providerId = "provider-bounded";
    const key = `${PROVIDER_ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}:${encodeURIComponent(providerId)}`;
    await env.CHAT_STORE.put(key, JSON.stringify({
      version: 2,
      source: "real_task",
      routeId,
      providerId,
      attempts: 1_000,
      successes: 1_000,
      averageLatencyMs: 200,
      lastOutcome: "success",
      observedAt: new Date().toISOString(),
      streamSamples: 1_000,
      progressiveSamples: 0,
      averageFirstVisibleLatencyMs: 100,
      lastFirstVisibleLatencyMs: 100,
      lastStreamShape: "single_chunk",
    }));

    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: true,
      fallback: false,
      startedAt: Date.now() - 300,
      usedUserKey: false,
      firstVisibleLatencyMs: 200,
      streamShape: "progressive",
    });

    await expect(loadProviderRouteReliability(env, routeId, providerId)).resolves.toMatchObject({
      attempts: 1_000,
      successes: 1_000,
      streamSamples: 1_000,
      progressiveSamples: 1,
      averageFirstVisibleLatencyMs: 100,
      lastFirstVisibleLatencyMs: 200,
      lastStreamShape: "progressive",
    });

    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: false,
      fallback: false,
      startedAt: Date.now() - 300,
      usedUserKey: false,
      status: 503,
    });

    await expect(loadProviderRouteReliability(env, routeId, providerId)).resolves.toMatchObject({
      attempts: 1_000,
      successes: 999,
      streamSamples: 999,
      progressiveSamples: 1,
      averageFirstVisibleLatencyMs: 100,
      lastFirstVisibleLatencyMs: 200,
      lastStreamShape: "progressive",
    });
  });

  it("treats expired provider-pair quality as unknown", async () => {
    const expired = {
      version: 2,
      source: "real_task",
      routeId: "old-route",
      providerId: "old-provider",
      attempts: 4,
      successes: 3,
      averageLatencyMs: 180,
      lastOutcome: "success" as const,
      observedAt: "2026-07-01T00:00:00.000Z",
      lastFallback: false,
      fallbackCount: 0,
    };
    expect(isRecentProviderRouteReliability(expired, Date.parse("2026-07-17T00:00:00.000Z"))).toBe(false);
  });
});
