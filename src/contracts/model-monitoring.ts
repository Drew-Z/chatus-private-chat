export const MODEL_MONITORING_VERSION = 1 as const;
export const MODEL_MONITORING_WINDOW = "24h" as const;
export const MODEL_MONITORING_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const MODEL_MONITORING_BUCKET_MS = 60 * 60 * 1_000;
export const MEMBER_AVAILABILITY_FAILURE_WINDOW_MS = 15 * 60 * 1_000;
export const MEMBER_AVAILABILITY_MIN_SAMPLE = 3;
export const MEMBER_AVAILABILITY_HEALTHY_RATE = 0.9;
export const MEMBER_AVAILABILITY_FAST_FIRST_VISIBLE_MS = 800;
export const MEMBER_AVAILABILITY_NORMAL_FIRST_VISIBLE_MS = 2_000;

export type ModelMonitoringRunKind =
  | "main_answer"
  | "automatic_skill"
  | "memory_suggestion"
  | "conversation_summary"
  | "model_discovery"
  | "auxiliary_vision"
  | "tool_continuation"
  | "legacy_capability";
export type ModelMonitoringAttemptStatus = "started" | "succeeded" | "failed" | "cancelled" | "timed_out";
export type ModelMonitoringErrorClass =
  | "none"
  | "provider_busy"
  | "upstream_timeout"
  | "upstream_rate_limited"
  | "upstream_authentication_failed"
  | "upstream_request_rejected"
  | "provider_protocol_error"
  | "upstream_unavailable"
  | "upstream_error"
  | "request_cancelled";

export type ModelMonitorGroupV1 = {
  id: string;
  label: string;
  model?: string;
  attempts: number;
  succeeded: number;
  failures: number;
  inFlight: number;
  completed: number;
  successRate: number | null;
  fallbacks: number;
  averageLatencyMs: number | null;
};

export type ModelMonitorTrendBucketV1 = {
  bucketStart: number;
  bucketEnd: number;
  attempts: number;
  succeeded: number;
  failures: number;
  inFlight: number;
  fallbacks: number;
};

export type ModelMonitorRunKindV1 = {
  runKind: ModelMonitoringRunKind;
  attempts: number;
  succeeded: number;
  failures: number;
  inFlight: number;
  completed: number;
  successRate: number | null;
  fallbacks: number;
  averageLatencyMs: number | null;
};

export type ModelMonitorFailureClassV1 = {
  errorClass: Exclude<ModelMonitoringErrorClass, "none">;
  count: number;
};

export type ModelMonitorSnapshotV1 = {
  version: 1;
  window: "24h";
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  totals: {
    attempts: number;
    succeeded: number;
    failures: number;
    inFlight: number;
    completed: number;
    successRate: number | null;
    fallbacks: number;
    averageLatencyMs: number | null;
  };
  trend: ModelMonitorTrendBucketV1[];
  routes: ModelMonitorGroupV1[];
  providers: ModelMonitorGroupV1[];
  models: ModelMonitorGroupV1[];
  runKinds: ModelMonitorRunKindV1[];
  failureClasses: ModelMonitorFailureClassV1[];
};

export type MemberModelAvailabilityStatus = "healthy" | "degraded" | "unavailable" | "unknown";
export type MemberModelAvailabilityConfidence = "recent" | "limited" | "stale";
export type MemberModelAvailabilitySpeed = "fast" | "normal" | "slow" | "unknown";

export type MemberModelAvailabilityRouteV1 = {
  routeId: string;
  label: string;
  model: string;
  status: MemberModelAvailabilityStatus;
  confidence: MemberModelAvailabilityConfidence;
  speed: MemberModelAvailabilitySpeed;
  observedAt: number | null;
  fallbackRecentlyUsed: boolean;
  message: MemberModelAvailabilityStatus;
};

export type MemberModelAvailabilityV1 = {
  version: 1;
  generatedAt: number;
  window: "24h";
  routes: MemberModelAvailabilityRouteV1[];
};

export type ProviderAttemptMonitoringRowV1 = {
  logicalRouteId: string;
  providerId: string;
  model: string;
  runKind: ModelMonitoringRunKind;
  errorClass: ModelMonitoringErrorClass;
  bucketStart: number;
  attempts: number;
  succeeded: number;
  failures: number;
  inFlight: number;
  fallbacks: number;
  latencySumMs: number;
  latencyCount: number;
};

