export const INSTANCE_CAPTURE_SCHEMA_VERSION = 1 as const;
export const INSTANCE_MAINTENANCE_COORDINATOR = "$instance-maintenance";

export const INSTANCE_CAPTURE_REQUIRED_STORES = [
  "instance_identity",
  "chat_store",
  "user_state",
  "root_team_agent",
  "conversation_team_agent",
  "workspace_files",
  "document_ingest_queue",
  "provider_coordinator",
  "instance_object_registry",
  "instance_coordinator_runtime",
] as const;

export type CaptureStateClass = "authoritative" | "transitional" | "rebuildable" | "excluded";
export type CaptureRestoreBehavior = "restore" | "rebuild" | "exclude";
export type InstanceMaintenancePhase = "requested" | "active" | "released";
export type InstanceMaintenanceOutcome = "pending" | "captured" | "failed";
export type InstanceOperationKind =
  | "http_mutation"
  | "provider_turn"
  | "document_ingest"
  | "oauth_callback"
  | "workspace_operation"
  | "background_cleanup"
  | "agent_turn";
export type InstanceObjectKind =
  | "user_state"
  | "root_team_agent"
  | "conversation_team_agent"
  | "provider_coordinator";

export type InstanceMaintenanceStateV1 = {
  version: 1;
  revision: number;
  operationId: string;
  captureEpoch: string;
  phase: InstanceMaintenancePhase;
  requestedAt: number;
  activatedAt: number;
  releasedAt: number;
  outcome: InstanceMaintenanceOutcome;
  archiveEvidenceId: string;
  lastError: string;
};

export type InstanceMaintenanceDrainProofV1 = {
  version: 1;
  queue: "drained" | "unknown";
  activeOperations: number;
  observedAt: number;
};

export type InstanceMaintenanceRequestInput = {
  operationId: string;
  captureEpoch: string;
  requestedAt: number;
};

export type InstanceMaintenanceActivationInput = {
  operationId: string;
  captureEpoch: string;
  expectedRevision: number;
  proof: InstanceMaintenanceDrainProofV1;
};

export type InstanceMaintenanceReleaseInput = {
  operationId: string;
  captureEpoch: string;
  expectedRevision: number;
  outcome: "captured" | "failed";
  releasedAt: number;
  archiveEvidenceId?: string;
  lastError?: string;
};

export type InstanceMaintenanceInspection =
  | { blocked: false; state?: InstanceMaintenanceStateV1 }
  | { blocked: true; state?: InstanceMaintenanceStateV1; error?: "instance_maintenance_state_invalid" };

export type InstanceMaintenanceResult =
  | { ok: true; state: InstanceMaintenanceStateV1 }
  | {
      ok: false;
      error:
        | "instance_maintenance_busy"
        | "instance_maintenance_conflict"
        | "instance_maintenance_not_drained"
        | "instance_maintenance_state_invalid";
    };

export type InstanceOperationStateV1 = {
  version: 1;
  operationId: string;
  fenceId: string;
  kind: InstanceOperationKind;
  startedAt: number;
};

export type InstanceOperationAcquireInput = InstanceOperationStateV1;

export type InstanceOperationFenceInput = Omit<InstanceOperationStateV1, "fenceId">;

export type InstanceOperationReleaseInput = {
  operationId: string;
  fenceId: string;
  kind: InstanceOperationKind;
};

export type InstanceOperationResult =
  | { ok: true; operation?: InstanceOperationStateV1; activeOperations: number }
  | {
      ok: false;
      error: "instance_maintenance_busy" | "instance_operation_conflict" | "instance_maintenance_state_invalid";
    };

export type InstanceObjectRegistrationV1 = {
  version: 1;
  kind: InstanceObjectKind;
  instanceName: string;
  rootInstanceName: string;
  schemaVersion: string;
  stateClass: CaptureStateClass;
  restoreBehavior: CaptureRestoreBehavior;
  registeredAt: number;
};

export type InstanceObjectRegistryResult =
  | {
      ok: true;
      objects: InstanceObjectRegistrationV1[];
      baselineComplete: boolean;
      registryDigest: string;
      baselineConfirmedAt: number;
      baselineInventoryId: string;
    }
  | {
      ok: false;
      error: "instance_object_conflict" | "instance_maintenance_busy" | "instance_maintenance_state_invalid";
    };

export type InstanceObjectRegistryBaselineInput = {
  version: 1;
  inventoryId: string;
  objects: InstanceObjectRegistrationV1[];
  confirmedAt: number;
};

export type InstanceOperationFence = { release(): Promise<void> };

export interface InstanceMaintenanceCoordinator {
  requestMaintenance(input: InstanceMaintenanceRequestInput): Promise<InstanceMaintenanceResult>;
  activateMaintenance(input: InstanceMaintenanceActivationInput): Promise<InstanceMaintenanceResult>;
  releaseMaintenance(input: InstanceMaintenanceReleaseInput): Promise<InstanceMaintenanceResult>;
  inspectMaintenance(): Promise<InstanceMaintenanceInspection>;
  acquireOperation(input: InstanceOperationAcquireInput): Promise<InstanceOperationResult>;
  releaseOperation(input: InstanceOperationReleaseInput): Promise<InstanceOperationResult>;
  registerObject(input: InstanceObjectRegistrationV1): Promise<InstanceObjectRegistryResult>;
  listRegisteredObjects(): Promise<InstanceObjectRegistryResult>;
  confirmObjectRegistryBaseline(input: InstanceObjectRegistryBaselineInput): Promise<InstanceObjectRegistryResult>;
}

