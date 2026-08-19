export const CAPABILITY_MONITORING_VERSION = 1 as const;
export const CAPABILITY_MONITORING_WINDOW = "24h" as const;
export const CAPABILITY_MONITORING_BUCKET = "hour" as const;
export const CAPABILITY_MONITORING_BUCKET_MS = 60 * 60 * 1_000;
export const CAPABILITY_MONITORING_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const CAPABILITY_MONITORING_RETENTION_MS = 48 * 60 * 60 * 1_000;
export const CAPABILITY_MONITORING_MAX_ROWS = 4 * 5 * 49;
export const CAPABILITY_MONITORING_MAX_COUNT_PER_ROW = 100_000;
export const CAPABILITY_MONITORING_MAX_LATENCY_MS = 600_000;

export const CAPABILITY_ID_WORKFLOW_SELECTION = "chatus:workflow_selection" as const;
export const CAPABILITY_ID_VISION_ASSIST = "chatus:vision_assist" as const;
export const CAPABILITY_ID_WEB_RESEARCH = "chatus:web_research" as const;
export const CAPABILITY_ID_TOOL_EXECUTION = "chatus:tool_execution" as const;

export const CAPABILITY_MONITORING_IDS = [
  CAPABILITY_ID_WORKFLOW_SELECTION,
  CAPABILITY_ID_VISION_ASSIST,
  CAPABILITY_ID_WEB_RESEARCH,
  CAPABILITY_ID_TOOL_EXECUTION,
] as const;

export type CapabilityMonitoringId = (typeof CAPABILITY_MONITORING_IDS)[number];
export type CapabilityMonitoringKind = "workflow_selection" | "auxiliary_vision" | "web_research" | "tool";
export type CapabilityMonitoringStatus = "succeeded" | "failed" | "denied" | "cancelled" | "timed_out";
export type CapabilityMonitoringEvidence = "fresh" | "stale" | "no_data" | "unavailable";

export type CapabilityMonitoringEventV1 = {
  version: 1;
  capabilityId: CapabilityMonitoringId;
  kind: CapabilityMonitoringKind;
  status: CapabilityMonitoringStatus;
  latencyMs: number | null;
  occurredAt: number;
};

export type CapabilityMonitoringRowV1 = {
  version: 1;
  capabilityId: CapabilityMonitoringId;
  kind: CapabilityMonitoringKind;
  status: CapabilityMonitoringStatus;
  bucketStart: number;
  count: number;
  latencySumMs: number;
  latencyCount: number;
  lastOccurredAt: number;
};

export type CapabilityMonitoringAggregateV1 = {
  version: 1;
  rows: CapabilityMonitoringRowV1[];
};

export type CapabilityMonitoringSummaryV1 = {
  capabilityId: CapabilityMonitoringId;
  kind: CapabilityMonitoringKind;
  total: number;
  succeeded: number;
  failed: number;
  denied: number;
  cancelled: number;
  timedOut: number;
  successRate: number | null;
  averageLatencyMs: number | null;
  lastOccurredAt: number | null;
};

export type CapabilityMonitoringSnapshotV1 = {
  version: 1;
  window: "24h";
  bucket: "hour";
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  evidence: CapabilityMonitoringEvidence;
  stale: boolean;
  rows: CapabilityMonitoringRowV1[];
  capabilities: CapabilityMonitoringSummaryV1[];
};

const KIND_BY_ID: Readonly<Record<CapabilityMonitoringId, CapabilityMonitoringKind>> = {
  [CAPABILITY_ID_WORKFLOW_SELECTION]: "workflow_selection",
  [CAPABILITY_ID_VISION_ASSIST]: "auxiliary_vision",
  [CAPABILITY_ID_WEB_RESEARCH]: "web_research",
  [CAPABILITY_ID_TOOL_EXECUTION]: "tool",
};

export function capabilityMonitoringKindForId(
  capabilityId: CapabilityMonitoringId,
): CapabilityMonitoringKind {
  return KIND_BY_ID[capabilityId];
}

export function decodeCapabilityMonitoringEvent(value: unknown): CapabilityMonitoringEventV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "capabilityId", "kind", "status", "latencyMs", "occurredAt"])) {
    return null;
  }
  if (value.version !== 1) return null;
  const capabilityId = isCapabilityMonitoringId(value.capabilityId) ? value.capabilityId : null;
  const status = isCapabilityMonitoringStatus(value.status) ? value.status : null;
  if (!capabilityId || value.kind !== KIND_BY_ID[capabilityId] || !status) return null;
  if (!isSafeTimestamp(value.occurredAt)) return null;
  if (value.latencyMs !== null && !isBoundedLatency(value.latencyMs)) return null;
  return {
    version: 1,
    capabilityId,
    kind: KIND_BY_ID[capabilityId],
    status,
    latencyMs: value.latencyMs,
    occurredAt: value.occurredAt,
  };
}

