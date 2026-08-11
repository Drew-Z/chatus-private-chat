import {
  captureInstance,
  stableJson,
  type CaptureManifestV1,
  type CaptureStoreAdapter,
  type EncryptedCaptureArchiveV1,
  type InstanceMaintenanceCoordinator,
  type InstanceMaintenanceStateV1,
  type InstanceObjectKind,
  type InstanceObjectRegistrationV1,
} from "../../src/services/instance-capture";
import {
  INSTANCE_RESTORE_PHASES,
  type InstanceRestoreCheckpointStore,
  type InstanceRestorePhase,
  type IsolatedRestoreTargetAdapter,
  type RestoreAcceptanceV1,
  type RestoreCheckpointV1,
  type RestoreEntryInputV1,
  type RestoreLegacySurfaceRegistryEntryV1,
  type RestoreObjectMappingV1,
  type RestorePhaseEvidenceV1,
  type RestorePhaseResultV1,
  type RestoreQueueItemV1,
  type RestoreReconciliationV1,
  type RestoreTargetIdentityV1,
  type RestoreTargetInspectionV1,
  type RestoreTargetPhaseReceiptV1,
} from "../../src/services/instance-restore";
import {
  LEGACY_SURFACE_MANIFEST,
  LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION,
  legacySurfaceCaptureSnapshotDigest,
  legacySurfaceManifestDigest,
  legacySurfaceObjectName,
  legacySurfaceRegistryCaptureDigest,
  type LegacySurfaceCaptureSnapshotV1,
  type LegacySurfaceRegistryCaptureV1,
} from "../../src/contracts/legacy-surface";

const FIXED_NOW = new Date("2026-08-05T12:00:00.000Z");
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const encoder = new TextEncoder();