export async function acquireInstanceOperationFence(
  coordinator: Pick<InstanceMaintenanceCoordinator, "acquireOperation" | "releaseOperation">,
  input: InstanceOperationFenceInput,
): Promise<InstanceOperationFence | undefined> {
  const request: InstanceOperationAcquireInput = {
    ...input,
    fenceId: crypto.randomUUID(),
  };
  let acquired: InstanceOperationResult | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      acquired = await coordinator.acquireOperation(request);
      break;
    } catch {
      // Retrying the same fence ID reconciles an RPC that persisted before rejecting.
    }
  }
  if (!acquired?.ok || acquired.operation?.fenceId !== request.fenceId) {
    await releaseInstanceOperationFence(coordinator, {
      operationId: request.operationId,
      fenceId: request.fenceId,
      kind: request.kind,
    });
    return undefined;
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      const result = await releaseInstanceOperationFence(coordinator, {
        operationId: request.operationId,
        fenceId: request.fenceId,
        kind: request.kind,
      });
      if (!result.ok) throw new InstanceCaptureError(result.error);
      released = true;
    },
  };
}

async function releaseInstanceOperationFence(
  coordinator: Pick<InstanceMaintenanceCoordinator, "releaseOperation">,
  input: InstanceOperationReleaseInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let lastError = "instance_operation_release_failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await coordinator.releaseOperation(input);
      if (result.ok) return { ok: true };
      lastError = result.error;
    } catch {
      lastError = "instance_operation_release_failed";
    }
  }
  return { ok: false, error: lastError };
}

export type CaptureSourceIdentityV1 = {
  accountId: string;
  workerName: string;
  kvNamespaceId: string;
};

export type CaptureAdapterResult = {
  captureEpoch: string;
  sourceIdentity: string;
  schemaVersion: string;
  generation: string;
  stateClass: CaptureStateClass;
  restoreBehavior: CaptureRestoreBehavior;
  itemCount: number;
  bytes?: Uint8Array;
  exclusionReason?: string;
  unresolvedReferences?: number;
  references?: CaptureReferenceV1[];
};

export type CaptureReferenceV1 = {
  targetStore: string;
  targetSourceIdentity: string;
  expectedGeneration: string;
};

export type CaptureStoreAdapter = {
  store: string;
  capture(captureEpoch: string): Promise<CaptureAdapterResult>;
};

export type CaptureStoreEntryV1 = {
  store: string;
  sourceIdentity: string;
  schemaVersion: string;
  generation: string;
  stateClass: CaptureStateClass;
  restoreBehavior: CaptureRestoreBehavior;
  payloadId: string;
  itemCount: number;
  sizeBytes: number;
  checksum: string;
  exclusionReason: string;
  references: CaptureReferenceV1[];
};

export type CaptureManifestV1 = {
  version: 1;
  archiveId: string;
  source: CaptureSourceIdentityV1;
  captureEpoch: string;
  capturedAt: string;
  requiredStores: string[];
  entries: CaptureStoreEntryV1[];
  manifestChecksum: string;
  status: "sealed";
};

export type EncryptedCaptureBlobV1 = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  plaintextBytes: number;
  plaintextChecksum: string;
};

export type EncryptedCaptureArchiveV1 = {
  version: 1;
  algorithm: "AES-GCM";
  keyId: string;
  archiveId: string;
  captureEpoch: string;
  manifest: EncryptedCaptureBlobV1;
  payloads: Array<{ payloadId: string; blob: EncryptedCaptureBlobV1 }>;
  sealed: true;
};

export type CaptureInstanceInput = {
  archiveId: string;
  keyId: string;
  archiveKey: Uint8Array;
  source: CaptureSourceIdentityV1;
  captureEpoch: string;
  capturedAt: Date;
  requiredStores?: readonly string[];
  coordinator: InstanceMaintenanceCoordinator;
  drain(): Promise<InstanceMaintenanceDrainProofV1>;
  adapters: CaptureStoreAdapter[];
  persistArchive(archive: EncryptedCaptureArchiveV1): Promise<{ evidenceId: string }>;
};

export type CaptureInstanceResult = {
  manifest: CaptureManifestV1;
  archive: EncryptedCaptureArchiveV1;
};

export type DecryptedCaptureArchiveV1 = {
  manifest: CaptureManifestV1;
  payloads: Array<{ entry: CaptureStoreEntryV1; bytes: Uint8Array }>;
};

export class InstanceCaptureError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "InstanceCaptureError";
  }
}

