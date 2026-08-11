import {
  INSTANCE_MAINTENANCE_COORDINATOR,
  decryptAndValidateCaptureArchive,
  normalizeInstanceObjectRegistration,
  stableJson,
  type CaptureManifestV1,
  type CaptureStoreEntryV1,
  type EncryptedCaptureArchiveV1,
  type InstanceObjectKind,
  type InstanceObjectRegistrationV1,
} from "./instance-capture";
import {
  decodeDurableObjectCaptureSnapshot,
  decodeDurableObjectCaptureValue,
  DurableObjectRestoreError,
} from "./durable-object-restore";
import {
  LEGACY_SURFACE_MANIFEST,
  LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION,
  legacySurfaceManifestDigest,
  legacySurfaceObjectName,
  validateLegacySurfaceRegistryCaptureDigest,
  type LegacySurfaceRegistryCaptureV1,
} from "../contracts/legacy-surface";
import type { InstanceCoordinator } from "../instance-coordinator";

export const INSTANCE_RESTORE_SCHEMA_VERSION = 1 as const;
export const INSTANCE_RESTORE_PHASES = [
  "preflight",
  "provision",
  "durable_stores",
  "user_state",
  "root_agent",
  "conversation_agents",
  "workspace_files",
  "queue_regeneration",
  "reconciliation",
  "acceptance",
  "eligible_for_cutover",
] as const;

export type InstanceRestorePhase = typeof INSTANCE_RESTORE_PHASES[number];
export type RestoreTargetBindingKind = "kv" | "r2" | "queue" | "dlq" | "durable_object";

export type RestoreTargetBindingV1 = {
  kind: RestoreTargetBindingKind;
  bindingName: string;
  physicalId: string;
  className: string;
  migrationTag: string;
};

export type RestoreTargetIdentityV1 = {
  version: 1;
  accountId: string;
  workerName: string;
  environment: string;
  commit: string;
  isolated: true;
  bindings: RestoreTargetBindingV1[];
};

export type RestoreObjectMappingV1 = {
  version: 1;
  kind: InstanceObjectKind;
  sourceInstanceName: string;
  sourceRootInstanceName: string;
  targetInstanceName: string;
  targetRootInstanceName: string;
  stablePrincipalId: string;
  stableResourceId: string;
};

export type RestoreSupportedSchemaV1 = {
  store: string;
  schemaVersion: string;
};

export type RestoreTargetInspectionV1 = {
  version: 1;
  target: RestoreTargetIdentityV1;
  provisioned: boolean;
  empty: boolean;
  writesOpen: boolean;
  availableBytes: number;
  availableItems: number;
  supportedSchemas: RestoreSupportedSchemaV1[];
};

export type RestorePhaseEvidenceV1 = {
  version: 1;
  phase: InstanceRestorePhase;
  itemCount: number;
  sizeBytes: number;
  outputDigest: string;
  unresolvedReferences: number;
  writesOpen: boolean;
  operatorWaitMs: number;
};

export type RestoreCheckpointV1 = {
  version: 1;
  operationId: string;
  archiveId: string;
  manifestChecksum: string;
  targetIdentityDigest: string;
  phase: InstanceRestorePhase;
  inputDigest: string;
  outputDigest: string;
  itemCount: number;
  sizeBytes: number;
  completedAt: string;
  state: "completed";
};

export type RestorePhaseResultV1 =
  | {
    version: 1;
    kind: "phase";
    evidence: RestorePhaseEvidenceV1;
  }
  | {
    version: 1;
    kind: "reconciliation";
    evidence: RestorePhaseEvidenceV1;
    reconciliation: RestoreReconciliationV1;
  }
  | {
    version: 1;
    kind: "acceptance";
    evidence: RestorePhaseEvidenceV1;
    acceptance: RestoreAcceptanceV1;
  };

export type RestoreTargetPhaseReceiptV1 = {
  version: 1;
  operationId: string;
  archiveId: string;
  manifestChecksum: string;
  targetIdentityDigest: string;
  phase: InstanceRestorePhase;
  inputDigest: string;
  result: RestorePhaseResultV1;
  committedAt: string;
  state: "committed";
};

export type RestoreEntryInputV1 = {
  store: string;
  sourceIdentity: string;
  targetIdentity: string;
  schemaVersion: string;
  generation: string;
  stateClass: CaptureStoreEntryV1["stateClass"];
  restoreBehavior: CaptureStoreEntryV1["restoreBehavior"];
  itemCount: number;
  sizeBytes: number;
  checksum: string;
  bytes: Uint8Array;
};

export type RestoreLegacySurfaceRegistryEntryV1 = RestoreEntryInputV1 & {
  store: "legacy_surface_registry";
  schemaVersion: typeof LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION;
  stateClass: "authoritative";
  restoreBehavior: "restore";
};

export type RestoreQueueAction = "enqueue" | "retain_failed" | "retain_dlq" | "none";

export type RestoreQueueItemV1 = {
  operationKey: string;
  sourceRootInstanceName: string;
  targetRootInstanceName: string;
  fileId: string;
  versionId: string;
  generation: number;
  status: "queued" | "extracting" | "ready" | "failed" | "deleted";
  action: RestoreQueueAction;
};

export type RestoreReconciliationV1 = {
  version: 1;
  countsMatch: true;
  checksumsMatch: true;
  referencesResolved: true;
  decryptCanaryVerified: true;
  authenticationVerified: true;
  isolationVerified: true;
  deletionVerified: true;
  conversationVerified: true;
  memoryVerified: true;
  workspaceVerified: true;
  queueVerified: true;
  unresolvedReferences: 0;
  sourceBeforeDigest: string;
  sourceAfterDigest: string;
  targetDigest: string;
};

export type RestoreAcceptanceV1 = {
  version: 1;
  passed: true;
  writesOpen: false;
  authentication: "passed";
  isolation: "passed";
  deletion: "passed";
  conversations: "passed";
  memory: "passed";
  workspace: "passed";
  queue: "passed";
};

export type RestoreDrillPhaseEvidenceV1 = {
  phase: InstanceRestorePhase;
  startedAtMs: number;
  completedAtMs: number;
  durationMs: number;
  operatorWaitMs: number;
  inputDigest: string;
  outputDigest: string;
  outcome: "completed" | "reused";
};

export type RestoreDrillEvidenceV1 = {
  schemaVersion: 1;
  kind: "isolated-restore-drill";
  status: "passed";
  commit: string;
  generatedAt: string;
  manifestChecksum: string;
  targetIdentityDigest: string;
  sourceBeforeDigest: string;
  sourceAfterDigest: string;
  targetDigest: string;
  unresolvedReferences: 0;
  loss: {
    capturedThrough: string;
    restoredThrough: string;
    lostItemCount: 0;
  };
  phases: RestoreDrillPhaseEvidenceV1[];
  totals: {
    itemCount: number;
    bytes: number;
    durationMs: number;
    operatorWaitMs: number;
  };
};

export interface InstanceRestoreCheckpointStore {
  read(operationId: string, phase: InstanceRestorePhase): Promise<unknown>;
  write(checkpoint: RestoreCheckpointV1): Promise<void>;
}

type RestoreAdapterBaseInput = {
  operationId: string;
  manifest: CaptureManifestV1;
  target: RestoreTargetIdentityV1;
  targetIdentityDigest: string;
  inputDigest: string;
};

export interface IsolatedRestoreTargetAdapter {
  inspectTarget(): Promise<unknown>;
  /** Reads the receipt atomically committed with a phase's target mutations. */
  readPhaseReceipt(input: RestoreAdapterBaseInput & { phase: InstanceRestorePhase }): Promise<unknown>;
  preflight(input: RestoreAdapterBaseInput & {
    inspection: RestoreTargetInspectionV1;
    mappings: RestoreObjectMappingV1[];
  }): Promise<unknown>;
  provision(input: RestoreAdapterBaseInput): Promise<unknown>;
  restoreEntries(input: RestoreAdapterBaseInput & {
    phase: "durable_stores" | "user_state" | "root_agent" | "conversation_agents" | "workspace_files";
    entries: RestoreEntryInputV1[];
    /** The prevalidated registry entry that the durable-stores target action must apply. */
    legacySurfaceRegistry: RestoreLegacySurfaceRegistryEntryV1 | null;
  }): Promise<unknown>;
  regenerateQueue(input: RestoreAdapterBaseInput & { items: RestoreQueueItemV1[] }): Promise<unknown>;
  reconcile(input: RestoreAdapterBaseInput & {
    entries: RestoreEntryInputV1[];
    mappings: RestoreObjectMappingV1[];
    queueItems: RestoreQueueItemV1[];
  }): Promise<unknown>;
  accept(input: RestoreAdapterBaseInput & { reconciliation: RestoreReconciliationV1 }): Promise<unknown>;
  markEligibleForCutover(input: RestoreAdapterBaseInput & { acceptance: RestoreAcceptanceV1 }): Promise<unknown>;
  discard(input: { operationId: string; target: RestoreTargetIdentityV1; targetIdentityDigest: string }): Promise<void>;
}

