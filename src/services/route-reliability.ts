import type { ProviderStreamShape } from "../contracts/provider";
import type { ProviderCoordinator } from "../provider-coordinator";

const ROUTE_RELIABILITY_PREFIX = "route-reliability:";
const PROVIDER_ROUTE_RELIABILITY_PREFIX = "route-provider-reliability:";
const SKILL_SELECTION_TELEMETRY_PREFIX = "route-provider-skill-selection:";
const ROUTE_RELIABILITY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_PROVIDER_QUALITY_SAMPLES = 1_000;

type RouteReliabilityStoreEnv = {
  CHAT_STORE: KVNamespace;
};

type RouteReliabilityWriteEnv = RouteReliabilityStoreEnv & {
  PROVIDER_COORDINATOR: DurableObjectNamespace<ProviderCoordinator>;
};

export type RouteReliabilityOutcome =
  | "success"
  | "timeout"
  | "upstream_auth"
  | "upstream_rate_limit"
  | "upstream_client"
  | "upstream_server"
  | "protocol_error"
  | "network_error";

export type RouteReliabilityRecord = {
  version: 2;
  source: "real_task";
  routeId: string;
  ok: boolean;
  outcome: RouteReliabilityOutcome;
  observedAt: string;
  latencyMs: number;
  fallback: boolean;
  httpStatusClass?: "4xx" | "5xx";
  firstVisibleLatencyMs?: number;
  streamShape?: ProviderStreamShape;
};

type CommonReliabilityWrite = {
  routeId: string;
  providerId?: string;
  ok: boolean;
  fallback: boolean;
  startedAt: number;
  status?: number;
  error?: unknown;
  outcome?: RouteReliabilityOutcome;
  firstVisibleLatencyMs?: number;
  streamShape?: ProviderStreamShape;
};

export type ChatReliabilityWrite = CommonReliabilityWrite & {
  operation?: "chat";
  usedUserKey: boolean;
};

export type SkillSelectionReliabilityWrite = CommonReliabilityWrite & {
  operation: "skill_selection";
  usedUserKey?: boolean;
};

export type RouteReliabilityWrite = ChatReliabilityWrite | SkillSelectionReliabilityWrite;

export type SkillSelectionTelemetryRecord = {
  version: 1;
  source: "real_task";
  operation: "skill_selection";
  routeId: string;
  providerId: string;
  attempts: number;
  successes: number;
  averageLatencyMs: number;
  lastOutcome: RouteReliabilityOutcome;
  observedAt: string;
  lastFallback: boolean;
  fallbackCount: number;
  httpStatusClass?: "4xx" | "5xx";
};

export type ProviderRouteReliabilityRecord = {
  version: 2;
  source: "real_task";
  routeId: string;
  providerId: string;
  attempts: number;
  successes: number;
  averageLatencyMs: number;
  lastOutcome: RouteReliabilityOutcome;
  observedAt: string;
  lastFallback?: boolean;
  fallbackCount?: number;
  streamSamples?: number;
  progressiveSamples?: number;
  averageFirstVisibleLatencyMs?: number;
  lastFirstVisibleLatencyMs?: number;
  lastStreamShape?: ProviderStreamShape;
};

export type ProviderReliabilitySample = {
  version: 2;
  source: "real_task";
  routeId: string;
  providerId: string;
  ok: boolean;
  outcome: RouteReliabilityOutcome;
  observedAt: string;
  latencyMs: number;
  fallback: boolean;
  httpStatusClass?: "4xx" | "5xx";
  firstVisibleLatencyMs?: number;
  streamShape?: ProviderStreamShape;
};

export async function recordRouteReliability(
  env: RouteReliabilityWriteEnv,
  args: RouteReliabilityWrite,
): Promise<void> {
  if (args.operation === "skill_selection") {
    await recordSkillSelectionTelemetry(env, args);
    return;
  }
  if (args.usedUserKey) return;
  const outcome = args.outcome || classifyRouteReliability(args.ok, args.status, args.error);
  const streamEvidence = normalizeStreamEvidenceWrite(args);
  const record: RouteReliabilityRecord = {
    version: 2,
    source: "real_task",
    routeId: args.routeId,
    ok: args.ok,
    outcome,
    observedAt: new Date().toISOString(),
    latencyMs: Math.max(0, Math.min(600_000, Date.now() - args.startedAt)),
    fallback: args.fallback,
    httpStatusClass: toHttpStatusClass(args.status),
    ...streamEvidence,
  };
  try {
    const writes: Promise<void>[] = [
      env.CHAT_STORE.put(routeReliabilityKey(args.routeId), JSON.stringify(record)),
    ];
    if (args.providerId) writes.push(recordProviderRouteReliability(env, args, record));
    await Promise.all(writes);
  } catch {
    console.warn(JSON.stringify({
      level: "warn",
      event: "route_reliability_write_failed",
      routeId: args.routeId,
      ...(args.providerId ? { providerId: args.providerId } : {}),
    }));
  }
}