export async function captureInstance(input: CaptureInstanceInput): Promise<CaptureInstanceResult> {
  const archiveId = normalizeId(input.archiveId, 160);
  const keyId = normalizeId(input.keyId, 160);
  const captureEpoch = normalizeId(input.captureEpoch, 160);
  const source = normalizeCaptureSource(input.source);
  const requiredStores = normalizeRequiredStores(input.requiredStores || INSTANCE_CAPTURE_REQUIRED_STORES);
  const key = await importArchiveKey(input.archiveKey);
  if (!archiveId || !keyId || !captureEpoch || !source || !isValidDate(input.capturedAt)) {
    throw new InstanceCaptureError("capture_input_invalid");
  }
  validateAdapters(input.adapters, requiredStores);

  const requested = await requestMaintenanceAndConfirm(input.coordinator, {
    operationId: archiveId,
    captureEpoch,
    requestedAt: input.capturedAt.getTime(),
  });
  if (!requested.ok) throw new InstanceCaptureError(requested.error);

  let activeRevision = requested.state.revision;
  try {
    const proof = normalizeDrainProof(await input.drain());
    if (!proof) throw new InstanceCaptureError("instance_maintenance_not_drained");
    const activated = await input.coordinator.activateMaintenance({
      operationId: archiveId,
      captureEpoch,
      expectedRevision: requested.state.revision,
      proof,
    });
    if (!activated.ok) throw new InstanceCaptureError(activated.error);
    activeRevision = activated.state.revision;

    const captured = await Promise.all(input.adapters.map(async (adapter) => ({
      store: adapter.store,
      result: await adapter.capture(captureEpoch),
    })));
    const built = await buildCaptureManifest({
      archiveId,
      source,
      captureEpoch,
      capturedAt: input.capturedAt,
      requiredStores,
      captured,
    });
    const archive = await encryptCaptureArchive(built.manifest, built.payloads, keyId, key);
    const persisted = await input.persistArchive(archive);
    const archiveEvidenceId = normalizeId(persisted?.evidenceId, 160);
    if (!archiveEvidenceId) throw new InstanceCaptureError("capture_archive_persistence_invalid");
    const releaseInput: InstanceMaintenanceReleaseInput = {
      operationId: archiveId,
      captureEpoch,
      expectedRevision: activeRevision,
      outcome: "captured",
      releasedAt: Date.now(),
      archiveEvidenceId,
    };
    if (!(await releaseMaintenanceAndConfirm(input.coordinator, releaseInput))) {
      throw new InstanceCaptureError("instance_maintenance_release_failed");
    }
    return { manifest: built.manifest, archive };
  } catch (error) {
    const released = await releaseMaintenanceAndConfirm(input.coordinator, {
      operationId: archiveId,
      captureEpoch,
      expectedRevision: activeRevision,
      outcome: "failed",
      releasedAt: Date.now(),
      archiveEvidenceId: "",
      lastError: stableCaptureError(error),
    });
    if (!released) throw new InstanceCaptureError("instance_maintenance_release_failed");
    throw error;
  }
}

async function requestMaintenanceAndConfirm(
  coordinator: InstanceMaintenanceCoordinator,
  input: InstanceMaintenanceRequestInput,
): Promise<InstanceMaintenanceResult> {
  try {
    return await coordinator.requestMaintenance(input);
  } catch {
    // A Durable Object RPC can reject after persisting the requested state.
  }
  try {
    const inspected = await coordinator.inspectMaintenance();
    if (
      inspected.blocked
      && inspected.state
      && inspected.state.operationId === input.operationId
      && inspected.state.captureEpoch === input.captureEpoch
      && (inspected.state.phase === "requested" || inspected.state.phase === "active")
    ) return { ok: true, state: inspected.state };
  } catch {
    // The stable error below tells the operator that maintenance may need reconciliation.
  }
  throw new InstanceCaptureError("instance_maintenance_request_failed");
}

async function releaseMaintenanceAndConfirm(
  coordinator: InstanceMaintenanceCoordinator,
  input: InstanceMaintenanceReleaseInput,
): Promise<boolean> {
  try {
    const result = await coordinator.releaseMaintenance(input);
    if (result.ok) return true;
  } catch {
    // Reconcile an ambiguous Durable Object RPC result from persisted state.
  }
  try {
    const inspected = await coordinator.inspectMaintenance();
    return !inspected.blocked
      && inspected.state?.phase === "released"
      && inspected.state.operationId === input.operationId
      && inspected.state.captureEpoch === input.captureEpoch
      && inspected.state.outcome === input.outcome
      && inspected.state.archiveEvidenceId === (input.archiveEvidenceId || "");
  } catch {
    return false;
  }
}

