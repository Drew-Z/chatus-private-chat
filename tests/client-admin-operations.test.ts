import { describe, expect, it } from "vitest";
import {
  filterModelMonitorGroups,
  modelMonitorTrendSummary,
  OPERATIONS_PAGE_SIZE,
  paginateOperations,
  prepareLegacySurfaceTransition,
  type LegacySurfaceTransitionDraft,
} from "../client/src/components/AdminOperationsPanel";
import type { ModelMonitorSnapshot } from "../client/src/lib/api";

describe("admin operations pagination", () => {
  const entries = Array.from({ length: 21 }, (_, index) => `entry-${index + 1}`);

  it("uses a stable 20-item page and exposes item 21", () => {
    const first = paginateOperations(entries, 1);
    expect(OPERATIONS_PAGE_SIZE).toBe(20);
    expect(first).toMatchObject({ page: 1, pageCount: 2, displayed: 20, total: 21 });
    expect(first.items).toEqual(entries.slice(0, 20));

    const second = paginateOperations(entries, 2);
    expect(second).toMatchObject({ page: 2, pageCount: 2, displayed: 1, total: 21 });
    expect(second.items).toEqual(["entry-21"]);
  });

  it("clamps stale pages after filtering and keeps empty counts exact", () => {
    expect(paginateOperations(["filtered-entry"], 4)).toMatchObject({
      items: ["filtered-entry"],
      page: 1,
      pageCount: 1,
      displayed: 1,
      total: 1,
    });
    expect(paginateOperations([], 4)).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      displayed: 0,
      total: 0,
    });
  });
});

describe("admin model monitor presentation", () => {
  const monitor: ModelMonitorSnapshot = {
    version: 1,
    window: "24h",
    generatedAt: Date.parse("2026-07-26T12:00:00Z"),
    periodStart: Date.parse("2026-07-25T12:00:00Z"),
    periodEnd: Date.parse("2026-07-26T12:00:00Z"),
    totals: { attempts: 6, succeeded: 4, failures: 1, inFlight: 1, completed: 5, successRate: 0.8, fallbacks: 1, averageLatencyMs: 400 },
    trend: [{
      bucketStart: Date.parse("2026-07-26T11:00:00Z"),
      bucketEnd: Date.parse("2026-07-26T12:00:00Z"),
      attempts: 6,
      succeeded: 4,
      failures: 1,
      inFlight: 1,
      fallbacks: 1,
    }],
    routes: [{ id: "reasoning", label: "高质量推理", model: "reasoning-v2", attempts: 6, succeeded: 4, failures: 1, inFlight: 1, completed: 5, successRate: 0.8, fallbacks: 1, averageLatencyMs: 400 }],
    providers: [{ id: "provider-alpha", label: "Provider Alpha", model: "reasoning-v2", attempts: 6, succeeded: 4, failures: 1, inFlight: 1, completed: 5, successRate: 0.8, fallbacks: 1, averageLatencyMs: 400 }],
    models: [{ id: "reasoning-v2", label: "Reasoning V2", attempts: 6, succeeded: 4, failures: 1, inFlight: 1, completed: 5, successRate: 0.8, fallbacks: 1, averageLatencyMs: 400 }],
    runKinds: [{ runKind: "main_answer", attempts: 6, succeeded: 4, failures: 1, inFlight: 1, completed: 5, successRate: 0.8, fallbacks: 1, averageLatencyMs: 400 }],
    failureClasses: [{ errorClass: "upstream_timeout", count: 1 }],
  };

  it("filters every monitor grouping by identifiers, labels, and models", () => {
    expect(filterModelMonitorGroups(monitor, "routes", "高质量")).toHaveLength(1);
    expect(filterModelMonitorGroups(monitor, "routes", "REASONING-V2")).toHaveLength(1);
    expect(filterModelMonitorGroups(monitor, "providers", "provider alpha")).toHaveLength(1);
    expect(filterModelMonitorGroups(monitor, "models", "reasoning-v2")).toHaveLength(1);
    expect(filterModelMonitorGroups(monitor, "routes", "no-match")).toEqual([]);
  });

  it("announces attempts and terminal versus in-flight outcomes", () => {
    expect(modelMonitorTrendSummary(monitor.trend[0])).toContain("尝试 6，成功 4，失败 1，进行中 1，完成成功率 80%");
    expect(modelMonitorTrendSummary({ ...monitor.trend[0], attempts: 1, succeeded: 0, failures: 0, inFlight: 1 })).toContain("暂无已完成结果");
  });
});

