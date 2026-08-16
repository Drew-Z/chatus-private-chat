import { describe, expect, it } from "vitest";
import {
  isModelMonitorSnapshot,
  summarizeModelMonitorSnapshot,
} from "../scripts/collect-production-model-observation.mjs";

function emptySnapshot() {
  const periodStart = 1_900_000_000_000;
  const periodEnd = periodStart + 24 * 60 * 60 * 1_000;
  return {
    version: 1,
    window: "24h",
    generatedAt: periodEnd,
    periodStart,
    periodEnd,
    totals: {
      attempts: 0,
      succeeded: 0,
      failures: 0,
      inFlight: 0,
      completed: 0,
      successRate: null,
      fallbacks: 0,
      averageLatencyMs: null,
    },
    trend: Array.from({ length: 24 }, (_, index) => ({
      bucketStart: periodStart + index * 60 * 60 * 1_000,
      bucketEnd: periodStart + (index + 1) * 60 * 60 * 1_000,
      attempts: 0,
      succeeded: 0,
      failures: 0,
      inFlight: 0,
      fallbacks: 0,
    })),
    routes: [],
    providers: [],
    models: [],
    runKinds: [],
    failureClasses: [],
  };
}

describe("production model observation contract", () => {
  it("accepts an empty exact 24-hour snapshot and produces aggregate-only evidence", () => {
    const snapshot = emptySnapshot() as any;
    expect(isModelMonitorSnapshot(snapshot)).toBe(true);
    expect(summarizeModelMonitorSnapshot(snapshot, {
      deployedSha: "a".repeat(40),
      observationStartedAt: snapshot.periodStart - 24 * 60 * 60 * 1_000,
      observedAt: snapshot.periodEnd,
    })).toMatchObject({
      schemaVersion: 1,
      kind: "chatus-model-monitor-observation",
      status: "passed",
      deployedSha: "a".repeat(40),
      totals: { attempts: 0, completed: 0, failures: 0, successRate: null },
      reconciliation: { trendBuckets: 24, exact: true },
    });
  });

  it("accepts reconciled non-empty groups without retaining their identities", () => {
    const snapshot = emptySnapshot() as any;
    const counts = {
      attempts: 2,
      succeeded: 1,
      failures: 1,
      inFlight: 0,
      completed: 2,
      successRate: 0.5,
      fallbacks: 1,
      averageLatencyMs: 250,
    };
    snapshot.totals = counts;
    snapshot.trend[23] = {
      ...snapshot.trend[23],
      attempts: 2,
      succeeded: 1,
      failures: 1,
      fallbacks: 1,
    };
    snapshot.routes = [{ id: "route-a", label: "Route A", model: "model-a", ...counts }];
    snapshot.providers = [{ id: "provider-a", label: "Provider A", model: "model-a", ...counts }];
    snapshot.models = [{ id: "model-a", label: "Model A", model: "model-a", ...counts }];
    snapshot.runKinds = [{ runKind: "main_answer", ...counts }];
    snapshot.failureClasses = [{ errorClass: "upstream_timeout", count: 1 }];
    expect(isModelMonitorSnapshot(snapshot)).toBe(true);
    const summary = summarizeModelMonitorSnapshot(snapshot, {
      deployedSha: "a".repeat(40),
      observationStartedAt: snapshot.periodStart - 24 * 60 * 60 * 1_000,
      observedAt: snapshot.periodEnd,
    });
    expect(summary.reconciliation).toMatchObject({
      routeGroups: 1,
      providerGroups: 1,
      modelGroups: 1,
      runKindGroups: 1,
      failureClassGroups: 1,
      exact: true,
    });
    expect(JSON.stringify(summary)).not.toMatch(/route-a|provider-a|model-a|upstream_timeout/u);
  });

  it("rejects malformed, truncated, unreconciled, and leakage-bearing snapshots", () => {
    const snapshot = emptySnapshot();
    expect(isModelMonitorSnapshot({ ...snapshot, trend: snapshot.trend.slice(1) })).toBe(false);
    expect(isModelMonitorSnapshot({ ...snapshot, totals: { ...snapshot.totals, attempts: 1 } })).toBe(false);
    expect(isModelMonitorSnapshot({ ...snapshot, providerId: "secret-provider" })).toBe(false);
    expect(isModelMonitorSnapshot({
      ...snapshot,
      trend: snapshot.trend.map((bucket, index) => index === 3
        ? { ...bucket, bucketStart: bucket.bucketStart + 1 }
        : bucket),
    })).toBe(false);
  });
});