export function normalizeInstanceMaintenanceState(value: unknown): InstanceMaintenanceStateV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "revision", "operationId", "captureEpoch", "phase", "requestedAt",
    "activatedAt", "releasedAt", "outcome", "archiveEvidenceId", "lastError",
  ])) return undefined;
  const operationId = normalizeId(value.operationId, 160);
  const captureEpoch = normalizeId(value.captureEpoch, 160);
  const phase = value.phase;
  const outcome = value.outcome;
  const archiveEvidenceId = value.archiveEvidenceId === "" ? "" : normalizeId(value.archiveEvidenceId, 160);
  const lastError = normalizeErrorCode(value.lastError, true);
  if (
    value.version !== 1
    || !isSafeNonNegativeInteger(value.revision)
    || !operationId
    || !captureEpoch
    || (phase !== "requested" && phase !== "active" && phase !== "released")
    || !isSafeNonNegativeInteger(value.requestedAt)
    || !isSafeNonNegativeInteger(value.activatedAt)
    || !isSafeNonNegativeInteger(value.releasedAt)
    || (outcome !== "pending" && outcome !== "captured" && outcome !== "failed")
    || (value.archiveEvidenceId !== "" && !archiveEvidenceId)
    || lastError === undefined
  ) return undefined;
  if (
    phase === "requested"
    && (value.activatedAt !== 0 || value.releasedAt !== 0 || outcome !== "pending" || archiveEvidenceId || lastError)
  ) {
    return undefined;
  }
  if (
    phase === "active"
    && (value.activatedAt <= 0 || value.releasedAt !== 0 || outcome !== "pending" || archiveEvidenceId || lastError)
  ) {
    return undefined;
  }
  if (
    phase === "released"
    && (
      value.releasedAt <= 0
      || outcome === "pending"
      || (outcome === "captured" && value.activatedAt <= 0)
      || (outcome === "captured" && (!archiveEvidenceId || lastError))
      || (outcome === "failed" && (archiveEvidenceId || !lastError))
    )
  ) return undefined;
  return {
    version: 1,
    revision: value.revision,
    operationId,
    captureEpoch,
    phase,
    requestedAt: value.requestedAt,
    activatedAt: value.activatedAt,
    releasedAt: value.releasedAt,
    outcome,
    archiveEvidenceId,
    lastError,
  };
}

export function normalizeDrainProof(value: unknown): InstanceMaintenanceDrainProofV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "queue", "activeOperations", "observedAt"])) {
    return undefined;
  }
  if (
    value.version !== 1
    || value.queue !== "drained"
    || value.activeOperations !== 0
    || !isSafeNonNegativeInteger(value.observedAt)
  ) return undefined;
  return { version: 1, queue: "drained", activeOperations: 0, observedAt: value.observedAt };
}

export function normalizeInstanceOperationState(value: unknown): InstanceOperationStateV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "operationId", "fenceId", "kind", "startedAt"])) {
    return undefined;
  }
  const operationId = normalizeId(value.operationId, 160);
  const fenceId = normalizeId(value.fenceId, 160);
  if (
    value.version !== 1 || !operationId || !fenceId || !isInstanceOperationKind(value.kind)
    || !isSafeNonNegativeInteger(value.startedAt)
  ) return undefined;
  return { version: 1, operationId, fenceId, kind: value.kind, startedAt: value.startedAt };
}

export function normalizeInstanceObjectRegistration(value: unknown): InstanceObjectRegistrationV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "kind", "instanceName", "rootInstanceName", "schemaVersion",
    "stateClass", "restoreBehavior", "registeredAt",
  ])) return undefined;
  const instanceName = normalizeId(value.instanceName, 160);
  const rawRootInstanceName = value.rootInstanceName;
  const rootInstanceName = rawRootInstanceName === "" ? "" : normalizeId(rawRootInstanceName, 160);
  const schemaVersion = normalizeId(value.schemaVersion, 120);
  if (
    value.version !== 1 || !isInstanceObjectKind(value.kind) || !instanceName
    || (rawRootInstanceName !== "" && !rootInstanceName)
    || !schemaVersion || !isCaptureStateClass(value.stateClass) || !isRestoreBehavior(value.restoreBehavior)
    || !isValidStateRestoreCombination(value.stateClass, value.restoreBehavior)
    || value.restoreBehavior === "exclude"
    || !isSafeNonNegativeInteger(value.registeredAt)
    || (value.kind === "conversation_team_agent" ? !rootInstanceName : Boolean(rootInstanceName))
  ) return undefined;
  return {
    version: 1,
    kind: value.kind,
    instanceName,
    rootInstanceName,
    schemaVersion,
    stateClass: value.stateClass,
    restoreBehavior: value.restoreBehavior,
    registeredAt: value.registeredAt,
  };
}

export function parseCaptureManifest(value: unknown): CaptureManifestV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "archiveId", "source", "captureEpoch", "capturedAt", "requiredStores",
    "entries", "manifestChecksum", "status",
  ])) return undefined;
  const archiveId = normalizeId(value.archiveId, 160);
  const captureEpoch = normalizeId(value.captureEpoch, 160);
  const source = normalizeCaptureSource(value.source);
  const requiredStores = normalizeRequiredStores(value.requiredStores);
  const capturedAt = normalizeIsoTimestamp(value.capturedAt);
  const manifestChecksum = normalizeChecksum(value.manifestChecksum);
  if (
    value.version !== 1 || !archiveId || !source || !captureEpoch || !capturedAt
    || !requiredStores.length || !Array.isArray(value.entries) || !manifestChecksum || value.status !== "sealed"
    || !sameStringArray(value.requiredStores, requiredStores)
  ) return undefined;
  const entries = value.entries.map(normalizeCaptureEntry);
  if (entries.some((entry) => !entry)) return undefined;
  const normalizedEntries = entries as CaptureStoreEntryV1[];
  if (!isCanonicalEntryOrder(normalizedEntries) || captureInventoryError(normalizedEntries, requiredStores)) {
    return undefined;
  }
  return {
    version: 1,
    archiveId,
    source,
    captureEpoch,
    capturedAt,
    requiredStores,
    entries: normalizedEntries,
    manifestChecksum,
    status: "sealed",
  };
}

