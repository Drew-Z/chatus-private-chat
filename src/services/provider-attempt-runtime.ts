import {
  createProviderRunId,
  createProviderTurnId,
  providerAttemptIdempotencyKey,
  providerOfferingId,
  type ProviderAttemptCredentialClass,
  type ProviderAttemptErrorClass,
  type ProviderAttemptRunKind,
  type ProviderAttemptTerminalStatus,
} from "../contracts/provider-attempt";
import type { ProviderAttemptLedger } from "../provider-attempt-ledger";
import {
  PROVIDER_USAGE_TOKEN_FIELDS,
  type ProviderTokenUsageV1,
  type ProviderUsageEvidenceClass,
  type ProviderUsageEvidenceMode,
  type ProviderUsageEvidenceSource,
} from "../contracts/provider-finance";
import { providerUsageEvidenceId } from "./provider-usage";
import type { InstanceOperationStateV1 } from "./instance-capture";

export type ProviderAttemptLedgerMode = "required" | "disabled";

export class ProviderAttemptLedgerError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Provider attempt ledger is unavailable.", options);
    this.name = "ProviderAttemptLedgerError";
  }
}

export type ProviderBudgetErrorCode = "provider_budget_exceeded" | "provider_budget_policy_unknown";

export class ProviderBudgetError extends Error {
  readonly code: ProviderBudgetErrorCode;

  constructor(code: ProviderBudgetErrorCode, options?: { cause?: unknown }) {
    super(code === "provider_budget_exceeded"
      ? "Provider budget is exhausted."
      : "Provider budget policy is unavailable.", options);
    this.name = "ProviderBudgetError";
    this.code = code;
  }
}

export function isProviderAttemptBlockingError(error: unknown): boolean {
  return error instanceof ProviderAttemptLedgerError || error instanceof ProviderBudgetError;
}

export type ProviderAttemptRuntime = {
  readonly turnId: string;
  createRun(runKind: ProviderAttemptRunKind): ProviderAttemptRun;
};

export type ProviderAttemptRun = {
  readonly turnId: string;
  readonly runId: string;
  readonly runKind: ProviderAttemptRunKind;
  start(input: ProviderAttemptRouteInput): Promise<ProviderAttemptHandle>;
};

export type ProviderAttemptRouteInput = {
  logicalRouteId: string;
  providerId: string;
  model: string;
  credentialClass: ProviderAttemptCredentialClass;
  fallbackIndex: number;
  startedAt?: number;
};

export type ProviderAttemptHandle = {
  readonly attemptId?: string;
  recordUsage(input: ProviderAttemptUsageInput): Promise<void>;
  succeed(endedAt?: number): Promise<void>;
  fail(error: unknown, endedAt?: number): Promise<void>;
  cancel(endedAt?: number): Promise<void>;
  timeout(endedAt?: number): Promise<void>;
};

export type ProviderAttemptUsageInput = ProviderTokenUsageV1 & {
  evidenceId?: string;
  mode?: ProviderUsageEvidenceMode;
  evidenceClass?: ProviderUsageEvidenceClass;
  source: ProviderUsageEvidenceSource;
  observedAt?: number;
};

export function normalizeProviderAttemptLedgerMode(value: unknown): ProviderAttemptLedgerMode {
  return value === "disabled" ? "disabled" : "required";
}

export function createProviderAttemptRuntime(input: {
  ledger: DurableObjectNamespace<ProviderAttemptLedger>;
  mode?: unknown;
  operation: InstanceOperationStateV1;
  turnId?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
}): ProviderAttemptRuntime {
  const turnId = input.turnId || createProviderTurnId();
  const mode = normalizeProviderAttemptLedgerMode(input.mode);
  return {
    turnId,
    createRun(runKind) {
      return createRun({
        ledger: input.ledger,
        mode,
        operation: input.operation,
        turnId,
        runId: createProviderRunId(),
        runKind,
        waitUntil: input.waitUntil,
      });
    },
  };
}

