import {
  deriveAverageLatency,
  deriveSuccessRate,
  isFailureStatus,
  isTerminalStatus,
  type ModelMonitorFailureClassV1,
  type ModelMonitorGroupV1,
  type ModelMonitorRunKindV1,
  type ModelMonitorSnapshotV1,
  type ProviderAttemptMonitoringRowV1,
  type ModelMonitorTrendBucketV1,
} from "../contracts/model-monitoring";
import type { ModelMonitoringRunKind } from "../contracts/model-monitoring";

type MutableStats = {
  attempts: number;
  succeeded: number;
  failures: number;
  inFlight: number;
  fallbacks: number;
  latencySumMs: number;
  latencyCount: number;
  models: Set<string>;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function emptyStats(): MutableStats {
  return { attempts: 0, succeeded: 0, failures: 0, inFlight: 0, fallbacks: 0, latencySumMs: 0, latencyCount: 0, models: new Set() };
}

function addRow(stats: MutableStats, row: ProviderAttemptMonitoringRowV1): void {
  stats.attempts += row.attempts;
  stats.succeeded += row.succeeded;
  stats.failures += row.failures;
  stats.inFlight += row.inFlight;
  stats.fallbacks += row.fallbacks;
  stats.latencySumMs += row.latencySumMs;
  stats.latencyCount += row.latencyCount;
  if (row.model) stats.models.add(row.model);
}

function toGroup(id: string, label: string, stats: MutableStats): ModelMonitorGroupV1 {
  const model = stats.models.size === 1 ? [...stats.models][0] : undefined;
  return {
    id,
    label,
    ...(model ? { model } : {}),
    attempts: stats.attempts,
    succeeded: stats.succeeded,
    failures: stats.failures,
    inFlight: stats.inFlight,
    completed: stats.succeeded + stats.failures,
    successRate: deriveSuccessRate(stats.succeeded, stats.failures),
    fallbacks: stats.fallbacks,
    averageLatencyMs: deriveAverageLatency(stats.latencySumMs, stats.latencyCount),
  };
}

export function mergeProviderAttemptMonitoringRows(
  rows: ProviderAttemptMonitoringRowV1[],
  labels: { routes: Map<string, string>; providers: Map<string, string> },
  generatedAt: number,
  periodStart: number,
  periodEnd: number,
): ModelMonitorSnapshotV1 {
  const totals = emptyStats();
  const routeStats = new Map<string, MutableStats>();
  const providerStats = new Map<string, MutableStats>();
  const modelStats = new Map<string, MutableStats>();
  const runStats = new Map<ModelMonitoringRunKind, MutableStats>();
  const trend = new Map<number, MutableStats>();
  const failures = new Map<string, number>();
  for (const row of rows) {
    addRow(totals, row);
    const route = routeStats.get(row.logicalRouteId) || emptyStats();
    addRow(route, row);
    routeStats.set(row.logicalRouteId, route);
    const provider = providerStats.get(row.providerId) || emptyStats();
    addRow(provider, row);
    providerStats.set(row.providerId, provider);
    const model = modelStats.get(row.model) || emptyStats();
    addRow(model, row);
    modelStats.set(row.model, model);
    const run = runStats.get(row.runKind) || emptyStats();
    addRow(run, row);
    runStats.set(row.runKind, run);
    const bucket = trend.get(row.bucketStart) || emptyStats();
    addRow(bucket, row);
    trend.set(row.bucketStart, bucket);
    if (row.errorClass !== "none" && row.failures > 0) failures.set(row.errorClass, (failures.get(row.errorClass) || 0) + row.failures);
  }
  const bucketCount = Math.ceil((periodEnd - periodStart) / (60 * 60 * 1_000));
  const trendRows: ModelMonitorTrendBucketV1[] = Array.from({ length: bucketCount }, (_, index) => {
    const start = periodStart + index * 60 * 60 * 1_000;
    const stats = trend.get(start) || emptyStats();
    return {
      bucketStart: start,
      bucketEnd: Math.min(periodEnd, start + 60 * 60 * 1_000),
      attempts: stats.attempts,
      succeeded: stats.succeeded,
      failures: stats.failures,
      inFlight: stats.inFlight,
      fallbacks: stats.fallbacks,
    };
  });
  const toSorted = (items: ModelMonitorGroupV1[]) => items.sort((left, right) => right.attempts - left.attempts || compareText(left.id, right.id));
  const runKinds: ModelMonitorRunKindV1[] = [...runStats.entries()]
    .map(([runKind, stats]) => ({
      runKind,
      attempts: stats.attempts,
      succeeded: stats.succeeded,
      failures: stats.failures,
      inFlight: stats.inFlight,
      completed: stats.succeeded + stats.failures,
      successRate: deriveSuccessRate(stats.succeeded, stats.failures),
      fallbacks: stats.fallbacks,
      averageLatencyMs: deriveAverageLatency(stats.latencySumMs, stats.latencyCount),
    }))
    .sort((left, right) => right.attempts - left.attempts || compareText(left.runKind, right.runKind));
  const failureClasses: ModelMonitorFailureClassV1[] = [...failures.entries()]
    .map(([errorClass, count]) => ({ errorClass: errorClass as ModelMonitorFailureClassV1["errorClass"], count }))
    .sort((left, right) => right.count - left.count || compareText(left.errorClass, right.errorClass));
  return {
    version: 1,
    window: "24h",
    generatedAt,
    periodStart,
    periodEnd,
    totals: {
      attempts: totals.attempts,
      succeeded: totals.succeeded,
      failures: totals.failures,
      inFlight: totals.inFlight,
      completed: totals.succeeded + totals.failures,
      successRate: deriveSuccessRate(totals.succeeded, totals.failures),
      fallbacks: totals.fallbacks,
      averageLatencyMs: deriveAverageLatency(totals.latencySumMs, totals.latencyCount),
    },
    trend: trendRows,
    routes: toSorted([...routeStats.entries()].map(([id, stats]) => toGroup(id, labels.routes.get(id) || id, stats))),
    providers: toSorted([...providerStats.entries()].map(([id, stats]) => toGroup(id, labels.providers.get(id) || id, stats))),
    models: toSorted([...modelStats.entries()].map(([id, stats]) => toGroup(id, id, stats))),
    runKinds,
    failureClasses,
  };
}

export function monitoringRowsFromProjection(input: Array<{
  logicalRouteId: string;
  providerId: string;
  model: string;
  runKind: ModelMonitoringRunKind;
  errorClass: ProviderAttemptMonitoringRowV1["errorClass"];
  status: "started" | "succeeded" | "failed" | "cancelled" | "timed_out";
  fallbackIndex: number;
  bucketStart: number;
  startedAt: number;
  endedAt: number;
}>): ProviderAttemptMonitoringRowV1[] {
  const groups = new Map<string, ProviderAttemptMonitoringRowV1>();
  for (const item of input) {
    const key = [item.logicalRouteId, item.providerId, item.model, item.runKind, item.errorClass, item.bucketStart].join("\u0000");
    const current = groups.get(key) || {
      logicalRouteId: item.logicalRouteId,
      providerId: item.providerId,
      model: item.model,
      runKind: item.runKind,
      errorClass: item.errorClass,
      bucketStart: item.bucketStart,
      attempts: 0,
      succeeded: 0,
      failures: 0,
      inFlight: 0,
      fallbacks: 0,
      latencySumMs: 0,
      latencyCount: 0,
    };
    current.attempts += 1;
    if (item.status === "succeeded") current.succeeded += 1;
    else if (isFailureStatus(item.status)) current.failures += 1;
    else current.inFlight += 1;
    if (item.fallbackIndex > 0) current.fallbacks += 1;
    if (isTerminalStatus(item.status) && item.endedAt >= item.startedAt) {
      current.latencySumMs += item.endedAt - item.startedAt;
      current.latencyCount += 1;
    }
    groups.set(key, current);
  }
  return [...groups.values()];
}