export async function verifyCaptureManifest(value: unknown): Promise<CaptureManifestV1 | undefined> {
  const manifest = parseCaptureManifest(value);
  if (!manifest) return undefined;
  const { manifestChecksum, ...base } = manifest;
  if (await sha256Hex(new TextEncoder().encode(stableJson(base))) !== manifestChecksum) return undefined;
  for (const entry of manifest.entries) {
    const expectedPayloadId = await payloadIdFor(entry.store, entry.sourceIdentity, entry.generation);
    if (entry.payloadId !== expectedPayloadId) return undefined;
  }
  return manifest;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

async function buildCaptureManifest(input: {
  archiveId: string;
  source: CaptureSourceIdentityV1;
  captureEpoch: string;
  capturedAt: Date;
  requiredStores: string[];
  captured: Array<{ store: string; result: CaptureAdapterResult }>;
}): Promise<{ manifest: CaptureManifestV1; payloads: Array<{ entry: CaptureStoreEntryV1; bytes: Uint8Array }> }> {
  const payloads = await Promise.all(input.captured.map(async ({ store: rawStore, result }) => {
    const store = normalizeStore(rawStore);
    const sourceIdentity = normalizeId(result.sourceIdentity, 240);
    const schemaVersion = normalizeId(result.schemaVersion, 120);
    const generation = normalizeId(result.generation, 160);
    const exclusionReason = normalizeReason(result.exclusionReason);
    const hasBytes = result.bytes instanceof Uint8Array;
    const bytes = hasBytes ? result.bytes as Uint8Array : new Uint8Array();
    const unresolvedReferences = result.unresolvedReferences ?? 0;
    const references = normalizeCaptureReferences(result.references ?? []);
    if (
      !store || !sourceIdentity || !schemaVersion || !generation
      || result.captureEpoch !== input.captureEpoch
      || !isCaptureStateClass(result.stateClass)
      || !isRestoreBehavior(result.restoreBehavior)
      || !isSafeNonNegativeInteger(result.itemCount)
      || !isSafeNonNegativeInteger(unresolvedReferences)
      || unresolvedReferences !== 0
      || !references
      || !isValidStateRestoreCombination(result.stateClass, result.restoreBehavior)
      || (result.restoreBehavior === "exclude" && !exclusionReason)
      || (result.restoreBehavior !== "exclude" && exclusionReason)
      || (result.restoreBehavior !== "exclude" && !hasBytes)
      || (result.restoreBehavior === "exclude" && hasBytes)
    ) throw new InstanceCaptureError("capture_store_invalid");
    const checksum = await sha256Hex(bytes);
    const payloadId = await payloadIdFor(store, sourceIdentity, generation);
    const entry: CaptureStoreEntryV1 = {
      store,
      sourceIdentity,
      schemaVersion,
      generation,
      stateClass: result.stateClass,
      restoreBehavior: result.restoreBehavior,
      payloadId,
      itemCount: result.itemCount,
      sizeBytes: bytes.byteLength,
      checksum,
      exclusionReason,
      references,
    };
    return { entry, bytes };
  }));
  payloads.sort((left, right) => compareEntries(left.entry, right.entry));
  const inventoryError = captureInventoryError(payloads.map(({ entry }) => entry), input.requiredStores);
  if (inventoryError) throw new InstanceCaptureError(inventoryError);
  const base = {
    version: 1 as const,
    archiveId: input.archiveId,
    source: input.source,
    captureEpoch: input.captureEpoch,
    capturedAt: input.capturedAt.toISOString(),
    requiredStores: input.requiredStores,
    entries: payloads.map(({ entry }) => entry),
    status: "sealed" as const,
  };
  const manifestChecksum = await sha256Hex(new TextEncoder().encode(stableJson(base)));
  return { manifest: { ...base, manifestChecksum }, payloads };
}

async function encryptCaptureArchive(
  manifest: CaptureManifestV1,
  payloads: Array<{ entry: CaptureStoreEntryV1; bytes: Uint8Array }>,
  keyId: string,
  key: CryptoKey,
): Promise<EncryptedCaptureArchiveV1> {
  const manifestBytes = new TextEncoder().encode(stableJson(manifest));
  const header = {
    version: 1 as const,
    algorithm: "AES-GCM" as const,
    keyId,
    archiveId: manifest.archiveId,
    captureEpoch: manifest.captureEpoch,
    sealed: true as const,
  };
  const encryptedPayloads = await Promise.all(payloads.map(async ({ entry, bytes }) => ({
    payloadId: entry.payloadId,
    blob: await encryptBlob(bytes, key, (metadata) => archiveBlobAad(header, {
      kind: "payload",
      payloadId: entry.payloadId,
      ...metadata,
    })),
  })));
  return {
    ...header,
    manifest: await encryptBlob(manifestBytes, key, (metadata) => archiveBlobAad(header, {
      kind: "manifest",
      ...metadata,
    })),
    payloads: encryptedPayloads,
  };
}

export async function decryptAndValidateCaptureArchive(
  value: unknown,
  rawKey: Uint8Array,
): Promise<DecryptedCaptureArchiveV1> {
  const archive = parseEncryptedCaptureArchive(value);
  if (!archive) throw new InstanceCaptureError("archive_invalid");
  const key = await importArchiveKey(rawKey, "decrypt");
  const header = archiveHeader(archive);
  const manifestBytes = await decryptBlob(
    archive.manifest,
    key,
    archiveBlobAad(header, { kind: "manifest", ...blobMetadata(archive.manifest) }),
  );
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(manifestBytes));
  } catch {
    throw new InstanceCaptureError("capture_manifest_invalid");
  }
  const manifest = await verifyCaptureManifest(manifestValue);
  if (
    !manifest
    || manifest.archiveId !== archive.archiveId
    || manifest.captureEpoch !== archive.captureEpoch
    || manifest.entries.length !== archive.payloads.length
  ) throw new InstanceCaptureError("capture_manifest_invalid");

  const payloads = await Promise.all(archive.payloads.map(async (payload, index) => {
    const entry = manifest.entries[index];
    if (!entry || entry.payloadId !== payload.payloadId) {
      throw new InstanceCaptureError("archive_payload_inventory_invalid");
    }
    const bytes = await decryptBlob(
      payload.blob,
      key,
      archiveBlobAad(header, {
        kind: "payload",
        payloadId: payload.payloadId,
        ...blobMetadata(payload.blob),
      }),
    );
    if (bytes.byteLength !== entry.sizeBytes || await sha256Hex(bytes) !== entry.checksum) {
      throw new InstanceCaptureError("archive_integrity_invalid");
    }
    return { entry, bytes };
  }));
  return { manifest, payloads };
}