export type ProviderAttemptAvailabilityEvidenceV1 = {
  logicalRouteId: string;
  status: ModelMonitoringAttemptStatus;
  startedAt: number;
  endedAt: number;
  fallbackIndex: number;
};

export function deriveSuccessRate(succeeded: number, failures: number): number | null {
  const completed = succeeded + failures;
  return completed > 0 ? succeeded / completed : null;
}

export function deriveAverageLatency(latencySumMs: number, latencyCount: number): number | null {
  return latencyCount > 0 ? Math.round(latencySumMs / latencyCount) : null;
}

export function isTerminalStatus(status: ModelMonitoringAttemptStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "timed_out";
}

export function isFailureStatus(status: ModelMonitoringAttemptStatus): boolean {
  return status === "failed" || status === "cancelled" || status === "timed_out";
}

export function bucketStartFor(timestamp: number, periodStart: number): number {
  return periodStart + Math.floor((timestamp - periodStart) / MODEL_MONITORING_BUCKET_MS) * MODEL_MONITORING_BUCKET_MS;
}

export function memberAvailabilitySpeed(firstVisibleLatencyMs: number | null | undefined): MemberModelAvailabilitySpeed {
  if (typeof firstVisibleLatencyMs !== "number" || !Number.isSafeInteger(firstVisibleLatencyMs) || firstVisibleLatencyMs < 0) return "unknown";
  const latency: number = firstVisibleLatencyMs;
  if (latency <= MEMBER_AVAILABILITY_FAST_FIRST_VISIBLE_MS) return "fast";
  if (latency <= MEMBER_AVAILABILITY_NORMAL_FIRST_VISIBLE_MS) return "normal";
  return "slow";
}

export function classifyMemberAvailability(
  evidence: ProviderAttemptAvailabilityEvidenceV1[],
  now: number,
  firstVisibleLatencyMs?: number | null,
): {
  status: MemberModelAvailabilityStatus;
  confidence: MemberModelAvailabilityConfidence;
  speed: MemberModelAvailabilitySpeed;
  observedAt: number | null;
  fallbackRecentlyUsed: boolean;
} {
  const recent = evidence
    .filter((item) => item.startedAt >= now - MODEL_MONITORING_WINDOW_MS && item.startedAt <= now)
    .sort((left, right) => right.startedAt - left.startedAt);
  if (!recent.length) {
    return {
      status: "unknown",
      confidence: "stale",
      speed: memberAvailabilitySpeed(firstVisibleLatencyMs),
      observedAt: null,
      fallbackRecentlyUsed: false,
    };
  }
  const terminal = recent.filter((item) => isTerminalStatus(item.status));
  const failures = terminal.filter((item) => isFailureStatus(item.status));
  const latestTerminal = terminal.slice(0, 3);
  const unavailable = latestTerminal.length >= 3
    && latestTerminal.every((item) => isFailureStatus(item.status))
    && latestTerminal.every((item) => item.startedAt >= latestTerminal[0].startedAt - MEMBER_AVAILABILITY_FAILURE_WINDOW_MS);
  const completed = terminal.length;
  const successRate = completed ? terminal.filter((item) => item.status === "succeeded").length / completed : null;
  const fallbackRecentlyUsed = recent.some((item) => item.fallbackIndex > 0);
  const speed = memberAvailabilitySpeed(firstVisibleLatencyMs);
  const status: MemberModelAvailabilityStatus = unavailable
    ? "unavailable"
    : completed < MEMBER_AVAILABILITY_MIN_SAMPLE
      ? (failures.length ? "degraded" : "unknown")
      : successRate !== null && successRate >= MEMBER_AVAILABILITY_HEALTHY_RATE && !fallbackRecentlyUsed && speed !== "slow"
        ? "healthy"
        : "degraded";
  return {
    status,
    confidence: completed >= MEMBER_AVAILABILITY_MIN_SAMPLE ? "recent" : "limited",
    speed,
    observedAt: recent[0]?.startedAt ?? null,
    fallbackRecentlyUsed,
  };
}