export type RestoreIsolatedInstanceInput = {
  operationId: string;
  archive: EncryptedCaptureArchiveV1 | unknown;
  archiveKey: Uint8Array;
  target: RestoreTargetIdentityV1;
  mappings: RestoreObjectMappingV1[];
  checkpoints: InstanceRestoreCheckpointStore;
  adapter: IsolatedRestoreTargetAdapter;
  now?: () => number;
};

export type RestoreIsolatedInstanceResult = {
  manifest: CaptureManifestV1;
  checkpoints: RestoreCheckpointV1[];
  reconciliation: RestoreReconciliationV1;
  acceptance: RestoreAcceptanceV1;
  drill: RestoreDrillEvidenceV1;
};

export class InstanceRestoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "InstanceRestoreError";
  }
}

export async function restoreIsolatedInstance(
  input: RestoreIsolatedInstanceInput,
): Promise<RestoreIsolatedInstanceResult> {
  const operationId = normalizeId(input.operationId, 160);
  const target = normalizeRestoreTargetIdentity(input.target);
  const mappings = normalizeRestoreMappings(input.mappings);
  if (!operationId || !target || !mappings) throw new InstanceRestoreError("restore_input_invalid");

  // Decrypt and verify every payload before the target adapter is allowed to inspect or mutate anything.
  const decrypted = await decryptAndValidateCaptureArchive(input.archive, input.archiveKey);
  const { manifest } = decrypted;
  const registry = parseRegistrySnapshot(findSinglePayload(decrypted.payloads, "instance_object_registry"));
  validateMappings(registry.objects, manifest, mappings);
  await validateKnownPayloads(decrypted.payloads);

  const targetIdentityDigest = await digestStable(target);
  const rawInspection = await callTarget(() => input.adapter.inspectTarget());
  const inspection = normalizeTargetInspection(rawInspection);
  if (!inspection || stableJson(inspection.target) !== stableJson(target)) {
    throw new InstanceRestoreError("restore_target_invalid");
  }
  const preflightDigestValue = {
    targetIdentityDigest,
    mappings,
    supportedSchemas: inspection.supportedSchemas,
    manifestChecksum: manifest.manifestChecksum,
  };
  const preflightInputDigest = await digestStable(preflightDigestValue);
  const resumedFromCheckpoint = await hasMatchingPreflightCheckpoint(
    input.checkpoints,
    operationId,
    manifest,
    targetIdentityDigest,
  );
  const resumedFromTarget = await hasMatchingPreflightTargetReceipt(
    input.adapter,
    { operationId, manifest, target, targetIdentityDigest, inputDigest: preflightInputDigest },
  );
  const resumed = resumedFromCheckpoint || resumedFromTarget;
  validatePreflight(manifest, target, inspection, resumed);

  const entries = decrypted.payloads.map(({ entry, bytes }) => toRestoreEntry(entry, bytes, target, mappings));
  const legacySurfaceRegistry = requireLegacySurfaceRegistryRestoreEntry(entries);
  const queueItems = await buildQueueItems(decrypted.payloads, mappings);
  const now = input.now || Date.now;
  const checkpoints: RestoreCheckpointV1[] = [];
  const measurements: RestoreDrillPhaseEvidenceV1[] = [];

  const base = { operationId, manifest, target, targetIdentityDigest };
  const execute = async (
    phase: InstanceRestorePhase,
    digestValue: unknown,
    action: (inputDigest: string) => Promise<unknown>,
  ): Promise<RestorePhaseResultV1> => {
    const inputDigest = await digestStable(digestValue);
    const expected = expectedPhaseTotals(phase, entries, queueItems);
    const result = await runCheckpointedPhase({
      phase,
      operationId,
      manifest,
      targetIdentityDigest,
      inputDigest,
      checkpoints: input.checkpoints,
      now,
      expectedItemCount: expected.itemCount,
      expectedSizeBytes: expected.sizeBytes,
      action: () => action(inputDigest),
      readReceipt: () => callTarget(() => input.adapter.readPhaseReceipt({
        ...base,
        inputDigest,
        phase,
      })),
    });
    checkpoints.push(result.checkpoint);
    measurements.push(result.measurement);
    return result.result;
  };

  await execute("preflight", preflightDigestValue,
    async (inputDigest) => callTarget(() => input.adapter.preflight({ ...base, inputDigest, inspection, mappings })));

  await execute("provision", { targetIdentityDigest, manifestChecksum: manifest.manifestChecksum },
    async (inputDigest) => callTarget(() => input.adapter.provision({ ...base, inputDigest })));

  for (const phase of [
    "durable_stores", "user_state", "root_agent", "conversation_agents", "workspace_files",
  ] as const) {
    const phaseEntries = entries.filter((entry) => (
      entry.restoreBehavior === "restore" && restorePhaseForStore(entry.store) === phase
    ));
    await execute(phase, phaseEntries.map(entryDigestProjection), async (inputDigest) => callTarget(
      () => input.adapter.restoreEntries({
        ...base,
        inputDigest,
        phase,
        entries: phaseEntries,
        legacySurfaceRegistry: phase === "durable_stores" ? legacySurfaceRegistry : null,
      }),
    ));
  }

  await execute("queue_regeneration", queueItems, async (inputDigest) => callTarget(
    () => input.adapter.regenerateQueue({ ...base, inputDigest, items: queueItems }),
  ));

  const reconciliationResult = await execute("reconciliation", {
    entries: entries.map(entryDigestProjection), mappings, queueItems,
  }, async (inputDigest) => callTarget(() => input.adapter.reconcile({
    ...base, inputDigest, entries, mappings, queueItems,
  })));
  if (reconciliationResult.kind !== "reconciliation") {
    throw new InstanceRestoreError("restore_reconciliation_failed");
  }
  const reconciliation = reconciliationResult.reconciliation;

  const acceptanceResult = await execute("acceptance", reconciliation, async (inputDigest) => callTarget(
    () => input.adapter.accept({ ...base, inputDigest, reconciliation }),
  ));
  if (acceptanceResult.kind !== "acceptance") {
    throw new InstanceRestoreError("restore_acceptance_failed");
  }
  const acceptance = acceptanceResult.acceptance;

  await execute("eligible_for_cutover", acceptance, async (inputDigest) => callTarget(
    () => input.adapter.markEligibleForCutover({ ...base, inputDigest, acceptance }),
  ));

  const generatedAtMs = normalizeNow(now());
  const generatedAt = new Date(generatedAtMs).toISOString();
  const totals = measurements.reduce((output, phase) => ({
    itemCount: output.itemCount,
    bytes: output.bytes,
    durationMs: output.durationMs + phase.durationMs,
    operatorWaitMs: output.operatorWaitMs + phase.operatorWaitMs,
  }), {
    itemCount: entries.reduce((count, entry) => count + entry.itemCount, 0),
    bytes: entries.reduce((count, entry) => count + entry.sizeBytes, 0),
    durationMs: 0,
    operatorWaitMs: 0,
  });
  return {
    manifest,
    checkpoints,
    reconciliation,
    acceptance,
    drill: {
      schemaVersion: 1,
      kind: "isolated-restore-drill",
      status: "passed",
      commit: target.commit,
      generatedAt,
      manifestChecksum: manifest.manifestChecksum,
      targetIdentityDigest,
      sourceBeforeDigest: reconciliation.sourceBeforeDigest,
      sourceAfterDigest: reconciliation.sourceAfterDigest,
      targetDigest: reconciliation.targetDigest,
      unresolvedReferences: 0,
      loss: {
        capturedThrough: manifest.capturedAt,
        restoredThrough: manifest.capturedAt,
        lostItemCount: 0,
      },
      phases: measurements,
      totals,
    },
  };
}