export async function loadSkillSelectionTelemetry(
  env: RouteReliabilityStoreEnv,
  routeId: string,
  providerId: string,
): Promise<SkillSelectionTelemetryRecord | null> {
  const key = skillSelectionTelemetryKey(routeId, providerId);
  const raw = await env.CHAT_STORE.get(key);
  if (!raw) return null;
  try {
    const record = normalizeSkillSelectionTelemetry(JSON.parse(raw), routeId, providerId);
    if (!record) await deleteInvalidReliabilityRecord(env, key);
    return record;
  } catch {
    await deleteInvalidReliabilityRecord(env, key);
    return null;
  }
}

export async function loadProviderRouteReliability(
  env: RouteReliabilityStoreEnv,
  routeId: string,
  providerId: string,
): Promise<ProviderRouteReliabilityRecord | null> {
  const key = providerRouteReliabilityKey(routeId, providerId);
  const raw = await env.CHAT_STORE.get(key);
  if (!raw) return null;
  try {
    const record = normalizeProviderRouteReliability(JSON.parse(raw), routeId, providerId);
    if (!record) await deleteInvalidReliabilityRecord(env, key);
    return record;
  } catch {
    await deleteInvalidReliabilityRecord(env, key);
    return null;
  }
}

export function isRecentProviderRouteReliability(
  value: ProviderRouteReliabilityRecord | null,
  now = Date.now(),
): value is ProviderRouteReliabilityRecord {
  if (!value) return false;
  const observedAt = Date.parse(value.observedAt);
  const ageMs = now - observedAt;
  return Number.isFinite(observedAt) && ageMs >= 0 && ageMs <= ROUTE_RELIABILITY_MAX_AGE_MS;
}

export async function loadRouteReliability(
  env: RouteReliabilityStoreEnv,
  routeId: string,
): Promise<RouteReliabilityRecord | null> {
  const key = routeReliabilityKey(routeId);
  const raw = await env.CHAT_STORE.get(key);
  if (!raw) return null;
  try {
    const record = normalizeRouteReliability(JSON.parse(raw), routeId);
    if (!record) await deleteInvalidReliabilityRecord(env, key);
    return record;
  } catch {
    await deleteInvalidReliabilityRecord(env, key);
    return null;
  }
}

export function isRecentRouteReliability(
  value: RouteReliabilityRecord | null,
  now = Date.now(),
): value is RouteReliabilityRecord {
  if (!value) return false;
  const observedAt = Date.parse(value.observedAt);
  const ageMs = now - observedAt;
  return Number.isFinite(observedAt) && ageMs >= 0 && ageMs <= ROUTE_RELIABILITY_MAX_AGE_MS;
}

export function routeReliabilityMessage(outcome: RouteReliabilityOutcome): string {
  if (outcome === "timeout") return "最近真实任务超时";
  if (outcome === "upstream_auth") return "最近真实任务遇到上游认证错误";
  if (outcome === "upstream_rate_limit") return "最近真实任务遇到上游限流";
  if (outcome === "upstream_client") return "最近真实任务被上游拒绝";
  if (outcome === "upstream_server") return "最近真实任务遇到上游服务错误";
  if (outcome === "protocol_error") return "最近真实任务返回了无法识别的响应";
  if (outcome === "network_error") return "最近真实任务无法连接上游";
  return "最近真实任务成功";
}

function routeReliabilityKey(routeId: string): string {
  return `${ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}`;
}

export function providerRouteReliabilityKey(routeId: string, providerId: string): string {
  return `${PROVIDER_ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}:${encodeURIComponent(providerId)}`;
}

export function skillSelectionTelemetryKey(routeId: string, providerId: string): string {
  return `${SKILL_SELECTION_TELEMETRY_PREFIX}${encodeURIComponent(routeId)}:${encodeURIComponent(providerId)}`;
}

