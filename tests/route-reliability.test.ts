import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isRecentProviderRouteReliability,
  isRecentRouteReliability,
  loadProviderRouteReliability,
  loadRouteReliability,
  recordRouteReliability,
  type RouteReliabilityRecord,
} from "../src/services/route-reliability";

const ROUTE_RELIABILITY_PREFIX = "route-reliability:";

function reliabilityKey(routeId: string): string {
  return `${ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}`;
}

async function clearRouteReliability(): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: ROUTE_RELIABILITY_PREFIX, cursor, limit: 100 });
    await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

function validRecord(routeId: string, overrides: Partial<RouteReliabilityRecord> = {}): RouteReliabilityRecord {
  return {
    version: 1,
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
    ];

    for (const raw of malformed) {
      await env.CHAT_STORE.put(reliabilityKey("primary"), raw);
      await expect(loadRouteReliability(env, "primary")).resolves.toBeNull();
    }

    const expired = validRecord("primary", { observedAt: "2026-07-01T00:00:00.000Z" });
    const future = validRecord("primary", { observedAt: "2026-07-18T00:00:00.000Z" });
    expect(isRecentRouteReliability(expired, Date.parse("2026-07-17T00:00:00.000Z"))).toBe(false);
    expect(isRecentRouteReliability(future, Date.parse("2026-07-17T00:00:00.000Z"))).toBe(false);
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

  it("treats expired provider-pair quality as unknown", async () => {
    const expired = {
      version: 1,
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