describe("legacy surface transition preparation", () => {
  const observedAtText = "2026-07-26T12:00";
  const observedAt = Date.parse(observedAtText);
  const requestedAt = Date.parse("2026-07-26T12:01");

  function advanceDraft(): LegacySurfaceTransitionDraft {
    return {
      surfaceId: "legacy.surface-fixture",
      expectedRevision: 4,
      fromPhase: "instrumented",
      operationId: "legacy-surface:00000000-0000-4000-8000-000000000001",
      action: { kind: "advance", targetPhase: "censused" },
      rollbackReason: "runtime_regression",
      evidence: [{
        kind: "census_window",
        evidenceId: "fixture:census/window-1",
        digest: "a".repeat(64),
        deploymentSha: "b".repeat(40),
        observedAt: observedAtText,
        count: "0",
        result: "complete",
      }],
    };
  }

  it("builds an exact advance envelope with a frozen request time", () => {
    const result = prepareLegacySurfaceTransition(advanceDraft(), requestedAt);
    expect(Object.keys(result)).toEqual([
      "version", "surfaceId", "expectedRevision", "operationId", "targetPhase", "requestedAt", "evidence",
    ]);
    expect(result).toEqual({
      version: 1,
      surfaceId: "legacy.surface-fixture",
      expectedRevision: 4,
      operationId: "legacy-surface:00000000-0000-4000-8000-000000000001",
      targetPhase: "censused",
      requestedAt,
      evidence: [{
        version: 1,
        kind: "census_window",
        evidenceId: "fixture:census/window-1",
        digest: "a".repeat(64),
        deploymentSha: "b".repeat(40),
        observedAt,
        count: 0,
        result: "complete",
      }],
    });
  });

  it("builds rollback with only rollback rehearsal evidence", () => {
    const draft = advanceDraft();
    draft.fromPhase = "read_disabled";
    draft.action = { kind: "rollback", scope: "read", targetPhase: "recovery_proven" };
    draft.rollbackReason = "recovery_failure";
    draft.evidence[0].kind = "rollback_rehearsal";

    const result = prepareLegacySurfaceTransition(draft, requestedAt);
    expect(Object.keys(result)).toEqual([
      "version", "surfaceId", "expectedRevision", "operationId", "scope", "reason", "requestedAt", "evidence",
    ]);
    expect(result).toMatchObject({
      scope: "read",
      reason: "recovery_failure",
      requestedAt,
      evidence: [{ kind: "rollback_rehearsal" }],
    });
  });

  it.each([
    ["invalid evidence ID", (draft: LegacySurfaceTransitionDraft) => { draft.evidence[0].evidenceId = "invalid id"; }, "证据 ID 格式无效"],
    ["uppercase digest", (draft: LegacySurfaceTransitionDraft) => { draft.evidence[0].digest = "A".repeat(64); }, "SHA-256 摘要格式无效"],
    ["uppercase deployment SHA", (draft: LegacySurfaceTransitionDraft) => { draft.evidence[0].deploymentSha = "B".repeat(40); }, "部署 Commit SHA 格式无效"],
    ["future observation", (draft: LegacySurfaceTransitionDraft) => { draft.evidence[0].observedAt = "2026-07-26T12:02"; }, "观察时间不能晚于请求时间"],
    ["unsafe count", (draft: LegacySurfaceTransitionDraft) => { draft.evidence[0].count = "9007199254740992"; }, "计数格式无效"],
    ["wrong evidence kind", (draft: LegacySurfaceTransitionDraft) => { draft.evidence[0].kind = "parity_digest"; }, "证据类型与服务端授权操作不一致"],
    ["invalid operation ID", (draft: LegacySurfaceTransitionDraft) => { draft.operationId = "invalid operation"; }, "操作标识格式无效"],
  ])("rejects %s", (_name, mutate, expectedMessage) => {
    const draft = advanceDraft();
    mutate(draft);
    expect(() => prepareLegacySurfaceTransition(draft, requestedAt)).toThrow(expectedMessage);
  });
});
