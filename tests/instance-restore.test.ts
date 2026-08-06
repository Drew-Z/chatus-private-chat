import { describe, expect, it } from "vitest";
import {
  decodeDurableObjectCaptureSnapshot,
  decodeDurableObjectCaptureValue,
} from "../src/services/durable-object-restore";
import { stableJson } from "../src/services/instance-capture";
import {
  INSTANCE_RESTORE_PHASES,
  discardIsolatedRestoreTarget,
  restoreIsolatedInstance,
} from "../src/services/instance-restore";
import {
  buildRestoreFixture,
  createRecordingRestoreAdapter,
  MemoryRestoreCheckpointStore,
} from "./helpers/instance-restore-fixture";

function flipArchive(archive: any): any {
  const copy = structuredClone(archive);
  const bytes = Uint8Array.from(atob(copy.manifest.ciphertext), (character) => character.charCodeAt(0));
  bytes[0] = bytes[0]! ^ 1;
  copy.manifest.ciphertext = btoa(String.fromCharCode(...bytes));
  return copy;
}

describe("isolated restore engine", () => {
  it("restores a sealed archive through every phase and excludes rebuild/excluded payloads", async () => {
    const fixture = await buildRestoreFixture();
    const adapter = createRecordingRestoreAdapter(fixture);
    const result = await restoreIsolatedInstance({
      operationId: "restore-operation-1",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter,
      now: monotonicClock(),
    });

    expect(result.drill.status).toBe("passed");
    expect(fixture.manifest.entries).toContainEqual(expect.objectContaining({
      store: "provider_attempt_ledger",
      schemaVersion: "provider-attempt-ledger-v2",
      stateClass: "authoritative",
      restoreBehavior: "restore",
    }));
    expect(fixture.target.bindings).toContainEqual(expect.objectContaining({
      bindingName: "PROVIDER_ATTEMPT_LEDGER",
      className: "ProviderAttemptLedger",
      migrationTag: "v5",
    }));
    expect(result.reconciliation.unresolvedReferences).toBe(0);
    expect(result.acceptance.writesOpen).toBe(false);
    expect(result.checkpoints.map(({ phase }) => phase)).toEqual([...INSTANCE_RESTORE_PHASES]);
    expect(adapter.actionOrder).toEqual([...INSTANCE_RESTORE_PHASES]);
    expect(adapter.restoredEntries.every(({ entries }) => entries.every(({ restoreBehavior }) => restoreBehavior === "restore")))
      .toBe(true);
    expect(adapter.restoredEntries.flatMap(({ entries }) => entries).some(({ store }) => store === "document_ingest_queue"))
      .toBe(false);
    expect(adapter.restoredEntries.flatMap(({ entries }) => entries).some(({ restoreBehavior }) => restoreBehavior === "exclude"))
      .toBe(false);
    expect(adapter.queueItems.map(({ status, action }) => `${status}:${action}`).sort()).toEqual([
      "deleted:none",
      "extracting:enqueue",
      "failed:retain_failed",
      "failed:retain_dlq",
      "queued:enqueue",
      "ready:none",
    ].sort());
    expect(result.drill.sourceBeforeDigest).toBe(result.drill.sourceAfterDigest);
    const second = await restoreIsolatedInstance({
      operationId: "restore-operation-1",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: result.checkpoints.reduce((store, checkpoint) => {
        store.values.set(`${checkpoint.operationId}\0${checkpoint.phase}`, checkpoint);
        return store;
      }, new MemoryRestoreCheckpointStore()),
      adapter,
      now: monotonicClock(),
    });
    expect(second.drill.phases.every(({ outcome }) => outcome === "reused")).toBe(true);
    for (const phase of INSTANCE_RESTORE_PHASES) expect(adapter.calls.get(phase)).toBe(1);
  });

  it("does not inspect or mutate an isolated target when archive authentication fails", async () => {
    const fixture = await buildRestoreFixture();
    const adapter = createRecordingRestoreAdapter(fixture);
    await expect(restoreIsolatedInstance({
      operationId: "restore-wrong-key",
      archive: fixture.archive,
      archiveKey: new Uint8Array(32).fill(8),
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter,
    })).rejects.toMatchObject({ code: "archive_decrypt_failed" });
    expect(adapter.calls.get("inspect") || 0).toBe(0);

    const secondAdapter = createRecordingRestoreAdapter(fixture);
    await expect(restoreIsolatedInstance({
      operationId: "restore-tampered",
      archive: flipArchive(fixture.archive),
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter: secondAdapter,
    })).rejects.toMatchObject({ code: "archive_decrypt_failed" });
    expect(secondAdapter.calls.get("inspect") || 0).toBe(0);
  });

  it.each([
    ["non-empty", { empty: false }, "restore_target_not_empty"],
    ["writes-open", { writesOpen: true }, "restore_target_writes_open"],
    ["capacity", { availableBytes: 0 }, "restore_target_capacity_insufficient"],
  ] as const)("rejects %s targets before phase writes", async (_label, inspection, code) => {
    const fixture = await buildRestoreFixture();
    const adapter = createRecordingRestoreAdapter(fixture, { inspection });
    await expect(restoreIsolatedInstance({
      operationId: `restore-preflight-${_label}`,
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter,
    })).rejects.toMatchObject({ code });
    expect(adapter.actionOrder).toEqual([]);
  });

  it("rejects incompatible mappings and schema evidence before target writes", async () => {
    const fixture = await buildRestoreFixture();
    const unknown = fixture.mappings.map((mapping, index) => index === 0
      ? { ...mapping, sourceInstanceName: "orphan-source" }
      : mapping);
    const adapter = createRecordingRestoreAdapter(fixture);
    await expect(restoreIsolatedInstance({
      operationId: "restore-orphan",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: unknown,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter,
    })).rejects.toMatchObject({ code: "restore_mapping_unknown" });
    expect(adapter.calls.get("inspect") || 0).toBe(0);

    const schemaAdapter = createRecordingRestoreAdapter(fixture, { supportedSchemas: [] });
    await expect(restoreIsolatedInstance({
      operationId: "restore-schema",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter: schemaAdapter,
    })).rejects.toMatchObject({ code: "restore_target_schema_incompatible" });
    expect(schemaAdapter.actionOrder).toEqual([]);

    const v1SchemaAdapter = createRecordingRestoreAdapter(fixture, {
      supportedSchemas: fixture.manifest.entries
        .filter(({ restoreBehavior }) => restoreBehavior !== "exclude")
        .map(({ store, schemaVersion }) => ({
          store,
          schemaVersion: store === "provider_attempt_ledger"
            ? "provider-attempt-ledger-v1"
            : schemaVersion,
        })),
    });
    await expect(restoreIsolatedInstance({
      operationId: "restore-provider-ledger-v1",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter: v1SchemaAdapter,
    })).rejects.toMatchObject({ code: "restore_target_schema_incompatible" });
    expect(v1SchemaAdapter.actionOrder).toEqual([]);

    const targetAdapter = createRecordingRestoreAdapter(fixture);
    const wrongTarget = { ...fixture.target, workerName: "other-worker" };
    await expect(restoreIsolatedInstance({
      operationId: "restore-wrong-target",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: wrongTarget,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter: targetAdapter,
    })).rejects.toMatchObject({ code: "restore_target_invalid" });
    expect(targetAdapter.actionOrder).toEqual([]);

    const migrationAdapter = createRecordingRestoreAdapter(fixture);
    const wrongMigrationTarget = {
      ...fixture.target,
      bindings: fixture.target.bindings.map((binding) => binding.bindingName === "PROVIDER_ATTEMPT_LEDGER"
        ? { ...binding, migrationTag: "v4" }
        : binding),
    };
    await expect(restoreIsolatedInstance({
      operationId: "restore-wrong-migration",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: wrongMigrationTarget,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter: migrationAdapter,
    })).rejects.toMatchObject({ code: "restore_input_invalid" });
    expect(migrationAdapter.calls.get("inspect") || 0).toBe(0);
  });

  it.each(INSTANCE_RESTORE_PHASES)("recovers after a failure immediately after %s commit without replaying it", async (phase) => {
    const fixture = await buildRestoreFixture();
    const adapter = createRecordingRestoreAdapter(fixture, { failAfterCommitOnceForPhase: phase });
    const checkpoints = new MemoryRestoreCheckpointStore();
    const input = {
      operationId: `restore-fault-${phase}`,
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints,
      adapter,
      now: monotonicClock(),
    };
    await expect(restoreIsolatedInstance(input)).rejects.toMatchObject({ code: "restore_target_failed" });
    const result = await restoreIsolatedInstance(input);
    expect(result.drill.status).toBe("passed");
    for (const actionPhase of INSTANCE_RESTORE_PHASES) expect(adapter.calls.get(actionPhase)).toBe(1);
  });

  it("recovers a checkpoint write ambiguity from the target receipt", async () => {
    const fixture = await buildRestoreFixture();
    const adapter = createRecordingRestoreAdapter(fixture);
    const checkpoints = new MemoryRestoreCheckpointStore();
    checkpoints.failWriteOnceForPhase = "provision";
    const input = {
      operationId: "restore-checkpoint-write-fault",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints,
      adapter,
      now: monotonicClock(),
    };
    await expect(restoreIsolatedInstance(input)).rejects.toMatchObject({ code: "restore_checkpoint_failed" });
    await restoreIsolatedInstance(input);
    expect(adapter.calls.get("provision")).toBe(1);
  });

  it("discards a failed isolated target without touching the source", async () => {
    const fixture = await buildRestoreFixture();
    const adapter = createRecordingRestoreAdapter(fixture, { failAfterCommitOnceForPhase: "root_agent" });
    await expect(restoreIsolatedInstance({
      operationId: "restore-discard",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter,
    })).rejects.toMatchObject({ code: "restore_target_failed" });
    await discardIsolatedRestoreTarget({ operationId: "restore-discard", target: fixture.target, adapter });
    expect(adapter.discarded).toBe(true);
    expect(adapter.calls.get("discard")).toBe(1);
  });

  it("fails closed on checkpoint conflict and divergent target receipts", async () => {
    const fixture = await buildRestoreFixture();
    const adapter = createRecordingRestoreAdapter(fixture);
    const checkpoints = new MemoryRestoreCheckpointStore();
    const input = {
      operationId: "restore-checkpoint-conflict",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints,
      adapter,
      now: monotonicClock(),
    };
    await restoreIsolatedInstance(input);
    const provisionKey = `${input.operationId}\0provision`;
    const provision = checkpoints.values.get(provisionKey)!;
    checkpoints.values.set(provisionKey, { ...provision, inputDigest: "f".repeat(64) });
    await expect(restoreIsolatedInstance(input)).rejects.toMatchObject({ code: "restore_checkpoint_conflict" });

    checkpoints.values.set(provisionKey, provision);
    adapter.receipts.get(provisionKey)!.result.evidence.outputDigest = "f".repeat(64);
    await expect(restoreIsolatedInstance(input)).rejects.toMatchObject({ code: "restore_checkpoint_diverged" });
  });

  it("rejects impossible Queue state combinations before target inspection", async () => {
    const fixture = await buildRestoreFixture({
      queueRows: [{
        id: "bad-queued",
        file_id: "file-bad",
        object_key: "workspace/bad",
        checksum: "c".repeat(64),
        state: "ready",
        generation: 1,
        ingest_status: "queued",
        ingest_generation: 1,
        ingest_attempts: 0,
        ingest_error: "document_ingest_retry_exhausted",
        extracted_object_key: "workspace/bad/extracted/1",
        extracted_checksum: "",
      }],
    });
    const adapter = createRecordingRestoreAdapter(fixture);
    await expect(restoreIsolatedInstance({
      operationId: "restore-bad-queue",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter,
    })).rejects.toMatchObject({ code: "restore_queue_evidence_invalid" });
    expect(adapter.calls.get("inspect") || 0).toBe(0);
  });

  it("round-trips legal zero-byte values through DO, KV and R2 decoders", async () => {
    const snapshot = decodeDurableObjectCaptureSnapshot(new TextEncoder().encode(stableJson({
      version: 1,
      schemaVersion: "schema-v1",
      tables: [],
      storage: [{ key: "empty", value: { $binary: "" } }],
      storageBackedTables: [],
      excludedTables: [],
    })), "schema-v1");
    expect((snapshot.storage[0]!.value as ArrayBuffer).byteLength).toBe(0);
    expect((decodeDurableObjectCaptureValue({ $binary: "" }) as ArrayBuffer).byteLength).toBe(0);
  });
});

function monotonicClock(): () => number {
  let value = 10_000;
  return () => value++;
}