export async function discardIsolatedRestoreTarget(input: {
  operationId: string;
  target: RestoreTargetIdentityV1;
  adapter: IsolatedRestoreTargetAdapter;
}): Promise<void> {
  const operationId = normalizeId(input.operationId, 160);
  const target = normalizeRestoreTargetIdentity(input.target);
  if (!operationId || !target) throw new InstanceRestoreError("restore_input_invalid");
  const targetIdentityDigest = await digestStable(target);
  await callTarget(() => input.adapter.discard({ operationId, target, targetIdentityDigest }));
}

type RunCheckpointedPhaseInput = {
  phase: InstanceRestorePhase;
  operationId: string;
  manifest: CaptureManifestV1;
  targetIdentityDigest: string;
  inputDigest: string;
  checkpoints: InstanceRestoreCheckpointStore;
  now: () => number;
  expectedItemCount: number;
  expectedSizeBytes: number;
  action(): Promise<unknown>;
  readReceipt(): Promise<unknown>;
};

async function runCheckpointedPhase(input: RunCheckpointedPhaseInput): Promise<{
  checkpoint: RestoreCheckpointV1;
  result: RestorePhaseResultV1;
  measurement: RestoreDrillPhaseEvidenceV1;
}> {
  let existing: RestoreCheckpointV1 | undefined;
  try {
    const value = await input.checkpoints.read(input.operationId, input.phase);
    if (value !== undefined && value !== null) {
      existing = normalizeCheckpoint(value);
      if (!existing) throw new InstanceRestoreError("restore_checkpoint_invalid");
    }
  } catch (error) {
    if (error instanceof InstanceRestoreError) throw error;
    throw new InstanceRestoreError("restore_checkpoint_failed");
  }
  if (existing && (
    existing.operationId !== input.operationId
    || existing.archiveId !== input.manifest.archiveId
    || existing.manifestChecksum !== input.manifest.manifestChecksum
    || existing.targetIdentityDigest !== input.targetIdentityDigest
    || existing.phase !== input.phase
    || existing.inputDigest !== input.inputDigest
  )) throw new InstanceRestoreError("restore_checkpoint_conflict");
  const recovered = await readAndValidateTargetReceipt(input);
  if (existing) {
    if (!recovered) throw new InstanceRestoreError("restore_phase_receipt_missing");
    requireCheckpointMatchesReceipt(existing, recovered);
    const reusedAtMs = normalizeNow(input.now());
    return checkpointedPhaseResult(existing, recovered.result, reusedAtMs, reusedAtMs, "reused");
  }
  if (recovered) {
    const checkpoint = checkpointFromReceipt(recovered);
    await persistCheckpoint(input.checkpoints, checkpoint);
    const reusedAtMs = normalizeNow(input.now());
    return checkpointedPhaseResult(checkpoint, recovered.result, reusedAtMs, reusedAtMs, "reused");
  }

  const startedAtMs = normalizeNow(input.now());
  const actionReceipt = await normalizeAndValidateTargetReceipt(await input.action(), input);
  const persistedReceipt = await readAndValidateTargetReceipt(input);
  if (!persistedReceipt || stableJson(persistedReceipt) !== stableJson(actionReceipt)) {
    throw new InstanceRestoreError("restore_phase_receipt_diverged");
  }
  const completedAtMs = normalizeNow(input.now());
  if (completedAtMs < startedAtMs) throw new InstanceRestoreError("restore_clock_invalid");
  const checkpoint = checkpointFromReceipt(actionReceipt);
  await persistCheckpoint(input.checkpoints, checkpoint);
  return checkpointedPhaseResult(checkpoint, actionReceipt.result, startedAtMs, completedAtMs, "completed");
}

async function readAndValidateTargetReceipt(
  input: RunCheckpointedPhaseInput,
): Promise<RestoreTargetPhaseReceiptV1 | undefined> {
  const value = await input.readReceipt();
  if (value === undefined || value === null) return undefined;
  return normalizeAndValidateTargetReceipt(value, input);
}

async function normalizeAndValidateTargetReceipt(
  value: unknown,
  input: RunCheckpointedPhaseInput,
): Promise<RestoreTargetPhaseReceiptV1> {
  const receipt = normalizeTargetPhaseReceipt(value);
  if (!receipt) throw new InstanceRestoreError("restore_phase_receipt_invalid");
  if (
    receipt.operationId !== input.operationId
    || receipt.archiveId !== input.manifest.archiveId
    || receipt.manifestChecksum !== input.manifest.manifestChecksum
    || receipt.targetIdentityDigest !== input.targetIdentityDigest
    || receipt.phase !== input.phase
    || receipt.inputDigest !== input.inputDigest
  ) throw new InstanceRestoreError("restore_phase_receipt_conflict");
  if (!phaseResultMatchesPhase(receipt.result, receipt.phase)) {
    throw new InstanceRestoreError("restore_phase_receipt_invalid");
  }
  if (
    receipt.result.kind === "reconciliation"
    && await digestStable(receipt.result.reconciliation) !== receipt.result.evidence.outputDigest
  ) throw new InstanceRestoreError("restore_phase_receipt_diverged");
  if (
    receipt.result.kind === "acceptance"
    && await digestStable(receipt.result.acceptance) !== receipt.result.evidence.outputDigest
  ) throw new InstanceRestoreError("restore_phase_receipt_diverged");
  if (
    receipt.result.evidence.itemCount !== input.expectedItemCount
    || receipt.result.evidence.sizeBytes !== input.expectedSizeBytes
  ) throw new InstanceRestoreError("restore_phase_receipt_diverged");
  return receipt;
}

function expectedPhaseTotals(
  phase: InstanceRestorePhase,
  entries: RestoreEntryInputV1[],
  queueItems: RestoreQueueItemV1[],
): { itemCount: number; sizeBytes: number } {
  if (phase === "queue_regeneration") return { itemCount: queueItems.length, sizeBytes: 0 };
  if (phase === "preflight" || phase === "provision" || phase === "acceptance" || phase === "eligible_for_cutover") {
    return { itemCount: 0, sizeBytes: 0 };
  }
  const sourceEntries = phase === "reconciliation"
    ? entries
    : entries.filter((entry) => entry.restoreBehavior === "restore" && restorePhaseForStore(entry.store) === phase);
  return {
    itemCount: sourceEntries.reduce((count, entry) => count + entry.itemCount, 0),
    sizeBytes: sourceEntries.reduce((count, entry) => count + entry.sizeBytes, 0),
  };
}

function checkpointFromReceipt(receipt: RestoreTargetPhaseReceiptV1): RestoreCheckpointV1 {
  return {
    version: 1,
    operationId: receipt.operationId,
    archiveId: receipt.archiveId,
    manifestChecksum: receipt.manifestChecksum,
    targetIdentityDigest: receipt.targetIdentityDigest,
    phase: receipt.phase,
    inputDigest: receipt.inputDigest,
    outputDigest: receipt.result.evidence.outputDigest,
    itemCount: receipt.result.evidence.itemCount,
    sizeBytes: receipt.result.evidence.sizeBytes,
    completedAt: receipt.committedAt,
    state: "completed",
  };
}

function requireCheckpointMatchesReceipt(
  checkpoint: RestoreCheckpointV1,
  receipt: RestoreTargetPhaseReceiptV1,
): void {
  const recovered = checkpointFromReceipt(receipt);
  if (stableJson(checkpoint) !== stableJson(recovered)) {
    throw new InstanceRestoreError("restore_checkpoint_diverged");
  }
}

async function persistCheckpoint(
  store: InstanceRestoreCheckpointStore,
  checkpoint: RestoreCheckpointV1,
): Promise<void> {
  try {
    await store.write(checkpoint);
    const persisted = normalizeCheckpoint(await store.read(checkpoint.operationId, checkpoint.phase));
    if (!persisted || stableJson(persisted) !== stableJson(checkpoint)) {
      throw new InstanceRestoreError("restore_checkpoint_failed");
    }
  } catch (error) {
    if (error instanceof InstanceRestoreError) throw error;
    throw new InstanceRestoreError("restore_checkpoint_failed");
  }
}

function checkpointedPhaseResult(
  checkpoint: RestoreCheckpointV1,
  result: RestorePhaseResultV1,
  startedAtMs: number,
  completedAtMs: number,
  outcome: RestoreDrillPhaseEvidenceV1["outcome"],
): {
  checkpoint: RestoreCheckpointV1;
  result: RestorePhaseResultV1;
  measurement: RestoreDrillPhaseEvidenceV1;
} {
  return {
    checkpoint,
    result,
    measurement: {
      phase: checkpoint.phase,
      startedAtMs,
      completedAtMs,
      durationMs: completedAtMs - startedAtMs,
      operatorWaitMs: result.evidence.operatorWaitMs,
      inputDigest: checkpoint.inputDigest,
      outputDigest: result.evidence.outputDigest,
      outcome,
    },
  };
}