export const normalizeCapabilityMonitoringEvent = decodeCapabilityMonitoringEvent;

export function decodeCapabilityMonitoringRow(value: unknown): CapabilityMonitoringRowV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version",
    "capabilityId",
    "kind",
    "status",
    "bucketStart",
    "count",
    "latencySumMs",
    "latencyCount",
    "lastOccurredAt",
  ])) return null;
  if (value.version !== 1) return null;
  const capabilityId = isCapabilityMonitoringId(value.capabilityId) ? value.capabilityId : null;
  const status = isCapabilityMonitoringStatus(value.status) ? value.status : null;
  if (!capabilityId || value.kind !== KIND_BY_ID[capabilityId] || !status) return null;
  if (!isBucketStart(value.bucketStart) || !isSafeTimestamp(value.lastOccurredAt)) return null;
  if (
    !isBoundedCount(value.count)
    || !isBoundedLatencySum(value.latencySumMs)
    || !isBoundedNonNegativeCount(value.latencyCount)
    || value.latencyCount > value.count
    || value.latencySumMs > value.latencyCount * CAPABILITY_MONITORING_MAX_LATENCY_MS
    || value.lastOccurredAt < value.bucketStart
    || value.lastOccurredAt >= value.bucketStart + CAPABILITY_MONITORING_BUCKET_MS
  ) return null;
  return {
    version: 1,
    capabilityId,
    kind: KIND_BY_ID[capabilityId],
    status,
    bucketStart: value.bucketStart,
    count: value.count,
    latencySumMs: value.latencySumMs,
    latencyCount: value.latencyCount,
    lastOccurredAt: value.lastOccurredAt,
  };
}

export function decodeCapabilityMonitoringAggregate(value: unknown): CapabilityMonitoringAggregateV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "rows"]) || value.version !== 1 || !Array.isArray(value.rows)) {
    return null;
  }
  if (value.rows.length > CAPABILITY_MONITORING_MAX_ROWS) return null;
  const rows: CapabilityMonitoringRowV1[] = [];
  const seen = new Set<string>();
  for (const candidate of value.rows) {
    const row = decodeCapabilityMonitoringRow(candidate);
    if (!row) return null;
    const key = capabilityMonitoringRowKey(row);
    if (seen.has(key)) return null;
    seen.add(key);
    rows.push(row);
  }
  return { version: 1, rows: sortRows(rows) };
}

export function emptyCapabilityMonitoringAggregate(): CapabilityMonitoringAggregateV1 {
  return { version: 1, rows: [] };
}

export function bucketStartForCapabilityMonitoring(timestamp: number): number {
  return Math.floor(timestamp / CAPABILITY_MONITORING_BUCKET_MS) * CAPABILITY_MONITORING_BUCKET_MS;
}

