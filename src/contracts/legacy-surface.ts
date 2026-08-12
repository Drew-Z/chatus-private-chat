export const LEGACY_SURFACE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION = "legacy-surface-registry-v1";
export const LEGACY_SURFACE_OBJECT_PREFIX = "$legacy-surface:";
export const LEGACY_SURFACE_DAILY_RETENTION_DAYS = 100;
export const LEGACY_SURFACE_ADMIN_LIMIT = 100;

export const LEGACY_SURFACE_PHASES = [
  "discovered",
  "instrumented",
  "censused",
  "parity_proven",
  "shadowing",
  "write_disabled",
  "write_observing",
  "recovery_proven",
  "read_disabled",
  "read_observing",
  "approved_for_cleanup",
] as const;

export type LegacySurfacePhase = typeof LEGACY_SURFACE_PHASES[number];
export type LegacySurfaceKind = "browser" | "api" | "kv" | "durable_substate" | "provider" | "credential";
export type LegacySurfaceRisk = "low" | "medium" | "high" | "critical";
export type LegacySurfaceOwner = "unassigned" | "frontend" | "operations" | "data" | "provider" | "security";
export type LegacySurfaceAccess = "read" | "write";
export type LegacySurfaceControl = "enabled" | "disabled";
export type LegacySurfaceDataClass =
  | "browser_asset"
  | "configuration"
  | "conversation"
  | "credential"
  | "memory"
  | "reliability"
  | "usage";
export type LegacySurfaceCallerClass =
  | "agent_runtime"
  | "background"
  | "browser"
  | "deployment"
  | "durable_object"
  | "operator"
  | "service_worker"
  | "test"
  | "worker_api"
  | "worker_internal";
export type LegacySurfaceRecoveryClass = "code_only" | "capture_restore" | "deployment_evidence";
export type LegacySurfaceRollbackRoute =
  | "code_revert"
  | "compatibility_read"
  | "configuration_fallback"
  | "deployment_binding"
  | "routing_switch";

export type LegacySurfaceManifestRecordV1 = {
  schemaVersion: 1;
  surfaceId: string;
  manifestVersion: number;
  kind: LegacySurfaceKind;
  risk: LegacySurfaceRisk;
  owner: LegacySurfaceOwner;
  dataClasses: LegacySurfaceDataClass[];
  callerClasses: LegacySurfaceCallerClass[];
  replacement: string;
  rollbackRoute: LegacySurfaceRollbackRoute;
  recoveryClass: LegacySurfaceRecoveryClass;
  writeObservationMs: number;
  readObservationMs: number;
  maximumSupportedPhase: LegacySurfacePhase;
};

export type LegacySurfaceManifestSyncInputV1 = {
  version: 1;
  manifest: LegacySurfaceManifestRecordV1;
  manifestDigest: string;
};

export type LegacySurfaceEvidenceKind =
  | "caller_map"
  | "instrumentation_contract"
  | "deployment"
  | "census_window"
  | "parity_digest"
  | "shadow_reconciliation"
  | "write_disable_approval"
  | "rollback_rehearsal"
  | "write_observation"
  | "capture_evidence"
  | "isolated_restore"
  | "read_disable_approval"
  | "read_observation"
  | "owner_approval";

export type LegacySurfaceEvidenceResult = "passed" | "complete" | "approved";

export type LegacySurfaceEvidenceReferenceV1 = {
  version: 1;
  kind: LegacySurfaceEvidenceKind;
  evidenceId: string;
  digest: string;
  deploymentSha: string;
  observedAt: number;
  count: number;
  result: LegacySurfaceEvidenceResult;
};

export type LegacySurfaceAdvanceInputV1 = {
  version: 1;
  surfaceId: string;
  expectedRevision: number;
  operationId: string;
  targetPhase: LegacySurfacePhase;
  requestedAt: number;
  evidence: LegacySurfaceEvidenceReferenceV1[];
};

export type LegacySurfaceRollbackReason =
  | "control_failure"
  | "evidence_invalidated"
  | "parity_regression"
  | "recovery_failure"
  | "runtime_regression";

export type LegacySurfaceRollbackInputV1 = {
  version: 1;
  surfaceId: string;
  expectedRevision: number;
  operationId: string;
  scope: "read" | "write";
  reason: LegacySurfaceRollbackReason;
  requestedAt: number;
  evidence: LegacySurfaceEvidenceReferenceV1[];
};

export type LegacySurfaceUseInputV1 = {
  version: 1;
  surfaceId: string;
  callerClass: LegacySurfaceCallerClass;
  access: LegacySurfaceAccess;
  occurredAt: number;
  deploymentSha: string;
};

export type LegacySurfaceBlockerCode =
  | "maximum_phase_reached"
  | "owner_unassigned"
  | "missing_evidence"
  | "observation_incomplete"
  | "manifest_conflict"
  | "state_invalid";

export type LegacySurfaceEvidenceSummaryV1 = {
  required: number;
  present: number;
  complete: boolean;
};

export type LegacySurfaceAllowedActionV1 =
  | { kind: "advance"; targetPhase: LegacySurfacePhase }
  | { kind: "rollback"; scope: "read" | "write"; targetPhase: LegacySurfacePhase };

export type LegacySurfaceProjectionV1 = {
  version: 1;
  surfaceId: string;
  revision: number;
  manifestVersion: number;
  manifestDigest: string;
  phase: LegacySurfacePhase;
  readControl: LegacySurfaceControl;
  writeControl: LegacySurfaceControl;
  owner: LegacySurfaceOwner;
  blockerCodes: LegacySurfaceBlockerCode[];
  observationStartedAt: number;
  observationRequiredUntil: number;
  lastTransitionAt: number;
  lastDeploymentSha: string;
  evidence: LegacySurfaceEvidenceSummaryV1;
  allowedActions: LegacySurfaceAllowedActionV1[];
};

export type LegacySurfaceAdminSnapshotV1 = {
  version: 1;
  manifestDigest: string;
  generatedAt: number;
  total: number;
  surfaces: LegacySurfaceProjectionV1[];
};

export type LegacySurfaceUseResultV1 = Pick<
  LegacySurfaceProjectionV1,
  "revision" | "phase" | "readControl" | "writeControl" | "blockerCodes"
>;

export type LegacySurfaceTransitionResult =
  | { ok: true; replayed: boolean; projection: LegacySurfaceProjectionV1 }
  | {
      ok: false;
      error:
        | "legacy_surface_not_found"
        | "legacy_surface_conflict"
        | "legacy_surface_gate_blocked"
        | "legacy_surface_state_invalid"
        | "legacy_surface_manifest_conflict";
    };

