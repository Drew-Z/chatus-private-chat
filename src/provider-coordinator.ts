import { DurableObject } from "cloudflare:workers";
import {
  normalizeProviderReliabilitySample,
  normalizeProviderRouteReliability,
  normalizeSkillSelectionTelemetry,
  providerRouteReliabilityKey,
  reduceProviderRouteReliability,
  reduceSkillSelectionTelemetry,
  skillSelectionTelemetryKey,
  type ProviderReliabilitySample,
  type ProviderRouteReliabilityRecord,
  type SkillSelectionTelemetryRecord,
} from "./services/route-reliability";
import { captureDurableObjectState } from "./services/durable-object-capture";
import {
  INSTANCE_MAINTENANCE_COORDINATOR,
} from "./services/instance-capture";
import type { InstanceCoordinator } from "./instance-coordinator";
import {
  bucketStartForCapabilityMonitoring,
  decodeCapabilityMonitoringAggregate,
  decodeCapabilityMonitoringEvent,
  emptyCapabilityMonitoringAggregate,
  reduceCapabilityMonitoringAggregate,
  type CapabilityMonitoringAggregateV1,
  type CapabilityMonitoringEventV1,
  type CapabilityMonitoringRowV1,
} from "./contracts/capability-monitoring";

const LEASES_STORAGE_KEY = "provider-leases:v1";
const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1_000;
const MAX_LEASE_TTL_MS = 60 * 60 * 1_000;
const MAX_WAIT_MS = 10_000;
const MAX_CAPACITY = 100;
const MAX_WAITERS = 200;
const RELIABILITY_CHAT_PREFIX = "reliability:chat:";
const RELIABILITY_SELECTOR_PREFIX = "reliability:skill_selection:";
const CAPABILITY_MONITORING_STORAGE_KEY = "capability-monitoring:v1";
export const PROVIDER_COORDINATOR_SCHEMA_VERSION = 2;

type ProviderCoordinatorEnv = {
  CHAT_STORE: KVNamespace;
  INSTANCE_COORDINATOR: DurableObjectNamespace<InstanceCoordinator>;
};

export type ProviderReliabilityOperation = "chat" | "skill_selection";

export type ProviderReliabilitySampleInput = {
  operation: ProviderReliabilityOperation;
  sample: ProviderReliabilitySample;
};

export type CapabilityMonitoringPeriodInput = {
  periodStart: number;
  periodEnd: number;
};

export type ProviderLeaseAcquireInput = {
  requestId: string;
  capacity: number;
  waitMs?: number;
  leaseTtlMs?: number;
};

export type ProviderLeaseAcquireResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; error: "provider_busy"; retryAfterMs: number };

export type ProviderLeaseReleaseInput = {
  token?: string;
  requestId?: string;
};

export type ProviderLeaseRenewInput = {
  token: string;
  requestId: string;
  leaseTtlMs?: number;
};

export type ProviderLeaseRenewResult =
  | { ok: true; expiresAt: number }
  | { ok: false; error: "provider_lease_missing" };

type StoredLease = {
  token: string;
  requestId: string;
  expiresAt: number;
};

type PendingWaiter = {
  requestId: string;
  capacity: number;
  leaseTtlMs: number;
  deadline: number;
  resolve: (result: ProviderLeaseAcquireResult) => void;
  promise: Promise<ProviderLeaseAcquireResult>;
  timer: ReturnType<typeof setTimeout>;
};

export class ProviderCoordinator extends DurableObject<ProviderCoordinatorEnv> {
  private leases: StoredLease[] = [];
  private readonly waiters: PendingWaiter[] = [];