export function projectProviderAttemptFailure(error: unknown): {
  status: Exclude<ProviderAttemptTerminalStatus, "succeeded">;
  errorClass: ProviderAttemptErrorClass;
} {
  const chain = errorChain(error);
  if (chain.some((item) => item.name === "AbortError")) {
    return { status: "cancelled", errorClass: "request_cancelled" };
  }
  const text = chain.map((item) => typeof item.message === "string" ? item.message : "").join(" ").toLowerCase();
  const status = firstStatus(chain);
  if (
    chain.some((item) => item.name === "TimeoutError")
    || status === 408
    || status === 504
    || /timed?\s*out|timeout|超时/.test(text)
  ) return { status: "timed_out", errorClass: "upstream_timeout" };
  if (
    chain.some((item) => item.name === "ProviderProtocolError")
    || chain.some((item) => item.outcome === "protocol_error")
  ) return { status: "failed", errorClass: "provider_protocol_error" };
  if (chain.some((item) => item.name === "ProviderBusyError")) {
    return { status: "failed", errorClass: "provider_busy" };
  }
  if (status === 401 || status === 403) {
    return { status: "failed", errorClass: "upstream_authentication_failed" };
  }
  if (status === 429) return { status: "failed", errorClass: "upstream_rate_limited" };
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return { status: "failed", errorClass: "upstream_request_rejected" };
  }
  if (status !== undefined && status >= 500) {
    return { status: "failed", errorClass: "upstream_unavailable" };
  }
  if (chain.some((item) => item.name === "AI_APICallError" || item.name === "TypeError")) {
    return { status: "failed", errorClass: "upstream_unavailable" };
  }
  return { status: "failed", errorClass: "upstream_error" };
}

function createRun(input: {
  ledger: DurableObjectNamespace<ProviderAttemptLedger>;
  mode: ProviderAttemptLedgerMode;
  operation: InstanceOperationStateV1;
  turnId: string;
  runId: string;
  runKind: ProviderAttemptRunKind;
  waitUntil?: (promise: Promise<unknown>) => void;
}): ProviderAttemptRun {
  return {
    turnId: input.turnId,
    runId: input.runId,
    runKind: input.runKind,
    async start(route) {
      const startedAt = route.startedAt ?? Date.now();
      if (input.mode === "disabled") return disabledHandle();
      const stub = input.ledger.getByName(route.providerId);
      const result = await requiredLedgerCall(() => stub.start({
          version: 1,
          idempotencyKey: providerAttemptIdempotencyKey(
            input.operation.fenceId,
            input.runId,
            route.fallbackIndex,
          ),
          turnId: input.turnId,
          runId: input.runId,
          runKind: input.runKind,
          logicalRouteId: route.logicalRouteId,
          providerId: route.providerId,
          offeringId: providerOfferingId(route.logicalRouteId, route.providerId),
          model: route.model,
          fallbackIndex: route.fallbackIndex,
          credentialClass: route.credentialClass,
          operation: input.operation,
          startedAt,
        }));
      return requiredHandle(stub, result.attempt.attemptId, input.waitUntil);
    },
  };
}

