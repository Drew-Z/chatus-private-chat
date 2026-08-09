import { describe, expect, it } from "vitest";
import {
  PROVIDER_TURN_RUN_DEADLINE_MS,
  decodeProviderTurnProgressV1,
} from "../src/contracts/provider-turn-progress";

const REQUEST_ID = "request-progress-1234";

function frame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "chatus_provider_turn_progress",
    version: 1,
    requestId: REQUEST_ID,
    sequence: 1,
    phase: "attempting",
    attempt: 1,
    candidateCount: 3,
    startedAt: 1_000,
    deadlineAt: 1_000 + PROVIDER_TURN_RUN_DEADLINE_MS,
    ...overrides,
  };
}

describe("Provider turn progress contract", () => {
  it("accepts only the exact bounded phase shapes", () => {
    expect(decodeProviderTurnProgressV1(frame())).toEqual(frame());
    expect(decodeProviderTurnProgressV1(frame({ phase: "planning", attempt: 0, candidateCount: 0 }))).toBeTruthy();
    expect(decodeProviderTurnProgressV1(frame({ phase: "waiting_capacity", attempt: 0 }))).toBeTruthy();
    expect(decodeProviderTurnProgressV1(frame({ phase: "fallback", attempt: 2 }))).toBeTruthy();
  });

  it("rejects unknown keys, invalid request IDs, phase contradictions, and altered deadlines", () => {
    expect(decodeProviderTurnProgressV1(frame({ providerId: "must-not-cross" }))).toBeUndefined();
    expect(decodeProviderTurnProgressV1(frame({ requestId: "short" }))).toBeUndefined();
    expect(decodeProviderTurnProgressV1(frame({ phase: "fallback", attempt: 1 }))).toBeUndefined();
    expect(decodeProviderTurnProgressV1(frame({ phase: "planning", candidateCount: 1, attempt: 0 }))).toBeUndefined();
    expect(decodeProviderTurnProgressV1(frame({ deadlineAt: 91_001 }))).toBeUndefined();
    expect(decodeProviderTurnProgressV1(frame({ sequence: 0 }))).toBeUndefined();
  });
});