async function recordSkillSelectionTelemetry(
  env: RouteReliabilityWriteEnv,
  args: SkillSelectionReliabilityWrite,
): Promise<void> {
  const providerId = args.providerId?.trim() || "";
  if (!providerId) return;
  const outcome = args.outcome || classifyRouteReliability(args.ok, args.status, args.error);
  const latencyMs = Math.max(0, Math.min(600_000, Date.now() - args.startedAt));
  try {
    await env.PROVIDER_COORDINATOR.getByName(providerId).recordReliabilitySample({
      operation: "skill_selection",
      sample: {
        version: 2,
        source: "real_task",
        routeId: args.routeId,
        providerId,
        ok: args.ok,
        outcome,
        observedAt: new Date().toISOString(),
        latencyMs,
        fallback: args.fallback,
        httpStatusClass: toHttpStatusClass(args.status),
      },
    });
  } catch {
    console.warn(JSON.stringify({
      level: "warn",
      event: "route_reliability_write_failed",
      operation: "skill_selection",
      routeId: args.routeId,
      providerId,
    }));
  }
}

export function normalizeSkillSelectionTelemetry(
  value: unknown,
  routeId: string,
  providerId: string,
): SkillSelectionTelemetryRecord | null {
  if (
    !isRecord(value)
    || value.version !== 1
    || value.source !== "real_task"
    || value.operation !== "skill_selection"
    || value.routeId !== routeId
    || value.providerId !== providerId
    || !isRouteReliabilityOutcome(value.lastOutcome)
    || typeof value.observedAt !== "string"
    || !Number.isFinite(Date.parse(value.observedAt))
  ) return null;
  const attempts = value.attempts;
  const successes = value.successes;
  const averageLatencyMs = value.averageLatencyMs;
  const fallbackCount = value.fallbackCount;
  if (
    typeof attempts !== "number"
    || !Number.isInteger(attempts)
    || attempts < 1
    || attempts > MAX_PROVIDER_QUALITY_SAMPLES
    || typeof successes !== "number"
    || !Number.isInteger(successes)
    || successes < 0
    || successes > attempts
    || typeof averageLatencyMs !== "number"
    || !Number.isInteger(averageLatencyMs)
    || averageLatencyMs < 0
    || averageLatencyMs > 600_000
    || typeof value.lastFallback !== "boolean"
    || typeof fallbackCount !== "number"
    || !Number.isInteger(fallbackCount)
    || fallbackCount < 0
    || fallbackCount > attempts
    || (value.httpStatusClass !== undefined && value.httpStatusClass !== "4xx" && value.httpStatusClass !== "5xx")
  ) return null;
  return {
    version: 1,
    source: "real_task",
    operation: "skill_selection",
    routeId,
    providerId,
    attempts,
    successes,
    averageLatencyMs,
    lastOutcome: value.lastOutcome,
    observedAt: value.observedAt,
    lastFallback: value.lastFallback,
    fallbackCount,
    ...(value.httpStatusClass ? { httpStatusClass: value.httpStatusClass } : {}),
  };
}

async function deleteInvalidReliabilityRecord(env: RouteReliabilityStoreEnv, key: string): Promise<void> {
  try {
    await env.CHAT_STORE.delete(key);
  } catch {
    // Passive telemetry cleanup must never affect routing or diagnostics.
  }
}

async function recordProviderRouteReliability(
  env: RouteReliabilityWriteEnv,
  args: ChatReliabilityWrite,
  latest: RouteReliabilityRecord,
): Promise<void> {
  const providerId = args.providerId?.trim() || "";
  if (!providerId) return;
  await env.PROVIDER_COORDINATOR.getByName(providerId).recordReliabilitySample({
    operation: "chat",
    sample: {
      version: 2,
      source: "real_task",
      routeId: args.routeId,
      providerId,
      ok: latest.ok,
      outcome: latest.outcome,
      observedAt: latest.observedAt,
      latencyMs: latest.latencyMs,
      fallback: latest.fallback,
      httpStatusClass: latest.httpStatusClass,
      firstVisibleLatencyMs: latest.firstVisibleLatencyMs,
      streamShape: latest.streamShape,
    },
  });
}

export function normalizeProviderReliabilitySample(value: unknown): ProviderReliabilitySample | null {
  if (!isRecord(value)) return null;
  const routeId = normalizeAggregateId(value.routeId);
  const providerId = normalizeAggregateId(value.providerId);
  if (!routeId || !providerId) return null;
  const normalized = normalizeRouteReliability(value, routeId);
  if (!normalized) return null;
  return {
    version: 2,
    source: "real_task",
    routeId,
    providerId,
    ok: normalized.ok,
    outcome: normalized.outcome,
    observedAt: normalized.observedAt,
    latencyMs: normalized.latencyMs,
    fallback: normalized.fallback,
    httpStatusClass: normalized.httpStatusClass,
    firstVisibleLatencyMs: normalized.firstVisibleLatencyMs,
    streamShape: normalized.streamShape,
  };
}

