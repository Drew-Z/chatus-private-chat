import { describe, expect, it } from "vitest";
import {
  classifyMemberAvailability,
  deriveAverageLatency,
  deriveSuccessRate,
  type ProviderAttemptAvailabilityEvidenceV1,
} from "../src/contracts/model-monitoring";
import { mergeProviderAttemptMonitoringRows } from "../src/services/model-monitoring";

const now = 1_700_000_000_000;

function evidence(status: ProviderAttemptAvailabilityEvidenceV1["status"], startedAt: number, fallbackIndex = 0): ProviderAttemptAvailabilityEvidenceV1 {
  return {
    logicalRouteId: "route-a",
    status,
    startedAt,
    endedAt: status === "started" ? 0 : startedAt + 100,
    fallbackIndex,
  };
}

describe("model monitoring contracts", () => {
  it("keeps completed success rate separate from in-flight attempts", () => {
    expect(deriveSuccessRate(0, 0)).toBeNull();
    expect(deriveSuccessRate(2, 1)).toBeCloseTo(2 / 3);
    expect(deriveAverageLatency(300, 2)).toBe(150);
    expect(deriveAverageLatency(0, 0)).toBeNull();
  });

  it("classifies no data, limited data, degraded fallback, and recovery", () => {
    expect(classifyMemberAvailability([], now)).toMatchObject({ status: "unknown", confidence: "stale" });
    expect(classifyMemberAvailability([evidence("succeeded", now - 1_000)], now)).toMatchObject({ status: "unknown", confidence: "limited" });
    expect(classifyMemberAvailability([
      evidence("succeeded", now - 3_000),
      evidence("succeeded", now - 2_000, 1),
      evidence("succeeded", now - 1_000),
    ], now)).toMatchObject({ status: "degraded", fallbackRecentlyUsed: true });
    expect(classifyMemberAvailability([
      evidence("failed", now - 3_000),
      evidence("succeeded", now - 2_000),
      evidence("succeeded", now - 1_000),
    ], now)).toMatchObject({ status: "degraded" });
  });

  it("requires three consecutive failures inside the anti-flap window", () => {
    expect(classifyMemberAvailability([
      evidence("failed", now - 3_000),
      evidence("failed", now - 2_000),
      evidence("failed", now - 1_000),
    ], now).status).toBe("unavailable");
    expect(classifyMemberAvailability([
      evidence("failed", now - 3_000),
      evidence("succeeded", now - 2_000),
      evidence("failed", now - 1_000),
      evidence("failed", now - 500),
    ], now).status).not.toBe("unavailable");
  });

  it("merges cross-provider rows and preserves null latency", () => {
    const snapshot = mergeProviderAttemptMonitoringRows([
      {
        logicalRouteId: "route-a", providerId: "provider-a", model: "model-a", runKind: "main_answer", errorClass: "none", bucketStart: now - 3_600_000,
        attempts: 2, succeeded: 1, failures: 0, inFlight: 1, fallbacks: 0, latencySumMs: 100, latencyCount: 1,
      },
      {
        logicalRouteId: "route-a", providerId: "provider-b", model: "model-a", runKind: "main_answer", errorClass: "upstream_timeout", bucketStart: now - 3_600_000,
        attempts: 1, succeeded: 0, failures: 1, inFlight: 0, fallbacks: 1, latencySumMs: 200, latencyCount: 1,
      },
    ], { routes: new Map([["route-a", "Route A"]]), providers: new Map([["provider-a", "Provider A"], ["provider-b", "Provider B"]]) }, now, now - 86_400_000, now);
    expect(snapshot.totals).toMatchObject({ attempts: 3, succeeded: 1, failures: 1, inFlight: 1, fallbacks: 1, averageLatencyMs: 150 });
    expect(snapshot.totals.successRate).toBe(0.5);
    expect(snapshot.routes[0]).toMatchObject({ id: "route-a", label: "Route A", attempts: 3 });
    expect(snapshot.failureClasses).toEqual([{ errorClass: "upstream_timeout", count: 1 }]);
    expect(snapshot.trend).toHaveLength(24);
  });
});