export type LegacySurfaceProjectionResult =
  | { ok: true; projection: LegacySurfaceProjectionV1 }
  | {
      ok: false;
      error:
        | "legacy_surface_not_found"
        | "legacy_surface_state_invalid"
        | "legacy_surface_manifest_conflict";
    };

export type LegacySurfaceCensusResult =
  | { ok: true; rows: LegacySurfaceCensusRowV1[] }
  | {
      ok: false;
      error:
        | "legacy_surface_not_found"
        | "legacy_surface_conflict"
        | "legacy_surface_state_invalid"
        | "legacy_surface_manifest_conflict";
    };

export type LegacySurfaceUseRecordResult =
  | { ok: true; projection: LegacySurfaceUseResultV1 }
  | {
      ok: false;
      error:
        | "legacy_surface_not_found"
        | "legacy_surface_conflict"
        | "legacy_surface_state_invalid"
        | "legacy_surface_manifest_conflict";
    };

export type LegacySurfaceStoredStateV1 = {
  version: 1;
  surfaceId: string;
  revision: number;
  phase: LegacySurfacePhase;
  readControl: LegacySurfaceControl;
  writeControl: LegacySurfaceControl;
  manifestVersion: number;
  manifestDigest: string;
  observationStartedAt: number;
  observationRequiredUntil: number;
  lastTransitionAt: number;
  lastDeploymentSha: string;
};

export type LegacySurfaceEventV1 = {
  version: 1;
  revision: number;
  action: "manifest_sync" | "advance" | "rollback_read" | "rollback_write";
  beforePhase: LegacySurfacePhase;
  afterPhase: LegacySurfacePhase;
  operationId: string;
  inputDigest: string;
  at: number;
  deploymentSha: string;
  reason: "" | LegacySurfaceRollbackReason;
  evidence: LegacySurfaceEvidenceReferenceV1[];
};

export type LegacySurfaceOperationV1 = {
  version: 1;
  operationId: string;
  inputDigest: string;
  result: LegacySurfaceProjectionV1;
  completedAt: number;
};

export type LegacySurfaceDailyCountV1 = {
  version: 1;
  day: string;
  callerClass: LegacySurfaceCallerClass;
  access: LegacySurfaceAccess;
  count: number;
  lastOccurredAt: number;
  deploymentSha: string;
};

export type LegacySurfaceCensusRowV1 = Pick<
  LegacySurfaceDailyCountV1,
  "day" | "callerClass" | "access" | "count" | "lastOccurredAt" | "deploymentSha"
>;

export type LegacySurfaceCensusSnapshotV1 = {
  version: 1;
  surfaceId: string;
  generatedAt: number;
  days: number;
  rows: LegacySurfaceCensusRowV1[];
};

export type LegacySurfaceCaptureSnapshotV1 = {
  version: 1;
  schemaVersion: typeof LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION;
  captureEpoch: string;
  coordinatorName: string;
  manifest: LegacySurfaceManifestRecordV1;
  state: LegacySurfaceStoredStateV1;
  events: LegacySurfaceEventV1[];
  operations: LegacySurfaceOperationV1[];
  daily: LegacySurfaceDailyCountV1[];
  itemCount: number;
  snapshotDigest: string;
};

export type LegacySurfaceRegistryCaptureV1 = {
  version: 1;
  schemaVersion: typeof LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION;
  captureEpoch: string;
  coordinatorBinding: "INSTANCE_COORDINATOR";
  manifestDigest: string;
  surfaces: LegacySurfaceCaptureSnapshotV1[];
  itemCount: number;
  registryDigest: string;
};

export type LegacySurfaceCaptureInputV1 = {
  version: 1;
  surfaceId: string;
  captureEpoch: string;
  manifestDigest: string;
};

export type LegacySurfaceRestoreInputV1 = {
  version: 1;
  snapshot: LegacySurfaceCaptureSnapshotV1;
};

export const LEGACY_SURFACE_PHASE_EVIDENCE: Readonly<Record<LegacySurfacePhase, readonly LegacySurfaceEvidenceKind[]>> = {
  discovered: [],
  instrumented: ["caller_map", "instrumentation_contract", "deployment"],
  censused: ["census_window"],
  parity_proven: ["parity_digest"],
  shadowing: ["shadow_reconciliation"],
  write_disabled: ["write_disable_approval", "rollback_rehearsal", "deployment"],
  write_observing: ["write_observation", "deployment"],
  recovery_proven: ["capture_evidence", "isolated_restore"],
  read_disabled: ["read_disable_approval", "rollback_rehearsal", "deployment"],
  read_observing: ["read_observation", "deployment"],
  approved_for_cleanup: ["owner_approval"],
};

const MANIFEST_RECORD_KEYS = [
  "schemaVersion",
  "surfaceId",
  "manifestVersion",
  "kind",
  "risk",
  "owner",
  "dataClasses",
  "callerClasses",
  "replacement",
  "rollbackRoute",
  "recoveryClass",
  "writeObservationMs",
  "readObservationMs",
  "maximumSupportedPhase",
] as const;

const EVIDENCE_KEYS = [
  "version",
  "kind",
  "evidenceId",
  "digest",
  "deploymentSha",
  "observedAt",
  "count",
  "result",
] as const;