export function reduceSkillSelectionTelemetry(
  previous: SkillSelectionTelemetryRecord | null,
  latest: ProviderReliabilitySample,
): SkillSelectionTelemetryRecord {
  const previousAttempts = previous?.attempts || 0;
  const sampleWeight = Math.min(previousAttempts, MAX_PROVIDER_QUALITY_SAMPLES - 1);
  const attempts = Math.min(MAX_PROVIDER_QUALITY_SAMPLES, sampleWeight + 1);
  const successes = Math.min(
    attempts,
    Math.round((previousAttempts > 0 ? (previous?.successes || 0) / previousAttempts : 0) * sampleWeight)
      + (latest.ok ? 1 : 0),
  );
  return {
    version: 1,
    source: "real_task",
    operation: "skill_selection",
    routeId: latest.routeId,
    providerId: latest.providerId,
    attempts,
    successes,
    averageLatencyMs: Math.round(
      (((previous?.averageLatencyMs || 0) * sampleWeight) + latest.latencyMs) / attempts,
    ),
    lastOutcome: latest.outcome,
    observedAt: latest.observedAt,
    lastFallback: latest.fallback,
    fallbackCount: Math.min(
      MAX_PROVIDER_QUALITY_SAMPLES,
      (previous?.fallbackCount || 0) + (latest.fallback ? 1 : 0),
    ),
    httpStatusClass: latest.httpStatusClass,
  };
}

export function reduceProviderRouteReliability(
  previous: ProviderRouteReliabilityRecord | null,
  latest: ProviderReliabilitySample,
): ProviderRouteReliabilityRecord {
  const previousAttempts = previous?.attempts || 0;
  const sampleWeight = Math.min(previousAttempts, MAX_PROVIDER_QUALITY_SAMPLES - 1);
  const attempts = Math.min(MAX_PROVIDER_QUALITY_SAMPLES, sampleWeight + 1);
  const successes = Math.min(
    attempts,
    Math.round((previousAttempts > 0 ? (previous?.successes || 0) / previousAttempts : 0) * sampleWeight)
      + (latest.ok ? 1 : 0),
  );
  return {
    version: 2,
    source: "real_task",
    routeId: latest.routeId,
    providerId: latest.providerId,
    attempts,
    successes,
    averageLatencyMs: Math.round(
      (((previous?.averageLatencyMs || 0) * sampleWeight) + latest.latencyMs) / attempts,
    ),
    lastOutcome: latest.outcome,
    observedAt: latest.observedAt,
    lastFallback: latest.fallback,
    fallbackCount: Math.min(
      MAX_PROVIDER_QUALITY_SAMPLES,
      (previous?.fallbackCount || 0) + (latest.fallback ? 1 : 0),
    ),
    ...aggregateProviderStreamEvidence(previous, latest, successes),
  };
}

function normalizeRouteReliability(value: unknown, routeId: string): RouteReliabilityRecord | null {
  if (!isRecord(value) || value.version !== 2 || value.source !== "real_task" || value.routeId !== routeId) return null;
  const outcome = value.outcome;
  if (
    !isRouteReliabilityOutcome(outcome)
    || typeof value.ok !== "boolean"
    || value.ok !== (outcome === "success")
    || typeof value.fallback !== "boolean"
    || typeof value.observedAt !== "string"
    || !Number.isFinite(Date.parse(value.observedAt))
  ) return null;
  const latencyMs = value.latencyMs;
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 600_000) return null;
  if (
    value.httpStatusClass !== undefined
    && value.httpStatusClass !== "4xx"
    && value.httpStatusClass !== "5xx"
  ) return null;
  const streamEvidence = normalizeStoredStreamEvidence(value, value.ok);
  if (streamEvidence === null) return null;
  return {
    version: 2,
    source: "real_task",
    routeId,
    ok: value.ok,
    outcome,
    observedAt: value.observedAt,
    latencyMs: Math.round(latencyMs),
    fallback: value.fallback,
    httpStatusClass: value.httpStatusClass,
    ...streamEvidence,
  };
}

