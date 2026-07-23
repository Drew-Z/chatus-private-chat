import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
});

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not reached before timeout");
}
