import { describe, expect, it } from "vitest";
import {
  CAPABILITY_ID_TOOL_EXECUTION,
  CAPABILITY_ID_WEB_RESEARCH,
  CAPABILITY_ID_WORKFLOW_SELECTION,
  CAPABILITY_MONITORING_BUCKET_MS,
  CAPABILITY_MONITORING_RETENTION_MS,
  buildCapabilityMonitoringSnapshot,
  decodeCapabilityMonitoringAggregate,
  decodeCapabilityMonitoringEvent,
  decodeCapabilityMonitoringSnapshot,
  reduceCapabilityMonitoringAggregate,
  type CapabilityMonitoringEventV1,
} from "../src/contracts/capability-monitoring";

const now = 1_800_000_000_000;

function event(overrides: Partial<CapabilityMonitoringEventV1> = {}): CapabilityMonitoringEventV1 {
  return {
    version: 1,
    capabilityId: CAPABILITY_ID_WORKFLOW_SELECTION,
    kind: "workflow_selection",
    status: "succeeded",
    latencyMs: 125,
    occurredAt: now,
    ...overrides,
  };
}

describe("capability monitoring contracts", () => {
  it("accepts only exact, code-owned content-free dimensions", () => {
    expect(decodeCapabilityMonitoringEvent(event())).toEqual(event());
    expect(decodeCapabilityMonitoringEvent({ ...event(), capabilityId: "member:alice" })).toBeNull();
    expect(decodeCapabilityMonitoringEvent({ ...event(), kind: "tool" })).toBeNull();
    expect(decodeCapabilityMonitoringEvent({ ...event(), latencyMs: 600_001 })).toBeNull();
    expect(decodeCapabilityMonitoringEvent({ ...event(), query: "private search" })).toBeNull();
  });

  it("reduces hourly outcome and latency rows without retaining event payloads", () => {
    let aggregate = reduceCapabilityMonitoringAggregate(null, event(), now);
    aggregate = reduceCapabilityMonitoringAggregate(aggregate, event({ latencyMs: null, occurredAt: now + 10 }), now + 10);
    aggregate = reduceCapabilityMonitoringAggregate(aggregate, event({
      capabilityId: CAPABILITY_ID_WEB_RESEARCH,
      kind: "web_research",
      status: "timed_out",
      latencyMs: 20_000,
      occurredAt: now + CAPABILITY_MONITORING_BUCKET_MS,
    }), now + CAPABILITY_MONITORING_BUCKET_MS);

    expect(aggregate.rows).toHaveLength(2);
    expect(aggregate.rows[0]).toMatchObject({
      capabilityId: CAPABILITY_ID_WORKFLOW_SELECTION,
      status: "succeeded",
      count: 2,
      latencySumMs: 125,
      latencyCount: 1,
    });
    expect(aggregate.rows[1]).toMatchObject({
      capabilityId: CAPABILITY_ID_WEB_RESEARCH,
      status: "timed_out",
      count: 1,
      latencySumMs: 20_000,
      latencyCount: 1,
    });
    expect(JSON.stringify(aggregate)).not.toContain("private search");
  });

  it("prunes retained rows and rejects malformed or duplicate stored rows", () => {
    const old = event({ occurredAt: now - CAPABILITY_MONITORING_RETENTION_MS - CAPABILITY_MONITORING_BUCKET_MS });
    expect(reduceCapabilityMonitoringAggregate(null, old, now).rows).toEqual([]);

    const aggregate = reduceCapabilityMonitoringAggregate(null, event(), now);
    expect(decodeCapabilityMonitoringAggregate(aggregate)).toEqual(aggregate);
    expect(decodeCapabilityMonitoringAggregate({ version: 1, rows: [aggregate.rows[0], aggregate.rows[0]] })).toBeNull();
    expect(decodeCapabilityMonitoringAggregate({
      version: 1,
      rows: [{ ...aggregate.rows[0], latencyCount: 0, latencySumMs: 1 }],
    })).toBeNull();
  });

  it("builds explicit no-data, stale, and fresh 24-hour projections", () => {
    expect(buildCapabilityMonitoringSnapshot([], now)).toMatchObject({ evidence: "no_data", stale: false });
    const staleAggregate = reduceCapabilityMonitoringAggregate(null, event({ occurredAt: now - 7 * 60 * 60 * 1_000 }), now);
    expect(buildCapabilityMonitoringSnapshot(staleAggregate.rows, now)).toMatchObject({ evidence: "stale", stale: true });

    const aggregate = reduceCapabilityMonitoringAggregate(null, event({
      capabilityId: CAPABILITY_ID_TOOL_EXECUTION,
      kind: "tool",
      status: "denied",
      latencyMs: null,
    }), now);
    const snapshot = buildCapabilityMonitoringSnapshot(aggregate.rows, now);
    expect(snapshot).toMatchObject({ evidence: "fresh", stale: false });
    expect(snapshot.capabilities).toEqual([expect.objectContaining({
      capabilityId: CAPABILITY_ID_TOOL_EXECUTION,
      total: 1,
      denied: 1,
      successRate: 0,
      averageLatencyMs: null,
    })]);
  });

  it("strictly decodes canonical snapshots and rejects inconsistent summaries", () => {
    const aggregate = reduceCapabilityMonitoringAggregate(null, event(), now);
    const snapshot = buildCapabilityMonitoringSnapshot(aggregate.rows, now);
    expect(decodeCapabilityMonitoringSnapshot(snapshot)).toEqual(snapshot);
    expect(decodeCapabilityMonitoringSnapshot({ ...snapshot, periodStart: snapshot.periodStart + 1 })).toBeNull();
    expect(decodeCapabilityMonitoringSnapshot({
      ...snapshot,
      capabilities: [{ ...snapshot.capabilities[0], total: 2 }],
    })).toBeNull();
    expect(decodeCapabilityMonitoringSnapshot({
      ...snapshot,
      capabilities: [{ ...snapshot.capabilities[0], query: "private search" }],
    })).toBeNull();

    const noData = buildCapabilityMonitoringSnapshot([], now);
    expect(decodeCapabilityMonitoringSnapshot({ ...noData, evidence: "unavailable", stale: true }))
      .toEqual({ ...noData, evidence: "unavailable", stale: true });
    expect(decodeCapabilityMonitoringSnapshot({ ...noData, evidence: "unavailable", stale: false })).toBeNull();
  });
});