export function parseEncryptedCaptureArchive(value: unknown): EncryptedCaptureArchiveV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "algorithm", "keyId", "archiveId", "captureEpoch", "manifest", "payloads", "sealed",
  ])) return undefined;
  const keyId = normalizeId(value.keyId, 160);
  const archiveId = normalizeId(value.archiveId, 160);
  const captureEpoch = normalizeId(value.captureEpoch, 160);
  const manifest = normalizeEncryptedBlob(value.manifest);
  if (
    value.version !== 1 || value.algorithm !== "AES-GCM" || value.sealed !== true
    || !keyId || !archiveId || !captureEpoch || !manifest
    || !Array.isArray(value.payloads) || value.payloads.length > 1_000
  ) return undefined;
  const payloads = value.payloads.map((payload) => {
    if (!isRecord(payload) || !hasExactKeys(payload, ["payloadId", "blob"])) return undefined;
    const payloadId = normalizeChecksum(payload.payloadId);
    const blob = normalizeEncryptedBlob(payload.blob);
    return payloadId && blob ? { payloadId, blob } : undefined;
  });
  if (payloads.some((payload) => !payload)) return undefined;
  const normalizedPayloads = payloads as Array<{ payloadId: string; blob: EncryptedCaptureBlobV1 }>;
  if (new Set(normalizedPayloads.map(({ payloadId }) => payloadId)).size !== normalizedPayloads.length) {
    return undefined;
  }
  return {
    version: 1,
    algorithm: "AES-GCM",
    keyId,
    archiveId,
    captureEpoch,
    manifest,
    payloads: normalizedPayloads,
    sealed: true,
  };
}

type CaptureArchiveHeaderV1 = Pick<
  EncryptedCaptureArchiveV1,
  "version" | "algorithm" | "keyId" | "archiveId" | "captureEpoch" | "sealed"
>;

type CaptureBlobMetadataV1 = Pick<EncryptedCaptureBlobV1, "plaintextBytes" | "plaintextChecksum">;

function archiveHeader(archive: EncryptedCaptureArchiveV1): CaptureArchiveHeaderV1 {
  return {
    version: archive.version,
    algorithm: archive.algorithm,
    keyId: archive.keyId,
    archiveId: archive.archiveId,
    captureEpoch: archive.captureEpoch,
    sealed: archive.sealed,
  };
}

function archiveBlobAad(
  header: CaptureArchiveHeaderV1,
  detail: CaptureBlobMetadataV1 & ({ kind: "manifest" } | { kind: "payload"; payloadId: string }),
): string {
  return stableJson({ header, ...detail });
}

function blobMetadata(blob: EncryptedCaptureBlobV1): CaptureBlobMetadataV1 {
  return { plaintextBytes: blob.plaintextBytes, plaintextChecksum: blob.plaintextChecksum };
}

async function encryptBlob(
  bytes: Uint8Array,
  key: CryptoKey,
  aadFor: (metadata: CaptureBlobMetadataV1) => string,
): Promise<EncryptedCaptureBlobV1> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintextChecksum = await sha256Hex(bytes);
  const metadata = { plaintextBytes: bytes.byteLength, plaintextChecksum };
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aadFor(metadata)) },
    key,
    bytes,
  );
  return {
    version: 1,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    plaintextBytes: metadata.plaintextBytes,
    plaintextChecksum,
  };
}

async function decryptBlob(blob: EncryptedCaptureBlobV1, key: CryptoKey, aad: string): Promise<Uint8Array> {
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(blob.iv), additionalData: new TextEncoder().encode(aad) },
      key,
      base64ToBytes(blob.ciphertext),
    ));
  } catch {
    throw new InstanceCaptureError("archive_decrypt_failed");
  }
  if (plaintext.byteLength !== blob.plaintextBytes || await sha256Hex(plaintext) !== blob.plaintextChecksum) {
    throw new InstanceCaptureError("archive_integrity_invalid");
  }
  return plaintext;
}

