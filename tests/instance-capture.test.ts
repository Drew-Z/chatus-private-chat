import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEAM_AGENT_SCHEMA_VERSION, type TeamAgent } from "../src/agent/team-agent";
import { IDENTITY_REGISTRY_SCHEMA_VERSION } from "../src/contracts/identity";
import { IDENTITY_REGISTRY_INSTANCE_NAME } from "../src/identity-registry";
import type { InstanceCoordinator } from "../src/instance-coordinator";
import {
  createChatStoreCaptureAdapters,
  createDocumentIngestCaptureAdapter,
  createDurableObjectCaptureAdapter,
  createRegisteredDurableObjectCaptureAdapters,
  createWorkspaceFilesCaptureAdapter,
} from "../src/services/instance-capture-adapters";
import { normalizeDurableObjectCaptureValue } from "../src/services/durable-object-capture";
import type { ProviderCoordinator } from "../src/provider-coordinator";
import { PROVIDER_ATTEMPT_LEDGER_SCHEMA_VERSION } from "../src/provider-attempt-ledger";
import { createProviderAttemptRuntime } from "../src/services/provider-attempt-runtime";
import {
  acquireInstanceOperationFence,
  captureInstance,
  decryptAndValidateCaptureArchive,
  INSTANCE_CAPTURE_REQUIRED_STORES,
  INSTANCE_MAINTENANCE_COORDINATOR,
  InstanceCaptureError,
  parseCaptureManifest,
  stableJson,
  verifyCaptureManifest,
  type CaptureStoreAdapter,
  type InstanceMaintenanceCoordinator,
  type InstanceMaintenanceStateV1,
} from "../src/services/instance-capture";
import worker, { USER_STATE_SCHEMA_VERSION, type UserState } from "../src/worker";

const ACCESS_CODES_KEY = "config:access_codes";
const encoder = new TextEncoder();

function coordinator(name = `capture-${crypto.randomUUID()}`): DurableObjectStub<InstanceCoordinator> {
  return env.INSTANCE_COORDINATOR.getByName(name);
}

function source() {
  return {
    accountId: "test-account",
    workerName: "test-worker",
    kvNamespaceId: "a".repeat(32),
  };
}

function adapters(overrides: {
  epoch?: string;
  unresolvedStore?: string;
  omitStore?: string;
  duplicate?: boolean;
} = {}): CaptureStoreAdapter[] {
  const result = INSTANCE_CAPTURE_REQUIRED_STORES
    .filter((store) => store !== overrides.omitStore)
    .map((store): CaptureStoreAdapter => ({
      store,
      capture: async (captureEpoch) => ({
        captureEpoch: store === overrides.unresolvedStore && overrides.epoch ? overrides.epoch : captureEpoch,
        sourceIdentity: `source:${store}`,
        schemaVersion: "schema-v1",
        generation: "generation-1",
        stateClass: store === "document_ingest_queue" ? "transitional" : "authoritative",
        restoreBehavior: store === "document_ingest_queue" ? "rebuild" : "restore",
        itemCount: 1,
        bytes: encoder.encode(`${store}-payload`),
        unresolvedReferences: store === overrides.unresolvedStore ? 1 : 0,
        references: store === "user_state" ? [{
          targetStore: "chat_store",
          targetSourceIdentity: "source:chat_store",
          expectedGeneration: "generation-1",
        }] : [],
      }),
    }));
  result.push({
    store: "ephemeral_state",
    capture: async (captureEpoch) => ({
      captureEpoch,
      sourceIdentity: "sessions-and-leases",
      schemaVersion: "schema-v1",
      generation: "generation-1",
      stateClass: "excluded",
      restoreBehavior: "exclude",
      itemCount: 0,
      exclusionReason: "ephemeral_reauthenticate",
      references: [],
    }),
  });
  if (overrides.duplicate) result.push(result[0]!);
  return result;
}

