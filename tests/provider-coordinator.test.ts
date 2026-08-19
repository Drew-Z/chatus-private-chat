import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ProviderReliabilitySample } from "../src/services/route-reliability";

describe("ProviderCoordinator", () => {
  it("enforces one exclusive lease across every model using the provider", async () => {
    const coordinator = env.PROVIDER_COORDINATOR.getByName(`exclusive-${crypto.randomUUID()}`);
    const first = await coordinator.acquire({ requestId: "user-a:model-a", capacity: 1, waitMs: 0 });
    const second = await coordinator.acquire({ requestId: "user-b:model-b", capacity: 1, waitMs: 0 });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: "provider_busy" });
    expect(await coordinator.inspect()).toMatchObject({ active: 1, waiting: 0 });
  });

  it("supports bounded capacity and grants a waiter immediately after release", async () => {
    const coordinator = env.PROVIDER_COORDINATOR.getByName(`bounded-${crypto.randomUUID()}`);
    const first = await coordinator.acquire({ requestId: "first", capacity: 2, waitMs: 0 });
    const second = await coordinator.acquire({ requestId: "second", capacity: 2, waitMs: 0 });
    expect(first.ok && second.ok).toBe(true);

    const waiting = coordinator.acquire({ requestId: "waiting", capacity: 2, waitMs: 2_000 });
    await waitUntil(async () => (await coordinator.inspect()).waiting === 1);
    if (!first.ok) throw new Error("missing first lease");
    await coordinator.release({ token: first.token });

    await expect(waiting).resolves.toMatchObject({ ok: true });
    await expect(coordinator.inspect()).resolves.toMatchObject({ active: 2, waiting: 0 });
  });

  it("coalesces duplicate queued acquisitions by request ID", async () => {
    const coordinator = env.PROVIDER_COORDINATOR.getByName(`duplicate-wait-${crypto.randomUUID()}`);
    const active = await coordinator.acquire({ requestId: "active", capacity: 1, waitMs: 0 });
    expect(active.ok).toBe(true);

    const firstWait = coordinator.acquire({ requestId: "same-request", capacity: 1, waitMs: 2_000 });
    await waitUntil(async () => (await coordinator.inspect()).waiting === 1);
    let duplicateSettled = false;
    const duplicateWait = coordinator.acquire({ requestId: "same-request", capacity: 1, waitMs: 0 })
      .then((result) => {
        duplicateSettled = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(duplicateSettled).toBe(false);
    await expect(coordinator.inspect()).resolves.toMatchObject({ active: 1, waiting: 1 });
    if (!active.ok) throw new Error("missing active lease");
    await coordinator.release({ token: active.token });

    const [first, duplicate] = await Promise.all([firstWait, duplicateWait]);
    expect(first.ok).toBe(true);
    expect(duplicate).toEqual(first);
    await expect(coordinator.inspect()).resolves.toMatchObject({ active: 1, waiting: 0 });
    if (first.ok) await coordinator.release({ token: first.token });
  });

  it("cancels a pending waiter without consuming capacity later", async () => {
    const coordinator = env.PROVIDER_COORDINATOR.getByName(`cancel-${crypto.randomUUID()}`);
    const active = await coordinator.acquire({ requestId: "active", capacity: 1, waitMs: 0 });
    expect(active.ok).toBe(true);
    const waiting = coordinator.acquire({ requestId: "cancel-me", capacity: 1, waitMs: 2_000 });
    await waitUntil(async () => (await coordinator.inspect()).waiting === 1);

    await coordinator.cancel({ requestId: "cancel-me" });
    await expect(waiting).resolves.toMatchObject({ ok: false, error: "provider_busy" });
    if (!active.ok) throw new Error("missing active lease");
    await coordinator.release({ token: active.token });
    await expect(coordinator.inspect()).resolves.toMatchObject({ active: 0, waiting: 0 });
  });

  it("recovers capacity after a lease expires", async () => {
    const coordinator = env.PROVIDER_COORDINATOR.getByName(`expiry-${crypto.randomUUID()}`);
    const first = await coordinator.acquire({ requestId: "abandoned", capacity: 1, waitMs: 0, leaseTtlMs: 1_000 });
    expect(first.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await expect(coordinator.acquire({ requestId: "replacement", capacity: 1, waitMs: 0 })).resolves.toMatchObject({ ok: true });
  });

  it("renews only the exact active lease", async () => {
    const coordinator = env.PROVIDER_COORDINATOR.getByName(`renew-${crypto.randomUUID()}`);
    const lease = await coordinator.acquire({ requestId: "admin-mutation", capacity: 1, waitMs: 0, leaseTtlMs: 1_000 });
    if (!lease.ok) throw new Error("missing lease");

    await expect(coordinator.renew({
      token: lease.token,
      requestId: "admin-mutation",
      leaseTtlMs: 5_000,
    })).resolves.toMatchObject({ ok: true, expiresAt: expect.any(Number) });
    await expect(coordinator.renew({
      token: "wrong-token",
      requestId: "admin-mutation",
      leaseTtlMs: 5_000,
    })).resolves.toEqual({ ok: false, error: "provider_lease_missing" });
    await expect(coordinator.acquire({ requestId: "blocked", capacity: 1, waitMs: 0 })).resolves.toMatchObject({
      ok: false,
      error: "provider_busy",
    });
    await coordinator.release({ token: lease.token, requestId: "admin-mutation" });
  });

  it("normalizes persisted leases before restoring capacity and alarms", async () => {
    const name = `restore-${crypto.randomUUID()}`;
    const coordinator = env.PROVIDER_COORDINATOR.getByName(name);
    await coordinator.inspect();

    const now = Date.now();
    const secondExpiry = now + 50_000;
    const newestExpiry = now + 60_000;
    await runInDurableObject(coordinator, async (_instance, state) => {
      await state.storage.put("provider-leases:v1", [
        { token: "older-token", requestId: "same-request", expiresAt: now + 30_000 },
        { token: "newer-token", requestId: "same-request", expiresAt: newestExpiry },
        { token: "newer-token", requestId: "duplicate-token", expiresAt: now + 45_000 },
        { token: "second-token", requestId: "second-request", expiresAt: secondExpiry },
        { token: "expired-token", requestId: "expired-request", expiresAt: now - 1_000 },
        { token: "", requestId: "empty-token", expiresAt: now + 40_000 },
        { token: "empty-request", requestId: "   ", expiresAt: now + 40_000 },
        { token: "invalid-expiry", requestId: "invalid-expiry", expiresAt: "later" },
        null,
      ]);
      await state.storage.setAlarm(now + 120_000);
    });
    await evictDurableObject(coordinator);

    const restored = env.PROVIDER_COORDINATOR.getByName(name);
    await expect(restored.inspect()).resolves.toEqual({
      active: 2,
      waiting: 0,
      expiresAt: [secondExpiry, newestExpiry],
    });
    await expect(restored.acquire({ requestId: "same-request", capacity: 2, waitMs: 0 })).resolves.toEqual({
      ok: true,
      token: "newer-token",
      expiresAt: newestExpiry,
    });
    await expect(restored.acquire({ requestId: "third-request", capacity: 2, waitMs: 0 })).resolves.toMatchObject({
      ok: false,
      error: "provider_busy",
    });

    const persisted = await runInDurableObject(restored, async (_instance, state) => ({
      alarm: await state.storage.getAlarm(),
      leases: await state.storage.get("provider-leases:v1"),
    }));
    expect(persisted).toEqual({
      alarm: secondExpiry,
      leases: [
        { token: "second-token", requestId: "second-request", expiresAt: secondExpiry },
        { token: "newer-token", requestId: "same-request", expiresAt: newestExpiry },
      ],
    });
  });

  it("serializes concurrent chat quality samples and keeps DO storage authoritative after eviction", async () => {
    const providerId = `chat-quality-${crypto.randomUUID()}`;
    const routeId = `reasoning-${crypto.randomUUID()}`;
    const coordinator = env.PROVIDER_COORDINATOR.getByName(providerId);
    const first = reliabilitySample(routeId, providerId, {
      ok: true,
      outcome: "success",
      fallback: false,
      firstVisibleLatencyMs: 120,
      streamShape: "progressive",
    });
    const second = reliabilitySample(routeId, providerId, {
      ok: false,
      outcome: "upstream_server",
      fallback: true,
    });

    await Promise.all([
      coordinator.recordReliabilitySample({ operation: "chat", sample: first }),
      coordinator.recordReliabilitySample({ operation: "chat", sample: second }),
    ]);

    const storageKey = `reliability:chat:${encodeURIComponent(routeId)}`;
    await expect(runInDurableObject(coordinator, async (_instance, state) => (
      state.storage.get(storageKey)
    ))).resolves.toMatchObject({
      attempts: 2,
      successes: 1,
      fallbackCount: 1,
      streamSamples: 1,
      progressiveSamples: 1,
    });

    const projectionKey = `route-provider-reliability:${encodeURIComponent(routeId)}:${encodeURIComponent(providerId)}`;
    await env.CHAT_STORE.put(projectionKey, JSON.stringify({
      version: 2,
      source: "real_task",
      routeId,
      providerId,
      attempts: 900,
      successes: 900,
      averageLatencyMs: 1,
      lastOutcome: "success",
      observedAt: new Date().toISOString(),
    }));
    await evictDurableObject(coordinator);

    const restored = env.PROVIDER_COORDINATOR.getByName(providerId);
    const third = await restored.recordReliabilitySample({
      operation: "chat",
      sample: reliabilitySample(routeId, providerId, {
        ok: true,
        outcome: "success",
        fallback: false,
        firstVisibleLatencyMs: 80,
        streamShape: "single_chunk",
      }),
    });
    expect(third).toMatchObject({
      attempts: 3,
      successes: 2,
      fallbackCount: 1,
      streamSamples: 2,
      progressiveSamples: 1,
    });
    await expect(env.CHAT_STORE.get(projectionKey, "json")).resolves.toMatchObject({
      attempts: 3,
      successes: 2,
    });
  });

  it("serializes concurrent selector samples and keeps selector storage authoritative after eviction", async () => {
    const providerId = `selector-quality-${crypto.randomUUID()}`;
    const routeId = `reasoning-${crypto.randomUUID()}`;
    const coordinator = env.PROVIDER_COORDINATOR.getByName(providerId);

    await Promise.all([
      coordinator.recordReliabilitySample({
        operation: "skill_selection",
        sample: reliabilitySample(routeId, providerId, {
          ok: true,
          outcome: "success",
          fallback: false,
        }),
      }),
      coordinator.recordReliabilitySample({
        operation: "skill_selection",
        sample: reliabilitySample(routeId, providerId, {
          ok: false,
          outcome: "protocol_error",
          fallback: true,
        }),
      }),
    ]);

    const storageKey = `reliability:skill_selection:${encodeURIComponent(routeId)}`;
    await expect(runInDurableObject(coordinator, async (_instance, state) => (
      state.storage.get(storageKey)
    ))).resolves.toMatchObject({
      operation: "skill_selection",
      attempts: 2,
      successes: 1,
      fallbackCount: 1,
    });

    const projectionKey = `route-provider-skill-selection:${encodeURIComponent(routeId)}:${encodeURIComponent(providerId)}`;
    await env.CHAT_STORE.put(projectionKey, JSON.stringify({
      version: 1,
      source: "real_task",
      operation: "skill_selection",
      routeId,
      providerId,
      attempts: 700,
      successes: 700,
      averageLatencyMs: 1,
      lastOutcome: "success",
      observedAt: new Date().toISOString(),
      lastFallback: false,
      fallbackCount: 0,
    }));
    await evictDurableObject(coordinator);

    const restored = env.PROVIDER_COORDINATOR.getByName(providerId);
    const third = await restored.recordReliabilitySample({
      operation: "skill_selection",
      sample: reliabilitySample(routeId, providerId, {
        ok: true,
        outcome: "success",
        fallback: false,
      }),
    });
    expect(third).toMatchObject({ attempts: 3, successes: 2, fallbackCount: 1 });
    await expect(env.CHAT_STORE.get(projectionKey, "json")).resolves.toMatchObject({
      attempts: 3,
      successes: 2,
    });
  });

  it("uses existing chat v2 and selector v1 KV projections as one-time seeds", async () => {
    const providerId = `legacy-seed-${crypto.randomUUID()}`;
    const chatRouteId = `chat-seed-${crypto.randomUUID()}`;
    const selectorRouteId = `selector-seed-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(
      `route-provider-reliability:${encodeURIComponent(chatRouteId)}:${encodeURIComponent(providerId)}`,
      JSON.stringify({
        version: 2,
        source: "real_task",
        routeId: chatRouteId,
        providerId,
        attempts: 4,
        successes: 3,
        averageLatencyMs: 150,
        lastOutcome: "upstream_server",
        observedAt: new Date().toISOString(),
        lastFallback: true,
        fallbackCount: 1,
      }),
    );
    await env.CHAT_STORE.put(
      `route-provider-skill-selection:${encodeURIComponent(selectorRouteId)}:${encodeURIComponent(providerId)}`,
      JSON.stringify({
        version: 1,
        source: "real_task",
        operation: "skill_selection",
        routeId: selectorRouteId,
        providerId,
        attempts: 5,
        successes: 2,
        averageLatencyMs: 200,
        lastOutcome: "protocol_error",
        observedAt: new Date().toISOString(),
        lastFallback: false,
        fallbackCount: 1,
      }),
    );
    const coordinator = env.PROVIDER_COORDINATOR.getByName(providerId);

    await expect(coordinator.recordReliabilitySample({
      operation: "chat",
      sample: reliabilitySample(chatRouteId, providerId),
    })).resolves.toMatchObject({ attempts: 5, successes: 4, fallbackCount: 1 });
    await expect(coordinator.recordReliabilitySample({
      operation: "skill_selection",
      sample: reliabilitySample(selectorRouteId, providerId),
    })).resolves.toMatchObject({ attempts: 6, successes: 3, fallbackCount: 1 });
  });

  it("serializes bounded capability monitoring rows and restores them after eviction", async () => {
    const name = `capability-monitoring-${crypto.randomUUID()}`;
    const coordinator = env.PROVIDER_COORDINATOR.getByName(name);
    const occurredAt = Date.now();
    await Promise.all([
      coordinator.recordCapabilityMonitoringEvent({
        version: 1,
        capabilityId: "chatus:web_research",
        kind: "web_research",
        status: "succeeded",
        latencyMs: 250,
        occurredAt,
      }),
      coordinator.recordCapabilityMonitoringEvent({
        version: 1,
        capabilityId: "chatus:web_research",
        kind: "web_research",
        status: "failed",
        latencyMs: 500,
        occurredAt: occurredAt + 1,
      }),
    ]);

    await expect(runInDurableObject(coordinator, async (_instance, state) => (
      state.storage.get("capability-monitoring:v1")
    ))).resolves.toMatchObject({
      version: 1,
      rows: expect.arrayContaining([
        expect.objectContaining({ capabilityId: "chatus:web_research", status: "succeeded", count: 1 }),
        expect.objectContaining({ capabilityId: "chatus:web_research", status: "failed", count: 1 }),
      ]),
    });

    await evictDurableObject(coordinator);
    const restored = env.PROVIDER_COORDINATOR.getByName(name);
    await restored.recordCapabilityMonitoringEvent({
      version: 1,
      capabilityId: "chatus:web_research",
      kind: "web_research",
      status: "succeeded",
      latencyMs: null,
      occurredAt: occurredAt + 2,
    });
    await expect(restored.getCapabilityMonitoringAggregate({
      periodStart: occurredAt - 60_000,
      periodEnd: occurredAt + 60_000,
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "succeeded", count: 2, latencySumMs: 250, latencyCount: 1 }),
      expect.objectContaining({ status: "failed", count: 1, latencySumMs: 500, latencyCount: 1 }),
    ]));
  });
});

function reliabilitySample(
  routeId: string,
  providerId: string,
  overrides: Partial<ProviderReliabilitySample> = {},
): ProviderReliabilitySample {
  return {
    version: 2,
    source: "real_task",
    routeId,
    providerId,
    ok: true,
    outcome: "success",
    observedAt: new Date().toISOString(),
    latencyMs: 100,
    fallback: false,
    ...overrides,
  };
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not reached before timeout");
}
