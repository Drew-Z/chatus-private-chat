import type { ProviderCredentialSource } from "./provider";
import type { InstanceOperationStateV1 } from "../services/instance-capture";

export const PROVIDER_ATTEMPT_SCHEMA_VERSION = 1 as const;

export const PROVIDER_ATTEMPT_DATA_POLICY = {
  backup: "authoritative_restore",
  accountDeletion: "retain_instance_operational_evidence",
  userExport: "excluded",
  retention: "no_automatic_expiry",
} as const;

export type ProviderAttemptRunKind =
  | "main_answer"
  | "automatic_skill"
  | "memory_suggestion"
  | "conversation_summary"
  | "model_discovery"
  | "tool_continuation"
  | "legacy_capability";

export type ProviderAttemptCredentialClass = Exclude<ProviderCredentialSource, "missing">;

export type ProviderAttemptTerminalStatus = "succeeded" | "failed" | "cancelled" | "timed_out";
export type ProviderAttemptStatus = "started" | ProviderAttemptTerminalStatus;

export type ProviderAttemptErrorClass =
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

export type ProviderAttemptStartInputV1 = {
  version: 1;
  idempotencyKey: string;
  turnId: string;
  runId: string;
  runKind: ProviderAttemptRunKind;
  logicalRouteId: string;
  providerId: string;
  offeringId: string;
  model: string;
  fallbackIndex: number;
  credentialClass: ProviderAttemptCredentialClass;
  operation: InstanceOperationStateV1;
  startedAt: number;
};

export type ProviderAttemptTerminalInputV1 = {
  version: 1;
  attemptId: string;
  status: ProviderAttemptTerminalStatus;
  errorClass: ProviderAttemptErrorClass;
  endedAt: number;
};

export type ProviderAttemptProjectionV1 = {
  version: 1;
  attemptId: string;
  idempotencyKey: string;
  turnId: string;
  runId: string;
  runKind: ProviderAttemptRunKind;
  logicalRouteId: string;
  providerId: string;
  offeringId: string;
  model: string;
  fallbackIndex: number;
  credentialClass: ProviderAttemptCredentialClass;
  operation: InstanceOperationStateV1;
  status: ProviderAttemptStatus;
  errorClass: ProviderAttemptErrorClass;
  startedAt: number;
  endedAt: number;
};

export type ProviderAttemptDiagnosticV1 = Omit<
  ProviderAttemptProjectionV1,
  "idempotencyKey" | "operation"
> & {
  operationKind: InstanceOperationStateV1["kind"];
};

export type ProviderAttemptStartResultV1 = {
  created: boolean;
  attempt: ProviderAttemptProjectionV1;
};

export type ProviderAttemptTerminalResultV1 = {
  updated: boolean;
  attempt: ProviderAttemptProjectionV1;
};

const EXACT_START_KEYS = [
  "version",
  "idempotencyKey",
  "turnId",
  "runId",
  "runKind",
  "logicalRouteId",
  "providerId",
  "offeringId",
  "model",
  "fallbackIndex",
  "credentialClass",
  "operation",
  "startedAt",
] as const;
const EXACT_TERMINAL_KEYS = ["version", "attemptId", "status", "errorClass", "endedAt"] as const;
const EXACT_OPERATION_KEYS = ["version", "operationId", "fenceId", "kind", "startedAt"] as const;
const OPAQUE_ID_PATTERN = /^(turn|run|attempt)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^provider-attempt:v1:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9]{1,3}$/i;
const BOUNDED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/;
const OPERATION_KIND_VALUES = new Set<InstanceOperationStateV1["kind"]>([
  "http_mutation",
  "provider_turn",
  "document_ingest",
  "oauth_callback",
  "workspace_operation",
  "background_cleanup",
  "agent_turn",
]);
const RUN_KIND_VALUES = new Set<ProviderAttemptRunKind>([
  "main_answer",
  "automatic_skill",
  "memory_suggestion",
  "conversation_summary",
  "model_discovery",
  "tool_continuation",
  "legacy_capability",
]);
const CREDENTIAL_CLASS_VALUES = new Set<ProviderAttemptCredentialClass>(["user", "legacy", "managed", "worker"]);
const TERMINAL_STATUS_VALUES = new Set<ProviderAttemptTerminalStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);
const ERROR_CLASS_VALUES = new Set<ProviderAttemptErrorClass>([
  "none",
  "provider_busy",
  "upstream_timeout",
  "upstream_rate_limited",
  "upstream_authentication_failed",
  "upstream_request_rejected",
  "provider_protocol_error",
  "upstream_unavailable",
  "upstream_error",
  "request_cancelled",
]);

export function createProviderTurnId(): string {
  return `turn_${crypto.randomUUID()}`;
}