async function importArchiveKey(raw: Uint8Array, usage: "encrypt" | "decrypt" = "encrypt"): Promise<CryptoKey> {
  if (!(raw instanceof Uint8Array) || raw.byteLength !== 32) {
    throw new InstanceCaptureError("archive_key_invalid");
  }
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [usage]);
  } catch {
    throw new InstanceCaptureError("archive_key_invalid");
  }
}

function validateAdapters(adapters: CaptureStoreAdapter[], requiredStores: string[]): void {
  if (!Array.isArray(adapters) || !adapters.length || adapters.length > 1_000) {
    throw new InstanceCaptureError("capture_adapters_invalid");
  }
  const stores = new Set(adapters.map((adapter) => normalizeStore(adapter?.store)).filter(Boolean));
  if (adapters.some((adapter) => !normalizeStore(adapter?.store)) || requiredStores.some((store) => !stores.has(store))) {
    throw new InstanceCaptureError("capture_adapters_invalid");
  }
  if (adapters.some((adapter) => typeof adapter?.capture !== "function")) {
    throw new InstanceCaptureError("capture_adapters_invalid");
  }
}

function normalizeCaptureEntry(value: unknown): CaptureStoreEntryV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "store", "sourceIdentity", "schemaVersion", "generation", "stateClass", "restoreBehavior",
    "payloadId", "itemCount", "sizeBytes", "checksum", "exclusionReason", "references",
  ])) return undefined;
  const store = normalizeStore(value.store);
  const sourceIdentity = normalizeId(value.sourceIdentity, 240);
  const schemaVersion = normalizeId(value.schemaVersion, 120);
  const generation = normalizeId(value.generation, 160);
  const payloadId = normalizeChecksum(value.payloadId);
  const checksum = normalizeChecksum(value.checksum);
  const exclusionReason = normalizeReason(value.exclusionReason);
  const references = normalizeCaptureReferences(value.references, true);
  if (
    !store || !sourceIdentity || !schemaVersion || !generation || !payloadId || !checksum
    || !isCaptureStateClass(value.stateClass) || !isRestoreBehavior(value.restoreBehavior)
    || !isValidStateRestoreCombination(value.stateClass, value.restoreBehavior)
    || !isSafeNonNegativeInteger(value.itemCount)
    || !isSafeNonNegativeInteger(value.sizeBytes)
    || !references
    || (value.restoreBehavior === "exclude" && !exclusionReason)
    || (value.restoreBehavior !== "exclude" && exclusionReason)
    || (value.restoreBehavior === "exclude" && value.sizeBytes !== 0)
  ) return undefined;
  return {
    store,
    sourceIdentity,
    schemaVersion,
    generation,
    stateClass: value.stateClass,
    restoreBehavior: value.restoreBehavior,
    payloadId,
    itemCount: value.itemCount,
    sizeBytes: value.sizeBytes,
    checksum,
    exclusionReason,
    references,
  };
}

function normalizeCaptureReferences(value: unknown, requireCanonical = false): CaptureReferenceV1[] | undefined {
  if (!Array.isArray(value) || value.length > 10_000) return undefined;
  const references = value.map((reference): CaptureReferenceV1 | undefined => {
    if (!isRecord(reference) || !hasExactKeys(reference, [
      "targetStore", "targetSourceIdentity", "expectedGeneration",
    ])) return undefined;
    const targetStore = normalizeStore(reference.targetStore);
    const targetSourceIdentity = normalizeId(reference.targetSourceIdentity, 240);
    const expectedGeneration = normalizeId(reference.expectedGeneration, 160);
    return targetStore && targetSourceIdentity && expectedGeneration
      ? { targetStore, targetSourceIdentity, expectedGeneration }
      : undefined;
  });
  if (references.some((reference) => !reference)) return undefined;
  const normalized = references as CaptureReferenceV1[];
  if (requireCanonical && !normalized.every((reference, index) => (
    index === 0 || compareReferences(normalized[index - 1]!, reference) < 0
  ))) return undefined;
  normalized.sort(compareReferences);
  const keys = normalized.map(referenceKey);
  return new Set(keys).size === keys.length ? normalized : undefined;
}

function normalizeEncryptedBlob(value: unknown): EncryptedCaptureBlobV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "algorithm", "iv", "ciphertext", "plaintextBytes", "plaintextChecksum",
  ])) return undefined;
  const plaintextChecksum = normalizeChecksum(value.plaintextChecksum);
  if (
    value.version !== 1 || value.algorithm !== "AES-GCM"
    || !isCanonicalBase64(value.iv, 12)
    || !isCanonicalBase64(value.ciphertext, undefined, 16)
    || !isSafeNonNegativeInteger(value.plaintextBytes)
    || !plaintextChecksum
  ) return undefined;
  return {
    version: 1,
    algorithm: "AES-GCM",
    iv: value.iv,
    ciphertext: value.ciphertext,
    plaintextBytes: value.plaintextBytes,
    plaintextChecksum,
  };
}

function normalizeCaptureSource(value: unknown): CaptureSourceIdentityV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["accountId", "workerName", "kvNamespaceId"])) return undefined;
  const accountId = normalizeId(value.accountId, 128);
  const workerName = normalizeId(value.workerName, 128);
  const kvNamespaceId = normalizeId(value.kvNamespaceId, 128);
  return accountId && workerName && kvNamespaceId ? { accountId, workerName, kvNamespaceId } : undefined;
}

