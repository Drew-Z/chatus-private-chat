import { describe, expect, it } from "vitest";
import {
  OPERATIONS_PAGE_SIZE,
  paginateOperations,
  prepareLegacySurfaceTransition,
  type LegacySurfaceTransitionDraft,
} from "../client/src/components/AdminOperationsPanel";

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