function validatePreflight(
  manifest: CaptureManifestV1,
  target: RestoreTargetIdentityV1,
  inspection: RestoreTargetInspectionV1,
  resumed: boolean,
): void {
  if (!resumed && !inspection.empty) throw new InstanceRestoreError("restore_target_not_empty");
  if (inspection.writesOpen) throw new InstanceRestoreError("restore_target_writes_open");
  const totalBytes = manifest.entries.reduce((count, entry) => count + entry.sizeBytes, 0);
  const totalItems = manifest.entries.reduce((count, entry) => count + entry.itemCount, 0);
  if (!resumed && (inspection.availableBytes < totalBytes || inspection.availableItems < totalItems)) {
    throw new InstanceRestoreError("restore_target_capacity_insufficient");
  }
  const schemas = new Set(inspection.supportedSchemas.map(({ store, schemaVersion }) => `${store}\0${schemaVersion}`));
  for (const entry of manifest.entries) {
    if (entry.restoreBehavior !== "exclude" && !schemas.has(`${entry.store}\0${entry.schemaVersion}`)) {
      throw new InstanceRestoreError("restore_target_schema_incompatible");
    }
  }
  const targetKv = target.bindings.find(({ kind, bindingName }) => kind === "kv" && bindingName === "CHAT_STORE");
  if (
    target.accountId === manifest.source.accountId
    && target.workerName === manifest.source.workerName
    && targetKv?.physicalId === manifest.source.kvNamespaceId
  ) throw new InstanceRestoreError("restore_target_not_isolated");
}

async function hasMatchingPreflightCheckpoint(
  store: InstanceRestoreCheckpointStore,
  operationId: string,
  manifest: CaptureManifestV1,
  targetIdentityDigest: string,
): Promise<boolean> {
  let value: unknown;
  try {
    value = await store.read(operationId, "preflight");
  } catch {
    throw new InstanceRestoreError("restore_checkpoint_failed");
  }
  if (value === undefined || value === null) return false;
  const checkpoint = normalizeCheckpoint(value);
  if (!checkpoint) throw new InstanceRestoreError("restore_checkpoint_invalid");
  if (
    checkpoint.operationId !== operationId
    || checkpoint.archiveId !== manifest.archiveId
    || checkpoint.manifestChecksum !== manifest.manifestChecksum
    || checkpoint.targetIdentityDigest !== targetIdentityDigest
    || checkpoint.phase !== "preflight"
  ) throw new InstanceRestoreError("restore_checkpoint_conflict");
  return true;
}

async function hasMatchingPreflightTargetReceipt(
  adapter: IsolatedRestoreTargetAdapter,
  input: RestoreAdapterBaseInput,
): Promise<boolean> {
  const value = await callTarget(() => adapter.readPhaseReceipt({ ...input, phase: "preflight" }));
  if (value === undefined || value === null) return false;
  const receipt = normalizeTargetPhaseReceipt(value);
  if (!receipt || !phaseResultMatchesPhase(receipt.result, "preflight")) {
    throw new InstanceRestoreError("restore_phase_receipt_invalid");
  }
  if (
    receipt.operationId !== input.operationId
    || receipt.archiveId !== input.manifest.archiveId
    || receipt.manifestChecksum !== input.manifest.manifestChecksum
    || receipt.targetIdentityDigest !== input.targetIdentityDigest
    || receipt.phase !== "preflight"
    || receipt.inputDigest !== input.inputDigest
  ) throw new InstanceRestoreError("restore_phase_receipt_conflict");
  return true;
}

function validateMappings(
  objects: InstanceObjectRegistrationV1[],
  manifest: CaptureManifestV1,
  mappings: RestoreObjectMappingV1[],
): void {
  const objectByKey = new Map(objects.map((object) => [objectKey(object.kind, object.instanceName), object]));
  const mappingByKey = new Map(mappings.map((mapping) => [objectKey(mapping.kind, mapping.sourceInstanceName), mapping]));
  if (objectByKey.size !== objects.length || mappingByKey.size !== mappings.length) {
    throw new InstanceRestoreError("restore_mapping_duplicate");
  }
  for (const mapping of mappings) {
    const object = objectByKey.get(objectKey(mapping.kind, mapping.sourceInstanceName));
    if (!object || object.restoreBehavior !== "restore") {
      throw new InstanceRestoreError("restore_mapping_unknown");
    }
    if (mapping.sourceRootInstanceName !== object.rootInstanceName) {
      throw new InstanceRestoreError("restore_mapping_root_conflict");
    }
  }
  for (const object of objects) {
    const sourceIdentity = objectSourceIdentity(object.kind, object.instanceName);
    const entry = manifest.entries.find((candidate) => (
      candidate.store === object.kind && candidate.sourceIdentity === sourceIdentity
    ));
    if (!entry
      || entry.schemaVersion !== object.schemaVersion
      || entry.stateClass !== object.stateClass
      || entry.restoreBehavior !== object.restoreBehavior
    ) throw new InstanceRestoreError("restore_registry_manifest_conflict");
    if (object.restoreBehavior === "restore" && !mappingByKey.has(objectKey(object.kind, object.instanceName))) {
      throw new InstanceRestoreError("restore_mapping_missing");
    }
  }
  for (const mapping of mappings.filter(({ kind }) => kind === "conversation_team_agent")) {
    const sourceRoot = mappingByKey.get(objectKey("root_team_agent", mapping.sourceRootInstanceName));
    if (
      !sourceRoot
      || sourceRoot.stablePrincipalId !== mapping.stablePrincipalId
      || sourceRoot.targetInstanceName !== mapping.targetRootInstanceName
    ) throw new InstanceRestoreError("restore_mapping_root_conflict");
  }
}

async function validateKnownPayloads(
  payloads: Array<{ entry: CaptureStoreEntryV1; bytes: Uint8Array }>,
): Promise<void> {
  try {
    for (const payload of payloads) {
      const { entry, bytes } = payload;
      if (entry.restoreBehavior === "exclude") {
        if (bytes.byteLength !== 0 || entry.itemCount < 0) throw new InstanceRestoreError("restore_payload_invalid");
        continue;
      }
      if (entry.schemaVersion === "empty-inventory-v1") {
        const value = parseStableJsonBytes(bytes);
        if (!Array.isArray(value) || value.length !== 0 || entry.itemCount !== 0) {
          throw new InstanceRestoreError("restore_payload_invalid");
        }
        continue;
      }
      if ([
        "user_state",
        "root_team_agent",
        "conversation_team_agent",
        "provider_coordinator",
        "provider_attempt_ledger",
        "identity_registry",
      ].includes(entry.store)) {
        const snapshot = decodeDurableObjectCaptureSnapshot(bytes, entry.schemaVersion);
        const itemCount = snapshot.tables.reduce((count, table) => count + table.rows.length, snapshot.storage.length);
        if (itemCount !== entry.itemCount) throw new InstanceRestoreError("restore_payload_count_mismatch");
      } else if (entry.store === "chat_store" || entry.store === "chat_store_transitional") {
        const values = parseKvEntries(bytes);
        if (values.length !== entry.itemCount) throw new InstanceRestoreError("restore_payload_count_mismatch");
      } else if (entry.store === "workspace_files") {
        const values = await parseR2Entries(bytes);
        if (values.length !== entry.itemCount) throw new InstanceRestoreError("restore_payload_count_mismatch");
      } else if (entry.store === "document_ingest_queue") {
        const values = parseDocumentIngestEvidence(bytes);
        values.regeneration.forEach(queueAction);
        if (values.regeneration.length !== entry.itemCount) {
          throw new InstanceRestoreError("restore_payload_count_mismatch");
        }
      } else if (entry.store === "instance_object_registry") {
        const value = parseRegistrySnapshot(payload);
        if (value.objects.length !== entry.itemCount) throw new InstanceRestoreError("restore_payload_count_mismatch");
      } else if (entry.store === "legacy_surface_registry") {
        const value = await parseLegacySurfaceRegistryCapture(bytes);
        if (value.itemCount !== entry.itemCount) throw new InstanceRestoreError("restore_payload_count_mismatch");
      }
    }
  } catch (error) {
    if (error instanceof InstanceRestoreError) throw error;
    if (error instanceof DurableObjectRestoreError) throw new InstanceRestoreError(error.code);
    throw new InstanceRestoreError("restore_payload_invalid");
  }
}