const INITIAL_MANIFEST: LegacySurfaceManifestRecordV1[] = [
  manifestRecord({
    surfaceId: "legacy.api.chat-post",
    kind: "api",
    risk: "high",
    dataClasses: ["conversation"],
    callerClasses: ["browser", "test", "worker_api"],
    replacement: "team-agent-transport",
    rollbackRoute: "routing_switch",
    recoveryClass: "capture_restore",
    manifestVersion: 2,
    owner: "data",
    writeObservationMs: 30 * 24 * 60 * 60 * 1_000,
    readObservationMs: 30 * 24 * 60 * 60 * 1_000,
    maximumSupportedPhase: "instrumented",
  }),
  manifestRecord({
    surfaceId: "legacy.api.cloud-chats",
    kind: "api",
    risk: "high",
    dataClasses: ["conversation"],
    callerClasses: ["agent_runtime", "browser", "operator", "test", "worker_api"],
    replacement: "agent-conversation-api",
    rollbackRoute: "compatibility_read",
    recoveryClass: "capture_restore",
  }),
  manifestRecord({
    surfaceId: "legacy.auth.access-secret-fallback",
    kind: "credential",
    risk: "critical",
    dataClasses: ["credential"],
    callerClasses: ["deployment", "operator", "test", "worker_internal"],
    replacement: "managed-access-records",
    rollbackRoute: "deployment_binding",
    recoveryClass: "deployment_evidence",
  }),
  manifestRecord({
    surfaceId: "legacy.browser.admin-alias",
    kind: "browser",
    risk: "low",
    dataClasses: ["browser_asset"],
    callerClasses: ["browser", "deployment", "test", "worker_api"],
    replacement: "react-admin-route",
    rollbackRoute: "routing_switch",
    recoveryClass: "code_only",
    manifestVersion: 2,
    owner: "frontend",
    writeObservationMs: 7 * 24 * 60 * 60 * 1_000,
    readObservationMs: 7 * 24 * 60 * 60 * 1_000,
    maximumSupportedPhase: "instrumented",
  }),
  manifestRecord({
    surfaceId: "legacy.browser.shell",
    kind: "browser",
    risk: "medium",
    dataClasses: ["browser_asset", "conversation"],
    callerClasses: ["browser", "deployment", "service_worker", "test", "worker_api"],
    replacement: "react-workspace-shell",
    rollbackRoute: "routing_switch",
    recoveryClass: "code_only",
    manifestVersion: 2,
    owner: "frontend",
    writeObservationMs: 14 * 24 * 60 * 60 * 1_000,
    readObservationMs: 14 * 24 * 60 * 60 * 1_000,
    maximumSupportedPhase: "instrumented",
  }),
  manifestRecord({
    surfaceId: "legacy.config.source-fallback",
    kind: "provider",
    risk: "critical",
    dataClasses: ["configuration", "credential"],
    callerClasses: ["deployment", "operator", "test", "worker_internal"],
    replacement: "managed-provider-configuration",
    rollbackRoute: "configuration_fallback",
    recoveryClass: "deployment_evidence",
  }),
  manifestRecord({
    surfaceId: "legacy.kv.chat-index",
    kind: "kv",
    risk: "critical",
    dataClasses: ["conversation"],
    callerClasses: ["agent_runtime", "background", "durable_object", "test", "worker_internal"],
    replacement: "agent-conversation-index",
    rollbackRoute: "compatibility_read",
    recoveryClass: "capture_restore",
  }),
  manifestRecord({
    surfaceId: "legacy.kv.daily-usage",
    kind: "kv",
    risk: "high",
    dataClasses: ["usage"],
    callerClasses: ["background", "durable_object", "operator", "test", "worker_api", "worker_internal"],
    replacement: "user-state-usage",
    rollbackRoute: "compatibility_read",
    recoveryClass: "capture_restore",
  }),
  manifestRecord({
    surfaceId: "legacy.kv.memory",
    kind: "kv",
    risk: "high",
    dataClasses: ["memory"],
    callerClasses: ["agent_runtime", "durable_object", "operator", "test", "worker_api", "worker_internal"],
    replacement: "root-agent-memory",
    rollbackRoute: "compatibility_read",
    recoveryClass: "capture_restore",
  }),
  manifestRecord({
    surfaceId: "legacy.kv.route-reliability",
    kind: "kv",
    risk: "medium",
    dataClasses: ["reliability"],
    callerClasses: ["agent_runtime", "operator", "test", "worker_internal"],
    replacement: "provider-coordinator-reliability",
    rollbackRoute: "compatibility_read",
    recoveryClass: "capture_restore",
  }),
  manifestRecord({
    surfaceId: "legacy.provider.inline-credential",
    kind: "credential",
    risk: "critical",
    dataClasses: ["configuration", "credential"],
    callerClasses: ["agent_runtime", "operator", "test", "worker_internal"],
    replacement: "managed-route-secrets",
    rollbackRoute: "configuration_fallback",
    recoveryClass: "capture_restore",
  }),
  manifestRecord({
    surfaceId: "legacy.provider.route-shadow",
    kind: "provider",
    risk: "high",
    dataClasses: ["configuration"],
    callerClasses: ["agent_runtime", "operator", "test", "worker_internal"],
    replacement: "provider-offerings",
    rollbackRoute: "configuration_fallback",
    recoveryClass: "capture_restore",
  }),
  manifestRecord({
    surfaceId: "legacy.user-state.chat-projection",
    kind: "durable_substate",
    risk: "critical",
    dataClasses: ["conversation"],
    callerClasses: ["agent_runtime", "background", "durable_object", "operator", "test", "worker_api"],
    replacement: "agent-conversation-state",
    rollbackRoute: "compatibility_read",
    recoveryClass: "capture_restore",
  }),
];

export const LEGACY_SURFACE_MANIFEST: readonly LegacySurfaceManifestRecordV1[] = Object.freeze(
  INITIAL_MANIFEST.map(freezeManifestRecord),
);

export function legacySurfaceObjectName(surfaceId: string): string {
  return `${LEGACY_SURFACE_OBJECT_PREFIX}${surfaceId}`;
}

export function legacySurfacePhaseIndex(phase: LegacySurfacePhase): number {
  return LEGACY_SURFACE_PHASES.indexOf(phase);
}

export function nextLegacySurfacePhase(phase: LegacySurfacePhase): LegacySurfacePhase | undefined {
  return LEGACY_SURFACE_PHASES[legacySurfacePhaseIndex(phase) + 1];
}

export function legacySurfaceControlsForPhase(phase: LegacySurfacePhase): {
  readControl: LegacySurfaceControl;
  writeControl: LegacySurfaceControl;
} {
  return {
    readControl: legacySurfacePhaseIndex(phase) >= legacySurfacePhaseIndex("read_disabled") ? "disabled" : "enabled",
    writeControl: legacySurfacePhaseIndex(phase) >= legacySurfacePhaseIndex("write_disabled") ? "disabled" : "enabled",
  };
}

export function legacySurfaceRollbackTarget(
  phase: LegacySurfacePhase,
  scope: "read" | "write",
): LegacySurfacePhase | undefined {
  if (scope === "read") {
    return legacySurfacePhaseIndex(phase) >= legacySurfacePhaseIndex("read_disabled") ? "recovery_proven" : undefined;
  }
  return legacySurfacePhaseIndex(phase) >= legacySurfacePhaseIndex("write_disabled") ? "shadowing" : undefined;
}

