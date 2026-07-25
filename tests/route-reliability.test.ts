import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRecentProviderRouteReliability,
  isRecentRouteReliability,
  loadProviderRouteReliability,
  loadRouteReliability,
  recordRouteReliability,
  type RouteReliabilityRecord,
} from "../src/services/route-reliability";

const ROUTE_RELIABILITY_PREFIX = "route-reliability:";
const PROVIDER_ROUTE_RELIABILITY_PREFIX = "route-provider-reliability:";

function reliabilityKey(routeId: string): string {
  return `${ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}`;
}

async function clearRouteReliability(): Promise<void> {
  for (const prefix of [ROUTE_RELIABILITY_PREFIX, PROVIDER_ROUTE_RELIABILITY_PREFIX]) {
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
      status,
    });

    await expect(loadRouteReliability(env, routeId)).resolves.toMatchObject({
      routeId,
      ok: false,
      outcome,
      httpStatusClass,
    });
  });

  it("does not let a BYOK authentication failure overwrite shared route reliability", async () => {
    const routeId = "member-byok";
    const existing = validRecord(routeId);
    await env.CHAT_STORE.put(reliabilityKey(routeId), JSON.stringify(existing));

    await recordRouteReliability(env, {
      routeId,
      ok: false,
      fallback: false,
      startedAt: Date.now(),
      status: 401,
      usedUserKey: true,
    });
    await recordRouteReliability(env, {
      routeId,
      ok: false,
      fallback: false,
      startedAt: Date.now(),
      status: 403,
      usedUserKey: true,
    });

    await expect(env.CHAT_STORE.get(reliabilityKey(routeId), "json")).resolves.toEqual(existing);
  });

  it("distinguishes timeout, protocol, and network failures", async () => {
    const timeout = new Error("upstream request timed out");
    timeout.name = "TimeoutError";
    await recordRouteReliability(env, {
      routeId: "timeout",
      ok: false,
      fallback: false,
      startedAt: Date.now(),
      error: timeout,
    });
    await recordRouteReliability(env, {
      routeId: "protocol",
      ok: false,
      fallback: true,
      startedAt: Date.now(),
      status: 502,
      error: new Error("provider returned an invalid response shape"),
    });
    await recordRouteReliability(env, {
      routeId: "network",
      ok: false,
      fallback: false,
      startedAt: Date.now(),
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
    });
    await recordRouteReliability(env, {
      routeId: "reasoning",
      providerId: "provider-a",
      ok: false,
      fallback: true,
      startedAt: Date.now() - 300,
      status: 503,
    });
    await recordRouteReliability(env, {
      routeId: "reasoning",
      providerId: "provider-b",
      ok: true,
      fallback: false,
      startedAt: Date.now() - 50,
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
      firstVisibleLatencyMs: 200,
      streamShape: "progressive",
    });
    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: true,
      fallback: false,
      startedAt: Date.now() - 200,
      firstVisibleLatencyMs: 100,
      streamShape: "single_chunk",
    });
    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: true,
      fallback: false,
      startedAt: Date.now() - 75,
    });
    await recordRouteReliability(env, {
      routeId,
      providerId,
      ok: false,
      fallback: false,
      startedAt: Date.now() - 50,
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