export function normalizeProviderRouteReliability(
  value: unknown,
  routeId: string,
  providerId: string,
): ProviderRouteReliabilityRecord | null {
  if (
    !isRecord(value)
    || value.version !== 2
    || value.source !== "real_task"
    || value.routeId !== routeId
    || value.providerId !== providerId
    || !isRouteReliabilityOutcome(value.lastOutcome)
    || typeof value.observedAt !== "string"
    || !Number.isFinite(Date.parse(value.observedAt))
  ) return null;
  const attempts = value.attempts;
  const successes = value.successes;
  const averageLatencyMs = value.averageLatencyMs;
  const fallbackCount = typeof value.fallbackCount === "number" ? value.fallbackCount : undefined;
  const streamEvidence = normalizeStoredProviderStreamEvidence(value);
  if (streamEvidence === null) return null;
  if (
    typeof attempts !== "number"
    || !Number.isInteger(attempts)
    || attempts < 1
    || attempts > MAX_PROVIDER_QUALITY_SAMPLES
    || typeof successes !== "number"
    || !Number.isInteger(successes)
    || successes < 0
    || successes > attempts
    || typeof averageLatencyMs !== "number"
    || !Number.isFinite(averageLatencyMs)
    || averageLatencyMs < 0
    || averageLatencyMs > 600_000
    || (value.lastFallback !== undefined && typeof value.lastFallback !== "boolean")
    || (value.fallbackCount !== undefined
      && (fallbackCount === undefined || !Number.isInteger(fallbackCount) || fallbackCount < 0 || fallbackCount > attempts))
    || (streamEvidence.streamSamples !== undefined && streamEvidence.streamSamples > successes)
  ) return null;
  return {
    version: 2,
    source: "real_task",
    routeId,
    providerId,
    attempts,
    successes,
    averageLatencyMs: Math.round(averageLatencyMs),
    lastOutcome: value.lastOutcome,
    observedAt: value.observedAt,
    ...(value.lastFallback === undefined ? {} : { lastFallback: value.lastFallback }),
    ...(fallbackCount === undefined ? {} : { fallbackCount }),
    ...streamEvidence,
  };
}

function normalizeStreamEvidenceWrite(
  value: Pick<ChatReliabilityWrite, "ok" | "firstVisibleLatencyMs" | "streamShape">,
): Pick<RouteReliabilityRecord, "firstVisibleLatencyMs" | "streamShape"> {
  if (
    !value.ok
    || !isRouteStreamShape(value.streamShape)
    || typeof value.firstVisibleLatencyMs !== "number"
    || !Number.isFinite(value.firstVisibleLatencyMs)
  ) return {};
  return {
    firstVisibleLatencyMs: Math.max(0, Math.min(600_000, Math.round(value.firstVisibleLatencyMs))),
    streamShape: value.streamShape,
  };
}

function normalizeStoredStreamEvidence(
  value: Record<string, unknown>,
  ok: boolean,
): Pick<RouteReliabilityRecord, "firstVisibleLatencyMs" | "streamShape"> | null {
  const hasLatency = value.firstVisibleLatencyMs !== undefined;
  const hasShape = value.streamShape !== undefined;
  if (!hasLatency && !hasShape) return {};
  if (
    !ok
    || !hasLatency
    || !hasShape
    || typeof value.firstVisibleLatencyMs !== "number"
    || !Number.isInteger(value.firstVisibleLatencyMs)
    || value.firstVisibleLatencyMs < 0
    || value.firstVisibleLatencyMs > 600_000
    || !isRouteStreamShape(value.streamShape)
  ) return null;
  return {
    firstVisibleLatencyMs: value.firstVisibleLatencyMs,
    streamShape: value.streamShape,
  };
}

function aggregateProviderStreamEvidence(
  previous: ProviderRouteReliabilityRecord | null,
  latest: RouteReliabilityRecord,
  maxStreamSamples: number,
): Pick<ProviderRouteReliabilityRecord,
  | "streamSamples"
  | "progressiveSamples"
  | "averageFirstVisibleLatencyMs"
  | "lastFirstVisibleLatencyMs"
  | "lastStreamShape"