export function decodeLegacySurfaceManifestRecord(value: unknown): LegacySurfaceManifestRecordV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_RECORD_KEYS)) return undefined;
  const surfaceId = normalizeSurfaceId(value.surfaceId);
  const replacement = normalizePolicyId(value.replacement);
  const dataClasses = normalizeUniqueSortedArray(value.dataClasses, isLegacySurfaceDataClass);
  const callerClasses = normalizeUniqueSortedArray(value.callerClasses, isLegacySurfaceCallerClass);
  const maximumPhase = isLegacySurfacePhase(value.maximumSupportedPhase) ? value.maximumSupportedPhase : undefined;
  if (
    value.schemaVersion !== 1
    || !surfaceId
    || !isPositiveSafeInteger(value.manifestVersion)
    || !isLegacySurfaceKind(value.kind)
    || !isLegacySurfaceRisk(value.risk)
    || !isLegacySurfaceOwner(value.owner)
    || !dataClasses?.length
    || !callerClasses?.length
    || !replacement
    || !isLegacySurfaceRollbackRoute(value.rollbackRoute)
    || !isLegacySurfaceRecoveryClass(value.recoveryClass)
    || !isNonNegativeSafeInteger(value.writeObservationMs)
    || !isNonNegativeSafeInteger(value.readObservationMs)
    || !maximumPhase
    || (legacySurfacePhaseIndex(maximumPhase) >= legacySurfacePhaseIndex("write_observing") && value.writeObservationMs <= 0)
    || (legacySurfacePhaseIndex(maximumPhase) >= legacySurfacePhaseIndex("read_observing") && value.readObservationMs <= 0)
    || (maximumPhase !== "discovered" && value.owner === "unassigned")
  ) return undefined;
  return {
    schemaVersion: 1,
    surfaceId,
    manifestVersion: value.manifestVersion,
    kind: value.kind,
    risk: value.risk,
    owner: value.owner,
    dataClasses,
    callerClasses,
    replacement,
    rollbackRoute: value.rollbackRoute,
    recoveryClass: value.recoveryClass,
    writeObservationMs: value.writeObservationMs,
    readObservationMs: value.readObservationMs,
    maximumSupportedPhase: maximumPhase,
  };
}

export function decodeLegacySurfaceManifestSyncInput(value: unknown): LegacySurfaceManifestSyncInputV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "manifest", "manifestDigest"])) return undefined;
  const manifest = decodeLegacySurfaceManifestRecord(value.manifest);
  const manifestDigest = normalizeDigest(value.manifestDigest);
  return value.version === 1 && manifest && manifestDigest
    ? { version: 1, manifest, manifestDigest }
    : undefined;
}

export function decodeLegacySurfaceManifest(value: unknown): LegacySurfaceManifestRecordV1[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > LEGACY_SURFACE_ADMIN_LIMIT) return undefined;
  const records = value.map(decodeLegacySurfaceManifestRecord);
  if (records.some((record) => !record)) return undefined;
  const normalized = records as LegacySurfaceManifestRecordV1[];
  if (!isStrictlySorted(normalized.map(({ surfaceId }) => surfaceId))) return undefined;
  return normalized;
}

export function validateLegacySurfaceManifestUpgrade(
  previousValue: unknown,
  nextValue: unknown,
): LegacySurfaceManifestRecordV1[] | undefined {
  const previous = decodeLegacySurfaceManifest(previousValue);
  const next = decodeLegacySurfaceManifest(nextValue);
  if (!previous || !next || next.length < previous.length) return undefined;
  const nextById = new Map(next.map((record) => [record.surfaceId, record]));
  for (const current of previous) {
    const candidate = nextById.get(current.surfaceId);
    if (!candidate || candidate.manifestVersion < current.manifestVersion) return undefined;
    if (!sameLegacySurfaceIdentity(current, candidate)) return undefined;
    if (legacySurfacePhaseIndex(candidate.maximumSupportedPhase) < legacySurfacePhaseIndex(current.maximumSupportedPhase)) {
      return undefined;
    }
    if (current.owner !== candidate.owner && current.owner !== "unassigned") return undefined;
    if (
      (current.writeObservationMs !== candidate.writeObservationMs && current.writeObservationMs !== 0)
      || (current.readObservationMs !== candidate.readObservationMs && current.readObservationMs !== 0)
    ) return undefined;
    const changed = stableJson(current) !== stableJson(candidate);
    if (changed !== (candidate.manifestVersion > current.manifestVersion)) return undefined;
  }
  for (const record of next) {
    if (!previous.some(({ surfaceId }) => surfaceId === record.surfaceId)) {
      if (record.manifestVersion !== 1 || record.maximumSupportedPhase !== "discovered") return undefined;
    }
  }
  return next;
}

export async function legacySurfaceManifestDigest(
  manifest: readonly LegacySurfaceManifestRecordV1[] = LEGACY_SURFACE_MANIFEST,
): Promise<string> {
  const normalized = decodeLegacySurfaceManifest(manifest);
  if (!normalized) throw new Error("legacy_surface_manifest_invalid");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(normalized)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function decodeLegacySurfaceEvidenceReference(value: unknown): LegacySurfaceEvidenceReferenceV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_KEYS)) return undefined;
  const evidenceId = normalizeBoundedId(value.evidenceId, 160);
  const digest = normalizeDigest(value.digest);
  const deploymentSha = normalizeDeploymentSha(value.deploymentSha);
  if (
    value.version !== 1 || !isLegacySurfaceEvidenceKind(value.kind) || !evidenceId || !digest
    || !deploymentSha || !isPositiveSafeInteger(value.observedAt)
    || !isNonNegativeSafeInteger(value.count) || !isLegacySurfaceEvidenceResult(value.result)
  ) return undefined;
  return {
    version: 1,
    kind: value.kind,
    evidenceId,
    digest,
    deploymentSha,
    observedAt: value.observedAt,
    count: value.count,
    result: value.result,
  };
}

export function decodeLegacySurfaceAdvanceInput(value: unknown): LegacySurfaceAdvanceInputV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "surfaceId", "expectedRevision", "operationId", "targetPhase", "requestedAt", "evidence",
  ])) return undefined;
  const surfaceId = normalizeSurfaceId(value.surfaceId);
  const operationId = normalizeBoundedId(value.operationId, 160);
  const evidence = decodeEvidenceArray(value.evidence);
  if (
    value.version !== 1 || !surfaceId || !isNonNegativeSafeInteger(value.expectedRevision) || !operationId
    || !isLegacySurfacePhase(value.targetPhase) || !isPositiveSafeInteger(value.requestedAt) || !evidence
  ) return undefined;
  return {
    version: 1,
    surfaceId,
    expectedRevision: value.expectedRevision,
    operationId,
    targetPhase: value.targetPhase,
    requestedAt: value.requestedAt,
    evidence,
  };
}

export function decodeLegacySurfaceRollbackInput(value: unknown): LegacySurfaceRollbackInputV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "surfaceId", "expectedRevision", "operationId", "scope", "reason", "requestedAt", "evidence",
  ])) return undefined;
  const surfaceId = normalizeSurfaceId(value.surfaceId);
  const operationId = normalizeBoundedId(value.operationId, 160);
  const evidence = decodeEvidenceArray(value.evidence);
  if (
    value.version !== 1 || !surfaceId || !isNonNegativeSafeInteger(value.expectedRevision) || !operationId
    || (value.scope !== "read" && value.scope !== "write") || !isLegacySurfaceRollbackReason(value.reason)
    || !isPositiveSafeInteger(value.requestedAt) || !evidence
  ) return undefined;
  return {
    version: 1,
    surfaceId,
    expectedRevision: value.expectedRevision,
    operationId,
    scope: value.scope,
    reason: value.reason,
    requestedAt: value.requestedAt,
    evidence,
  };
}