  constructor(ctx: DurableObjectState, env: ProviderCoordinatorEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const instanceName = ctx.id.name;
      if (!instanceName) throw new Error("provider_coordinator_instance_name_unavailable");
      const registered = await env.INSTANCE_COORDINATOR
        .getByName(INSTANCE_MAINTENANCE_COORDINATOR)
        .registerObject({
          version: 1,
          kind: "provider_coordinator",
          instanceName,
          rootInstanceName: "",
          schemaVersion: `provider-coordinator-v${PROVIDER_COORDINATOR_SCHEMA_VERSION}`,
          stateClass: "rebuildable",
          restoreBehavior: "rebuild",
          registeredAt: Date.now(),
        });
      if (!registered.ok) throw new Error(registered.error);
      this.leases = normalizeStoredLeases(await ctx.storage.get(LEASES_STORAGE_KEY), Date.now());
      // Rewrite recovered state so malformed records cannot survive a restart.
      await this.persistLeases();
      const monitoring = decodeCapabilityMonitoringAggregate(
        await ctx.storage.get(CAPABILITY_MONITORING_STORAGE_KEY),
      );
      if (monitoring) await ctx.storage.put(CAPABILITY_MONITORING_STORAGE_KEY, monitoring);
      else await ctx.storage.delete(CAPABILITY_MONITORING_STORAGE_KEY);
    });
  }

  async recordReliabilitySample(
    input: ProviderReliabilitySampleInput,
  ): Promise<ProviderRouteReliabilityRecord | SkillSelectionTelemetryRecord> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const sample = normalizeProviderReliabilitySample(input.sample);
      if (!sample || (input.operation !== "chat" && input.operation !== "skill_selection")) {
        throw new Error("invalid_reliability_sample");
      }
      const storageKey = reliabilityStorageKey(input.operation, sample.routeId);
      const current = await this.readReliabilityRecord(
        input.operation,
        sample.routeId,
        sample.providerId,
        storageKey,
      );
      const next = input.operation === "chat"
        ? reduceProviderRouteReliability(current as ProviderRouteReliabilityRecord | null, sample)
        : reduceSkillSelectionTelemetry(current as SkillSelectionTelemetryRecord | null, sample);
      await this.ctx.storage.put(storageKey, next);
      await this.writeProjection(input.operation, sample.routeId, sample.providerId, next);
      return next;
    });
  }

  async recordCapabilityMonitoringEvent(
    event: CapabilityMonitoringEventV1,
  ): Promise<CapabilityMonitoringAggregateV1> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const normalized = decodeCapabilityMonitoringEvent(event);
      if (!normalized) throw new Error("invalid_capability_monitoring_event");
      const stored = decodeCapabilityMonitoringAggregate(
        await this.ctx.storage.get(CAPABILITY_MONITORING_STORAGE_KEY),
      );
      const next = reduceCapabilityMonitoringAggregate(stored, normalized, Date.now());
      if (next.rows.length) await this.ctx.storage.put(CAPABILITY_MONITORING_STORAGE_KEY, next);
      else await this.ctx.storage.delete(CAPABILITY_MONITORING_STORAGE_KEY);
      return next;
    });
  }

  async getCapabilityMonitoringAggregate(
    input: CapabilityMonitoringPeriodInput,
  ): Promise<CapabilityMonitoringRowV1[]> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (
        !Number.isSafeInteger(input.periodStart)
        || !Number.isSafeInteger(input.periodEnd)
        || input.periodStart < 0
        || input.periodEnd < input.periodStart
      ) return [];
      const aggregate = decodeCapabilityMonitoringAggregate(
        await this.ctx.storage.get(CAPABILITY_MONITORING_STORAGE_KEY),
      );
      if (!aggregate) return [];
      const rows = aggregate.rows.filter((row) => (
        row.bucketStart >= bucketStartForCapabilityMonitoring(input.periodStart)
        && row.bucketStart <= bucketStartForCapabilityMonitoring(input.periodEnd)
      ));
      return rows;
    });
  }

  async acquire(input: ProviderLeaseAcquireInput): Promise<ProviderLeaseAcquireResult> {
    const requestId = normalizeRequestId(input.requestId);
    if (!requestId) return busyResult(0);
    const capacity = clampInteger(input.capacity, 1, MAX_CAPACITY, 1);
    const waitMs = clampInteger(input.waitMs, 0, MAX_WAIT_MS, 0);
    const leaseTtlMs = clampInteger(input.leaseTtlMs, 1_000, MAX_LEASE_TTL_MS, DEFAULT_LEASE_TTL_MS);

    const decision = await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      await this.pruneAndPersist(now);
      const existing = this.leases.find((lease) => lease.requestId === requestId);
      if (existing) return { result: leaseResult(existing) };
      const pending = this.waiters.find((waiter) => waiter.requestId === requestId);
      if (pending) return { promise: pending.promise };
      if (this.leases.length < capacity) {
        const lease = createLease(requestId, now + leaseTtlMs);
        this.leases.push(lease);
        await this.persistLeases();
        return { result: leaseResult(lease) };
      }
      if (!waitMs || this.waiters.length >= MAX_WAITERS) return { result: this.busy(now) };

      let resolve!: (result: ProviderLeaseAcquireResult) => void;
      const promise = new Promise<ProviderLeaseAcquireResult>((settle) => { resolve = settle; });
      const waiter: PendingWaiter = {
        requestId,
        capacity,
        leaseTtlMs,
        deadline: now + waitMs,
        resolve,
        promise,
        timer: setTimeout(() => this.expireWaiter(requestId), waitMs),
      };
      this.waiters.push(waiter);
      return { promise };
    });

    if ("result" in decision && decision.result) return decision.result;
    if ("promise" in decision && decision.promise) return decision.promise;
    return busyResult(0);
  }

  async release(input: ProviderLeaseReleaseInput): Promise<{ ok: true; released: boolean }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const before = this.leases.length;
      this.leases = this.leases.filter((lease) => !matchesRelease(lease, input));
      const released = this.leases.length !== before;
      await this.grantWaiters(now);
      await this.persistLeases();
      return { ok: true, released };
    });
  }

  async renew(input: ProviderLeaseRenewInput): Promise<ProviderLeaseRenewResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      await this.pruneAndPersist(now);
      const requestId = normalizeRequestId(input.requestId);
      const token = typeof input.token === "string" ? input.token.trim().slice(0, 160) : "";
      const lease = this.leases.find((candidate) => candidate.requestId === requestId && candidate.token === token);
      if (!lease) return { ok: false, error: "provider_lease_missing" };
      lease.expiresAt = now + clampInteger(input.leaseTtlMs, 1_000, MAX_LEASE_TTL_MS, DEFAULT_LEASE_TTL_MS);
      await this.persistLeases();
      return { ok: true, expiresAt: lease.expiresAt };
    });
  }

  async cancel(input: ProviderLeaseReleaseInput): Promise<{ ok: true; cancelled: boolean }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      let cancelled = false;
      for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
        const waiter = this.waiters[index];
        if (!input.requestId || waiter.requestId !== input.requestId) continue;
        this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(busyResult(0));
        cancelled = true;
      }

      const before = this.leases.length;
      this.leases = this.leases.filter((lease) => !matchesRelease(lease, input));
      cancelled ||= this.leases.length !== before;
      await this.grantWaiters(Date.now());
      await this.persistLeases();
      return { ok: true, cancelled };
    });
  }

  async inspect(): Promise<{ active: number; waiting: number; expiresAt: number[] }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.pruneAndPersist(Date.now());
      return {
        active: this.leases.length,
        waiting: this.waiters.length,
        expiresAt: this.leases.map((lease) => lease.expiresAt).sort((a, b) => a - b),
      };
    });
  }

  async captureInstanceState(captureEpoch: string) {
    if (!isCaptureEpoch(captureEpoch)) throw new Error("capture_epoch_invalid");
    return captureDurableObjectState(
      this.ctx.storage,
      `provider-coordinator-v${PROVIDER_COORDINATOR_SCHEMA_VERSION}`,
      () => false,
    );
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      await this.pruneAndPersist(now);
      await this.grantWaiters(now);
      await this.persistLeases();
    });
  }

  private async grantWaiters(now: number): Promise<void> {
    this.leases = this.leases.filter((lease) => lease.expiresAt > now);
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index];
      if (waiter.deadline <= now) {
        this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(this.busy(now));
        continue;
      }
      if (this.leases.length >= waiter.capacity) {
        index += 1;
        continue;
      }
      this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      const lease = createLease(waiter.requestId, now + waiter.leaseTtlMs);
      this.leases.push(lease);
      waiter.resolve(leaseResult(lease));
    }
  }

  private expireWaiter(requestId: string): void {
    const index = this.waiters.findIndex((waiter) => waiter.requestId === requestId);
    if (index < 0) return;
    const [waiter] = this.waiters.splice(index, 1);
    waiter.resolve(this.busy(Date.now()));
  }

  private busy(now: number): ProviderLeaseAcquireResult {
    const nextExpiry = this.leases.reduce(
      (minimum, lease) => Math.min(minimum, lease.expiresAt),
      Number.POSITIVE_INFINITY,
    );
    return busyResult(Number.isFinite(nextExpiry) ? Math.max(0, nextExpiry - now) : 0);
  }

  private async pruneAndPersist(now: number): Promise<void> {
    const before = this.leases.length;
    this.leases = this.leases.filter((lease) => lease.expiresAt > now);
    if (this.leases.length !== before) await this.persistLeases();
    else await this.scheduleAlarm();
  }

  private async persistLeases(): Promise<void> {
    if (this.leases.length) await this.ctx.storage.put(LEASES_STORAGE_KEY, this.leases);
    else await this.ctx.storage.delete(LEASES_STORAGE_KEY);
    await this.scheduleAlarm();
  }

  private async scheduleAlarm(): Promise<void> {
    if (!this.leases.length) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...this.leases.map((lease) => lease.expiresAt)));
  }

  private async readReliabilityRecord(
    operation: ProviderReliabilityOperation,
    routeId: string,
    providerId: string,
    storageKey: string,
  ): Promise<ProviderRouteReliabilityRecord | SkillSelectionTelemetryRecord | null> {
    const stored = await this.ctx.storage.get(storageKey);
    if (stored) {
      return operation === "chat"
        ? normalizeProviderRouteReliability(stored, routeId, providerId)
        : normalizeSkillSelectionTelemetry(stored, routeId, providerId);
    }
    const kv = this.env.CHAT_STORE;
    try {
      const raw = await kv.get(operation === "chat"
        ? providerRouteReliabilityKey(routeId, providerId)
        : skillSelectionTelemetryKey(routeId, providerId));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return operation === "chat"
        ? normalizeProviderRouteReliability(parsed, routeId, providerId)
        : normalizeSkillSelectionTelemetry(parsed, routeId, providerId);
    } catch {
      return null;
    }
  }

  private async writeProjection(
    operation: ProviderReliabilityOperation,
    routeId: string,
    providerId: string,
    value: ProviderRouteReliabilityRecord | SkillSelectionTelemetryRecord,
  ): Promise<void> {
    const kv = this.env.CHAT_STORE;
    try {
      await kv.put(
        operation === "chat"
          ? providerRouteReliabilityKey(routeId, providerId)
          : skillSelectionTelemetryKey(routeId, providerId),
        JSON.stringify(value),
      );
    } catch {
      console.warn(JSON.stringify({
        level: "warn",
        event: "provider_reliability_projection_write_failed",
        operation,
        routeId,
        providerId,
      }));
    }
  }
}