export function createProviderRunId(): string {
  return `run_${crypto.randomUUID()}`;
}

export function createProviderAttemptId(): string {
  return `attempt_${crypto.randomUUID()}`;
}

export function providerOfferingId(logicalRouteId: string, providerId: string): string {
  return `${logicalRouteId}/${providerId}`;
}

export function providerAttemptIdempotencyKey(
  fenceId: string,
  runId: string,
  fallbackIndex: number,
): string {
  const normalizedRunId = runId.startsWith("run_") ? runId.slice(4) : runId;
  return `provider-attempt:v1:${fenceId}:${normalizedRunId}:${fallbackIndex}`;
}

export function decodeProviderAttemptStartInput(value: unknown): ProviderAttemptStartInputV1 | undefined {
  if (!isExactRecord(value, EXACT_START_KEYS)) return undefined;
  const operation = decodeOperation(value.operation);
  if (
    value.version !== 1
    || typeof value.idempotencyKey !== "string"
    || !IDEMPOTENCY_KEY_PATTERN.test(value.idempotencyKey)
    || !isOpaqueId(value.turnId, "turn")
    || !isOpaqueId(value.runId, "run")
    || !RUN_KIND_VALUES.has(value.runKind as ProviderAttemptRunKind)
    || !isBoundedId(value.logicalRouteId)
    || !isBoundedId(value.providerId)
    || !isBoundedId(value.offeringId)
    || !isBoundedText(value.model, 240)
    || !isIntegerInRange(value.fallbackIndex, 0, 999)
    || !CREDENTIAL_CLASS_VALUES.has(value.credentialClass as ProviderAttemptCredentialClass)
    || !operation
    || !isTimestamp(value.startedAt)
    || value.startedAt < operation.startedAt
  ) return undefined;
  return {
    version: 1,
    idempotencyKey: value.idempotencyKey,
    turnId: value.turnId,
    runId: value.runId,
    runKind: value.runKind as ProviderAttemptRunKind,
    logicalRouteId: value.logicalRouteId,
    providerId: value.providerId,
    offeringId: value.offeringId,
    model: value.model,
    fallbackIndex: value.fallbackIndex,
    credentialClass: value.credentialClass as ProviderAttemptCredentialClass,
    operation,
    startedAt: value.startedAt,
  };
}

export function decodeProviderAttemptTerminalInput(value: unknown): ProviderAttemptTerminalInputV1 | undefined {
  if (!isExactRecord(value, EXACT_TERMINAL_KEYS)) return undefined;
  if (
    value.version !== 1
    || !isOpaqueId(value.attemptId, "attempt")
    || !TERMINAL_STATUS_VALUES.has(value.status as ProviderAttemptTerminalStatus)
    || !ERROR_CLASS_VALUES.has(value.errorClass as ProviderAttemptErrorClass)
    || !isTimestamp(value.endedAt)
    || (value.status === "succeeded" && value.errorClass !== "none")
    || (value.status !== "succeeded" && value.errorClass === "none")
  ) return undefined;
  return {
    version: 1,
    attemptId: value.attemptId,
    status: value.status as ProviderAttemptTerminalStatus,
    errorClass: value.errorClass as ProviderAttemptErrorClass,
    endedAt: value.endedAt,
  };
}

export function providerAttemptDiagnostic(
  attempt: ProviderAttemptProjectionV1,
): ProviderAttemptDiagnosticV1 {
  const { idempotencyKey: _idempotencyKey, operation, ...projection } = attempt;
  return { ...projection, operationKind: operation.kind };
}

export function isProviderAttemptErrorClass(value: unknown): value is ProviderAttemptErrorClass {
  return ERROR_CLASS_VALUES.has(value as ProviderAttemptErrorClass);
}

function decodeOperation(value: unknown): InstanceOperationStateV1 | undefined {
  if (!isExactRecord(value, EXACT_OPERATION_KEYS)) return undefined;
  if (
    value.version !== 1
    || !isBoundedId(value.operationId)
    || typeof value.fenceId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(value.fenceId)
    || !OPERATION_KIND_VALUES.has(value.kind as InstanceOperationStateV1["kind"])
    || !isTimestamp(value.startedAt)
  ) return undefined;
  return {
    version: 1,
    operationId: value.operationId,
    fenceId: value.fenceId,
    kind: value.kind as InstanceOperationStateV1["kind"],
    startedAt: value.startedAt,
  };
}

function isOpaqueId(value: unknown, prefix: "turn" | "run" | "attempt"): value is string {
  return typeof value === "string" && value.startsWith(`${prefix}_`) && OPAQUE_ID_PATTERN.test(value);
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_ID_PATTERN.test(value);
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= max
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isExactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => (keys as readonly string[]).includes(key));
}
