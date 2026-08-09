import { normalizeAgentRequestId } from "./agent-error";

export const PROVIDER_TURN_RUN_DEADLINE_MS = 90_000;
export const PROVIDER_TURN_PROGRESS_MAX_CANDIDATES = 1_000;

export const PROVIDER_TURN_PROGRESS_PHASES = [
  "planning",
  "waiting_capacity",
  "attempting",
  "fallback",
] as const;

export type ProviderTurnProgressPhase = typeof PROVIDER_TURN_PROGRESS_PHASES[number];

export type ProviderTurnProgressV1 = {
  type: "chatus_provider_turn_progress";
  version: 1;
  requestId: string;
  sequence: number;
  phase: ProviderTurnProgressPhase;
  attempt: number;
  candidateCount: number;
  startedAt: number;
  deadlineAt: number;
};

const PROVIDER_TURN_PROGRESS_KEYS = [
  "type",
  "version",
  "requestId",
  "sequence",
  "phase",
  "attempt",
  "candidateCount",
  "startedAt",
  "deadlineAt",
] as const;

export function decodeProviderTurnProgressV1(value: unknown): ProviderTurnProgressV1 | undefined {
  if (!isExactRecord(value, PROVIDER_TURN_PROGRESS_KEYS)) return undefined;
  if (value.type !== "chatus_provider_turn_progress" || value.version !== 1) return undefined;
  const requestId = normalizeAgentRequestId(value.requestId);
  if (!requestId || requestId !== value.requestId) return undefined;
  if (!isPositiveSafeInteger(value.sequence)) return undefined;
  if (!isProviderTurnProgressPhase(value.phase)) return undefined;
  if (!isNonNegativeSafeInteger(value.attempt)) return undefined;
  if (
    !isNonNegativeSafeInteger(value.candidateCount)
    || value.candidateCount > PROVIDER_TURN_PROGRESS_MAX_CANDIDATES
  ) return undefined;
  if (!isNonNegativeSafeInteger(value.startedAt) || !isNonNegativeSafeInteger(value.deadlineAt)) return undefined;
  if (value.deadlineAt - value.startedAt !== PROVIDER_TURN_RUN_DEADLINE_MS) return undefined;

  if (value.phase === "planning") {
    if (value.attempt !== 0 || value.candidateCount !== 0) return undefined;
  } else if (value.phase === "waiting_capacity") {
    if (value.attempt !== 0 || value.candidateCount < 1) return undefined;
  } else if (value.phase === "attempting") {
    if (value.attempt < 1 || value.attempt > value.candidateCount) return undefined;
  } else if (value.attempt < 2 || value.attempt > value.candidateCount) {
    return undefined;
  }

  return {
    type: "chatus_provider_turn_progress",
    version: 1,
    requestId,
    sequence: value.sequence,
    phase: value.phase,
    attempt: value.attempt,
    candidateCount: value.candidateCount,
    startedAt: value.startedAt,
    deadlineAt: value.deadlineAt,
  };
}

function isProviderTurnProgressPhase(value: unknown): value is ProviderTurnProgressPhase {
  return typeof value === "string" && PROVIDER_TURN_PROGRESS_PHASES.some((phase) => phase === value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isExactRecord<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