function reliabilityStorageKey(operation: ProviderReliabilityOperation, routeId: string): string {
  const prefix = operation === "chat" ? RELIABILITY_CHAT_PREFIX : RELIABILITY_SELECTOR_PREFIX;
  return `${prefix}${encodeURIComponent(routeId)}`;
}

function normalizeStoredLeases(value: unknown, now: number): StoredLease[] {
  if (!Array.isArray(value)) return [];
  const candidates = value.flatMap((item): StoredLease[] => {
    if (!item || typeof item !== "object") return [];
    const lease = item as Partial<StoredLease>;
    const token = typeof lease.token === "string" ? lease.token.trim().slice(0, 160) : "";
    const requestId = normalizeRequestId(lease.requestId);
    if (
      !token
      || !requestId
      || typeof lease.expiresAt !== "number"
      || !Number.isFinite(lease.expiresAt)
      || lease.expiresAt <= now
    ) return [];
    return [{ token, requestId, expiresAt: lease.expiresAt }];
  }).sort((left, right) => right.expiresAt - left.expiresAt);

  const tokens = new Set<string>();
  const requestIds = new Set<string>();
  const normalized = candidates.filter((lease) => {
    if (tokens.has(lease.token) || requestIds.has(lease.requestId)) return false;
    tokens.add(lease.token);
    requestIds.add(lease.requestId);
    return true;
  });
  return normalized.sort((left, right) => left.expiresAt - right.expiresAt);
}

function createLease(requestId: string, expiresAt: number): StoredLease {
  return { token: crypto.randomUUID(), requestId, expiresAt };
}

function leaseResult(lease: StoredLease): ProviderLeaseAcquireResult {
  return { ok: true, token: lease.token, expiresAt: lease.expiresAt };
}

function busyResult(retryAfterMs: number): ProviderLeaseAcquireResult {
  return { ok: false, error: "provider_busy", retryAfterMs: Math.max(0, Math.round(retryAfterMs)) };
}

function matchesRelease(lease: StoredLease, input: ProviderLeaseReleaseInput): boolean {
  return Boolean(
    (input.token && lease.token === input.token)
    || (input.requestId && lease.requestId === input.requestId),
  );
}

function normalizeRequestId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

function isCaptureEpoch(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(value);
}