export function decodeLegacySurfaceUseInput(value: unknown): LegacySurfaceUseInputV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "surfaceId", "callerClass", "access", "occurredAt", "deploymentSha",
  ])) return undefined;
  const surfaceId = normalizeSurfaceId(value.surfaceId);
  const deploymentSha = normalizeDeploymentSha(value.deploymentSha);
  if (
    value.version !== 1 || !surfaceId || !isLegacySurfaceCallerClass(value.callerClass)
    || (value.access !== "read" && value.access !== "write")
    || !isPositiveSafeInteger(value.occurredAt) || !deploymentSha
  ) return undefined;
  return {
    version: 1,
    surfaceId,
    callerClass: value.callerClass,
    access: value.access,
    occurredAt: value.occurredAt,
    deploymentSha,
  };
}

export function decodeLegacySurfaceProjection(value: unknown): LegacySurfaceProjectionV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "surfaceId", "revision", "manifestVersion", "manifestDigest", "phase",
    "readControl", "writeControl", "owner", "blockerCodes", "observationStartedAt",
    "observationRequiredUntil", "lastTransitionAt", "lastDeploymentSha", "evidence", "allowedActions",
  ])) return undefined;
  const surfaceId = normalizeSurfaceId(value.surfaceId);
  const manifestDigest = normalizeDigest(value.manifestDigest);
  const phase = isLegacySurfacePhase(value.phase) ? value.phase : undefined;
  const blockerCodes = normalizeUniqueSortedArrayAllowEmpty(value.blockerCodes, isLegacySurfaceBlockerCode);
  const evidence = decodeLegacySurfaceEvidenceSummary(value.evidence);
  const allowedActions = decodeLegacySurfaceAllowedActions(value.allowedActions);
  const lastDeploymentSha = value.lastDeploymentSha === "" ? "" : normalizeDeploymentSha(value.lastDeploymentSha);
  if (
    value.version !== 1 || !surfaceId || !isNonNegativeSafeInteger(value.revision)
    || !isPositiveSafeInteger(value.manifestVersion) || !manifestDigest || !phase
    || (value.readControl !== "enabled" && value.readControl !== "disabled")
    || (value.writeControl !== "enabled" && value.writeControl !== "disabled")
    || !isLegacySurfaceOwner(value.owner) || !blockerCodes
    || !isNonNegativeSafeInteger(value.observationStartedAt)
    || !isNonNegativeSafeInteger(value.observationRequiredUntil)
    || value.observationRequiredUntil < value.observationStartedAt
    || !isNonNegativeSafeInteger(value.lastTransitionAt) || !lastDeploymentSha && value.lastDeploymentSha !== ""
    || !evidence || !allowedActions
  ) return undefined;
  const controls = legacySurfaceControlsForPhase(phase);
  if (controls.readControl !== value.readControl || controls.writeControl !== value.writeControl) return undefined;
  return {
    version: 1,
    surfaceId,
    revision: value.revision,
    manifestVersion: value.manifestVersion,
    manifestDigest,
    phase,
    readControl: value.readControl,
    writeControl: value.writeControl,
    owner: value.owner,
    blockerCodes,
    observationStartedAt: value.observationStartedAt,
    observationRequiredUntil: value.observationRequiredUntil,
    lastTransitionAt: value.lastTransitionAt,
    lastDeploymentSha,
    evidence,
    allowedActions,
  };
}

export function decodeLegacySurfaceCaptureInput(value: unknown): LegacySurfaceCaptureInputV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "surfaceId", "captureEpoch", "manifestDigest"])) {
    return undefined;
  }
  const surfaceId = normalizeSurfaceId(value.surfaceId);
  const captureEpoch = normalizeBoundedId(value.captureEpoch, 160);
  const manifestDigest = normalizeDigest(value.manifestDigest);
  return value.version === 1 && surfaceId && captureEpoch && manifestDigest
    ? { version: 1, surfaceId, captureEpoch, manifestDigest }
    : undefined;
}

export function decodeLegacySurfaceStoredState(value: unknown): LegacySurfaceStoredStateV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "surfaceId", "revision", "phase", "readControl", "writeControl",
    "manifestVersion", "manifestDigest", "observationStartedAt", "observationRequiredUntil",
    "lastTransitionAt", "lastDeploymentSha",
  ])) return undefined;
  const surfaceId = normalizeSurfaceId(value.surfaceId);
  const phase = isLegacySurfacePhase(value.phase) ? value.phase : undefined;
  const manifestDigest = normalizeDigest(value.manifestDigest);
  const lastDeploymentSha = value.lastDeploymentSha === "" ? "" : normalizeDeploymentSha(value.lastDeploymentSha);
  if (
    value.version !== 1 || !surfaceId || !isNonNegativeSafeInteger(value.revision) || !phase
    || (value.readControl !== "enabled" && value.readControl !== "disabled")
    || (value.writeControl !== "enabled" && value.writeControl !== "disabled")
    || !isPositiveSafeInteger(value.manifestVersion) || !manifestDigest
    || !isNonNegativeSafeInteger(value.observationStartedAt)
    || !isNonNegativeSafeInteger(value.observationRequiredUntil)
    || value.observationRequiredUntil < value.observationStartedAt
    || !isNonNegativeSafeInteger(value.lastTransitionAt)
    || (!lastDeploymentSha && value.lastDeploymentSha !== "")
  ) return undefined;
  const controls = legacySurfaceControlsForPhase(phase);
  if (controls.readControl !== value.readControl || controls.writeControl !== value.writeControl) return undefined;
  return {
    version: 1,
    surfaceId,
    revision: value.revision,
    phase,
    readControl: value.readControl,
    writeControl: value.writeControl,
    manifestVersion: value.manifestVersion,
    manifestDigest,
    observationStartedAt: value.observationStartedAt,
    observationRequiredUntil: value.observationRequiredUntil,
    lastTransitionAt: value.lastTransitionAt,
    lastDeploymentSha,
  };
}