export type QueueFixtureRow = {
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

export type RestoreFixture = {
  archive: EncryptedCaptureArchiveV1;
  archiveKey: Uint8Array;
  manifest: CaptureManifestV1;
  target: RestoreTargetIdentityV1;
  mappings: RestoreObjectMappingV1[];
  sourceDigest: string;
};

export type RecordingRestoreAdapter = IsolatedRestoreTargetAdapter & {
  calls: Map<InstanceRestorePhase | "inspect" | "discard", number>;
  actionOrder: InstanceRestorePhase[];
  receipts: Map<string, RestoreTargetPhaseReceiptV1>;
  restoredEntries: Array<{ phase: InstanceRestorePhase; entries: RestoreEntryInputV1[] }>;
  restoredLegacySurfaceRegistries: RestoreLegacySurfaceRegistryEntryV1[];
  queueItems: RestoreQueueItemV1[];
  writesOpened: boolean;
  discarded: boolean;
};

export class MemoryRestoreCheckpointStore implements InstanceRestoreCheckpointStore {
  readonly values = new Map<string, RestoreCheckpointV1>();
  failWriteOnceForPhase?: InstanceRestorePhase;

  async read(operationId: string, phase: InstanceRestorePhase): Promise<unknown> {
    return this.values.get(`${operationId}\0${phase}`);
  }

  async write(checkpoint: RestoreCheckpointV1): Promise<void> {
    if (this.failWriteOnceForPhase === checkpoint.phase) {
      this.failWriteOnceForPhase = undefined;
      throw new Error("checkpoint_write_injected");
    }
    this.values.set(`${checkpoint.operationId}\0${checkpoint.phase}`, structuredClone(checkpoint));
  }
}

export function defaultQueueRows(): QueueFixtureRow[] {
  return [
    queueRow("deleted", "deleted", 1, ""),
    queueRow("dlq", "failed", 4, "document_ingest_retry_exhausted"),
    queueRow("extracting", "extracting", 1, ""),
    queueRow("failed", "failed", 1, "document_ingest_invalid"),
    queueRow("queued", "queued", 0, ""),
    queueRow("ready", "ready", 1, ""),
  ];
}

export async function buildRestoreFixture(options: {
  principalCount?: number;
  queueRows?: QueueFixtureRow[];
} = {}): Promise<RestoreFixture> {
  const principalCount = options.principalCount ?? 1;
  const archiveKey = new Uint8Array(32).fill(7);
  const objects = fixtureObjects(principalCount);
  const queueRows = [...(options.queueRows || defaultQueueRows())]
    .sort((left, right) => compareStrings(left.id, right.id));
  const adapters = fixtureCaptureAdapters(objects, queueRows);
  const coordinator = createCaptureCoordinator();
  const result = await captureInstance({
    archiveId: `archive-${crypto.randomUUID()}`,
    keyId: "operator-key-2026-q3",
    archiveKey,
    source: {
      accountId: "source-account",
      workerName: "source-worker",
      kvNamespaceId: "a".repeat(32),
    },
    captureEpoch: `epoch-${crypto.randomUUID()}`,
    capturedAt: FIXED_NOW,
    coordinator,
    drain: async () => ({
      version: 1,
      queue: "drained",
      activeOperations: 0,
      observedAt: FIXED_NOW.getTime() + 1,
    }),
    adapters,
    persistArchive: async () => ({ evidenceId: "restore-fixture-evidence" }),
  });
  const target = fixtureTarget(result.manifest);
  return {
    archive: result.archive,
    archiveKey,
    manifest: result.manifest,
    target,
    mappings: fixtureMappings(objects),
    sourceDigest: await sha256Stable({ source: result.manifest.source, archiveId: result.manifest.archiveId }),
  };
}

export function createRecordingRestoreAdapter(
  fixture: RestoreFixture,
  options: {
    inspection?: Partial<Omit<RestoreTargetInspectionV1, "version" | "target" | "supportedSchemas">>;
    supportedSchemas?: RestoreTargetInspectionV1["supportedSchemas"];
    failAfterCommitOnceForPhase?: InstanceRestorePhase;
    restoreLegacySurfaceRegistry?: (entry: RestoreLegacySurfaceRegistryEntryV1) => Promise<void>;
  } = {},
): RecordingRestoreAdapter {
  const calls = new Map<InstanceRestorePhase | "inspect" | "discard", number>();
  const actionOrder: InstanceRestorePhase[] = [];
  const receipts = new Map<string, RestoreTargetPhaseReceiptV1>();
  const restoredEntries: RecordingRestoreAdapter["restoredEntries"] = [];
  const restoredLegacySurfaceRegistries: RestoreLegacySurfaceRegistryEntryV1[] = [];
  const queueItems: RestoreQueueItemV1[] = [];
  let failAfterCommit = options.failAfterCommitOnceForPhase;
  let nonEmpty = options.inspection?.empty === false;
  let discarded = false;
  let writesOpened = false;

  const increment = (phase: InstanceRestorePhase | "inspect" | "discard") => {
    calls.set(phase, (calls.get(phase) || 0) + 1);
  };
  const commit = async (
    phase: InstanceRestorePhase,
    input: AdapterBaseInput,
    result: RestorePhaseResultV1,
  ): Promise<RestoreTargetPhaseReceiptV1> => {
    increment(phase);
    actionOrder.push(phase);
    nonEmpty = true;
    const receipt: RestoreTargetPhaseReceiptV1 = {
      version: 1,
      operationId: input.operationId,
      archiveId: input.manifest.archiveId,
      manifestChecksum: input.manifest.manifestChecksum,
      targetIdentityDigest: input.targetIdentityDigest,
      phase,
      inputDigest: input.inputDigest,
      result,
      committedAt: new Date(FIXED_NOW.getTime() + INSTANCE_RESTORE_PHASES.indexOf(phase) + 10).toISOString(),
      state: "committed",
    };
    receipts.set(receiptKey(input.operationId, phase), structuredClone(receipt));
    if (failAfterCommit === phase) {
      failAfterCommit = undefined;
      throw new Error("phase_after_commit_injected");
    }
    return receipt;
  };
  const phaseResult = async (
    phase: InstanceRestorePhase,
    itemCount: number,
    sizeBytes: number,
    projection: unknown,
  ): Promise<RestorePhaseResultV1> => ({
    version: 1,
    kind: "phase",
    evidence: await phaseEvidence(phase, itemCount, sizeBytes, projection),
  });

  const adapter: RecordingRestoreAdapter = {
    calls,
    actionOrder,
    receipts,
    restoredEntries,
    restoredLegacySurfaceRegistries,
    queueItems,
    get writesOpened() { return writesOpened; },
    get discarded() { return discarded; },
    async inspectTarget() {
      increment("inspect");
      return {
        version: 1,
        target: fixture.target,
        provisioned: nonEmpty,
        empty: options.inspection?.empty ?? !nonEmpty,
        writesOpen: options.inspection?.writesOpen ?? false,
        availableBytes: options.inspection?.availableBytes ?? Number.MAX_SAFE_INTEGER,
        availableItems: options.inspection?.availableItems ?? Number.MAX_SAFE_INTEGER,
        supportedSchemas: options.supportedSchemas || supportedSchemas(fixture.manifest),
      } satisfies RestoreTargetInspectionV1;
    },
    async readPhaseReceipt(input) {
      return receipts.get(receiptKey(input.operationId, input.phase));
    },
    async preflight(input) {
      return commit("preflight", input, await phaseResult("preflight", 0, 0, {
        targetIdentityDigest: input.targetIdentityDigest,
        mappings: input.mappings.length,
      }));
    },
    async provision(input) {
      return commit("provision", input, await phaseResult("provision", 0, 0, input.targetIdentityDigest));
    },
    async restoreEntries(input) {
      restoredEntries.push({ phase: input.phase, entries: structuredClone(input.entries) });
      if (input.legacySurfaceRegistry) {
        restoredLegacySurfaceRegistries.push(structuredClone(input.legacySurfaceRegistry));
        await options.restoreLegacySurfaceRegistry?.(input.legacySurfaceRegistry);
      }
      const itemCount = input.entries.reduce((total, entry) => total + entry.itemCount, 0);
      const sizeBytes = input.entries.reduce((total, entry) => total + entry.sizeBytes, 0);
      return commit(input.phase, input, await phaseResult(input.phase, itemCount, sizeBytes,
        input.entries.map(({ bytes: _bytes, ...entry }) => entry)));
    },
    async regenerateQueue(input) {
      queueItems.push(...structuredClone(input.items));
      return commit("queue_regeneration", input,
        await phaseResult("queue_regeneration", input.items.length, 0, input.items));
    },
    async reconcile(input) {
      const reconciliation: RestoreReconciliationV1 = {
        version: 1,
        countsMatch: true,
        checksumsMatch: true,
        referencesResolved: true,
        decryptCanaryVerified: true,
        authenticationVerified: true,
        isolationVerified: true,
        deletionVerified: true,
        conversationVerified: true,
        memoryVerified: true,
        workspaceVerified: true,
        queueVerified: true,
        unresolvedReferences: 0,
        sourceBeforeDigest: fixture.sourceDigest,
        sourceAfterDigest: fixture.sourceDigest,
        targetDigest: await sha256Stable({
          entries: input.entries.map(({ bytes: _bytes, ...entry }) => entry),
          mappings: input.mappings,
          queueItems: input.queueItems,
        }),
      };
      const result: RestorePhaseResultV1 = {
        version: 1,
        kind: "reconciliation",
        evidence: await phaseEvidence(
          "reconciliation",
          input.entries.reduce((count, entry) => count + entry.itemCount, 0),
          input.entries.reduce((size, entry) => size + entry.sizeBytes, 0),
          reconciliation,
        ),
        reconciliation,
      };
      return commit("reconciliation", input, result);
    },
    async accept(input) {
      const acceptance: RestoreAcceptanceV1 = {
        version: 1,
        passed: true,
        writesOpen: false,
        authentication: "passed",
        isolation: "passed",
        deletion: "passed",
        conversations: "passed",
        memory: "passed",
        workspace: "passed",
        queue: "passed",
      };
      const result: RestorePhaseResultV1 = {
        version: 1,
        kind: "acceptance",
        evidence: await phaseEvidence("acceptance", 0, 0, acceptance),
        acceptance,
      };
      return commit("acceptance", input, result);
    },
    async markEligibleForCutover(input) {
      return commit("eligible_for_cutover", input,
        await phaseResult("eligible_for_cutover", 0, 0, input.acceptance));
    },
    async discard() {
      increment("discard");
      discarded = true;
      nonEmpty = false;
      writesOpened = false;
      receipts.clear();
    },
  };
  return adapter;
}

type AdapterBaseInput = {
  operationId: string;
  manifest: CaptureManifestV1;
  target: RestoreTargetIdentityV1;
  targetIdentityDigest: string;
  inputDigest: string;
};

function fixtureCaptureAdapters(
  objects: InstanceObjectRegistrationV1[],
  queueRows: QueueFixtureRow[],
): CaptureStoreAdapter[] {
  const adapters: CaptureStoreAdapter[] = [
    captureAdapter("instance_identity", "instance:source", "identity-v1", "authoritative", "restore",
      stableBytes({ version: 1, instanceId: "source-instance" }), 1),
    captureAdapter("chat_store", "kv:source", "kv-export-v1", "authoritative", "restore", stableBytes([{
      expiration: 0,
      key: "config:empty-value",
      metadata: null,
      value: "",
    }]), 1),
    captureAdapter("workspace_files", "r2:source", "r2-export-v1", "authoritative", "restore", stableBytes([{
      checksum: EMPTY_SHA256,
      customMetadata: { fixture: "empty" },
      etag: "etag-empty",
      httpMetadata: { contentType: "application/octet-stream" },
      key: "workspace/empty.bin",
      size: 0,
      uploaded: FIXED_NOW.toISOString(),
      value: "",
      version: "version-empty",
    }]), 1),
    captureAdapter("document_ingest_queue", "document-ingest:source-root-1", "queue-regeneration-v1",
      "transitional", "rebuild", stableBytes({
        version: 1,
        captureEpoch: "queue-epoch-1",
        source: "workspace_file_versions",
        queueBodiesEnumerable: false,
        regeneration: queueRows,
      }), queueRows.length),
    captureAdapter("instance_object_registry", "registry:source", "registry-v1", "authoritative", "restore",
      stableBytes({
        version: 1,
        baselineComplete: true,
        baselineConfirmedAt: FIXED_NOW.getTime(),
        baselineInventoryId: "inventory-1",
        registryDigest: "a".repeat(64),
        objects,
      }), objects.length),
    legacySurfaceFixtureAdapter(),
    captureAdapter("instance_coordinator_runtime", "coordinator:source", "runtime-v1", "transitional", "restore",
      stableBytes({ version: 1, maintenance: "released" }), 1),
  ];
  for (const object of objects) {
    adapters.push(captureAdapter(
      object.kind,
      `do:${object.kind}:${object.instanceName}`,
      object.schemaVersion,
      object.stateClass,
      object.restoreBehavior,
      durableSnapshotBytes(object.schemaVersion, object.kind),
      object.kind === "user_state" ? 1 : 0,
    ));
  }
  adapters.push(captureAdapter("ephemeral_state", "sessions-and-leases", "ephemeral-v1", "excluded", "exclude",
    new Uint8Array(), 0, "ephemeral_reauthenticate"));
  return adapters;
}

function legacySurfaceFixtureAdapter(): CaptureStoreAdapter {
  return {
    store: "legacy_surface_registry",
    async capture(captureEpoch) {
      const manifestDigest = await legacySurfaceManifestDigest();
      const surfaces: LegacySurfaceCaptureSnapshotV1[] = [];
      for (const manifest of LEGACY_SURFACE_MANIFEST) {
        const base: Omit<LegacySurfaceCaptureSnapshotV1, "snapshotDigest"> = {
          version: 1,
          schemaVersion: LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION,
          captureEpoch,
          coordinatorName: legacySurfaceObjectName(manifest.surfaceId),
          manifest,
          state: {
            version: 1,
            surfaceId: manifest.surfaceId,
            revision: 0,
            phase: "discovered",
            readControl: "enabled",
            writeControl: "enabled",
            manifestVersion: manifest.manifestVersion,
            manifestDigest,
            observationStartedAt: 0,
            observationRequiredUntil: 0,
            lastTransitionAt: 0,
            lastDeploymentSha: "",
          },
          events: [],
          operations: [],
          daily: [],
          itemCount: 2,
        };
        surfaces.push({ ...base, snapshotDigest: await legacySurfaceCaptureSnapshotDigest(base) });
      }
      const base: Omit<LegacySurfaceRegistryCaptureV1, "registryDigest"> = {
        version: 1,
        schemaVersion: LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION,
        captureEpoch,
        coordinatorBinding: "INSTANCE_COORDINATOR",
        manifestDigest,
        surfaces,
        itemCount: surfaces.reduce((total, surface) => total + surface.itemCount, 0),
      };
      const registry: LegacySurfaceRegistryCaptureV1 = {
        ...base,
        registryDigest: await legacySurfaceRegistryCaptureDigest(base),
      };
      return {
        captureEpoch,
        sourceIdentity: "legacy-surface-registry:source",
        schemaVersion: LEGACY_SURFACE_REGISTRY_SCHEMA_VERSION,
        generation: captureEpoch,
        stateClass: "authoritative",
        restoreBehavior: "restore",
        itemCount: registry.itemCount,
        bytes: stableBytes(registry),
        unresolvedReferences: 0,
        references: [],
      };
    },
  };
}

function captureAdapter(
  store: string,
  sourceIdentity: string,
  schemaVersion: string,
  stateClass: "authoritative" | "transitional" | "rebuildable" | "excluded",
  restoreBehavior: "restore" | "rebuild" | "exclude",
  bytes: Uint8Array,
  itemCount: number,
  exclusionReason = "",
): CaptureStoreAdapter {
  return {
    store,
    capture: async (captureEpoch) => ({
      captureEpoch,
      sourceIdentity,
      schemaVersion,
      generation: "generation-1",
      stateClass,
      restoreBehavior,
      itemCount,
      bytes: restoreBehavior === "exclude" ? undefined : bytes,
      exclusionReason: restoreBehavior === "exclude" ? exclusionReason : undefined,
      unresolvedReferences: 0,
      references: [],
    }),
  };
}

function fixtureObjects(principalCount: number): InstanceObjectRegistrationV1[] {
  const objects: InstanceObjectRegistrationV1[] = [];
  for (let index = 1; index <= principalCount; index += 1) {
    const root = `source-root-${index}`;
    objects.push(
      objectRegistration("conversation_team_agent", `source-conversation-${index}`, root),
      objectRegistration("root_team_agent", root, ""),
      objectRegistration("user_state", `source-user-${index}`, ""),
    );
  }
  objects.push(
    objectRegistration("identity_registry", "$identity-registry", ""),
    objectRegistration("provider_attempt_ledger", "source-provider-ledger", ""),
    objectRegistration("provider_coordinator", "source-provider", ""),
  );
  return objects.sort((left, right) => compareStrings(objectKey(left.kind, left.instanceName), objectKey(right.kind, right.instanceName)));
}

function objectRegistration(
  kind: InstanceObjectKind,
  instanceName: string,
  rootInstanceName: string,
): InstanceObjectRegistrationV1 {
  return {
    version: 1,
    kind,
    instanceName,
    rootInstanceName,
    schemaVersion: kind === "provider_attempt_ledger"
      ? "provider-attempt-ledger-v3"
      : kind === "identity_registry"
        ? "identity-registry-v2"
      : `${kind}-schema-v1`,
    stateClass: "authoritative",
    restoreBehavior: "restore",
    registeredAt: FIXED_NOW.getTime(),
  };
}

function fixtureMappings(objects: InstanceObjectRegistrationV1[]): RestoreObjectMappingV1[] {
  return objects.map((object) => {
    const principalSuffix = object.kind === "provider_coordinator"
      || object.kind === "provider_attempt_ledger"
      || object.kind === "identity_registry"
      ? object.kind.replaceAll("_", "-")
      : /-(\d+)$/.exec(object.instanceName)?.[1] || "1";
    const conversation = object.kind === "conversation_team_agent";
    return {
      version: 1,
      kind: object.kind,
      sourceInstanceName: object.instanceName,
      sourceRootInstanceName: conversation ? object.rootInstanceName : "",
      targetInstanceName: object.instanceName.replace("source-", "target-"),
      targetRootInstanceName: conversation ? object.rootInstanceName.replace("source-", "target-") : "",
      stablePrincipalId: `principal-${principalSuffix}`,
      stableResourceId: conversation ? `conversation-${principalSuffix}` : "",
    };
  }).sort((left, right) => compareStrings(objectKey(left.kind, left.sourceInstanceName), objectKey(right.kind, right.sourceInstanceName)));
}

function fixtureTarget(manifest: CaptureManifestV1): RestoreTargetIdentityV1 {
  const bindings: RestoreTargetIdentityV1["bindings"] = [
    { kind: "kv", bindingName: "CHAT_STORE", physicalId: "target-kv", className: "", migrationTag: "" },
    { kind: "queue", bindingName: "DOCUMENT_INGEST", physicalId: "target-queue", className: "", migrationTag: "" },
    { kind: "dlq", bindingName: "DOCUMENT_INGEST_DLQ", physicalId: "target-dlq", className: "", migrationTag: "" },
    { kind: "durable_object", bindingName: "IDENTITY_REGISTRY", physicalId: "target-identity-do", className: "IdentityRegistry", migrationTag: "v6" },
    { kind: "durable_object", bindingName: "INSTANCE_COORDINATOR", physicalId: "target-instance-do", className: "InstanceCoordinator", migrationTag: "v4" },
    { kind: "durable_object", bindingName: "PROVIDER_ATTEMPT_LEDGER", physicalId: "target-provider-attempt-do", className: "ProviderAttemptLedger", migrationTag: "v5" },
    { kind: "durable_object", bindingName: "PROVIDER_COORDINATOR", physicalId: "target-provider-do", className: "ProviderCoordinator", migrationTag: "v3" },
    { kind: "durable_object", bindingName: "TEAM_AGENT", physicalId: "target-team-do", className: "TeamAgent", migrationTag: "v2" },
    { kind: "durable_object", bindingName: "USER_STATE", physicalId: "target-user-do", className: "UserState", migrationTag: "v1" },
    { kind: "r2", bindingName: "WORKSPACE_FILES", physicalId: "target-r2", className: "", migrationTag: "" },
  ];
  void manifest;
  return {
    version: 1,
    accountId: "target-account",
    workerName: "target-worker",
    environment: "restore-drill",
    commit: process.env.RESTORE_DRILL_COMMIT && /^[a-f0-9]{40}$/.test(process.env.RESTORE_DRILL_COMMIT)
      ? process.env.RESTORE_DRILL_COMMIT
      : "b".repeat(40),
    isolated: true,
    bindings,
  };
}

function supportedSchemas(manifest: CaptureManifestV1): RestoreTargetInspectionV1["supportedSchemas"] {
  const unique = new Map<string, { store: string; schemaVersion: string }>();
  for (const entry of manifest.entries.filter(({ restoreBehavior }) => restoreBehavior !== "exclude")) {
    unique.set(`${entry.store}\0${entry.schemaVersion}`, { store: entry.store, schemaVersion: entry.schemaVersion });
  }
  return [...unique.values()].sort((left, right) => compareStrings(
    `${left.store}\0${left.schemaVersion}`,
    `${right.store}\0${right.schemaVersion}`,
  ));
}

function durableSnapshotBytes(schemaVersion: string, kind: InstanceObjectKind): Uint8Array {
  const tables = kind === "identity_registry"
    ? [
      {
        name: "conversation_acl_entries",
        schema: "CREATE TABLE conversation_acl_entries(resource_id TEXT NOT NULL, grantee_principal_id TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL, grant_revision INTEGER NOT NULL, revoke_revision INTEGER, granted_by_principal_id TEXT NOT NULL, revoked_by_principal_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER, PRIMARY KEY(resource_id, grantee_principal_id))",
        rows: [],
      },
      {
        name: "conversation_acl_events",
        schema: "CREATE TABLE conversation_acl_events(operation_id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, actor_principal_id TEXT, target_principal_id TEXT NOT NULL, event_type TEXT NOT NULL, before_role TEXT, after_role TEXT, access_revision INTEGER NOT NULL, occurred_at INTEGER NOT NULL)",
        rows: [],
      },
    ]
    : [];
  return stableBytes({
    version: 1,
    schemaVersion,
    tables,
    storage: kind === "user_state" ? [{ key: "empty-binary", value: { $binary: "" } }] : [],
    storageBackedTables: [],
    excludedTables: [],
  });
}

function queueRow(
  id: string,
  status: QueueFixtureRow["ingest_status"],
  attempts: number,
  error: string,
): QueueFixtureRow {
  return {
    id,
    file_id: `file-${id}`,
    object_key: `workspace/${id}`,
    checksum: "c".repeat(64),
    state: status === "deleted" ? "deleting" : "ready",
    generation: 1,
    ingest_status: status,
    ingest_generation: 1,
    ingest_attempts: attempts,
    ingest_error: error,
    extracted_object_key: `workspace/${id}/extracted/1`,
    extracted_checksum: status === "ready" ? "d".repeat(64) : "",
  };
}

function stableBytes(value: unknown): Uint8Array {
  return encoder.encode(stableJson(value));
}

async function phaseEvidence(
  phase: InstanceRestorePhase,
  itemCount: number,
  sizeBytes: number,
  projection: unknown,
): Promise<RestorePhaseEvidenceV1> {
  return {
    version: 1,
    phase,
    itemCount,
    sizeBytes,
    outputDigest: await sha256Stable(projection),
    unresolvedReferences: 0,
    writesOpen: false,
    operatorWaitMs: phase === "provision" ? 7 : 0,
  };
}

async function sha256Stable(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(stableJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function receiptKey(operationId: string, phase: InstanceRestorePhase): string {
  return `${operationId}\0${phase}`;
}

function objectKey(kind: InstanceObjectKind, instanceName: string): string {
  return `${kind}\0${instanceName}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createCaptureCoordinator(): InstanceMaintenanceCoordinator {
  let state: InstanceMaintenanceStateV1 | undefined;
  return {
    async requestMaintenance(input) {
      state = {
        version: 1,
        revision: 1,
        operationId: input.operationId,
        captureEpoch: input.captureEpoch,
        phase: "requested",
        requestedAt: input.requestedAt,
        activatedAt: 0,
        releasedAt: 0,
        outcome: "pending",
        archiveEvidenceId: "",
        lastError: "",
      };
      return { ok: true, state };
    },
    async activateMaintenance(input) {
      if (!state || input.expectedRevision !== state.revision) return { ok: false, error: "instance_maintenance_conflict" };
      state = { ...state, revision: 2, phase: "active", activatedAt: input.proof.observedAt };
      return { ok: true, state };
    },
    async releaseMaintenance(input) {
      if (!state || input.expectedRevision !== state.revision) return { ok: false, error: "instance_maintenance_conflict" };
      state = {
        ...state,
        revision: state.revision + 1,
        phase: "released",
        releasedAt: input.releasedAt,
        outcome: input.outcome,
        archiveEvidenceId: input.archiveEvidenceId || "",
        lastError: input.lastError || "",
      };
      return { ok: true, state };
    },
    async inspectMaintenance() {
      return state?.phase === "active" || state?.phase === "requested"
        ? { blocked: true, state }
        : { blocked: false, state };
    },
    async acquireOperation() { return { ok: true, activeOperations: 1 }; },
    async releaseOperation() { return { ok: true, activeOperations: 0 }; },
    async registerObject() { return { ok: false, error: "instance_object_registry_invalid" }; },
    async listRegisteredObjects() { return { ok: false, error: "instance_object_registry_invalid" }; },
    async confirmObjectRegistryBaseline() { return { ok: false, error: "instance_object_registry_invalid" }; },
  };
}