function requiredHandle(
  stub: DurableObjectStub<ProviderAttemptLedger>,
  attemptId: string,
  waitUntil?: (promise: Promise<unknown>) => void,
): ProviderAttemptHandle {
  let settled: { status: ProviderAttemptTerminalStatus; errorClass: ProviderAttemptErrorClass } | undefined;
  const terminal = async (
    status: ProviderAttemptTerminalStatus,
    errorClass: ProviderAttemptErrorClass,
    endedAt = Date.now(),
    preserveSuccessfulResponse = false,
  ) => {
    if (settled) {
      if (settled.status !== status || settled.errorClass !== errorClass) {
        throw new Error("provider_attempt_conflict");
      }
      return;
    }
    try {
      await requiredLedgerCall(() => stub.terminal({ version: 1, attemptId, status, errorClass, endedAt }));
    } catch (error) {
      if (
        preserveSuccessfulResponse
        && error instanceof ProviderAttemptLedgerError
        && !isProviderTerminalConsistencyError(error)
      ) {
        settled = { status, errorClass };
        scheduleTerminalRetry(stub, attemptId, status, errorClass, endedAt, waitUntil);
        return;
      }
      throw error;
    }
    settled = { status, errorClass };
  };
  return {
    attemptId,
    recordUsage: async (usage) => {
      const observedAt = usage.observedAt ?? Date.now();
      const hasKnownUsage = PROVIDER_USAGE_TOKEN_FIELDS.some((field) => usage[field] !== null);
      await requiredLedgerCall(() => stub.appendUsage({
        version: 1,
        evidenceId: usage.evidenceId ?? providerUsageEvidenceId(attemptId, usage.source),
        attemptId,
        mode: usage.mode ?? (hasKnownUsage ? "cumulative" : "missing"),
        evidenceClass: usage.evidenceClass ?? "reported",
        source: usage.source,
        observedAt,
        inputNoCacheTokens: usage.inputNoCacheTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheWriteInputTokens: usage.cacheWriteInputTokens,
        outputTextTokens: usage.outputTextTokens,
        reasoningOutputTokens: usage.reasoningOutputTokens,
      }));
    },
    succeed: (endedAt) => terminal("succeeded", "none", endedAt, true),
    async fail(error, endedAt) {
      const projected = projectProviderAttemptFailure(error);
      await terminal(projected.status, projected.errorClass, endedAt);
    },
    cancel: (endedAt) => terminal("cancelled", "request_cancelled", endedAt),
    timeout: (endedAt) => terminal("timed_out", "upstream_timeout", endedAt),
  };
}

function disabledHandle(): ProviderAttemptHandle {
  return {
    recordUsage: async () => undefined,
    succeed: async () => undefined,
    fail: async () => undefined,
    cancel: async () => undefined,
    timeout: async () => undefined,
  };
}

async function retryLedgerCall<T>(call: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function requiredLedgerCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await retryLedgerCall(call);
  } catch (cause) {
    const budgetCode = providerBudgetErrorCode(cause);
    if (budgetCode) throw new ProviderBudgetError(budgetCode, { cause });
    throw new ProviderAttemptLedgerError({ cause });
  }
}

function scheduleTerminalRetry(
  stub: DurableObjectStub<ProviderAttemptLedger>,
  attemptId: string,
  status: ProviderAttemptTerminalStatus,
  errorClass: ProviderAttemptErrorClass,
  endedAt: number,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  if (!waitUntil) return;
  const retry = (async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await requiredLedgerCall(() => stub.terminal({ version: 1, attemptId, status, errorClass, endedAt }));
        return;
      } catch {
        // Keep the conservative reservation pending when the bounded retry window closes.
      }
    }
  })();
  try {
    waitUntil(retry);
  } catch {
    // A missing execution context must not turn a successful Provider response into a failure.
  }
}

function providerBudgetErrorCode(error: unknown): ProviderBudgetErrorCode | undefined {
  for (const item of errorChain(error)) {
    const message = typeof item.message === "string" ? item.message : "";
    if (message.includes("provider_budget_exceeded")) return "provider_budget_exceeded";
    if (message.includes("provider_budget_policy_unknown")) return "provider_budget_policy_unknown";
  }
  return undefined;
}

function isProviderTerminalConsistencyError(error: unknown): boolean {
  const consistencyCodes = [
    "provider_attempt_conflict",
    "provider_attempt_terminal_invalid",
    "provider_budget_event_conflict",
    "provider_budget_projection_missing",
  ];
  return errorChain(error).some((item) => {
    const message = typeof item.message === "string" ? item.message : "";
    return consistencyCodes.some((code) => message.includes(code));
  });
}

function errorChain(error: unknown): Record<string, unknown>[] {
  const queue: unknown[] = [error];
  const output: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  while (queue.length && output.length < 12) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || Array.isArray(current) || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    output.push(record);
    queue.push(record.cause, record.lastError);
    if (Array.isArray(record.errors)) queue.push(...record.errors.slice(0, 4));
  }
  return output;
}

function firstStatus(chain: Record<string, unknown>[]): number | undefined {
  for (const item of chain) {
    const value = typeof item.statusCode === "number" ? item.statusCode : item.status;
    if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return undefined;
}