> {
  if (latest.firstVisibleLatencyMs === undefined || !latest.streamShape) {
    const previousSamples = previous?.streamSamples || 0;
    const streamSamples = Math.min(previousSamples, maxStreamSamples);
    if (streamSamples === 0) return {};
    return {
      streamSamples,
      progressiveSamples: Math.min(
        streamSamples,
        Math.round(((previous?.progressiveSamples || 0) / previousSamples) * streamSamples),
      ),
      averageFirstVisibleLatencyMs: previous!.averageFirstVisibleLatencyMs!,
      lastFirstVisibleLatencyMs: previous!.lastFirstVisibleLatencyMs!,
      lastStreamShape: previous!.lastStreamShape!,
    };
  }
  const previousSamples = previous?.streamSamples || 0;
  const sampleWeight = Math.min(previousSamples, MAX_PROVIDER_QUALITY_SAMPLES - 1, maxStreamSamples - 1);
  const streamSamples = Math.min(MAX_PROVIDER_QUALITY_SAMPLES, maxStreamSamples, sampleWeight + 1);
  const progressiveSamples = Math.min(
    streamSamples,
    Math.round(
      (previousSamples > 0 ? (previous?.progressiveSamples || 0) / previousSamples : 0) * sampleWeight,
    ) + (latest.streamShape === "progressive" ? 1 : 0),
  );
  return {
    streamSamples,
    progressiveSamples,
    averageFirstVisibleLatencyMs: Math.round(
      (((previous?.averageFirstVisibleLatencyMs || 0) * sampleWeight) + latest.firstVisibleLatencyMs) / streamSamples,
    ),
    lastFirstVisibleLatencyMs: latest.firstVisibleLatencyMs,
    lastStreamShape: latest.streamShape,
  };
}

function normalizeStoredProviderStreamEvidence(
  value: Record<string, unknown>,
): Pick<ProviderRouteReliabilityRecord,
  | "streamSamples"
  | "progressiveSamples"
  | "averageFirstVisibleLatencyMs"
  | "lastFirstVisibleLatencyMs"
  | "lastStreamShape"
> | null {
  const fields = [
    value.streamSamples,
    value.progressiveSamples,
    value.averageFirstVisibleLatencyMs,
    value.lastFirstVisibleLatencyMs,
    value.lastStreamShape,
  ];
  if (fields.every((field) => field === undefined)) return {};
  if (fields.some((field) => field === undefined)) return null;
  if (
    typeof value.streamSamples !== "number"
    || !Number.isInteger(value.streamSamples)
    || value.streamSamples < 1
    || value.streamSamples > MAX_PROVIDER_QUALITY_SAMPLES
    || typeof value.progressiveSamples !== "number"
    || !Number.isInteger(value.progressiveSamples)
    || value.progressiveSamples < 0
    || value.progressiveSamples > value.streamSamples
    || !isBoundedLatency(value.averageFirstVisibleLatencyMs)
    || !isBoundedLatency(value.lastFirstVisibleLatencyMs)
    || !isRouteStreamShape(value.lastStreamShape)
  ) return null;
  return {
    streamSamples: value.streamSamples,
    progressiveSamples: value.progressiveSamples,
    averageFirstVisibleLatencyMs: value.averageFirstVisibleLatencyMs,
    lastFirstVisibleLatencyMs: value.lastFirstVisibleLatencyMs,
    lastStreamShape: value.lastStreamShape,
  };
}

function isBoundedLatency(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= 600_000;
}

function isRouteStreamShape(value: unknown): value is ProviderStreamShape {
  return value === "progressive" || value === "single_chunk";
}

function isRouteReliabilityOutcome(value: unknown): value is RouteReliabilityOutcome {
  return value === "success"
    || value === "timeout"
    || value === "upstream_auth"
    || value === "upstream_rate_limit"
    || value === "upstream_client"
    || value === "upstream_server"
    || value === "protocol_error"
    || value === "network_error";
}

function classifyRouteReliability(
  ok: boolean,
  status: number | undefined,
  error: unknown,
): RouteReliabilityOutcome {
  if (ok) return "success";
  if (isTimeoutError(error)) return "timeout";
  if (status === 401 || status === 403) return "upstream_auth";
  if (status === 429) return "upstream_rate_limit";
  if (typeof status === "number" && status >= 500) {
    const message = error instanceof Error ? error.message : "";
    return /无法识别|invalid response|protocol/i.test(message) ? "protocol_error" : "upstream_server";
  }
  if (typeof status === "number" && status >= 400) return "upstream_client";
  return "network_error";
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || /timed?\s*out|timeout|超时/i.test(error.message);
}

function toHttpStatusClass(status: number | undefined): "4xx" | "5xx" | undefined {
  if (typeof status !== "number") return undefined;
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  return undefined;
}

function normalizeAggregateId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || value.trim() !== value) return "";
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
