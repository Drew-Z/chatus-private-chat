const ROUTE_RELIABILITY_PREFIX = "route-reliability:";
const PROVIDER_ROUTE_RELIABILITY_PREFIX = "route-provider-reliability:";
const ROUTE_RELIABILITY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_PROVIDER_QUALITY_SAMPLES = 1_000;

type RouteReliabilityEnv = {
  CHAT_STORE: KVNamespace;
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
  version: 1;
  source: "real_task";
  routeId: string;
  ok: boolean;
  outcome: RouteReliabilityOutcome;
  observedAt: string;
  latencyMs: number;
  fallback: boolean;
  httpStatusClass?: "4xx" | "5xx";
};

export type RouteReliabilityWrite = {
  routeId: string;
  providerId?: string;
  ok: boolean;
  fallback: boolean;
  startedAt: number;
  status?: number;
  error?: unknown;
  outcome?: RouteReliabilityOutcome;
  usedUserKey?: boolean;
};

export type ProviderRouteReliabilityRecord = {
  version: 1;
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
};

export async function recordRouteReliability(
  env: RouteReliabilityEnv,
  args: RouteReliabilityWrite,
): Promise<void> {
  if (args.usedUserKey && (args.status === 401 || args.status === 403)) return;
  const outcome = args.outcome || classifyRouteReliability(args.ok, args.status, args.error);
  const record: RouteReliabilityRecord = {
    version: 1,
    source: "real_task",
    routeId: args.routeId,
    ok: args.ok,
    outcome,
    observedAt: new Date().toISOString(),
    latencyMs: Math.max(0, Math.min(600_000, Date.now() - args.startedAt)),
    fallback: args.fallback,
    httpStatusClass: toHttpStatusClass(args.status),
  };
  try {
    const writes: Promise<void>[] = [
      env.CHAT_STORE.put(routeReliabilityKey(args.routeId), JSON.stringify(record)),
    ];
    if (args.providerId) {
      writes.push(recordProviderRouteReliability(env, args, record));
    }
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

export async function loadProviderRouteReliability(
  env: RouteReliabilityEnv,
  routeId: string,
  providerId: string,
): Promise<ProviderRouteReliabilityRecord | null> {
  const raw = await env.CHAT_STORE.get(providerRouteReliabilityKey(routeId, providerId));
  if (!raw) return null;
  try {
    return normalizeProviderRouteReliability(JSON.parse(raw), routeId, providerId);
  } catch {
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
  env: RouteReliabilityEnv,
  routeId: string,
): Promise<RouteReliabilityRecord | null> {
  const raw = await env.CHAT_STORE.get(routeReliabilityKey(routeId));
  if (!raw) return null;
  try {
    return normalizeRouteReliability(JSON.parse(raw), routeId);
  } catch {
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

function providerRouteReliabilityKey(routeId: string, providerId: string): string {
  return `${PROVIDER_ROUTE_RELIABILITY_PREFIX}${encodeURIComponent(routeId)}:${encodeURIComponent(providerId)}`;
}

async function recordProviderRouteReliability(
  env: RouteReliabilityEnv,
  args: RouteReliabilityWrite & { providerId?: string },
  latest: RouteReliabilityRecord,
): Promise<void> {
  const providerId = args.providerId?.trim() || "";
  if (!providerId) return;
  const previous = await loadProviderRouteReliability(env, args.routeId, providerId);
  const previousAttempts = previous?.attempts || 0;
  const sampleWeight = Math.min(previousAttempts, MAX_PROVIDER_QUALITY_SAMPLES - 1);
  const attempts = Math.min(MAX_PROVIDER_QUALITY_SAMPLES, sampleWeight + 1);
  const successes = Math.min(
    attempts,
    Math.round((previousAttempts > 0 ? (previous?.successes || 0) / previousAttempts : 0) * sampleWeight)
      + (latest.ok ? 1 : 0),
  );
  const averageLatencyMs = Math.round(
    (((previous?.averageLatencyMs || 0) * sampleWeight) + latest.latencyMs) / attempts,
  );
  const record: ProviderRouteReliabilityRecord = {
    version: 1,
    source: "real_task",
    routeId: args.routeId,
    providerId,
    attempts,
    successes,
    averageLatencyMs,
    lastOutcome: latest.outcome,
    observedAt: latest.observedAt,
    lastFallback: latest.fallback,
    fallbackCount: Math.min(MAX_PROVIDER_QUALITY_SAMPLES, (previous?.fallbackCount || 0) + (latest.fallback ? 1 : 0)),
  };
  await env.CHAT_STORE.put(providerRouteReliabilityKey(args.routeId, providerId), JSON.stringify(record));
}

function normalizeRouteReliability(value: unknown, routeId: string): RouteReliabilityRecord | null {
  if (!isRecord(value) || value.version !== 1 || value.source !== "real_task" || value.routeId !== routeId) return null;
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
  return {
    version: 1,
    source: "real_task",
    routeId,
    ok: value.ok,
    outcome,
    observedAt: value.observedAt,
    latencyMs: Math.round(latencyMs),
    fallback: value.fallback,
    httpStatusClass: value.httpStatusClass,
  };
}

function normalizeProviderRouteReliability(
  value: unknown,
  routeId: string,
  providerId: string,
): ProviderRouteReliabilityRecord | null {
  if (
    !isRecord(value)
    || value.version !== 1
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
  ) return null;
  return {
    version: 1,
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
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