function toRestoreEntry(
  entry: CaptureStoreEntryV1,
  bytes: Uint8Array,
  target: RestoreTargetIdentityV1,
  mappings: RestoreObjectMappingV1[],
): RestoreEntryInputV1 {
  return {
    store: entry.store,
    sourceIdentity: entry.sourceIdentity,
    targetIdentity: targetIdentityForEntry(entry, target, mappings),
    schemaVersion: entry.schemaVersion,
    generation: entry.generation,
    stateClass: entry.stateClass,
    restoreBehavior: entry.restoreBehavior,
    itemCount: entry.itemCount,
    sizeBytes: entry.sizeBytes,
    checksum: entry.checksum,
    bytes,
  };
}

function targetIdentityForEntry(
  entry: CaptureStoreEntryV1,
  target: RestoreTargetIdentityV1,
  mappings: RestoreObjectMappingV1[],
): string {
  const parsed = parseObjectSourceIdentity(entry.sourceIdentity);
  if (parsed) {
    const mapping = mappings.find((candidate) => (
      candidate.kind === parsed.kind && candidate.sourceInstanceName === parsed.instanceName
    ));
    if (mapping) return objectSourceIdentity(mapping.kind, mapping.targetInstanceName);
    if (entry.itemCount !== 0 || entry.restoreBehavior === "restore") {
      throw new InstanceRestoreError("restore_mapping_missing");
    }
  }
  if (entry.store === "instance_object_registry") {
    return `instance-registry:${INSTANCE_MAINTENANCE_COORDINATOR}`;
  }
  if (entry.store === "legacy_surface_registry") {
    const binding = target.bindings.find(({ bindingName }) => bindingName === "INSTANCE_COORDINATOR");
    return binding
      ? `target:${binding.kind}:${binding.physicalId}:legacy_surface_registry`
      : "target:legacy_surface_registry";
  }
  const binding = targetBindingForStore(target, entry.store);
  return binding ? `target:${binding.kind}:${binding.physicalId}:${entry.store}` : `target:${entry.store}`;
}

function targetBindingForStore(
  target: RestoreTargetIdentityV1,
  store: string,
): RestoreTargetBindingV1 | undefined {
  if (store === "chat_store" || store === "chat_store_transitional" || store === "chat_store_excluded") {
    return target.bindings.find(({ bindingName }) => bindingName === "CHAT_STORE");
  }
  if (store === "workspace_files") {
    return target.bindings.find(({ bindingName }) => bindingName === "WORKSPACE_FILES");
  }
  if (store === "document_ingest_queue") {
    return target.bindings.find(({ bindingName }) => bindingName === "DOCUMENT_INGEST");
  }
  return undefined;
}

async function buildQueueItems(
  payloads: Array<{ entry: CaptureStoreEntryV1; bytes: Uint8Array }>,
  mappings: RestoreObjectMappingV1[],
): Promise<RestoreQueueItemV1[]> {
  const output: RestoreQueueItemV1[] = [];
  for (const payload of payloads.filter(({ entry }) => entry.store === "document_ingest_queue")) {
    if (payload.entry.schemaVersion === "empty-inventory-v1") continue;
    const sourceRootInstanceName = payload.entry.sourceIdentity.startsWith("document-ingest:")
      ? payload.entry.sourceIdentity.slice("document-ingest:".length)
      : "";
    const mapping = mappings.find((candidate) => (
      candidate.kind === "root_team_agent" && candidate.sourceInstanceName === sourceRootInstanceName
    ));
    const evidence = parseDocumentIngestEvidence(payload.bytes);
    if (!sourceRootInstanceName || (!mapping && evidence.regeneration.length)) {
      throw new InstanceRestoreError("restore_queue_mapping_missing");
    }
    for (const row of evidence.regeneration) {
      const action = queueAction(row);
      output.push({
        operationKey: await digestStable({
          sourceRootInstanceName,
          fileId: row.file_id,
          versionId: row.id,
          generation: row.ingest_generation,
          action,
        }),
        sourceRootInstanceName,
        targetRootInstanceName: mapping?.targetInstanceName || "",
        fileId: row.file_id,
        versionId: row.id,
        generation: row.ingest_generation,
        status: row.ingest_status,
        action,
      });
    }
  }
  output.sort((left, right) => compareStrings(left.operationKey, right.operationKey));
  if (new Set(output.map(({ operationKey }) => operationKey)).size !== output.length) {
    throw new InstanceRestoreError("restore_queue_duplicate");
  }
  return output;
}

function queueAction(row: DocumentIngestRegenerationRowV1): RestoreQueueAction {
  if (row.ingest_status === "queued") {
    if (row.ingest_error === "document_ingest_retry_exhausted") {
      throw new InstanceRestoreError("restore_queue_evidence_invalid");
    }
    return "enqueue";
  }
  if (row.ingest_status === "extracting") {
    if (row.ingest_attempts < 1 || row.ingest_error === "document_ingest_retry_exhausted") {
      throw new InstanceRestoreError("restore_queue_evidence_invalid");
    }
    return "enqueue";
  }
  if (row.ingest_status === "failed") {
    if (row.ingest_attempts < 1 || !row.ingest_error) {
      throw new InstanceRestoreError("restore_queue_evidence_invalid");
    }
    if (row.ingest_error === "document_ingest_retry_exhausted") {
      if (row.ingest_attempts < 4) throw new InstanceRestoreError("restore_queue_evidence_invalid");
      return "retain_dlq";
    }
    return "retain_failed";
  }
  return "none";
}

function restorePhaseForStore(store: string): Exclude<InstanceRestorePhase,
  "preflight" | "provision" | "queue_regeneration" | "reconciliation" | "acceptance" | "eligible_for_cutover"> {
  if (store === "user_state") return "user_state";
  if (store === "root_team_agent") return "root_agent";
  if (store === "conversation_team_agent") return "conversation_agents";
  if (store === "workspace_files") return "workspace_files";
  return "durable_stores";
}

function requireLegacySurfaceRegistryRestoreEntry(
  entries: RestoreEntryInputV1[],
): RestoreLegacySurfaceRegistryEntryV1 {
  const matches = entries.filter((entry): entry is RestoreLegacySurfaceRegistryEntryV1 => (
    entry.store === "legacy_surface_registry"
    && entry.schemaVersion === LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION
    && entry.stateClass === "authoritative"
    && entry.restoreBehavior === "restore"
  ));
  if (matches.length !== 1) throw new InstanceRestoreError("restore_legacy_surface_registry_invalid");
  return matches[0]!;
}

function entryDigestProjection(entry: RestoreEntryInputV1): Omit<RestoreEntryInputV1, "bytes"> {
  const { bytes: _bytes, ...projection } = entry;
  return projection;
}

function normalizeRestoreTargetIdentity(value: unknown): RestoreTargetIdentityV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "accountId", "workerName", "environment", "commit", "isolated", "bindings",
  ])) return undefined;
  if (
    value.version !== 1
    || !isBoundedId(value.accountId, 128)
    || !isBoundedId(value.workerName, 128)
    || !isBoundedId(value.environment, 64)
    || typeof value.commit !== "string"
    || !/^[a-f0-9]{40}$/.test(value.commit)
    || value.isolated !== true
    || !Array.isArray(value.bindings)
  ) return undefined;
  const bindings = value.bindings.map(normalizeTargetBinding);
  if (bindings.some((binding) => !binding)) return undefined;
  const normalized = bindings as RestoreTargetBindingV1[];
  if (!isStrictlySorted(normalized.map(({ bindingName }) => bindingName))) return undefined;
  const required = new Map<RestoreTargetBindingKind | string, {
    className: string;
    migrationTag: string;
  }>([
    ["kv:CHAT_STORE", { className: "", migrationTag: "" }],
    ["r2:WORKSPACE_FILES", { className: "", migrationTag: "" }],
    ["queue:DOCUMENT_INGEST", { className: "", migrationTag: "" }],
    ["dlq:DOCUMENT_INGEST_DLQ", { className: "", migrationTag: "" }],
    ["durable_object:USER_STATE", { className: "UserState", migrationTag: "v1" }],
    ["durable_object:TEAM_AGENT", { className: "TeamAgent", migrationTag: "v2" }],
    ["durable_object:PROVIDER_COORDINATOR", { className: "ProviderCoordinator", migrationTag: "v3" }],
    ["durable_object:INSTANCE_COORDINATOR", { className: "InstanceCoordinator", migrationTag: "v4" }],
    ["durable_object:PROVIDER_ATTEMPT_LEDGER", { className: "ProviderAttemptLedger", migrationTag: "v5" }],
    ["durable_object:IDENTITY_REGISTRY", { className: "IdentityRegistry", migrationTag: "v6" }],
  ]);
  if (normalized.length !== required.size) return undefined;
  for (const binding of normalized) {
    const expected = required.get(`${binding.kind}:${binding.bindingName}`);
    if (
      !expected
      || binding.className !== expected.className
      || binding.migrationTag !== expected.migrationTag
    ) return undefined;
  }
  return {
    version: 1,
    accountId: value.accountId,
    workerName: value.workerName,
    environment: value.environment,
    commit: value.commit,
    isolated: true,
    bindings: normalized,
  };
}