export function reduceCapabilityMonitoringAggregate(
  previous: CapabilityMonitoringAggregateV1 | null,
  event: CapabilityMonitoringEventV1,
  now = event.occurredAt,
): CapabilityMonitoringAggregateV1 {
  const normalized = decodeCapabilityMonitoringEvent(event);
  if (!normalized || !isSafeTimestamp(now)) return previous || emptyCapabilityMonitoringAggregate();
  const current = previous && decodeCapabilityMonitoringAggregate(previous)
    ? decodeCapabilityMonitoringAggregate(previous)!
    : emptyCapabilityMonitoringAggregate();
  const bucketStart = bucketStartForCapabilityMonitoring(normalized.occurredAt);
  const rows = current.rows.filter((row) => (
    row.bucketStart >= bucketStartForCapabilityMonitoring(now - CAPABILITY_MONITORING_RETENTION_MS)
    && row.bucketStart <= bucketStartForCapabilityMonitoring(now)
  ));
  if (
    bucketStart < bucketStartForCapabilityMonitoring(now - CAPABILITY_MONITORING_RETENTION_MS)
    || normalized.occurredAt > now + CAPABILITY_MONITORING_BUCKET_MS
  ) return { version: 1, rows: sortRows(rows) };
  const key = capabilityMonitoringRowKey({
    capabilityId: normalized.capabilityId,
    kind: normalized.kind,
    status: normalized.status,
    bucketStart,
  });
  const existing = rows.find((row) => capabilityMonitoringRowKey(row) === key);
  if (existing) {
    existing.count = Math.min(CAPABILITY_MONITORING_MAX_COUNT_PER_ROW, existing.count + 1);
    if (normalized.latencyMs !== null && existing.latencyCount < CAPABILITY_MONITORING_MAX_COUNT_PER_ROW) {
      existing.latencySumMs = Math.min(
        CAPABILITY_MONITORING_MAX_COUNT_PER_ROW * CAPABILITY_MONITORING_MAX_LATENCY_MS,
        existing.latencySumMs + normalized.latencyMs,
      );
      existing.latencyCount += 1;
    }
    existing.lastOccurredAt = Math.max(existing.lastOccurredAt, normalized.occurredAt);
  } else {
    rows.push({
      version: 1,
      capabilityId: normalized.capabilityId,
      kind: normalized.kind,
      status: normalized.status,
      bucketStart,
      count: 1,
      latencySumMs: normalized.latencyMs ?? 0,
      latencyCount: normalized.latencyMs === null ? 0 : 1,
      lastOccurredAt: normalized.occurredAt,
    });
  }
  return { version: 1, rows: sortRows(rows).slice(0, CAPABILITY_MONITORING_MAX_ROWS) };
}

export function mergeCapabilityMonitoringRows(
  shards: readonly (readonly CapabilityMonitoringRowV1[])[],
  periodStart: number,
  periodEnd: number,
): CapabilityMonitoringRowV1[] {
  if (!isSafeTimestamp(periodStart) || !isSafeTimestamp(periodEnd) || periodEnd < periodStart) return [];
  const grouped = new Map<string, CapabilityMonitoringRowV1>();
  for (const shard of shards) {
    for (const candidate of shard) {
      const row = decodeCapabilityMonitoringRow(candidate);
      if (!row || row.bucketStart < bucketStartForCapabilityMonitoring(periodStart) || row.bucketStart > bucketStartForCapabilityMonitoring(periodEnd)) {
        continue;
      }
      const key = capabilityMonitoringRowKey(row);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...row });
        continue;
      }
      existing.count = Math.min(CAPABILITY_MONITORING_MAX_COUNT_PER_ROW, existing.count + row.count);
      existing.latencySumMs = Math.min(
        CAPABILITY_MONITORING_MAX_COUNT_PER_ROW * CAPABILITY_MONITORING_MAX_LATENCY_MS,
        existing.latencySumMs + row.latencySumMs,
      );
      existing.latencyCount = Math.min(CAPABILITY_MONITORING_MAX_COUNT_PER_ROW, existing.latencyCount + row.latencyCount);
      existing.lastOccurredAt = Math.max(existing.lastOccurredAt, row.lastOccurredAt);
    }
  }
  return sortRows([...grouped.values()]).slice(0, CAPABILITY_MONITORING_MAX_ROWS);
}

export function buildCapabilityMonitoringSnapshot(
  rows: readonly CapabilityMonitoringRowV1[],
  generatedAt: number,
  evidence: Exclude<CapabilityMonitoringEvidence, "unavailable"> = "fresh",
): CapabilityMonitoringSnapshotV1 {
  const periodStart = generatedAt - CAPABILITY_MONITORING_WINDOW_MS;
  const periodEnd = generatedAt;
  const normalizedRows = mergeCapabilityMonitoringRows([rows], periodStart, periodEnd);
  const byCapability = new Map<string, CapabilityMonitoringSummaryV1>();
  for (const row of normalizedRows) {
    const key = `${row.capabilityId}\0${row.kind}`;
    const current = byCapability.get(key) || {
      capabilityId: row.capabilityId,
      kind: row.kind,
      total: 0,
      succeeded: 0,
      failed: 0,
      denied: 0,
      cancelled: 0,
      timedOut: 0,
      successRate: null,
      averageLatencyMs: null,
      lastOccurredAt: null,
    };
    current.total += row.count;
    if (row.status === "succeeded") current.succeeded += row.count;
    if (row.status === "failed") current.failed += row.count;
    if (row.status === "denied") current.denied += row.count;
    if (row.status === "cancelled") current.cancelled += row.count;
    if (row.status === "timed_out") current.timedOut += row.count;
    current.lastOccurredAt = Math.max(current.lastOccurredAt || 0, row.lastOccurredAt);
    byCapability.set(key, current);
  }
  const capabilities = [...byCapability.values()].map((summary) => {
    const relevant = normalizedRows.filter((row) => row.capabilityId === summary.capabilityId && row.kind === summary.kind);
    const latencyCount = relevant.reduce((total, row) => total + row.latencyCount, 0);
    const latencySum = relevant.reduce((total, row) => total + row.latencySumMs, 0);
    const completed = summary.succeeded + summary.failed + summary.denied + summary.cancelled + summary.timedOut;
    return {
      ...summary,
      successRate: completed > 0 ? summary.succeeded / completed : null,
      averageLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
      lastOccurredAt: summary.lastOccurredAt || null,
    };
  }).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const latest = normalizedRows.reduce((value, row) => Math.max(value, row.lastOccurredAt), 0);
  const stale = evidence === "stale" || (normalizedRows.length > 0 && latest < generatedAt - 6 * 60 * 60 * 1_000);
  return {
    version: 1,
    window: "24h",
    bucket: "hour",
    generatedAt,
    periodStart,
    periodEnd,
    evidence: normalizedRows.length === 0 ? "no_data" : stale ? "stale" : evidence,
    stale,
    rows: normalizedRows,
    capabilities,
  };
}