export function decodeLegacySurfaceEvent(value: unknown): LegacySurfaceEventV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "revision", "action", "beforePhase", "afterPhase", "operationId",
    "inputDigest", "at", "deploymentSha", "reason", "evidence",
  ])) return undefined;
  const operationId = normalizeBoundedId(value.operationId, 160);
  const inputDigest = normalizeDigest(value.inputDigest);
  const deploymentSha = value.deploymentSha === "" ? "" : normalizeDeploymentSha(value.deploymentSha);
  const evidence = decodeEvidenceArray(value.evidence);
  const action = isLegacySurfaceEventAction(value.action) ? value.action : undefined;
  const beforePhase = isLegacySurfacePhase(value.beforePhase) ? value.beforePhase : undefined;
  const afterPhase = isLegacySurfacePhase(value.afterPhase) ? value.afterPhase : undefined;
  const reason = value.reason === "" ? "" : isLegacySurfaceRollbackReason(value.reason) ? value.reason : undefined;
  if (
    value.version !== 1 || !isPositiveSafeInteger(value.revision) || !action || !beforePhase || !afterPhase
    || !operationId || !inputDigest || !isPositiveSafeInteger(value.at)
    || (!deploymentSha && value.deploymentSha !== "") || reason === undefined || !evidence
  ) return undefined;
  if (
    (action === "manifest_sync" && (beforePhase !== afterPhase || reason !== "" || evidence.length !== 0))
    || (action === "advance" && (
      nextLegacySurfacePhase(beforePhase) !== afterPhase || reason !== ""
      || !hasExactEvidenceKinds(evidence, LEGACY_SURFACE_PHASE_EVIDENCE[afterPhase], value.at)
    ))
    || (action === "rollback_read" && (
      legacySurfaceRollbackTarget(beforePhase, "read") !== afterPhase || reason === ""
      || !hasExactEvidenceKinds(evidence, ["rollback_rehearsal"], value.at)
    ))
    || (action === "rollback_write" && (
      legacySurfaceRollbackTarget(beforePhase, "write") !== afterPhase || reason === ""
      || !hasExactEvidenceKinds(evidence, ["rollback_rehearsal"], value.at)
    ))
  ) return undefined;
  return {
    version: 1,
    revision: value.revision,
    action,
    beforePhase,
    afterPhase,
    operationId,
    inputDigest,
    at: value.at,
    deploymentSha,
    reason,
    evidence,
  };
}

export function decodeLegacySurfaceOperation(value: unknown): LegacySurfaceOperationV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "operationId", "inputDigest", "result", "completedAt",
  ])) return undefined;
  const operationId = normalizeBoundedId(value.operationId, 160);
  const inputDigest = normalizeDigest(value.inputDigest);
  const result = decodeLegacySurfaceProjection(value.result);
  return value.version === 1 && operationId && inputDigest && result && isPositiveSafeInteger(value.completedAt)
    ? { version: 1, operationId, inputDigest, result, completedAt: value.completedAt }
    : undefined;
}

export function decodeLegacySurfaceDailyCount(value: unknown): LegacySurfaceDailyCountV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "day", "callerClass", "access", "count", "lastOccurredAt", "deploymentSha",
  ])) return undefined;
  const day = normalizeUtcDay(value.day);
  const deploymentSha = normalizeDeploymentSha(value.deploymentSha);
  if (
    value.version !== 1 || !day || !isLegacySurfaceCallerClass(value.callerClass)
    || (value.access !== "read" && value.access !== "write") || !isPositiveSafeInteger(value.count)
    || !isPositiveSafeInteger(value.lastOccurredAt) || !deploymentSha
  ) return undefined;
  return {
    version: 1,
    day,
    callerClass: value.callerClass,
    access: value.access,
    count: value.count,
    lastOccurredAt: value.lastOccurredAt,
    deploymentSha,
  };
}

export function decodeLegacySurfaceCensusRow(value: unknown): LegacySurfaceCensusRowV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "day", "callerClass", "access", "count", "lastOccurredAt", "deploymentSha",
  ])) return undefined;
  const row = decodeLegacySurfaceDailyCount({ version: 1, ...value });
  return row ? {
    day: row.day,
    callerClass: row.callerClass,
    access: row.access,
    count: row.count,
    lastOccurredAt: row.lastOccurredAt,
    deploymentSha: row.deploymentSha,
  } : undefined;
}

export function decodeLegacySurfaceCensusSnapshot(value: unknown): LegacySurfaceCensusSnapshotV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "surfaceId", "generatedAt", "days", "rows"])) return undefined;
  const surfaceId = normalizeSurfaceId(value.surfaceId);
  const days = isPositiveSafeInteger(value.days) && value.days <= LEGACY_SURFACE_DAILY_RETENTION_DAYS
    ? value.days
    : undefined;
  const rows = days ? decodeArray(value.rows, days * 20, decodeLegacySurfaceCensusRow) : undefined;
  if (
    value.version !== 1 || !surfaceId || !isPositiveSafeInteger(value.generatedAt)
    || !days || !rows
  ) return undefined;
  const keys = rows.map((row) => `${row.day}|${row.callerClass}|${row.access}`);
  if (
    new Set(keys).size !== keys.length
    || keys.some((key, index) => index > 0 && keys[index - 1]! >= key)
    || rows.some(({ day, lastOccurredAt }) => new Date(lastOccurredAt).toISOString().slice(0, 10) !== day)
  ) return undefined;
  return { version: 1, surfaceId, generatedAt: value.generatedAt, days, rows };
}

export function decodeLegacySurfaceCaptureSnapshot(value: unknown): LegacySurfaceCaptureSnapshotV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "schemaVersion", "captureEpoch", "coordinatorName", "manifest", "state",
    "events", "operations", "daily", "itemCount", "snapshotDigest",
  ])) return undefined;
  const captureEpoch = normalizeBoundedId(value.captureEpoch, 160);
  const coordinatorName = typeof value.coordinatorName === "string" ? value.coordinatorName : "";
  const manifest = decodeLegacySurfaceManifestRecord(value.manifest);
  const state = decodeLegacySurfaceStoredState(value.state);
  const events = decodeArray(value.events, 10_000, decodeLegacySurfaceEvent);
  const operations = decodeArray(value.operations, 10_000, decodeLegacySurfaceOperation);
  const daily = decodeArray(value.daily, LEGACY_SURFACE_DAILY_RETENTION_DAYS * 20, decodeLegacySurfaceDailyCount);
  const snapshotDigest = normalizeDigest(value.snapshotDigest);
  if (
    value.version !== 1 || value.schemaVersion !== LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION
    || !captureEpoch || !manifest || coordinatorName !== legacySurfaceObjectName(manifest.surfaceId)
    || !state || state.surfaceId !== manifest.surfaceId || state.manifestVersion !== manifest.manifestVersion
    || state.manifestDigest === "" || !events || !operations || !daily || !snapshotDigest
    || !isNonNegativeSafeInteger(value.itemCount)
    || value.itemCount !== 2 + events.length + operations.length + daily.length
    || !isCanonicalLegacySurfaceEvents(events, state)
    || !isCanonicalLegacySurfaceOperations(operations, events, state)
    || !isCanonicalLegacySurfaceDaily(daily, manifest)
  ) return undefined;
  return {
    version: 1,
    schemaVersion: LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION,
    captureEpoch,
    coordinatorName,
    manifest,
    state,
    events,
    operations,
    daily,
    itemCount: value.itemCount,
    snapshotDigest,
  };
}