function normalizeRequiredStores(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) return [];
  const stores = value.map(normalizeStore);
  return stores.every(Boolean) && new Set(stores).size === stores.length ? stores.sort() : [];
}

function normalizeStore(value: unknown): string {
  const normalized = typeof value === "string" ? value : "";
  return /^[a-z][a-z0-9_]{1,79}$/.test(normalized) ? normalized : "";
}

function normalizeId(value: unknown, max: number): string {
  const normalized = typeof value === "string" ? value : "";
  return normalized && normalized.length <= max && /^[A-Za-z0-9$][A-Za-z0-9$:._/-]*$/.test(normalized)
    ? normalized
    : "";
}

function normalizeChecksum(value: unknown): string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : "";
}

function normalizeReason(value: unknown): string {
  const reason = typeof value === "string" ? value : "";
  return reason.length <= 240 && /^[a-z0-9_:-]*$/.test(reason) ? reason : "";
}

function normalizeErrorCode(value: unknown, allowEmpty = false): string | undefined {
  const code = typeof value === "string" ? value : "";
  if (!code && allowEmpty) return "";
  return /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : undefined;
}

function stableCaptureError(error: unknown): string {
  if (error instanceof InstanceCaptureError) return normalizeErrorCode(error.code) || "capture_failed";
  return "capture_failed";
}

function isCaptureStateClass(value: unknown): value is CaptureStateClass {
  return value === "authoritative" || value === "transitional" || value === "rebuildable" || value === "excluded";
}

function isRestoreBehavior(value: unknown): value is CaptureRestoreBehavior {
  return value === "restore" || value === "rebuild" || value === "exclude";
}

function isInstanceOperationKind(value: unknown): value is InstanceOperationKind {
  return value === "http_mutation" || value === "provider_turn" || value === "document_ingest"
    || value === "oauth_callback" || value === "workspace_operation"
    || value === "background_cleanup" || value === "agent_turn";
}

function isInstanceObjectKind(value: unknown): value is InstanceObjectKind {
  return value === "user_state" || value === "root_team_agent" || value === "conversation_team_agent"
    || value === "provider_coordinator";
}

function isValidStateRestoreCombination(
  stateClass: CaptureStateClass,
  restoreBehavior: CaptureRestoreBehavior,
): boolean {
  if (stateClass === "authoritative") return restoreBehavior === "restore";
  if (stateClass === "transitional") return restoreBehavior === "restore" || restoreBehavior === "rebuild";
  if (stateClass === "rebuildable") return restoreBehavior === "rebuild";
  return restoreBehavior === "exclude";
}

function captureInventoryError(entries: CaptureStoreEntryV1[], requiredStores: string[]): string | undefined {
  const identities = new Set<string>();
  const payloadIds = new Set<string>();
  const generations = new Map<string, string>();
  for (const entry of entries) {
    const identity = captureIdentity(entry.store, entry.sourceIdentity);
    if (identities.has(identity)) return "capture_store_duplicate";
    if (payloadIds.has(entry.payloadId)) return "capture_payload_duplicate";
    identities.add(identity);
    payloadIds.add(entry.payloadId);
    generations.set(identity, entry.generation);
  }
  for (const store of requiredStores) {
    if (!entries.some((entry) => entry.store === store)) return "capture_store_missing";
  }
  for (const entry of entries) {
    for (const reference of entry.references) {
      if (
        generations.get(captureIdentity(reference.targetStore, reference.targetSourceIdentity))
        !== reference.expectedGeneration
      ) return "capture_reference_unresolved";
    }
  }
  return undefined;
}

function captureIdentity(store: string, sourceIdentity: string): string {
  return `${store}\0${sourceIdentity}`;
}

function referenceKey(reference: CaptureReferenceV1): string {
  return `${captureIdentity(reference.targetStore, reference.targetSourceIdentity)}\0${reference.expectedGeneration}`;
}

function normalizeIsoTimestamp(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : "";
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key])]));
}

function compareEntries(left: CaptureStoreEntryV1, right: CaptureStoreEntryV1): number {
  return compareStrings(left.store, right.store) || compareStrings(left.sourceIdentity, right.sourceIdentity);
}

function compareReferences(left: CaptureReferenceV1, right: CaptureReferenceV1): number {
  return compareStrings(left.targetStore, right.targetStore)
    || compareStrings(left.targetSourceIdentity, right.targetSourceIdentity)
    || compareStrings(left.expectedGeneration, right.expectedGeneration);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCanonicalEntryOrder(entries: CaptureStoreEntryV1[]): boolean {
  return entries.every((entry, index) => index === 0 || compareEntries(entries[index - 1]!, entry) < 0);
}

async function payloadIdFor(store: string, sourceIdentity: string, generation: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(`${store}\0${sourceIdentity}\0${generation}`));
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function isCanonicalBase64(value: unknown, exactBytes?: number, minimumBytes = 0): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const bytes = base64ToBytes(value);
    return bytesToBase64(bytes) === value
      && (exactBytes === undefined || bytes.byteLength === exactBytes)
      && bytes.byteLength >= minimumBytes;
  } catch {
    return false;
  }
}
