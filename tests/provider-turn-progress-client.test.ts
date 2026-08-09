import { describe, expect, it } from "vitest";
import type { ProviderTurnProgressV1 } from "../src/contracts/provider-turn-progress";
import {
  decodeProviderTurnProgressMessage,
  providerTurnProgressText,
  selectNewestProviderTurnProgress,
} from "../client/src/lib/provider-turn-progress";

function progress(overrides: Partial<ProviderTurnProgressV1> = {}): ProviderTurnProgressV1 {
  return {
    type: "chatus_provider_turn_progress",
    version: 1,
    requestId: "request-progress-1234",
    sequence: 1,
    phase: "attempting",
    attempt: 1,
    candidateCount: 3,
    startedAt: 10_000,
    deadlineAt: 100_000,
    ...overrides,
  };
}

describe("Provider turn progress client", () => {
  it("decodes only exact string frames", () => {
    expect(decodeProviderTurnProgressMessage(JSON.stringify(progress()))).toEqual(progress());
    expect(decodeProviderTurnProgressMessage(progress())).toBeUndefined();
    expect(decodeProviderTurnProgressMessage("not-json")).toBeUndefined();
    expect(decodeProviderTurnProgressMessage(JSON.stringify({ ...progress(), endpoint: "secret" }))).toBeUndefined();
  });

  it("keeps the newest monotonic request-scoped state", () => {
    const current = progress({ sequence: 3 });
    expect(selectNewestProviderTurnProgress(current, progress({ sequence: 2 }), 9_000)).toBe(current);
    expect(selectNewestProviderTurnProgress(current, progress({ sequence: 4, phase: "fallback", attempt: 2 }), 9_000))
      .toMatchObject({ sequence: 4, phase: "fallback" });
    expect(selectNewestProviderTurnProgress(current, progress({
      requestId: "request-other-5678",
      startedAt: 9_999,
      deadlineAt: 99_999,
    }), 9_000)).toBe(current);
    expect(selectNewestProviderTurnProgress(null, progress(), 10_001)).toBeNull();
  });

  it("renders bounded neutral planning, capacity, primary, and fallback text", () => {
    expect(providerTurnProgressText(progress({ phase: "planning", attempt: 0, candidateCount: 0 }), 10_000))
      .toBe("正在规划可用线路 · 最多还需 90s");
    expect(providerTurnProgressText(progress({ phase: "waiting_capacity", attempt: 0 }), 99_500))
      .toBe("正在等待可用线路 · 最多还需 1s");
    expect(providerTurnProgressText(progress(), 101_000))
      .toBe("正在尝试可用线路 1/3 · 最多还需 0s");
    expect(providerTurnProgressText(progress({ phase: "fallback", attempt: 2 }), 40_000))
      .toBe("正在尝试备用线路 2/3 · 最多还需 60s");
    expect(providerTurnProgressText(progress(), -10_000))
      .toBe("正在尝试可用线路 1/3 · 最多还需 90s");
  });
});