export function decodeLegacySurfaceRegistryCapture(value: unknown): LegacySurfaceRegistryCaptureV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "schemaVersion", "captureEpoch", "coordinatorBinding", "manifestDigest",
    "surfaces", "itemCount", "registryDigest",
  ])) return undefined;
  const captureEpoch = normalizeBoundedId(value.captureEpoch, 160);
  const manifestDigest = normalizeDigest(value.manifestDigest);
  const surfaces = decodeArray(value.surfaces, LEGACY_SURFACE_ADMIN_LIMIT, decodeLegacySurfaceCaptureSnapshot);
  const registryDigest = normalizeDigest(value.registryDigest);
  if (
    value.version !== 1 || value.schemaVersion !== LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION
    || !captureEpoch || value.coordinatorBinding !== "INSTANCE_COORDINATOR" || !manifestDigest
    || !surfaces?.length || !registryDigest || !isNonNegativeSafeInteger(value.itemCount)
    || value.itemCount !== surfaces.reduce((total, surface) => total + surface.itemCount, 0)
    || !isStrictlySorted(surfaces.map(({ manifest }) => manifest.surfaceId))
    || surfaces.some((surface) => (
      surface.captureEpoch !== captureEpoch || surface.state.manifestDigest !== manifestDigest
    ))
  ) return undefined;
  return {
    version: 1,
    schemaVersion: LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION,
    captureEpoch,
    coordinatorBinding: "INSTANCE_COORDINATOR",
    manifestDigest,
    surfaces,
    itemCount: value.itemCount,
    registryDigest,
  };
}

export async function legacySurfaceCaptureSnapshotDigest(
  snapshot: Omit<LegacySurfaceCaptureSnapshotV1, "snapshotDigest">,
): Promise<string> {
  return sha256Stable(snapshot);
}

export async function legacySurfaceRegistryCaptureDigest(
  capture: Omit<LegacySurfaceRegistryCaptureV1, "registryDigest">,
): Promise<string> {
  return sha256Stable(capture);
}

export async function validateLegacySurfaceCaptureSnapshotDigest(
  value: unknown,
): Promise<LegacySurfaceCaptureSnapshotV1 | undefined> {
  const snapshot = decodeLegacySurfaceCaptureSnapshot(value);
  if (!snapshot) return undefined;
  const { snapshotDigest, ...base } = snapshot;
  return await legacySurfaceCaptureSnapshotDigest(base) === snapshotDigest ? snapshot : undefined;
}

export async function validateLegacySurfaceRegistryCaptureDigest(
  value: unknown,
): Promise<LegacySurfaceRegistryCaptureV1 | undefined> {
  const capture = decodeLegacySurfaceRegistryCapture(value);
  if (!capture) return undefined;
  for (const surface of capture.surfaces) {
    if (!await validateLegacySurfaceCaptureSnapshotDigest(surface)) return undefined;
  }
  const { registryDigest, ...base } = capture;
  return await legacySurfaceRegistryCaptureDigest(base) === registryDigest ? capture : undefined;
}

export function sameLegacySurfaceIdentity(
  left: LegacySurfaceManifestRecordV1,
  right: LegacySurfaceManifestRecordV1,
): boolean {
  return left.surfaceId === right.surfaceId
    && left.kind === right.kind
    && left.risk === right.risk
    && sameStrings(left.dataClasses, right.dataClasses)
    && sameStrings(left.callerClasses, right.callerClasses)
    && left.replacement === right.replacement
    && left.rollbackRoute === right.rollbackRoute
    && left.recoveryClass === right.recoveryClass;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function manifestRecord(input: Omit<
  LegacySurfaceManifestRecordV1,
  | "schemaVersion"
  | "manifestVersion"
  | "owner"
  | "writeObservationMs"
  | "readObservationMs"
  | "maximumSupportedPhase"
> & Partial<Pick<
  LegacySurfaceManifestRecordV1,
  "manifestVersion" | "owner" | "writeObservationMs" | "readObservationMs" | "maximumSupportedPhase"
>>): LegacySurfaceManifestRecordV1 {
  return {
    schemaVersion: 1,
    manifestVersion: 1,
    owner: "unassigned",
    writeObservationMs: 0,
    readObservationMs: 0,
    maximumSupportedPhase: "discovered",
    ...input,
  };
}

function freezeManifestRecord(record: LegacySurfaceManifestRecordV1): LegacySurfaceManifestRecordV1 {
  Object.freeze(record.dataClasses);
  Object.freeze(record.callerClasses);
  return Object.freeze(record);
}

function decodeEvidenceArray(value: unknown): LegacySurfaceEvidenceReferenceV1[] | undefined {
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const evidence = value.map(decodeLegacySurfaceEvidenceReference);
  if (evidence.some((entry) => !entry)) return undefined;
  const normalized = evidence as LegacySurfaceEvidenceReferenceV1[];
  const identities = normalized.map(({ kind, evidenceId }) => `${kind}\0${evidenceId}`);
  return new Set(identities).size === identities.length ? normalized : undefined;
}

function decodeArray<T>(
  value: unknown,
  maximum: number,
  decoder: (entry: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const output: T[] = [];
  for (const raw of value) {
    const decoded = decoder(raw);
    if (!decoded) return undefined;
    output.push(decoded);
  }
  return output;
}

function normalizeUniqueSortedArray<T extends string>(
  value: unknown,
  predicate: (entry: unknown) => entry is T,
): T[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 20 || !value.every(predicate)) return undefined;
  if (!isStrictlySorted(value)) return undefined;
  return [...value];
}

function normalizeUniqueSortedArrayAllowEmpty<T extends string>(
  value: unknown,
  predicate: (entry: unknown) => entry is T,
): T[] | undefined {
  if (!Array.isArray(value) || value.length > 20 || !value.every(predicate)) return undefined;
  if (value.length && !isStrictlySorted(value)) return undefined;
  return [...value];
}

function decodeLegacySurfaceEvidenceSummary(value: unknown): LegacySurfaceEvidenceSummaryV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["required", "present", "complete"])) return undefined;
  if (
    !isNonNegativeSafeInteger(value.required) || !isNonNegativeSafeInteger(value.present)
    || value.present > value.required || typeof value.complete !== "boolean"
    || value.complete !== (value.present === value.required)
  ) return undefined;
  return { required: value.required, present: value.present, complete: value.complete };
}