function normalizeTargetBinding(value: unknown): RestoreTargetBindingV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "kind", "bindingName", "physicalId", "className", "migrationTag",
  ])) return undefined;
  if (!isTargetBindingKind(value.kind)
    || !isBoundedId(value.bindingName, 80)
    || !isBoundedId(value.physicalId, 240)
    || typeof value.className !== "string"
    || typeof value.migrationTag !== "string"
  ) return undefined;
  if (value.kind === "durable_object") {
    if (!isBoundedId(value.className, 120) || !isBoundedId(value.migrationTag, 80)) return undefined;
  } else if (value.className || value.migrationTag) return undefined;
  return {
    kind: value.kind,
    bindingName: value.bindingName,
    physicalId: value.physicalId,
    className: value.className,
    migrationTag: value.migrationTag,
  };
}

function normalizeRestoreMappings(value: unknown): RestoreObjectMappingV1[] | undefined {
  if (!Array.isArray(value) || value.length > 20_000) return undefined;
  const mappings: RestoreObjectMappingV1[] = [];
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, [
      "version", "kind", "sourceInstanceName", "sourceRootInstanceName", "targetInstanceName",
      "targetRootInstanceName", "stablePrincipalId", "stableResourceId",
    ])) return undefined;
    if (
      item.version !== 1
      || !isObjectKind(item.kind)
      || !isBoundedId(item.sourceInstanceName, 160)
      || !isBoundedId(item.targetInstanceName, 160)
      || !isBoundedId(item.stablePrincipalId, 160)
      || typeof item.sourceRootInstanceName !== "string"
      || typeof item.targetRootInstanceName !== "string"
      || typeof item.stableResourceId !== "string"
    ) return undefined;
    const conversation = item.kind === "conversation_team_agent";
    if (conversation) {
      if (
        !isBoundedId(item.sourceRootInstanceName, 160)
        || !isBoundedId(item.targetRootInstanceName, 160)
        || !isBoundedId(item.stableResourceId, 160)
      ) return undefined;
    } else if (item.sourceRootInstanceName || item.targetRootInstanceName || item.stableResourceId) return undefined;
    mappings.push({
      version: 1,
      kind: item.kind,
      sourceInstanceName: item.sourceInstanceName,
      sourceRootInstanceName: item.sourceRootInstanceName,
      targetInstanceName: item.targetInstanceName,
      targetRootInstanceName: item.targetRootInstanceName,
      stablePrincipalId: item.stablePrincipalId,
      stableResourceId: item.stableResourceId,
    });
  }
  if (!isStrictlySorted(mappings.map((mapping) => objectKey(mapping.kind, mapping.sourceInstanceName)))) {
    return undefined;
  }
  const targetKeys = mappings.map((mapping) => objectKey(mapping.kind, mapping.targetInstanceName));
  if (new Set(targetKeys).size !== targetKeys.length) return undefined;
  const principalKinds = mappings
    .filter(({ kind }) => kind !== "conversation_team_agent")
    .map(({ kind, stablePrincipalId }) => `${kind}\0${stablePrincipalId}`);
  if (new Set(principalKinds).size !== principalKinds.length) return undefined;
  return mappings;
}

function normalizeTargetInspection(value: unknown): RestoreTargetInspectionV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "target", "provisioned", "empty", "writesOpen", "availableBytes",
    "availableItems", "supportedSchemas",
  ])) return undefined;
  const target = normalizeRestoreTargetIdentity(value.target);
  if (
    value.version !== 1 || !target
    || typeof value.provisioned !== "boolean"
    || typeof value.empty !== "boolean"
    || typeof value.writesOpen !== "boolean"
    || !isSafeNonNegativeInteger(value.availableBytes)
    || !isSafeNonNegativeInteger(value.availableItems)
    || !Array.isArray(value.supportedSchemas)
    || value.supportedSchemas.length > 1_000
  ) return undefined;
  const supportedSchemas: RestoreSupportedSchemaV1[] = [];
  for (const rawSchema of value.supportedSchemas) {
    if (!isRecord(rawSchema) || !hasExactKeys(rawSchema, ["store", "schemaVersion"])) return undefined;
    if (!isStore(rawSchema.store) || !isBoundedId(rawSchema.schemaVersion, 120)) return undefined;
    supportedSchemas.push({ store: rawSchema.store, schemaVersion: rawSchema.schemaVersion });
  }
  if (!isStrictlySorted(supportedSchemas.map(({ store, schemaVersion }) => `${store}\0${schemaVersion}`))) {
    return undefined;
  }
  return {
    version: 1,
    target,
    provisioned: value.provisioned,
    empty: value.empty,
    writesOpen: value.writesOpen,
    availableBytes: value.availableBytes,
    availableItems: value.availableItems,
    supportedSchemas,
  };
}

function normalizePhaseEvidence(value: unknown): RestorePhaseEvidenceV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "phase", "itemCount", "sizeBytes", "outputDigest", "unresolvedReferences",
    "writesOpen", "operatorWaitMs",
  ])) return undefined;
  if (
    value.version !== 1
    || !isRestorePhase(value.phase)
    || !isSafeNonNegativeInteger(value.itemCount)
    || !isSafeNonNegativeInteger(value.sizeBytes)
    || !isChecksum(value.outputDigest)
    || !isSafeNonNegativeInteger(value.unresolvedReferences)
    || typeof value.writesOpen !== "boolean"
    || !isSafeNonNegativeInteger(value.operatorWaitMs)
  ) return undefined;
  return {
    version: 1,
    phase: value.phase,
    itemCount: value.itemCount,
    sizeBytes: value.sizeBytes,
    outputDigest: value.outputDigest,
    unresolvedReferences: value.unresolvedReferences,
    writesOpen: value.writesOpen,
    operatorWaitMs: value.operatorWaitMs,
  };
}

function normalizePhaseResult(value: unknown): RestorePhaseResultV1 | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== "string") return undefined;
  const evidence = normalizePhaseEvidence(value.evidence);
  if (!evidence || evidence.unresolvedReferences !== 0 || evidence.writesOpen) return undefined;
  if (value.kind === "phase") {
    if (!hasExactKeys(value, ["version", "kind", "evidence"])) return undefined;
    return { version: 1, kind: "phase", evidence };
  }
  if (value.kind === "reconciliation") {
    if (!hasExactKeys(value, ["version", "kind", "evidence", "reconciliation"])) return undefined;
    const reconciliation = normalizeReconciliation(value.reconciliation);
    if (!reconciliation) return undefined;
    return { version: 1, kind: "reconciliation", evidence, reconciliation };
  }
  if (value.kind === "acceptance") {
    if (!hasExactKeys(value, ["version", "kind", "evidence", "acceptance"])) return undefined;
    const acceptance = normalizeAcceptance(value.acceptance);
    if (!acceptance) return undefined;
    return { version: 1, kind: "acceptance", evidence, acceptance };
  }
  return undefined;
}