export function decodeCapabilityMonitoringSnapshot(value: unknown): CapabilityMonitoringSnapshotV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version",
    "window",
    "bucket",
    "generatedAt",
    "periodStart",
    "periodEnd",
    "evidence",
    "stale",
    "rows",
    "capabilities",
  ])) return null;
  if (
    value.version !== 1
    || value.window !== "24h"
    || value.bucket !== "hour"
    || !isSafeTimestamp(value.generatedAt)
    || !isSafeTimestamp(value.periodStart)
    || !isSafeTimestamp(value.periodEnd)
    || value.generatedAt !== value.periodEnd
    || value.periodEnd - value.periodStart !== CAPABILITY_MONITORING_WINDOW_MS
    || (value.evidence !== "fresh" && value.evidence !== "stale" && value.evidence !== "no_data" && value.evidence !== "unavailable")
    || typeof value.stale !== "boolean"
    || !Array.isArray(value.rows)
    || !Array.isArray(value.capabilities)
  ) return null;
  if (value.rows.length > CAPABILITY_MONITORING_MAX_ROWS || value.capabilities.length > CAPABILITY_MONITORING_IDS.length) return null;

  const minimumBucket = bucketStartForCapabilityMonitoring(value.periodStart);
  const maximumBucket = bucketStartForCapabilityMonitoring(value.periodEnd);
  const rows: CapabilityMonitoringRowV1[] = [];
  const rowKeys = new Set<string>();
  for (const candidate of value.rows) {
    const row = decodeCapabilityMonitoringRow(candidate);
    if (!row || row.bucketStart < minimumBucket || row.bucketStart > maximumBucket) return null;
    const key = capabilityMonitoringRowKey(row);
    if (rowKeys.has(key)) return null;
    rowKeys.add(key);
    rows.push(row);
  }

  const summaries: CapabilityMonitoringSummaryV1[] = [];
  const summaryKeys = new Set<string>();
  for (const candidate of value.capabilities) {
    const summary = decodeCapabilityMonitoringSummary(candidate);
    if (!summary) return null;
    const key = capabilityMonitoringSummaryKey(summary);
    if (summaryKeys.has(key)) return null;
    summaryKeys.add(key);
    summaries.push(summary);
  }

  const snapshot = buildCapabilityMonitoringSnapshot(rows, value.generatedAt);
  if (snapshot.capabilities.length !== summaries.length) return null;
  const expectedByKey = new Map(snapshot.capabilities.map((summary) => [capabilityMonitoringSummaryKey(summary), summary]));
  if (summaries.some((summary) => !sameCapabilityMonitoringSummary(summary, expectedByKey.get(capabilityMonitoringSummaryKey(summary))))) {
    return null;
  }

  if (!rows.length) {
    if (summaries.length) return null;
    if (value.evidence === "no_data" && value.stale === false) return snapshot;
    if (value.evidence === "unavailable" && value.stale === true) {
      return { ...snapshot, evidence: "unavailable", stale: true };
    }
    return null;
  }
  if (value.evidence !== snapshot.evidence || value.stale !== snapshot.stale) return null;
  return snapshot;
}