function captureInput(
  instance: InstanceMaintenanceCoordinator,
  overrides: Partial<Parameters<typeof captureInstance>[0]> = {},
) {
  const capturedAt = new Date("2026-08-05T12:00:00.000Z");
  return {
    archiveId: `archive-${crypto.randomUUID()}`,
    keyId: "operator-key-2026-q3",
    archiveKey: new Uint8Array(32).fill(7),
    source: source(),
    captureEpoch: `epoch-${crypto.randomUUID()}`,
    capturedAt,
    coordinator: instance,
    drain: async () => ({
      version: 1 as const,
      queue: "drained" as const,
      activeOperations: 0,
      observedAt: capturedAt.getTime() + 1,
    }),
    adapters: adapters(),
    persistArchive: async () => ({ evidenceId: "test-archive-evidence" }),
    ...overrides,
  };
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function flipBase64Byte(value: string): string {
  const bytes = fromBase64(value);
  bytes[0] = bytes[0]! ^ 1;
  return btoa(String.fromCharCode(...bytes));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function releaseIfBlocked(instance: DurableObjectStub<InstanceCoordinator>): Promise<void> {
  const inspected = await instance.inspectMaintenance();
  if (!inspected.blocked || !inspected.state || inspected.state.phase !== "active") return;
  await instance.releaseMaintenance({
    operationId: inspected.state.operationId,
    captureEpoch: inspected.state.captureEpoch,
    expectedRevision: inspected.state.revision,
    outcome: "failed",
    releasedAt: Date.now(),
    lastError: "test_cleanup",
  });
}

describe("instance capture contracts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("seals deterministic complete manifests while encrypting every persisted payload", async () => {
    const instance = coordinator();
    const key = new Uint8Array(32).fill(7);
    const input = captureInput(instance, { archiveKey: key });
    const first = await captureInstance(input);

    expect(first.manifest.requiredStores).toEqual([...INSTANCE_CAPTURE_REQUIRED_STORES].sort());
    expect(first.manifest.entries).toHaveLength(INSTANCE_CAPTURE_REQUIRED_STORES.length + 1);
    expect(first.manifest.entries.map((entry) => `${entry.store}:${entry.sourceIdentity}`))
      .toEqual([...first.manifest.entries]
        .sort((left, right) => left.store.localeCompare(right.store) || left.sourceIdentity.localeCompare(right.sourceIdentity))
        .map((entry) => `${entry.store}:${entry.sourceIdentity}`));
    expect(first.manifest.entries.find((entry) => entry.store === "ephemeral_state")).toMatchObject({
      stateClass: "excluded",
      restoreBehavior: "exclude",
      itemCount: 0,
      sizeBytes: 0,
      exclusionReason: "ephemeral_reauthenticate",
    });
    expect(parseCaptureManifest(first.manifest)).toEqual(first.manifest);
    expect(await verifyCaptureManifest(first.manifest)).toEqual(first.manifest);
    const decrypted = await decryptAndValidateCaptureArchive(clone(first.archive), key);
    expect(decrypted.manifest).toEqual(first.manifest);
    expect(decrypted.payloads.map(({ entry, bytes }) => ({
      store: entry.store,
      bytes: new TextDecoder().decode(bytes),
    }))).toContainEqual({ store: "chat_store", bytes: "chat_store-payload" });
    expect(JSON.stringify(first.archive)).not.toContain("instance_identity-payload");
    expect(JSON.stringify(first.archive)).not.toContain(btoa(String.fromCharCode(...key)));
    expect(first.archive.payloads).toHaveLength(first.manifest.entries.length);
    expect((await instance.inspectMaintenance()).blocked).toBe(false);

    const second = await captureInstance(input);
    expect(second.manifest.manifestChecksum).toBe(first.manifest.manifestChecksum);
    expect(second.archive.manifest.iv).not.toBe(first.archive.manifest.iv);
    expect(stableJson(second.manifest)).toBe(stableJson(first.manifest));
  });

  it("persists the encrypted archive before releasing maintenance as captured", async () => {
    const instance = coordinator();
    const persistArchive = vi.fn(async () => {
      await expect(instance.inspectMaintenance()).resolves.toMatchObject({
        blocked: true,
        state: { phase: "active", outcome: "pending", archiveEvidenceId: "" },
      });
      return { evidenceId: "durable-archive-receipt" };
    });
    await expect(captureInstance(captureInput(instance, { persistArchive }))).resolves.toBeDefined();
    expect(persistArchive).toHaveBeenCalledOnce();
    await expect(instance.inspectMaintenance()).resolves.toMatchObject({
      blocked: false,
      state: {
        phase: "released",
        outcome: "captured",
        archiveEvidenceId: "durable-archive-receipt",
      },
    });

    const failed = coordinator();
    await expect(captureInstance(captureInput(failed, {
      persistArchive: async () => { throw new Error("archive sink unavailable"); },
    }))).rejects.toThrow("archive sink unavailable");
    await expect(failed.inspectMaintenance()).resolves.toMatchObject({
      blocked: false,
      state: { phase: "released", outcome: "failed", archiveEvidenceId: "", lastError: "capture_failed" },
    });
  });

  it("reconciles an ambiguous fence acquisition and releases only its exact fence ID", async () => {
    let persisted: Parameters<InstanceMaintenanceCoordinator["acquireOperation"]>[0] | undefined;
    const fake = {
      acquireOperation: vi.fn(async (input: Parameters<InstanceMaintenanceCoordinator["acquireOperation"]>[0]) => {
        if (!persisted) {
          persisted = input;
          throw new Error("ambiguous rpc");
        }
        return { ok: true as const, operation: persisted, activeOperations: 1 };
      }),
      releaseOperation: vi.fn().mockResolvedValue({ ok: true, activeOperations: 0 }),
    };
    const fence = await acquireInstanceOperationFence(fake, {
      version: 1,
      operationId: "ambiguous-operation",
      kind: "provider_turn",
      startedAt: 1,
    });
    expect(fence).toBeDefined();
    expect(fake.acquireOperation).toHaveBeenCalledTimes(2);
    await fence!.release();
    expect(fake.releaseOperation).toHaveBeenCalledWith({
      operationId: "ambiguous-operation",
      fenceId: persisted!.fenceId,
      kind: "provider_turn",
    });

    const cleanup = {
      acquireOperation: vi.fn().mockRejectedValue(new Error("ambiguous acquire")),
      releaseOperation: vi.fn()
        .mockRejectedValueOnce(new Error("ambiguous cleanup"))
        .mockResolvedValueOnce({ ok: true, activeOperations: 0 }),
    };
    await expect(acquireInstanceOperationFence(cleanup, {
      version: 1,
      operationId: "ambiguous-cleanup",
      kind: "http_mutation",
      startedAt: 2,
    })).resolves.toBeUndefined();
    expect(cleanup.acquireOperation).toHaveBeenCalledTimes(2);
    expect(cleanup.releaseOperation).toHaveBeenCalledTimes(2);
    const cleanupFenceIds = cleanup.releaseOperation.mock.calls.map(([input]) => input.fenceId);
    expect(new Set(cleanupFenceIds).size).toBe(1);
  });

  it("rejects wrong keys and authenticated archive or payload tampering", async () => {
    const key = new Uint8Array(32).fill(7);
    const result = await captureInstance(captureInput(coordinator(), { archiveKey: key }));
    await expect(decryptAndValidateCaptureArchive(result.archive, new Uint8Array(32).fill(8)))
      .rejects.toMatchObject({ code: "archive_decrypt_failed" });

    const manifestCiphertext = clone(result.archive);
    manifestCiphertext.manifest.ciphertext = flipBase64Byte(manifestCiphertext.manifest.ciphertext);
    await expect(decryptAndValidateCaptureArchive(manifestCiphertext, key))
      .rejects.toMatchObject({ code: "archive_decrypt_failed" });

    const header = clone(result.archive);
    header.keyId = "operator-key-tampered";
    await expect(decryptAndValidateCaptureArchive(header, key))
      .rejects.toMatchObject({ code: "archive_decrypt_failed" });

    const payloadCiphertext = clone(result.archive);
    payloadCiphertext.payloads[0]!.blob.ciphertext = flipBase64Byte(
      payloadCiphertext.payloads[0]!.blob.ciphertext,
    );
    await expect(decryptAndValidateCaptureArchive(payloadCiphertext, key))
      .rejects.toMatchObject({ code: "archive_decrypt_failed" });

    const payloadMetadata = clone(result.archive);
    payloadMetadata.payloads[0]!.blob.plaintextChecksum = "0".repeat(64);
    await expect(decryptAndValidateCaptureArchive(payloadMetadata, key))
      .rejects.toMatchObject({ code: "archive_decrypt_failed" });

    const payloadIdentity = clone(result.archive);
    payloadIdentity.payloads[0]!.payloadId = "0".repeat(64);
    await expect(decryptAndValidateCaptureArchive(payloadIdentity, key))
      .rejects.toMatchObject({ code: "archive_payload_inventory_invalid" });

    const missingPayload = clone(result.archive);
    missingPayload.payloads.pop();
    await expect(decryptAndValidateCaptureArchive(missingPayload, key))
      .rejects.toMatchObject({ code: "capture_manifest_invalid" });
  });

  it("rejects invalid keys and incomplete store inventories before requesting maintenance", async () => {
    const invalidKeyCoordinator = coordinator();
    await expect(captureInstance(captureInput(invalidKeyCoordinator, {
      archiveKey: new Uint8Array(31),
    }))).rejects.toMatchObject({ code: "archive_key_invalid" });
    await expect(invalidKeyCoordinator.inspectMaintenance()).resolves.toEqual({ blocked: false });

    const missingCoordinator = coordinator();
    await expect(captureInstance(captureInput(missingCoordinator, {
      adapters: adapters({ omitStore: "user_state" }),
    }))).rejects.toMatchObject({ code: "capture_adapters_invalid" });
    await expect(missingCoordinator.inspectMaintenance()).resolves.toEqual({ blocked: false });
  });

  it("fails closed on cross-epoch, unresolved, and duplicate store evidence and releases maintenance", async () => {
    for (const testAdapters of [
      adapters({ unresolvedStore: "user_state", epoch: "wrong-epoch" }),
      adapters({ unresolvedStore: "workspace_files" }),
      adapters({ duplicate: true }),
    ]) {
      const instance = coordinator();
      await expect(captureInstance(captureInput(instance, { adapters: testAdapters })))
        .rejects.toBeInstanceOf(InstanceCaptureError);
      const inspection = await instance.inspectMaintenance();
      expect(inspection.blocked).toBe(false);
      expect(inspection.state).toMatchObject({ phase: "released", outcome: "failed" });
    }
  });

  it("strictly rejects unknown manifest fields and corrupt coordinator state", async () => {
    const instance = coordinator();
    const result = await captureInstance(captureInput(instance));
    expect(parseCaptureManifest({ ...result.manifest, extra: true })).toBeUndefined();
    expect(parseCaptureManifest({ ...result.manifest, manifestChecksum: "0".repeat(63) })).toBeUndefined();
    await expect(verifyCaptureManifest({
      ...result.manifest,
      capturedAt: "2026-08-05T12:00:00.001Z",
    })).resolves.toBeUndefined();
    expect(parseCaptureManifest({ ...result.manifest, archiveId: ` ${result.manifest.archiveId}` }))
      .toBeUndefined();
    expect(parseCaptureManifest({ ...result.manifest, capturedAt: "2026-08-05T12:00:00Z" }))
      .toBeUndefined();
    expect(parseCaptureManifest({
      ...result.manifest,
      requiredStores: [...result.manifest.requiredStores].reverse(),
    })).toBeUndefined();
    expect(parseCaptureManifest({
      ...result.manifest,
      entries: [...result.manifest.entries].reverse(),
    })).toBeUndefined();

    const corrupt = coordinator();
    await runInDurableObject(corrupt, async (_object, state) => {
      await state.storage.put("instance-maintenance:v1", { version: 1, phase: "active", secret: "bad" });
    });
    await expect(corrupt.inspectMaintenance()).resolves.toEqual({
      blocked: true,
      error: "instance_maintenance_state_invalid",
    });
    await expect(corrupt.requestMaintenance({
      operationId: "blocked",
      captureEpoch: "epoch-blocked",
      requestedAt: Date.now(),
    })).resolves.toEqual({ ok: false, error: "instance_maintenance_state_invalid" });
  });

  it("rejects stale structured references, invalid exclusions, and non-finite unresolved evidence", async () => {
    const staleReferenceAdapters = adapters();
    const userState = staleReferenceAdapters.find((adapter) => adapter.store === "user_state")!;
    const captureUserState = userState.capture;
    userState.capture = async (epoch) => ({
      ...await captureUserState(epoch),
      references: [{
        targetStore: "chat_store",
        targetSourceIdentity: "source:chat_store",
        expectedGeneration: "generation-stale",
      }],
    });
    await expect(captureInstance(captureInput(coordinator(), { adapters: staleReferenceAdapters })))
      .rejects.toMatchObject({ code: "capture_reference_unresolved" });

    const excludedBytes = adapters();
    const excluded = excludedBytes.find((adapter) => adapter.store === "ephemeral_state")!;
    excluded.capture = async (epoch) => ({
      captureEpoch: epoch,
      sourceIdentity: "sessions-and-leases",
      schemaVersion: "schema-v1",
      generation: "generation-1",
      stateClass: "excluded",
      restoreBehavior: "exclude",
      itemCount: 0,
      bytes: new Uint8Array(),
      exclusionReason: "ephemeral_reauthenticate",
      references: [],
    });
    await expect(captureInstance(captureInput(coordinator(), { adapters: excludedBytes })))
      .rejects.toMatchObject({ code: "capture_store_invalid" });

    const nanEvidence = adapters();
    const root = nanEvidence.find((adapter) => adapter.store === "root_team_agent")!;
    const captureRoot = root.capture;
    root.capture = async (epoch) => ({ ...await captureRoot(epoch), unresolvedReferences: Number.NaN });
    await expect(captureInstance(captureInput(coordinator(), { adapters: nanEvidence })))
      .rejects.toMatchObject({ code: "capture_store_invalid" });
  });

  it("requires an exact drained proof before activation and preserves monotonic revisions", async () => {
    const instance = coordinator();
    const requested = await instance.requestMaintenance({
      operationId: "maintenance-proof",
      captureEpoch: "epoch-proof",
      requestedAt: 1,
    });
    expect(requested).toMatchObject({ ok: true, state: { phase: "requested", revision: 1 } });
    if (!requested.ok) throw new Error("request failed");
    await expect(instance.activateMaintenance({
      operationId: "maintenance-proof",
      captureEpoch: "epoch-proof",
      expectedRevision: requested.state.revision,
      proof: { version: 1, queue: "unknown", activeOperations: 1, observedAt: 2 },
    })).resolves.toEqual({ ok: false, error: "instance_maintenance_not_drained" });
    const active = await instance.activateMaintenance({
      operationId: "maintenance-proof",
      captureEpoch: "epoch-proof",
      expectedRevision: requested.state.revision,
      proof: { version: 1, queue: "drained", activeOperations: 0, observedAt: 2 },
    });
    expect(active).toMatchObject({ ok: true, state: { phase: "active", revision: 2 } });
    if (!active.ok) throw new Error("activation failed");
    await expect(instance.activateMaintenance({
      operationId: "maintenance-proof",
      captureEpoch: "epoch-proof",
      expectedRevision: requested.state.revision,
      proof: { version: 1, queue: "drained", activeOperations: 0, observedAt: 2 },
    })).resolves.toEqual(active);
    await expect(instance.releaseMaintenance({
      operationId: "maintenance-proof",
      captureEpoch: "epoch-proof",
      expectedRevision: active.state.revision,
      outcome: "captured",
      releasedAt: 3,
      archiveEvidenceId: "test-capture-evidence",
    })).resolves.toMatchObject({
      ok: true,
      state: {
        phase: "released",
        revision: 3,
        outcome: "captured",
        archiveEvidenceId: "test-capture-evidence",
      },
    });
    await expect(instance.releaseMaintenance({
      operationId: "maintenance-proof",
      captureEpoch: "epoch-proof",
      expectedRevision: active.state.revision,
      outcome: "captured",
      releasedAt: 4,
      archiveEvidenceId: "test-capture-evidence",
    })).resolves.toMatchObject({ ok: true, state: { phase: "released", revision: 3, outcome: "captured" } });
  });

  it("derives activation drain state from durable operation fences", async () => {
    const instance = coordinator();
    await expect(instance.acquireOperation({
      version: 1,
      operationId: "active-provider-turn",
      fenceId: "provider-fence-a",
      kind: "provider_turn",
      startedAt: 1,
    })).resolves.toMatchObject({ ok: true, activeOperations: 1 });
    await expect(instance.acquireOperation({
      version: 1,
      operationId: "active-provider-turn",
      fenceId: "provider-fence-a",
      kind: "provider_turn",
      startedAt: 2,
    })).resolves.toMatchObject({ ok: true, activeOperations: 1 });
    await expect(instance.acquireOperation({
      version: 1,
      operationId: "active-provider-turn",
      fenceId: "provider-fence-b",
      kind: "provider_turn",
      startedAt: 2,
    })).resolves.toMatchObject({ ok: true, activeOperations: 2 });

    const requested = await instance.requestMaintenance({
      operationId: "maintenance-with-active-work",
      captureEpoch: "epoch-with-active-work",
      requestedAt: 2,
    });
    if (!requested.ok) throw new Error("request failed");
    await expect(instance.acquireOperation({
      version: 1,
      operationId: "late-operation",
      fenceId: "late-operation-fence",
      kind: "http_mutation",
      startedAt: 3,
    })).resolves.toEqual({ ok: false, error: "instance_maintenance_busy" });
    await expect(instance.activateMaintenance({
      operationId: requested.state.operationId,
      captureEpoch: requested.state.captureEpoch,
      expectedRevision: requested.state.revision,
      proof: { version: 1, queue: "drained", activeOperations: 0, observedAt: 3 },
    })).resolves.toEqual({ ok: false, error: "instance_maintenance_not_drained" });

    await expect(instance.releaseOperation({
      operationId: "active-provider-turn",
      fenceId: "provider-fence-a",
      kind: "provider_turn",
    })).resolves.toMatchObject({ ok: true, activeOperations: 1 });
    await expect(instance.activateMaintenance({
      operationId: requested.state.operationId,
      captureEpoch: requested.state.captureEpoch,
      expectedRevision: requested.state.revision,
      proof: { version: 1, queue: "drained", activeOperations: 0, observedAt: 4 },
    })).resolves.toEqual({ ok: false, error: "instance_maintenance_not_drained" });
    await expect(instance.releaseOperation({
      operationId: "active-provider-turn",
      fenceId: "provider-fence-b",
      kind: "provider_turn",
    })).resolves.toMatchObject({ ok: true, activeOperations: 0 });
    const active = await instance.activateMaintenance({
      operationId: requested.state.operationId,
      captureEpoch: requested.state.captureEpoch,
      expectedRevision: requested.state.revision,
      proof: { version: 1, queue: "drained", activeOperations: 0, observedAt: 4 },
    });
    expect(active).toMatchObject({ ok: true, state: { phase: "active" } });
    if (!active.ok) throw new Error("activation failed");
    await instance.releaseMaintenance({
      operationId: requested.state.operationId,
      captureEpoch: requested.state.captureEpoch,
      expectedRevision: active.state.revision,
      outcome: "failed",
      releasedAt: 5,
      lastError: "test_cleanup",
    });
  });

  it("keeps an idempotent Durable Object registry and freezes new identities during maintenance", async () => {
    const instance = coordinator();
    const registration = {
      version: 1 as const,
      kind: "root_team_agent" as const,
      instanceName: "member-registry-test",
      rootInstanceName: "",
      schemaVersion: "team-agent-v6",
      stateClass: "authoritative" as const,
      restoreBehavior: "restore" as const,
      registeredAt: 1,
    };
    await expect(instance.registerObject(registration)).resolves.toEqual({ ok: true });
    await expect(instance.registerObject({ ...registration, registeredAt: 2 })).resolves.toEqual({ ok: true });
    await expect(instance.listRegisteredObjects()).resolves.toMatchObject({
      ok: true,
      objects: [registration],
      baselineComplete: false,
      registryDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const beforeBaseline = await instance.listRegisteredObjects();
    if (!beforeBaseline.ok) throw new Error("registry read failed");
    await expect(instance.confirmObjectRegistryBaseline({
      version: 1,
      inventoryId: "external-inventory-1",
      objects: beforeBaseline.objects,
      confirmedAt: 2,
    })).resolves.toMatchObject({
      ok: true,
      objects: [registration],
      baselineComplete: true,
      baselineInventoryId: "external-inventory-1",
    });

    const laterRegistration = {
      ...registration,
      instanceName: "member-registered-after-baseline",
      registeredAt: 3,
    };
    await expect(instance.registerObject(laterRegistration)).resolves.toEqual({ ok: true });
    await expect(instance.listRegisteredObjects()).resolves.toMatchObject({
      ok: true,
      baselineComplete: false,
      objects: expect.arrayContaining([registration, laterRegistration]),
    });
    const refreshed = await instance.listRegisteredObjects();
    if (!refreshed.ok) throw new Error("registry read failed");
    await expect(instance.confirmObjectRegistryBaseline({
      version: 1,
      inventoryId: "external-inventory-2",
      objects: refreshed.objects,
      confirmedAt: 3,
    })).resolves.toMatchObject({ ok: true, baselineComplete: true });

    const requested = await instance.requestMaintenance({
      operationId: "registry-freeze",
      captureEpoch: "epoch-registry-freeze",
      requestedAt: 2,
    });
    if (!requested.ok) throw new Error("request failed");
    await expect(instance.registerObject({ ...registration, registeredAt: 3 })).resolves.toMatchObject({ ok: true });
    await expect(instance.registerObject({
      ...registration,
      instanceName: "member-new-during-maintenance",
      registeredAt: 4,
    })).resolves.toEqual({ ok: false, error: "instance_maintenance_busy" });
    await instance.releaseMaintenance({
      operationId: requested.state.operationId,
      captureEpoch: requested.state.captureEpoch,
      expectedRevision: requested.state.revision,
      outcome: "failed",
      releasedAt: 3,
      lastError: "test_cleanup",
    });
  });

  it("persists forward schema registration upgrades and invalidates the object baseline", async () => {
    const instance = coordinator();
    const registration = {
      version: 1 as const,
      kind: "root_team_agent" as const,
      instanceName: "member-schema-upgrade",
      rootInstanceName: "",
      schemaVersion: "team-agent-v6",
      stateClass: "authoritative" as const,
      restoreBehavior: "restore" as const,
      registeredAt: 1,
    };
    const initial = await instance.registerObject(registration);
    if (!initial.ok) throw new Error("registration failed");
    const initialRegistry = await instance.listRegisteredObjects();
    if (!initialRegistry.ok) throw new Error("registry read failed");
    const baseline = await instance.confirmObjectRegistryBaseline({
      version: 1,
      inventoryId: "schema-upgrade-v6",
      objects: initialRegistry.objects,
      confirmedAt: 2,
    });
    if (!baseline.ok) throw new Error("baseline confirmation failed");

    const upgraded = { ...registration, schemaVersion: "team-agent-v7", registeredAt: 3 };
    const upgradeResult = await instance.registerObject(upgraded);
    expect(upgradeResult).toEqual({ ok: true });
    if (!upgradeResult.ok) throw new Error("schema upgrade failed");
    const upgradedRegistry = await instance.listRegisteredObjects();
    expect(upgradedRegistry).toMatchObject({
      ok: true,
      objects: [upgraded],
      baselineComplete: false,
    });
    if (!upgradedRegistry.ok) throw new Error("registry read failed");
    expect(upgradedRegistry.registryDigest).not.toBe(baseline.registryDigest);
    await expect(instance.registerObject({ ...upgraded, registeredAt: 4 })).resolves.toEqual({ ok: true });
  });

  it("rejects schema registration downgrades, family changes, malformed versions, and policy drift", async () => {
    const instance = coordinator();
    const registration = {
      version: 1 as const,
      kind: "root_team_agent" as const,
      instanceName: "member-schema-conflicts",
      rootInstanceName: "",
      schemaVersion: "team-agent-v7",
      stateClass: "authoritative" as const,
      restoreBehavior: "restore" as const,
      registeredAt: 1,
    };
    await expect(instance.registerObject(registration)).resolves.toMatchObject({ ok: true });
    for (const schemaVersion of ["team-agent-v6", "other-agent-v8", "team-agent-v08", "team-agent-v0"]) {
      await expect(instance.registerObject({ ...registration, schemaVersion, registeredAt: 2 }))
        .resolves.toEqual({ ok: false, error: "instance_object_conflict" });
    }
    await expect(instance.registerObject({
      ...registration,
      schemaVersion: "team-agent-v8",
      stateClass: "rebuildable",
      restoreBehavior: "rebuild",
      registeredAt: 2,
    })).resolves.toEqual({ ok: false, error: "instance_object_conflict" });
    await expect(instance.listRegisteredObjects()).resolves.toMatchObject({
      ok: true,
      objects: [registration],
    });
  });

  it("keeps schema registration upgrades frozen while maintenance is requested or active", async () => {
    const instance = coordinator();
    const registration = {
      version: 1 as const,
      kind: "root_team_agent" as const,
      instanceName: "member-schema-maintenance",
      rootInstanceName: "",
      schemaVersion: "team-agent-v6",
      stateClass: "authoritative" as const,
      restoreBehavior: "restore" as const,
      registeredAt: 1,
    };
    await expect(instance.registerObject(registration)).resolves.toMatchObject({ ok: true });
    const requested = await instance.requestMaintenance({
      operationId: "schema-upgrade-freeze",
      captureEpoch: "epoch-schema-upgrade-freeze",
      requestedAt: 2,
    });
    if (!requested.ok) throw new Error("request failed");

    await expect(instance.registerObject({
      ...registration,
      schemaVersion: "team-agent-v7",
      registeredAt: 3,
    })).resolves.toEqual({ ok: false, error: "instance_maintenance_busy" });
    await expect(instance.registerObject({ ...registration, registeredAt: 3 })).resolves.toMatchObject({ ok: true });
    const active = await instance.activateMaintenance({
      operationId: requested.state.operationId,
      captureEpoch: requested.state.captureEpoch,
      expectedRevision: requested.state.revision,
      proof: { version: 1, queue: "drained", activeOperations: 0, observedAt: 3 },
    });
    if (!active.ok) throw new Error("activation failed");
    await expect(instance.registerObject({
      ...registration,
      schemaVersion: "team-agent-v7",
      registeredAt: 4,
    })).resolves.toEqual({ ok: false, error: "instance_maintenance_busy" });
    await expect(instance.listRegisteredObjects()).resolves.toMatchObject({
      ok: true,
      objects: [registration],
    });
    await instance.releaseMaintenance({
      operationId: requested.state.operationId,
      captureEpoch: requested.state.captureEpoch,
      expectedRevision: active.state.revision,
      outcome: "failed",
      releasedAt: 5,
      lastError: "test_cleanup",
    });
  });

  it("releases a requested maintenance boundary when drain proof fails", async () => {
    const instance = coordinator();
    await expect(captureInstance(captureInput(instance, {
      drain: async () => ({ version: 1, queue: "unknown", activeOperations: 1, observedAt: 2 }),
    }))).rejects.toMatchObject({ code: "instance_maintenance_not_drained" });
    await expect(instance.inspectMaintenance()).resolves.toMatchObject({
      blocked: false,
      state: { phase: "released", outcome: "failed", activatedAt: 0 },
    });
  });

  it("surfaces rollback failure instead of claiming that maintenance was released", async () => {
    const requestedState: InstanceMaintenanceStateV1 = {
      version: 1,
      revision: 1,
      operationId: "rollback-failure",
      captureEpoch: "epoch-rollback-failure",
      phase: "requested",
      requestedAt: 1,
      activatedAt: 0,
      releasedAt: 0,
      outcome: "pending",
      archiveEvidenceId: "",
      lastError: "",
    };
    const fake: InstanceMaintenanceCoordinator = {
      requestMaintenance: vi.fn().mockResolvedValue({ ok: true, state: requestedState }),
      activateMaintenance: vi.fn().mockResolvedValue({ ok: false, error: "instance_maintenance_not_drained" }),
      releaseMaintenance: vi.fn().mockRejectedValue(new Error("storage unavailable")),
      inspectMaintenance: vi.fn().mockResolvedValue({ blocked: true, state: requestedState }),
    };
    await expect(captureInstance(captureInput(fake, {
      archiveId: "rollback-failure",
      captureEpoch: "epoch-rollback-failure",
      coordinator: fake,
    }))).rejects.toMatchObject({ code: "instance_maintenance_release_failed" });
  });

  it("reconciles a request RPC that rejects after persisting maintenance", async () => {
    const requestedState: InstanceMaintenanceStateV1 = {
      version: 1,
      revision: 1,
      operationId: "ambiguous-request",
      captureEpoch: "epoch-ambiguous-request",
      phase: "requested",
      requestedAt: 1,
      activatedAt: 0,
      releasedAt: 0,
      outcome: "pending",
      archiveEvidenceId: "",
      lastError: "",
    };
    const fake: InstanceMaintenanceCoordinator = {
      requestMaintenance: vi.fn().mockRejectedValue(new Error("ambiguous rpc")),
      activateMaintenance: vi.fn().mockResolvedValue({ ok: false, error: "instance_maintenance_not_drained" }),
      releaseMaintenance: vi.fn().mockResolvedValue({
        ok: true,
        state: { ...requestedState, revision: 2, phase: "released", releasedAt: 2, outcome: "failed" },
      }),
      inspectMaintenance: vi.fn().mockResolvedValue({ blocked: true, state: requestedState }),
    };
    await expect(captureInstance(captureInput(fake, {
      archiveId: requestedState.operationId,
      captureEpoch: requestedState.captureEpoch,
      coordinator: fake,
    }))).rejects.toMatchObject({ code: "instance_maintenance_not_drained" });
    expect(fake.releaseMaintenance).toHaveBeenCalledWith(expect.objectContaining({
      operationId: requestedState.operationId,
      outcome: "failed",
    }));
  });

  it("rejects cyclic structured-clone values with a stable capture error", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => normalizeDurableObjectCaptureValue(value))
      .toThrowError(expect.objectContaining({ code: "capture_do_value_invalid" }));
  });

  it("rolls back drain, adapter, and encryption phase failures without returning an archive", async () => {
    const cases: Array<{
      name: string;
      overrides: (instance: DurableObjectStub<InstanceCoordinator>) => Partial<Parameters<typeof captureInstance>[0]>;
      before?: () => void;
    }> = [
      {
        name: "drain",
        overrides: () => ({ drain: async () => { throw new Error("drain unavailable"); } }),
      },
      {
        name: "adapter",
        overrides: () => ({
          adapters: adapters().map((adapter, index) => index === 0
            ? { ...adapter, capture: async () => { throw new Error("adapter unavailable"); } }
            : adapter),
        }),
      },
      {
        name: "encryption",
        overrides: () => ({}),
        before: () => {
          vi.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(new Error("encryption unavailable"));
        },
      },
    ];
    for (const testCase of cases) {
      const instance = coordinator();
      testCase.before?.();
      let result: Awaited<ReturnType<typeof captureInstance>> | undefined;
      try {
        result = await captureInstance(captureInput(instance, testCase.overrides(instance)));
      } catch {
        // Expected phase failure.
      }
      expect(result, testCase.name).toBeUndefined();
      await expect(instance.inspectMaintenance()).resolves.toMatchObject({
        blocked: false,
        state: { phase: "released", outcome: "failed" },
      });
      vi.restoreAllMocks();
    }
  });

  it("rolls back when the captured release cannot be confirmed", async () => {
    const requestedState: InstanceMaintenanceStateV1 = {
      version: 1,
      revision: 1,
      operationId: "captured-release-failure",
      captureEpoch: "epoch-captured-release-failure",
      phase: "requested",
      requestedAt: 1,
      activatedAt: 0,
      releasedAt: 0,
      outcome: "pending",
      archiveEvidenceId: "",
      lastError: "",
    };
    const activeState: InstanceMaintenanceStateV1 = {
      ...requestedState,
      revision: 2,
      phase: "active",
      activatedAt: 2,
    };
    const failedState: InstanceMaintenanceStateV1 = {
      ...activeState,
      revision: 3,
      phase: "released",
      releasedAt: 3,
      outcome: "failed",
      lastError: "instance_maintenance_release_failed",
    };
    const fake: InstanceMaintenanceCoordinator = {
      requestMaintenance: vi.fn().mockResolvedValue({ ok: true, state: requestedState }),
      activateMaintenance: vi.fn().mockResolvedValue({ ok: true, state: activeState }),
      releaseMaintenance: vi.fn()
        .mockResolvedValueOnce({ ok: false, error: "instance_maintenance_conflict" })
        .mockResolvedValueOnce({ ok: true, state: failedState }),
      inspectMaintenance: vi.fn().mockResolvedValue({ blocked: true, state: activeState }),
    };
    let result: Awaited<ReturnType<typeof captureInstance>> | undefined;
    await expect((async () => {
      result = await captureInstance(captureInput(fake, {
        archiveId: requestedState.operationId,
        captureEpoch: requestedState.captureEpoch,
        coordinator: fake,
      }));
    })()).rejects.toMatchObject({ code: "instance_maintenance_release_failed" });
    expect(result).toBeUndefined();
    expect(fake.releaseMaintenance).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "failed" }));
  });

  it("exposes explicit UserState and TeamAgent schema versions for capture inventory", async () => {
    const userStateName = `capture-schema-${crypto.randomUUID()}`;
    const userState = env.USER_STATE.getByName(userStateName) as DurableObjectStub<UserState>;
    await expect(userState.getCaptureSchemaVersion()).resolves.toBe(`user-state-v${USER_STATE_SCHEMA_VERSION}`);
    const userSnapshot = await userState.captureInstanceState("epoch-user-state");
    const userEnvelope = JSON.parse(new TextDecoder().decode(userSnapshot.bytes)) as {
      schemaVersion: string;
      tables: Array<{ name: string }>;
    };
    expect(userEnvelope.schemaVersion).toBe(`user-state-v${USER_STATE_SCHEMA_VERSION}`);
    expect(userEnvelope.tables.map(({ name: table }) => table)).toContain("mcp_oauth_tokens");

    const name = `capture-schema-${crypto.randomUUID()}`;
    const props = {
      userLabel: name,
      scope: "root" as const,
      accessKind: "member" as const,
      sessionExpiresAt: Number.MAX_SAFE_INTEGER,
    };
    const root = await getAgentByName(env.TEAM_AGENT, name, { props }) as DurableObjectStub<TeamAgent>;
    await expect(root.getCaptureSchemaVersion()).resolves.toBe(`team-agent-v${TEAM_AGENT_SCHEMA_VERSION}`);
    const teamSnapshot = await root.captureInstanceState("epoch-team-agent");
    const teamEnvelope = JSON.parse(new TextDecoder().decode(teamSnapshot.bytes)) as {
      schemaVersion: string;
      tables: Array<{ name: string }>;
      storage: Array<{ key: string }>;
    };
    expect(teamEnvelope.schemaVersion).toBe(`team-agent-v${TEAM_AGENT_SCHEMA_VERSION}`);
    expect(teamEnvelope.tables.map(({ name: table }) => table)).toEqual(expect.arrayContaining([
      "chatus_conversations",
      "cf_ai_chat_agent_messages",
      "cf_agents_schedules",
    ]));
    expect(teamEnvelope.storage.map(({ key }) => key)).toContain("chatus:agent-identity:v1");
    const providerName = `capture-provider-schema-${crypto.randomUUID()}`;
    const provider = env.PROVIDER_COORDINATOR.getByName(providerName) as DurableObjectStub<ProviderCoordinator>;
    await expect(provider.captureInstanceState("epoch-provider-schema"))
      .resolves.toMatchObject({ schemaVersion: "provider-coordinator-v1" });
    const providerLedgerName = `capture-provider-ledger-${crypto.randomUUID()}`;
    const providerAttempts = createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: "required",
      operation: {
        version: 1,
        operationId: `capture-provider-turn-${crypto.randomUUID()}`,
        fenceId: crypto.randomUUID(),
        kind: "provider_turn",
        startedAt: Date.now(),
      },
    });
    const providerAttempt = await providerAttempts.createRun("main_answer").start({
      logicalRouteId: "capture-route",
      providerId: providerLedgerName,
      model: "capture-model",
      credentialClass: "managed",
      fallbackIndex: 0,
    });
    await providerAttempt.succeed();
    const providerLedgerSnapshot = await env.PROVIDER_ATTEMPT_LEDGER
      .getByName(providerLedgerName)
      .captureInstanceState("epoch-provider-ledger");
    expect(providerLedgerSnapshot).toMatchObject({
      schemaVersion: `provider-attempt-ledger-v${PROVIDER_ATTEMPT_LEDGER_SCHEMA_VERSION}`,
    });
    const providerLedgerEnvelope = JSON.parse(new TextDecoder().decode(providerLedgerSnapshot.bytes)) as {
      schemaVersion: string;
      tables: Array<{ name: string }>;
    };
    expect(providerLedgerEnvelope.tables.map(({ name: table }) => table)).toEqual(expect.arrayContaining([
      "provider_budget_policies",
      "provider_budget_events",
      "provider_budget_decisions",
      "provider_budget_reservations",
      "provider_budget_projection",
    ]));
    const registry = await coordinator(INSTANCE_MAINTENANCE_COORDINATOR).listRegisteredObjects();
    expect(registry).toMatchObject({
      ok: true,
      objects: expect.arrayContaining([
        expect.objectContaining({ kind: "user_state", instanceName: userStateName }),
        expect.objectContaining({ kind: "root_team_agent", instanceName: name }),
        expect.objectContaining({ kind: "provider_coordinator", instanceName: providerName }),
        expect.objectContaining({ kind: "provider_attempt_ledger", instanceName: providerLedgerName }),
      ]),
    });
  });

  it("keeps rebuildable UserState instances out of the durable object recovery registry", async () => {
    const registry = coordinator(INSTANCE_MAINTENANCE_COORDINATOR);
    const before = await registry.listRegisteredObjects();
    if (!before.ok) throw new Error("registry read failed");
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const names = [
      `login:admin:${suffix.padEnd(64, "0")}`,
      `guest-source:${suffix.padEnd(64, "0")}`,
      `guest-${suffix}`,
    ];
    for (const name of names) {
      const state = env.USER_STATE.getByName(name) as DurableObjectStub<UserState>;
      await expect(state.getLoginThrottle(Date.now(), 5, 60_000)).resolves.toEqual({ ok: true, retryAfter: 0 });
    }
    await expect(registry.listRegisteredObjects()).resolves.toEqual(before);
  });

  it("captures deterministic KV classes without persisting excluded session payloads", async () => {
    const suffix = crypto.randomUUID();
    const keys = {
      durable: `config:capture-test-${suffix}`,
      transitional: `chats:capture-test-${suffix}:index`,
      excluded: `session:capture-test-${suffix}`,
    };
    await Promise.all([
      env.CHAT_STORE.put(keys.durable, "durable-value"),
      env.CHAT_STORE.put(keys.transitional, "transitional-value"),
      env.CHAT_STORE.put(keys.excluded, "must-not-enter-payload"),
    ]);
    try {
      const captureAdapters = createChatStoreCaptureAdapters(env.CHAT_STORE, "kv:test");
      const [durable, transitional, excluded] = await Promise.all(
        captureAdapters.map((adapter) => adapter.capture("epoch-kv-adapter")),
      );
      const durableEntries = JSON.parse(new TextDecoder().decode(durable!.bytes)) as Array<{ key: string }>;
      const transitionalEntries = JSON.parse(
        new TextDecoder().decode(transitional!.bytes),
      ) as Array<{ key: string }>;
      expect(durableEntries).toContainEqual(expect.objectContaining({ key: keys.durable }));
      expect(transitionalEntries).toContainEqual(expect.objectContaining({ key: keys.transitional }));
      expect(excluded).toMatchObject({
        stateClass: "excluded",
        restoreBehavior: "exclude",
      });
      expect(excluded!.bytes).toBeUndefined();
      expect(JSON.stringify([durableEntries, transitionalEntries])).not.toContain("must-not-enter-payload");
    } finally {
      await Promise.all(Object.values(keys).map((key) => env.CHAT_STORE.delete(key)));
    }
  });

  it("captures queued, extracting, failed, and DLQ regeneration evidence without duplicates", async () => {
    const suffix = crypto.randomUUID();
    const label = `capture-queue-${suffix}`;
    const root = await getAgentByName(env.TEAM_AGENT, label, {
      props: {
        userLabel: label,
        scope: "root" as const,
        accessKind: "member" as const,
        sessionExpiresAt: Number.MAX_SAFE_INTEGER,
      },
    }) as DurableObjectStub<TeamAgent>;
    await root.getCaptureSchemaVersion();
    const rows = [
      { id: `queued-${suffix}`, status: "queued", attempts: 0, error: "" },
      { id: `extracting-${suffix}`, status: "extracting", attempts: 1, error: "" },
      { id: `failed-${suffix}`, status: "failed", attempts: 1, error: "document_ingest_invalid" },
      { id: `dlq-${suffix}`, status: "failed", attempts: 4, error: "document_ingest_retry_exhausted" },
    ];
    await runInDurableObject(root, async (_object, state) => {
      for (const [index, row] of rows.entries()) {
        state.storage.sql.exec(
          `INSERT INTO workspace_file_versions(
            id, file_id, object_key, size, media_type, checksum, state, generation, error,
            ingest_status, ingest_generation, ingest_attempts, ingest_error,
            extracted_object_key, extracted_checksum, extracted_bytes, extracted_chars,
            created_at, updated_at
          ) VALUES (?, ?, ?, 1, 'text/plain', ?, 'ready', 1, '', ?, 1, ?, ?, ?, '', 0, 0, ?, ?)`,
          row.id,
          `file-${index}-${suffix}`,
          `workspace/test/${row.id}`,
          "a".repeat(64),
          row.status,
          row.attempts,
          row.error,
          `workspace/test/${row.id}/extracted/1`,
          index + 1,
          index + 1,
        );
      }
    });
    const evidence = await createDocumentIngestCaptureAdapter(root, `document-ingest:${label}`)
      .capture(`epoch-queue-${suffix}`);
    const payload = JSON.parse(new TextDecoder().decode(evidence.bytes)) as {
      queueBodiesEnumerable: boolean;
      regeneration: Array<{ id: string; ingest_status: string; ingest_attempts: number; ingest_error: string }>;
    };
    expect(payload.queueBodiesEnumerable).toBe(false);
    expect(payload.regeneration).toHaveLength(4);
    expect(new Set(payload.regeneration.map(({ id }) => id)).size).toBe(4);
    expect(payload.regeneration.map(({ ingest_status }) => ingest_status).sort())
      .toEqual(["extracting", "failed", "failed", "queued"]);
    expect(payload.regeneration.find(({ id }) => id.startsWith("dlq-"))).toMatchObject({
      ingest_status: "failed",
      ingest_attempts: 4,
      ingest_error: "document_ingest_retry_exhausted",
    });
  });

  it("fails closed on unknown KV keys and captures exact R2 object bytes and metadata", async () => {
    const suffix = crypto.randomUUID();
    const unknownKey = `unknown-capture-test:${suffix}`;
    await env.CHAT_STORE.put(unknownKey, "unknown");
    try {
      await expect(createChatStoreCaptureAdapters(env.CHAT_STORE, "kv:test")[0]!.capture("epoch-unknown"))
        .rejects.toMatchObject({ code: "capture_kv_key_unknown" });
    } finally {
      await env.CHAT_STORE.delete(unknownKey);
    }

    const objectKey = `capture-test/${suffix}.txt`;
    await env.WORKSPACE_FILES.put(objectKey, "workspace-capture", {
      httpMetadata: { contentType: "text/plain", cacheControl: "no-store" },
      customMetadata: { format: "test" },
    });
    try {
      const result = await createWorkspaceFilesCaptureAdapter(env.WORKSPACE_FILES, "r2:test")
        .capture("epoch-r2-adapter");
      const objects = JSON.parse(new TextDecoder().decode(result.bytes)) as Array<{
        key: string;
        value: string;
        checksum: string;
        httpMetadata: { contentType?: string };
        customMetadata: Record<string, string>;
      }>;
      expect(objects).toContainEqual(expect.objectContaining({
        key: objectKey,
        value: btoa("workspace-capture"),
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        httpMetadata: expect.objectContaining({ contentType: "text/plain" }),
        customMetadata: { format: "test" },
      }));
    } finally {
      await env.WORKSPACE_FILES.delete(objectKey);
    }
  });

  it("seals and independently verifies an explicit real-store inventory", async () => {
    const suffix = crypto.randomUUID();
    const epoch = `epoch-real-${suffix}`;
    const label = `capture-real-${suffix}`;
    const rootName = `capture-root-${suffix}`;
    const conversationName = `capture-conversation-${suffix}`;
    const rootProps = {
      userLabel: label,
      scope: "root" as const,
      accessKind: "member" as const,
      sessionExpiresAt: Number.MAX_SAFE_INTEGER,
    };
    const conversationProps = {
      ...rootProps,
      scope: "conversation" as const,
      chatId: `chat-${suffix}`,
      rootInstance: rootName,
    };
    const root = await getAgentByName(env.TEAM_AGENT, rootName, { props: rootProps }) as DurableObjectStub<TeamAgent>;
    const conversation = await getAgentByName(
      env.TEAM_AGENT,
      conversationName,
      { props: conversationProps },
    ) as DurableObjectStub<TeamAgent>;
    const userState = env.USER_STATE.getByName(label) as DurableObjectStub<UserState>;
    const provider = env.PROVIDER_COORDINATOR.getByName(
      `capture-provider-${suffix}`,
    ) as DurableObjectStub<ProviderCoordinator>;
    const registryName = `capture-registry-${suffix}`;
    const registry = coordinator(registryName);
    for (const registration of [
      {
        version: 1 as const,
        kind: "user_state" as const,
        instanceName: label,
        rootInstanceName: "",
        schemaVersion: `user-state-v${USER_STATE_SCHEMA_VERSION}`,
        stateClass: "authoritative" as const,
        restoreBehavior: "restore" as const,
        registeredAt: 1,
      },
      {
        version: 1 as const,
        kind: "root_team_agent" as const,
        instanceName: rootName,
        rootInstanceName: "",
        schemaVersion: `team-agent-v${TEAM_AGENT_SCHEMA_VERSION}`,
        stateClass: "authoritative" as const,
        restoreBehavior: "restore" as const,
        registeredAt: 1,
      },
      {
        version: 1 as const,
        kind: "conversation_team_agent" as const,
        instanceName: conversationName,
        rootInstanceName: rootName,
        schemaVersion: `team-agent-v${TEAM_AGENT_SCHEMA_VERSION}`,
        stateClass: "authoritative" as const,
        restoreBehavior: "restore" as const,
        registeredAt: 1,
      },
      {
        version: 1 as const,
        kind: "identity_registry" as const,
        instanceName: IDENTITY_REGISTRY_INSTANCE_NAME,
        rootInstanceName: "",
        schemaVersion: `identity-registry-v${IDENTITY_REGISTRY_SCHEMA_VERSION}` as const,
        stateClass: "authoritative" as const,
        restoreBehavior: "restore" as const,
        registeredAt: 1,
      },
    ]) {
      const registered = await registry.registerObject(registration);
      expect(registered.ok).toBe(true);
    }
    await expect(createRegisteredDurableObjectCaptureAdapters(env, registryName))
      .rejects.toMatchObject({ code: "capture_object_registry_incomplete" });
    const initialRegistry = await registry.listRegisteredObjects();
    if (!initialRegistry.ok) throw new Error("registry read failed");
    await expect(registry.confirmObjectRegistryBaseline({
      version: 1,
      inventoryId: `external-inventory-initial-${suffix}`,
      objects: initialRegistry.objects,
      confirmedAt: 2,
    })).resolves.toMatchObject({ ok: true, baselineComplete: true });
    const staleRegisteredAdapters = await createRegisteredDurableObjectCaptureAdapters(env, registryName);
    const lateRegistration = {
      version: 1 as const,
      kind: "user_state" as const,
      instanceName: `late-user-${suffix}`,
      rootInstanceName: "",
      schemaVersion: `user-state-v${USER_STATE_SCHEMA_VERSION}`,
      stateClass: "authoritative" as const,
      restoreBehavior: "restore" as const,
      registeredAt: 3,
    };
    await expect(registry.registerObject(lateRegistration)).resolves.toEqual({ ok: true });
    await expect(staleRegisteredAdapters.find(({ store }) => store === "instance_object_registry")!
      .capture(epoch)).rejects.toMatchObject({ code: "capture_object_registry_changed" });
    const currentRegistry = await registry.listRegisteredObjects();
    if (!currentRegistry.ok) throw new Error("registry read failed");
    const dormantRegistration = {
      ...lateRegistration,
      instanceName: `dormant-user-${suffix}`,
      registeredAt: 4,
    };
    await expect(registry.confirmObjectRegistryBaseline({
      version: 1,
      inventoryId: `external-inventory-complete-${suffix}`,
      objects: [...currentRegistry.objects, dormantRegistration],
      confirmedAt: 4,
    })).resolves.toMatchObject({
      ok: true,
      baselineComplete: true,
      baselineInventoryId: `external-inventory-complete-${suffix}`,
      objects: expect.arrayContaining([dormantRegistration]),
    });
    await expect(registry.listRegisteredObjects()).resolves.toMatchObject({
      ok: true,
      baselineComplete: true,
      objects: expect.arrayContaining([dormantRegistration]),
    });
    const registeredAdapters = await createRegisteredDurableObjectCaptureAdapters(env, registryName);
    const chatStoreAdapters = createChatStoreCaptureAdapters(env.CHAT_STORE, "kv:test");
    const adaptersForRuntime: CaptureStoreAdapter[] = [
      {
        store: "instance_identity",
        capture: async (captureEpoch) => ({
          captureEpoch,
          sourceIdentity: "worker:test",
          schemaVersion: "instance-identity-v1",
          generation: captureEpoch,
          stateClass: "authoritative",
          restoreBehavior: "restore",
          itemCount: 1,
          bytes: encoder.encode(stableJson(source())),
          unresolvedReferences: 0,
          references: [],
        }),
      },
      ...chatStoreAdapters,
      ...registeredAdapters,
      createWorkspaceFilesCaptureAdapter(env.WORKSPACE_FILES, "r2:test"),
      createDurableObjectCaptureAdapter({
        store: "provider_coordinator",
        sourceIdentity: `provider-coordinator:${suffix}`,
        stub: provider,
        stateClass: "rebuildable",
        restoreBehavior: "rebuild",
      }),
    ];
    const key = new Uint8Array(32).fill(19);
    const result = await captureInstance(captureInput(coordinator(), {
      captureEpoch: epoch,
      archiveKey: key,
      adapters: adaptersForRuntime,
    }));
    const verified = await decryptAndValidateCaptureArchive(clone(result.archive), key);
    expect(verified.manifest.entries.map(({ store }) => store)).toEqual(expect.arrayContaining([
      "chat_store",
      "user_state",
      "root_team_agent",
      "conversation_team_agent",
      "workspace_files",
      "document_ingest_queue",
      "provider_coordinator",
      "provider_attempt_ledger",
    ]));
    expect(verified.payloads.find(({ entry }) => entry.store === "provider_coordinator")?.entry)
      .toMatchObject({ stateClass: "rebuildable", restoreBehavior: "rebuild" });
    expect(verified.payloads.find(({ entry }) => entry.store === "provider_attempt_ledger")?.entry)
      .toMatchObject({ stateClass: "authoritative", restoreBehavior: "restore" });
  });
});