function normalizeTargetPhaseReceipt(value: unknown): RestoreTargetPhaseReceiptV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "operationId", "archiveId", "manifestChecksum", "targetIdentityDigest", "phase",
    "inputDigest", "result", "committedAt", "state",
  ])) return undefined;
  const result = normalizePhaseResult(value.result);
  const operationId = normalizeId(value.operationId, 160);
  const archiveId = normalizeId(value.archiveId, 160);
  const committedAt = normalizeIsoTimestamp(value.committedAt);
  if (
    value.version !== 1
    || !operationId
    || !archiveId
    || !isChecksum(value.manifestChecksum)
    || !isChecksum(value.targetIdentityDigest)
    || !isRestorePhase(value.phase)
    || !isChecksum(value.inputDigest)
    || !result
    || !committedAt
    || value.state !== "committed"
  ) return undefined;
  return {
    version: 1,
    operationId,
    archiveId,
    manifestChecksum: value.manifestChecksum,
    targetIdentityDigest: value.targetIdentityDigest,
    phase: value.phase,
    inputDigest: value.inputDigest,
    result,
    committedAt,
    state: "committed",
  };
}

function phaseResultMatchesPhase(result: RestorePhaseResultV1, phase: InstanceRestorePhase): boolean {
  if (result.evidence.phase !== phase) return false;
  if (phase === "reconciliation") return result.kind === "reconciliation";
  if (phase === "acceptance") return result.kind === "acceptance";
  return result.kind === "phase";
}

function normalizeCheckpoint(value: unknown): RestoreCheckpointV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "operationId", "archiveId", "manifestChecksum", "targetIdentityDigest", "phase",
    "inputDigest", "outputDigest", "itemCount", "sizeBytes", "completedAt", "state",
  ])) return undefined;
  if (
    value.version !== 1
    || !normalizeId(value.operationId, 160)
    || !normalizeId(value.archiveId, 160)
    || !isChecksum(value.manifestChecksum)
    || !isChecksum(value.targetIdentityDigest)
    || !isRestorePhase(value.phase)
    || !isChecksum(value.inputDigest)
    || !isChecksum(value.outputDigest)
    || !isSafeNonNegativeInteger(value.itemCount)
    || !isSafeNonNegativeInteger(value.sizeBytes)
    || !normalizeIsoTimestamp(value.completedAt)
    || value.state !== "completed"
  ) return undefined;
  return value as RestoreCheckpointV1;
}

function normalizeReconciliation(value: unknown): RestoreReconciliationV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "countsMatch", "checksumsMatch", "referencesResolved", "decryptCanaryVerified",
    "authenticationVerified", "isolationVerified", "deletionVerified", "conversationVerified",
    "memoryVerified", "workspaceVerified", "queueVerified", "unresolvedReferences",
    "sourceBeforeDigest", "sourceAfterDigest", "targetDigest",
  ])) return undefined;
  const requiredTrue = [
    "countsMatch", "checksumsMatch", "referencesResolved", "decryptCanaryVerified",
    "authenticationVerified", "isolationVerified", "deletionVerified", "conversationVerified",
    "memoryVerified", "workspaceVerified", "queueVerified",
  ];
  if (
    value.version !== 1
    || requiredTrue.some((key) => value[key] !== true)
    || value.unresolvedReferences !== 0
    || !isChecksum(value.sourceBeforeDigest)
    || value.sourceAfterDigest !== value.sourceBeforeDigest
    || !isChecksum(value.targetDigest)
  ) return undefined;
  return value as RestoreReconciliationV1;
}

function normalizeAcceptance(value: unknown): RestoreAcceptanceV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "passed", "writesOpen", "authentication", "isolation", "deletion",
    "conversations", "memory", "workspace", "queue",
  ])) return undefined;
  if (
    value.version !== 1 || value.passed !== true || value.writesOpen !== false
    || ["authentication", "isolation", "deletion", "conversations", "memory", "workspace", "queue"]
      .some((key) => value[key] !== "passed")
  ) return undefined;
  return value as RestoreAcceptanceV1;
}

type RegistrySnapshotV1 = {
  version: 1;
  baselineComplete: true;
  baselineConfirmedAt: number;
  baselineInventoryId: string;
  registryDigest: string;
  objects: InstanceObjectRegistrationV1[];
};

function parseRegistrySnapshot(payload: { entry: CaptureStoreEntryV1; bytes: Uint8Array }): RegistrySnapshotV1 {
  const value = parseStableJsonBytes(payload.bytes);
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "baselineComplete", "baselineConfirmedAt", "baselineInventoryId", "registryDigest", "objects",
  ])) throw new InstanceRestoreError("restore_registry_invalid");
  if (
    value.version !== 1
    || value.baselineComplete !== true
    || !isSafeNonNegativeInteger(value.baselineConfirmedAt)
    || !isBoundedId(value.baselineInventoryId, 160)
    || !isChecksum(value.registryDigest)
    || !Array.isArray(value.objects)
    || value.objects.length > 20_000
  ) throw new InstanceRestoreError("restore_registry_invalid");
  const objects = value.objects.map(normalizeInstanceObjectRegistration);
  if (objects.some((object) => !object)) throw new InstanceRestoreError("restore_registry_invalid");
  const normalized = objects as InstanceObjectRegistrationV1[];
  const keys = normalized.map((object) => objectKey(object.kind, object.instanceName));
  if (!isStrictlySorted(keys)) throw new InstanceRestoreError("restore_registry_invalid");
  return {
    version: 1,
    baselineComplete: true,
    baselineConfirmedAt: value.baselineConfirmedAt,
    baselineInventoryId: value.baselineInventoryId,
    registryDigest: value.registryDigest,
    objects: normalized,
  };
}

type DocumentIngestRegenerationRowV1 = {
  id: string;
  file_id: string;
  object_key: string;
  checksum: string;
  state: string;
  generation: number;
  ingest_status: "queued" | "extracting" | "ready" | "failed" | "deleted";
  ingest_generation: number;
  ingest_attempts: number;
  ingest_error: string;
  extracted_object_key: string;
  extracted_checksum: string;
};

function parseDocumentIngestEvidence(bytes: Uint8Array): {
  version: 1;
  captureEpoch: string;
  source: "workspace_file_versions";
  queueBodiesEnumerable: false;
  regeneration: DocumentIngestRegenerationRowV1[];
} {
  const value = parseStableJsonBytes(bytes);
  if (!isRecord(value) || !hasExactKeys(value, [
    "version", "captureEpoch", "source", "queueBodiesEnumerable", "regeneration",
  ])) throw new InstanceRestoreError("restore_queue_evidence_invalid");
  if (
    value.version !== 1
    || !isBoundedId(value.captureEpoch, 160)
    || value.source !== "workspace_file_versions"
    || value.queueBodiesEnumerable !== false
    || !Array.isArray(value.regeneration)
    || value.regeneration.length > 250_000
  ) throw new InstanceRestoreError("restore_queue_evidence_invalid");
  const regeneration: DocumentIngestRegenerationRowV1[] = [];
  for (const row of value.regeneration) {
    if (!isRecord(row) || !hasExactKeys(row, [
      "id", "file_id", "object_key", "checksum", "state", "generation", "ingest_status",
      "ingest_generation", "ingest_attempts", "ingest_error", "extracted_object_key", "extracted_checksum",
    ])) throw new InstanceRestoreError("restore_queue_evidence_invalid");
    if (
      !isBoundedId(row.id, 160)
      || !isBoundedId(row.file_id, 160)
      || typeof row.object_key !== "string" || row.object_key.length > 2_048
      || !isChecksum(row.checksum)
      || typeof row.state !== "string" || !row.state || row.state.length > 40
      || !isSafeNonNegativeInteger(row.generation)
      || !isDocumentIngestStatus(row.ingest_status)
      || !isSafeNonNegativeInteger(row.ingest_generation)
      || !isSafeNonNegativeInteger(row.ingest_attempts)
      || typeof row.ingest_error !== "string" || row.ingest_error.length > 160
      || typeof row.extracted_object_key !== "string" || row.extracted_object_key.length > 2_048
      || (row.extracted_checksum !== "" && !isChecksum(row.extracted_checksum))
    ) throw new InstanceRestoreError("restore_queue_evidence_invalid");
    if (
      row.ingest_status === "ready"
      && (!row.extracted_object_key || !isChecksum(row.extracted_checksum) || row.ingest_error !== "")
    ) throw new InstanceRestoreError("restore_queue_evidence_invalid");
    regeneration.push(row as DocumentIngestRegenerationRowV1);
  }
  if (!isStrictlySorted(regeneration.map(({ id }) => id))) {
    throw new InstanceRestoreError("restore_queue_evidence_invalid");
  }
  return {
    version: 1,
    captureEpoch: value.captureEpoch,
    source: "workspace_file_versions",
    queueBodiesEnumerable: false,
    regeneration,
  };
}