function decodeLegacySurfaceAllowedActions(value: unknown): LegacySurfaceAllowedActionV1[] | undefined {
  if (!Array.isArray(value) || value.length > 3) return undefined;
  const output: LegacySurfaceAllowedActionV1[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    if (entry.kind === "advance" && hasExactKeys(entry, ["kind", "targetPhase"]) && isLegacySurfacePhase(entry.targetPhase)) {
      output.push({ kind: "advance", targetPhase: entry.targetPhase });
      continue;
    }
    if (
      entry.kind === "rollback" && hasExactKeys(entry, ["kind", "scope", "targetPhase"])
      && (entry.scope === "read" || entry.scope === "write") && isLegacySurfacePhase(entry.targetPhase)
    ) {
      output.push({ kind: "rollback", scope: entry.scope, targetPhase: entry.targetPhase });
      continue;
    }
    return undefined;
  }
  const identities = output.map((entry) => entry.kind === "advance" ? `advance:${entry.targetPhase}` : `rollback:${entry.scope}`);
  return new Set(identities).size === identities.length ? output : undefined;
}

function normalizeSurfaceId(value: unknown): string {
  return typeof value === "string" && /^legacy\.[a-z0-9][a-z0-9.-]{0,118}[a-z0-9]$/.test(value) ? value : "";
}

function normalizePolicyId(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/.test(value) ? value : "";
}

function normalizeBoundedId(value: unknown, maximum: number): string {
  return typeof value === "string" && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(value) ? value : "";
}

function normalizeDigest(value: unknown): string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : "";
}

function normalizeDeploymentSha(value: unknown): string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : "";
}

function normalizeUtcDay(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : "";
}

function isLegacySurfacePhase(value: unknown): value is LegacySurfacePhase {
  return typeof value === "string" && (LEGACY_SURFACE_PHASES as readonly string[]).includes(value);
}

function isLegacySurfaceKind(value: unknown): value is LegacySurfaceKind {
  return value === "browser" || value === "api" || value === "kv" || value === "durable_substate"
    || value === "provider" || value === "credential";
}

function isLegacySurfaceRisk(value: unknown): value is LegacySurfaceRisk {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function isLegacySurfaceOwner(value: unknown): value is LegacySurfaceOwner {
  return value === "unassigned" || value === "frontend" || value === "operations" || value === "data"
    || value === "provider" || value === "security";
}

function isLegacySurfaceDataClass(value: unknown): value is LegacySurfaceDataClass {
  return value === "browser_asset" || value === "configuration" || value === "conversation" || value === "credential"
    || value === "memory" || value === "reliability" || value === "usage";
}

function isLegacySurfaceCallerClass(value: unknown): value is LegacySurfaceCallerClass {
  return value === "agent_runtime" || value === "background" || value === "browser" || value === "deployment"
    || value === "durable_object" || value === "operator" || value === "service_worker" || value === "test"
    || value === "worker_api" || value === "worker_internal";
}

function isLegacySurfaceRecoveryClass(value: unknown): value is LegacySurfaceRecoveryClass {
  return value === "code_only" || value === "capture_restore" || value === "deployment_evidence";
}

function isLegacySurfaceRollbackRoute(value: unknown): value is LegacySurfaceRollbackRoute {
  return value === "code_revert" || value === "compatibility_read" || value === "configuration_fallback"
    || value === "deployment_binding" || value === "routing_switch";
}

function isLegacySurfaceEvidenceKind(value: unknown): value is LegacySurfaceEvidenceKind {
  return typeof value === "string" && Object.values(LEGACY_SURFACE_PHASE_EVIDENCE).some((kinds) => (
    (kinds as readonly string[]).includes(value)
  ));
}

function isLegacySurfaceEvidenceResult(value: unknown): value is LegacySurfaceEvidenceResult {
  return value === "passed" || value === "complete" || value === "approved";
}

function isLegacySurfaceRollbackReason(value: unknown): value is LegacySurfaceRollbackReason {
  return value === "control_failure" || value === "evidence_invalidated" || value === "parity_regression"
    || value === "recovery_failure" || value === "runtime_regression";
}

function isLegacySurfaceEventAction(value: unknown): value is LegacySurfaceEventV1["action"] {
  return value === "manifest_sync" || value === "advance" || value === "rollback_read" || value === "rollback_write";
}

function isLegacySurfaceBlockerCode(value: unknown): value is LegacySurfaceBlockerCode {
  return value === "maximum_phase_reached" || value === "owner_unassigned" || value === "missing_evidence"
    || value === "observation_incomplete" || value === "manifest_conflict" || value === "state_invalid";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isStrictlySorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key])]));
}

function isCanonicalLegacySurfaceEvents(
  events: LegacySurfaceEventV1[],
  state: LegacySurfaceStoredStateV1,
): boolean {
  if (events.length === 0) return state.revision === 0;
  if (!events.every((event, index) => event.revision === index + 1)) return false;
  if (events[events.length - 1]!.revision !== state.revision) return false;
  return events.every((event, index) => (
    index === 0 || events[index - 1]!.afterPhase === event.beforePhase
  )) && events[events.length - 1]!.afterPhase === state.phase;
}

function isCanonicalLegacySurfaceOperations(
  operations: LegacySurfaceOperationV1[],
  events: LegacySurfaceEventV1[],
  state: LegacySurfaceStoredStateV1,
): boolean {
  const operationEvents = events.filter(({ action }) => action !== "manifest_sync");
  if (operations.length !== operationEvents.length) return false;
  if (!isStrictlySorted(operations.map(({ operationId }) => operationId))) return false;
  return operations.every((operation) => {
    const event = operationEvents.find(({ operationId }) => operationId === operation.operationId);
    return Boolean(event)
      && event!.inputDigest === operation.inputDigest
      && operation.result.surfaceId === state.surfaceId
      && operation.result.revision === event!.revision
      && operation.completedAt === event!.at;
  });
}

function hasExactEvidenceKinds(
  evidence: LegacySurfaceEvidenceReferenceV1[],
  required: readonly LegacySurfaceEvidenceKind[],
  at: unknown,
): boolean {
  if (!isPositiveSafeInteger(at) || evidence.some(({ observedAt }) => observedAt > at)) return false;
  const expectedKinds = [...required].sort();
  const actualKinds = evidence.map(({ kind }) => kind).sort();
  return expectedKinds.length === actualKinds.length
    && expectedKinds.every((kind, index) => kind === actualKinds[index]);
}

function isCanonicalLegacySurfaceDaily(
  daily: LegacySurfaceDailyCountV1[],
  manifest: LegacySurfaceManifestRecordV1,
): boolean {
  const identities = daily.map(({ day, callerClass, access }) => `${day}\0${callerClass}\0${access}`);
  if (identities.length && !isStrictlySorted(identities)) return false;
  return daily.every(({ callerClass, day, lastOccurredAt }) => (
    manifest.callerClasses.includes(callerClass)
    && new Date(lastOccurredAt).toISOString().slice(0, 10) === day
  ));
}

async function sha256Stable(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