function decodeCapabilityMonitoringSummary(value: unknown): CapabilityMonitoringSummaryV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "capabilityId",
    "kind",
    "total",
    "succeeded",
    "failed",
    "denied",
    "cancelled",
    "timedOut",
    "successRate",
    "averageLatencyMs",
    "lastOccurredAt",
  ])) return null;
  const capabilityId = isCapabilityMonitoringId(value.capabilityId) ? value.capabilityId : null;
  if (!capabilityId || value.kind !== KIND_BY_ID[capabilityId]) return null;
  if (
    !isBoundedSummaryCount(value.total)
    || !isBoundedSummaryCount(value.succeeded)
    || !isBoundedSummaryCount(value.failed)
    || !isBoundedSummaryCount(value.denied)
    || !isBoundedSummaryCount(value.cancelled)
    || !isBoundedSummaryCount(value.timedOut)
    || (value.successRate !== null && (typeof value.successRate !== "number" || !Number.isFinite(value.successRate) || value.successRate < 0 || value.successRate > 1))
    || (value.averageLatencyMs !== null && !isBoundedLatency(value.averageLatencyMs))
    || !isSafeTimestamp(value.lastOccurredAt)
  ) return null;
  if (value.total !== value.succeeded + value.failed + value.denied + value.cancelled + value.timedOut) return null;
  if (value.successRate !== (value.total > 0 ? value.succeeded / value.total : null)) return null;
  return {
    capabilityId,
    kind: KIND_BY_ID[capabilityId],
    total: value.total,
    succeeded: value.succeeded,
    failed: value.failed,
    denied: value.denied,
    cancelled: value.cancelled,
    timedOut: value.timedOut,
    successRate: value.successRate,
    averageLatencyMs: value.averageLatencyMs,
    lastOccurredAt: value.lastOccurredAt,
  };
}

function capabilityMonitoringSummaryKey(summary: Pick<CapabilityMonitoringSummaryV1, "capabilityId" | "kind">): string {
  return `${summary.capabilityId}\0${summary.kind}`;
}

function sameCapabilityMonitoringSummary(
  actual: CapabilityMonitoringSummaryV1,
  expected: CapabilityMonitoringSummaryV1 | undefined,
): boolean {
  if (!expected) return false;
  return actual.total === expected.total
    && actual.succeeded === expected.succeeded
    && actual.failed === expected.failed
    && actual.denied === expected.denied
    && actual.cancelled === expected.cancelled
    && actual.timedOut === expected.timedOut
    && actual.successRate === expected.successRate
    && actual.averageLatencyMs === expected.averageLatencyMs
    && actual.lastOccurredAt === expected.lastOccurredAt;
}

function capabilityMonitoringRowKey(row: Pick<CapabilityMonitoringRowV1, "capabilityId" | "kind" | "status" | "bucketStart">): string {
  return `${row.capabilityId}\0${row.kind}\0${row.status}\0${row.bucketStart}`;
}

function sortRows(rows: CapabilityMonitoringRowV1[]): CapabilityMonitoringRowV1[] {
  return rows.sort((left, right) => left.bucketStart - right.bucketStart || left.capabilityId.localeCompare(right.capabilityId) || left.status.localeCompare(right.status));
}

function isCapabilityMonitoringId(value: unknown): value is CapabilityMonitoringId {
  return typeof value === "string" && (CAPABILITY_MONITORING_IDS as readonly string[]).includes(value);
}

function isCapabilityMonitoringStatus(value: unknown): value is CapabilityMonitoringStatus {
  return value === "succeeded" || value === "failed" || value === "denied" || value === "cancelled" || value === "timed_out";
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBucketStart(value: unknown): value is number {
  return isSafeTimestamp(value) && value % CAPABILITY_MONITORING_BUCKET_MS === 0;
}

function isBoundedLatency(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= CAPABILITY_MONITORING_MAX_LATENCY_MS;
}

function isBoundedLatencySum(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= CAPABILITY_MONITORING_MAX_COUNT_PER_ROW * CAPABILITY_MONITORING_MAX_LATENCY_MS;
}

function isBoundedCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= CAPABILITY_MONITORING_MAX_COUNT_PER_ROW;
}

function isBoundedNonNegativeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= CAPABILITY_MONITORING_MAX_COUNT_PER_ROW;
}

function isBoundedSummaryCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= CAPABILITY_MONITORING_MAX_ROWS * CAPABILITY_MONITORING_MAX_COUNT_PER_ROW;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