function parseKvEntries(bytes: Uint8Array): Array<{
  key: string;
  expiration: number;
  metadata: unknown;
  value: Uint8Array;
}> {
  const value = parseStableJsonBytes(bytes);
  if (!Array.isArray(value) || value.length > 250_000) throw new InstanceRestoreError("restore_kv_payload_invalid");
  const output = value.map((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["key", "expiration", "metadata", "value"])) {
      throw new InstanceRestoreError("restore_kv_payload_invalid");
    }
    if (
      typeof entry.key !== "string" || !entry.key || entry.key.length > 2_048
      || !isSafeNonNegativeInteger(entry.expiration)
    ) throw new InstanceRestoreError("restore_kv_payload_invalid");
    const decoded = canonicalBase64ToBytes(entry.value);
    if (!decoded) throw new InstanceRestoreError("restore_kv_payload_invalid");
    return {
      key: entry.key,
      expiration: entry.expiration,
      metadata: decodeDurableObjectCaptureValue(entry.metadata),
      value: decoded,
    };
  });
  if (!isStrictlySorted(output.map(({ key }) => key))) throw new InstanceRestoreError("restore_kv_payload_invalid");
  return output;
}

async function parseR2Entries(bytes: Uint8Array): Promise<Array<{ key: string; checksum: string }>> {
  const value = parseStableJsonBytes(bytes);
  if (!Array.isArray(value) || value.length > 250_000) throw new InstanceRestoreError("restore_r2_payload_invalid");
  const output: Array<{ key: string; checksum: string }> = [];
  for (const entry of value) {
    if (!isRecord(entry) || !hasExactKeys(entry, [
      "key", "version", "size", "etag", "uploaded", "httpMetadata", "customMetadata", "checksum", "value",
    ])) throw new InstanceRestoreError("restore_r2_payload_invalid");
    if (
      typeof entry.key !== "string" || !entry.key || entry.key.length > 2_048
      || typeof entry.version !== "string" || entry.version.length > 256
      || typeof entry.etag !== "string" || entry.etag.length > 256
      || !isSafeNonNegativeInteger(entry.size)
      || !normalizeIsoTimestamp(entry.uploaded)
      || !isRecord(entry.httpMetadata)
      || !validHttpMetadata(entry.httpMetadata)
      || !isRecord(entry.customMetadata)
      || !isStringRecord(entry.customMetadata)
      || !isChecksum(entry.checksum)
    ) throw new InstanceRestoreError("restore_r2_payload_invalid");
    const decoded = canonicalBase64ToBytes(entry.value);
    if (!decoded || decoded.byteLength !== entry.size || await sha256Hex(decoded) !== entry.checksum) {
      throw new InstanceRestoreError("restore_r2_payload_invalid");
    }
    output.push({ key: entry.key, checksum: entry.checksum });
  }
  if (!isStrictlySorted(output.map(({ key }) => key))) throw new InstanceRestoreError("restore_r2_payload_invalid");
  return output;
}

function validHttpMetadata(value: Record<string, unknown>): boolean {
  const allowed = new Set([
    "contentType", "contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry",
  ]);
  return Object.keys(value).every((key) => allowed.has(key))
    && Object.entries(value).every(([key, item]) => (
      typeof item === "string" && (key !== "cacheExpiry" || Boolean(normalizeIsoTimestamp(item)))
    ));
}

function parseStableJsonBytes(bytes: Uint8Array): unknown {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new InstanceRestoreError("restore_payload_invalid");
  }
  if (stableJson(value) !== text) throw new InstanceRestoreError("restore_payload_noncanonical");
  return value;
}

export async function parseLegacySurfaceRegistryCapture(
  bytes: Uint8Array,
): Promise<LegacySurfaceRegistryCaptureV1> {
  const value = parseStableJsonBytes(bytes);
  const capture = await validateLegacySurfaceRegistryCaptureDigest(value);
  const manifestDigest = await legacySurfaceManifestDigest();
  if (
    !capture || capture.schemaVersion !== LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION
    || capture.manifestDigest !== manifestDigest
    || capture.surfaces.length !== LEGACY_SURFACE_MANIFEST.length
  ) throw new InstanceRestoreError("restore_legacy_surface_registry_invalid");
  for (let index = 0; index < LEGACY_SURFACE_MANIFEST.length; index += 1) {
    const expected = LEGACY_SURFACE_MANIFEST[index]!;
    const surface = capture.surfaces[index]!;
    if (
      surface.manifest.surfaceId !== expected.surfaceId
      || stableJson(surface.manifest) !== stableJson(expected)
      || surface.coordinatorName !== legacySurfaceObjectName(expected.surfaceId)
    ) throw new InstanceRestoreError("restore_legacy_surface_registry_invalid");
  }
  return capture;
}

export async function applyLegacySurfaceRegistryRestore(
  namespace: DurableObjectNamespace<InstanceCoordinator>,
  bytes: Uint8Array,
): Promise<{ itemCount: number; restoredSurfaces: number }> {
  const capture = await parseLegacySurfaceRegistryCapture(bytes);
  for (const snapshot of capture.surfaces) {
    const stub = namespace.getByName(snapshot.coordinatorName);
    const result = await stub.restoreLegacySurfaceState({ version: 1, snapshot });
    if (!result.ok) throw new InstanceRestoreError(result.error);
    const verified = await stub.captureLegacySurfaceState({
      version: 1,
      surfaceId: snapshot.manifest.surfaceId,
      captureEpoch: capture.captureEpoch,
      manifestDigest: capture.manifestDigest,
    });
    if (verified.snapshotDigest !== snapshot.snapshotDigest) {
      throw new InstanceRestoreError("restore_legacy_surface_registry_diverged");
    }
  }
  return { itemCount: capture.itemCount, restoredSurfaces: capture.surfaces.length };
}

function findSinglePayload(
  payloads: Array<{ entry: CaptureStoreEntryV1; bytes: Uint8Array }>,
  store: string,
): { entry: CaptureStoreEntryV1; bytes: Uint8Array } {
  const found = payloads.filter(({ entry }) => entry.store === store);
  if (found.length !== 1) throw new InstanceRestoreError("restore_payload_inventory_invalid");
  return found[0]!;
}

async function callTarget<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof InstanceRestoreError) throw error;
    throw new InstanceRestoreError("restore_target_failed");
  }
}

async function digestStable(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(stableJson(value)));
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalBase64ToBytes(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary) === value ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function objectSourceIdentity(kind: InstanceObjectKind, instanceName: string): string {
  return `do:${kind}:${instanceName}`;
}

function parseObjectSourceIdentity(value: string): { kind: InstanceObjectKind; instanceName: string } | undefined {
  const match = /^do:([a-z_]+):(.+)$/.exec(value);
  if (!match || !isObjectKind(match[1]) || !isBoundedId(match[2], 160)) return undefined;
  return { kind: match[1], instanceName: match[2] };
}

function objectKey(kind: InstanceObjectKind, instanceName: string): string {
  return `${kind}\0${instanceName}`;
}

function normalizeId(value: unknown, maxLength: number): string {
  return isBoundedId(value, maxLength) ? value : "";
}

function normalizeIsoTimestamp(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : "";
}

function normalizeNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new InstanceRestoreError("restore_clock_invalid");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isBoundedId(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && /^[A-Za-z0-9$][A-Za-z0-9$:._/-]*$/.test(value);
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isStore(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,79}$/.test(value);
}

function isTargetBindingKind(value: unknown): value is RestoreTargetBindingKind {
  return value === "kv" || value === "r2" || value === "queue" || value === "dlq" || value === "durable_object";
}

function isObjectKind(value: unknown): value is InstanceObjectKind {
  return value === "user_state" || value === "root_team_agent" || value === "conversation_team_agent"
    || value === "provider_coordinator" || value === "provider_attempt_ledger"
    || value === "identity_registry";
}

function isRestorePhase(value: unknown): value is InstanceRestorePhase {
  return typeof value === "string" && (INSTANCE_RESTORE_PHASES as readonly string[]).includes(value);
}

function isDocumentIngestStatus(value: unknown): value is DocumentIngestRegenerationRowV1["ingest_status"] {
  return value === "queued" || value === "extracting" || value === "ready"
    || value === "failed" || value === "deleted";
}

function isStrictlySorted(values: string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function isStringRecord(value: Record<string, unknown>): boolean {
  return Object.keys(value).length <= 128
    && Object.entries(value).every(([key, item]) => key.length <= 256 && typeof item === "string" && item.length <= 2_048);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