describe("instance maintenance runtime gate", () => {
  const instance = () => coordinator(INSTANCE_MAINTENANCE_COORDINATOR);

  afterEach(async () => {
    await releaseIfBlocked(instance());
    await env.CHAT_STORE.delete(ACCESS_CODES_KEY);
    vi.restoreAllMocks();
  });

  it("blocks member writes, Agent entry, Provider admission, and Queue consumption while reads and logout remain available", async () => {
    const label = `maintenance-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, `${label}:maintenance-code`);
    const login = await exports.default.fetch(new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "maintenance-code" }),
    }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get("Set-Cookie")!.split(";", 1)[0]!;

    const requested = await instance().requestMaintenance({
      operationId: "runtime-gate",
      captureEpoch: "epoch-runtime-gate",
      requestedAt: Date.now(),
    });
    expect(requested.ok).toBe(true);

    const session = await exports.default.fetch(new Request("https://example.test/api/session", {
      headers: { Cookie: cookie },
    }));
    expect(session.status).toBe(200);

    const oauthStatus = await exports.default.fetch(new Request("https://example.test/api/mcp/oauth/status", {
      headers: { Cookie: cookie },
    }));
    expect(oauthStatus.status).toBe(503);
    await expect(oauthStatus.json()).resolves.toMatchObject({ error: "instance_maintenance" });

    const registryBefore = await instance().listRegisteredObjects();
    const health = await exports.default.fetch(new Request("https://example.test/healthz"));
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      status: "maintenance",
      checks: {
        kv: true,
        configured: true,
        memberAccessConfigured: true,
        maintenance: true,
      },
    });
    await expect(instance().listRegisteredObjects()).resolves.toEqual(registryBefore);

    const write = await exports.default.fetch(new Request("https://example.test/api/chats", {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "blocked", title: "Blocked", messages: [] }),
    }));
    expect(write.status).toBe(503);
    await expect(write.json()).resolves.toMatchObject({ error: "instance_maintenance", revision: 1 });

    const agent = await exports.default.fetch(new Request("https://example.test/agent?chatId=blocked", {
      headers: { Cookie: cookie },
    }));
    expect(agent.status).toBe(503);
    await expect(agent.json()).resolves.toMatchObject({ error: "instance_maintenance" });

    const retry = vi.fn();
    const ack = vi.fn();
    await worker.queue({
      queue: "chatus-document-ingest-local",
      messages: [{
        id: "maintenance-message",
        timestamp: new Date(),
        attempts: 1,
        body: {},
        retry,
        ack,
      }],
    } as unknown as MessageBatch<any>, env);
    expect(retry).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();

    const logout = await exports.default.fetch(new Request("https://example.test/api/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    }));
    expect(logout.status).toBe(200);
  });
});
