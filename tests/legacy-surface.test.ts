import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  LEGACY_SURFACE_MANIFEST,
  LEGACY_SURFACE_PHASES,
  LEGACY_SURFACE_PHASE_EVIDENCE,
  decodeLegacySurfaceAdvanceInput,
  decodeLegacySurfaceManifest,
  decodeLegacySurfaceRollbackInput,
  decodeLegacySurfaceUseInput,
  legacySurfaceManifestDigest,
  legacySurfaceControlsForPhase,
  legacySurfaceObjectName,
  stableJson,
  nextLegacySurfacePhase,
  validateLegacySurfaceCaptureSnapshotDigest,
  validateLegacySurfaceManifestUpgrade,
  type LegacySurfaceEvidenceKind,
  type LegacySurfaceEvidenceReferenceV1,
  type LegacySurfaceManifestRecordV1,
  type LegacySurfacePhase,
  type LegacySurfaceProjectionV1,
} from "../src/contracts/legacy-surface";
import { createLegacySurfaceRegistryCaptureAdapter } from "../src/services/instance-capture-adapters";
import {
  applyLegacySurfaceRegistryRestore,
  parseLegacySurfaceRegistryCapture,
  restoreIsolatedInstance,
} from "../src/services/instance-restore";
import {
  buildRestoreFixture,
  createRecordingRestoreAdapter,
  MemoryRestoreCheckpointStore,
} from "./helpers/instance-restore-fixture";

describe("legacy surface contract", () => {
  it("owns exactly the 13 canonical census records at discovered", async () => {
    expect(LEGACY_SURFACE_MANIFEST.map(({ surfaceId }) => surfaceId)).toEqual([
      "legacy.api.chat-post",
      "legacy.api.cloud-chats",
      "legacy.auth.access-secret-fallback",
      "legacy.browser.admin-alias",
      "legacy.browser.shell",
      "legacy.config.source-fallback",
      "legacy.kv.chat-index",
      "legacy.kv.daily-usage",
      "legacy.kv.memory",
      "legacy.kv.route-reliability",
      "legacy.provider.inline-credential",
      "legacy.provider.route-shadow",
      "legacy.user-state.chat-projection",
    ]);
    expect(new Set(LEGACY_SURFACE_MANIFEST.map(({ surfaceId }) => surfaceId)).size).toBe(13);
    const adminAlias = LEGACY_SURFACE_MANIFEST.find(({ surfaceId }) => surfaceId === "legacy.browser.admin-alias");
    expect(adminAlias).toMatchObject({
      owner: "frontend",
      manifestVersion: 2,
      writeObservationMs: 7 * 24 * 60 * 60 * 1_000,
      readObservationMs: 7 * 24 * 60 * 60 * 1_000,
      maximumSupportedPhase: "instrumented",
    });
    expect(LEGACY_SURFACE_MANIFEST.filter(({ surfaceId }) => surfaceId !== "legacy.browser.admin-alias").every((record) => (
      record.owner === "unassigned"
      && record.manifestVersion === 1
      && record.maximumSupportedPhase === "discovered"
    ))).toBe(true);
    await expect(legacySurfaceManifestDigest()).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(legacySurfaceManifestDigest()).resolves.toBe(await legacySurfaceManifestDigest());
  });

  it("rejects unknown fields, duplicates, reordering and non-canonical nested sets", () => {
    expect(decodeLegacySurfaceManifest(LEGACY_SURFACE_MANIFEST)).toEqual(LEGACY_SURFACE_MANIFEST);
    expect(decodeLegacySurfaceManifest([
      { ...LEGACY_SURFACE_MANIFEST[0], note: "content is forbidden" },
      ...LEGACY_SURFACE_MANIFEST.slice(1),
    ])).toBeUndefined();
    expect(decodeLegacySurfaceManifest([
      LEGACY_SURFACE_MANIFEST[1],
      LEGACY_SURFACE_MANIFEST[0],
      ...LEGACY_SURFACE_MANIFEST.slice(2),
    ])).toBeUndefined();
    expect(decodeLegacySurfaceManifest([
      LEGACY_SURFACE_MANIFEST[0],
      LEGACY_SURFACE_MANIFEST[0],
      ...LEGACY_SURFACE_MANIFEST.slice(1),
    ])).toBeUndefined();
    expect(decodeLegacySurfaceManifest([
      {
        ...LEGACY_SURFACE_MANIFEST[0],
        callerClasses: [...LEGACY_SURFACE_MANIFEST[0]!.callerClasses].reverse(),
      },
      ...LEGACY_SURFACE_MANIFEST.slice(1),
    ])).toBeUndefined();
  });

  it("allows only additive or forward-versioned manifest evolution", () => {
    const ownerAssigned = replaceRecord(LEGACY_SURFACE_MANIFEST, 0, {
      owner: "operations",
      manifestVersion: 2,
      maximumSupportedPhase: "instrumented",
    });
    expect(validateLegacySurfaceManifestUpgrade(LEGACY_SURFACE_MANIFEST, ownerAssigned)).toEqual(ownerAssigned);

    expect(validateLegacySurfaceManifestUpgrade(LEGACY_SURFACE_MANIFEST, ownerAssigned.slice(1))).toBeUndefined();
    expect(validateLegacySurfaceManifestUpgrade(ownerAssigned, replaceRecord(ownerAssigned, 0, {
      owner: "security",
      manifestVersion: 3,
    }))).toBeUndefined();
    expect(validateLegacySurfaceManifestUpgrade(ownerAssigned, replaceRecord(ownerAssigned, 0, {
      maximumSupportedPhase: "discovered",
      manifestVersion: 3,
    }))).toBeUndefined();
    expect(validateLegacySurfaceManifestUpgrade(LEGACY_SURFACE_MANIFEST, replaceRecord(LEGACY_SURFACE_MANIFEST, 0, {
      replacement: "conflicting-replacement",
      manifestVersion: 2,
    }))).toBeUndefined();
    expect(validateLegacySurfaceManifestUpgrade(LEGACY_SURFACE_MANIFEST, replaceRecord(LEGACY_SURFACE_MANIFEST, 0, {
      maximumSupportedPhase: "instrumented",
    }))).toBeUndefined();
  });

  it("keeps the phase order explicit and advances only one step", () => {
    expect(LEGACY_SURFACE_PHASES).toHaveLength(11);
    for (let index = 0; index < LEGACY_SURFACE_PHASES.length - 1; index += 1) {
      expect(nextLegacySurfacePhase(LEGACY_SURFACE_PHASES[index]!)).toBe(LEGACY_SURFACE_PHASES[index + 1]);
    }
    expect(nextLegacySurfacePhase("approved_for_cleanup")).toBeUndefined();
  });

  it("strictly decodes transition and use payloads without content-bearing fields", () => {
    const evidence = [{
      version: 1,
      kind: "caller_map",
      evidenceId: "evidence:caller-map:1",
      digest: "a".repeat(64),
      deploymentSha: "b".repeat(40),
      observedAt: 1,
      count: 3,
      result: "complete",
    }] as const;
    const advance = {
      version: 1,
      surfaceId: "legacy.api.chat-post",
      expectedRevision: 0,
      operationId: "operation:advance:1",
      targetPhase: "instrumented",
      requestedAt: 2,
      evidence,
    };
    expect(decodeLegacySurfaceAdvanceInput(advance)).toEqual(advance);
    expect(decodeLegacySurfaceAdvanceInput({ ...advance, prompt: "SECRET_CONTENT" })).toBeUndefined();
    expect(decodeLegacySurfaceAdvanceInput({
      ...advance,
      evidence: [...evidence, evidence[0]],
    })).toBeUndefined();

    const rollback = {
      version: 1,
      surfaceId: "legacy.api.chat-post",
      expectedRevision: 4,
      operationId: "operation:rollback:1",
      scope: "write",
      reason: "runtime_regression",
      requestedAt: 3,
      evidence,
    };
    expect(decodeLegacySurfaceRollbackInput(rollback)).toEqual(rollback);
    expect(decodeLegacySurfaceRollbackInput({ ...rollback, notes: "arbitrary text" })).toBeUndefined();

    const use = {
      version: 1,
      surfaceId: "legacy.api.chat-post",
      callerClass: "worker_api",
      access: "read",
      occurredAt: 4,
      deploymentSha: "c".repeat(40),
    };
    expect(decodeLegacySurfaceUseInput(use)).toEqual(use);
    expect(decodeLegacySurfaceUseInput({ ...use, route: "/api/chat" })).toBeUndefined();
    expect(decodeLegacySurfaceUseInput({ ...use, callerClass: "unknown" })).toBeUndefined();
  });
});

describe("InstanceCoordinator legacy surface state", () => {
  it("creates each deterministic surface atom at discovered without changing legacy controls", async () => {
    const digest = await legacySurfaceManifestDigest();
    for (const manifest of LEGACY_SURFACE_MANIFEST) {
      const stub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
      const result = await stub.syncLegacySurfaceManifest({ version: 1, manifest, manifestDigest: digest });
      expect(result).toEqual({
        ok: true,
        projection: expect.objectContaining({
          surfaceId: manifest.surfaceId,
          revision: 0,
          phase: "discovered",
          readControl: "enabled",
          writeControl: "enabled",
          owner: manifest.surfaceId === "legacy.browser.admin-alias" ? "frontend" : "unassigned",
          allowedActions: manifest.surfaceId === "legacy.browser.admin-alias"
            ? [{ kind: "advance", targetPhase: "instrumented" }]
            : [],
        }),
      });
    }
  });

  it("fails closed on object identity, unknown sync keys and manifest policy drift", async () => {
    const manifest = elevatedManifest();
    const digest = "d".repeat(64);
    const stub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    await expect(stub.syncLegacySurfaceManifest({
      version: 1,
      manifest: LEGACY_SURFACE_MANIFEST[1],
      manifestDigest: digest,
    })).resolves.toEqual({ ok: false, error: "legacy_surface_manifest_conflict" });
    await expect(stub.syncLegacySurfaceManifest({
      version: 1,
      manifest,
      manifestDigest: digest,
      note: "forbidden",
    })).resolves.toEqual({ ok: false, error: "legacy_surface_manifest_conflict" });

    const created = await stub.syncLegacySurfaceManifest({ version: 1, manifest, manifestDigest: digest });
    expect(created.ok).toBe(true);
    const conflicting = { ...manifest, manifestVersion: 3, replacement: "different-owner" };
    await expect(stub.syncLegacySurfaceManifest({
      version: 1,
      manifest: conflicting,
      manifestDigest: "e".repeat(64),
    })).resolves.toEqual({ ok: false, error: "legacy_surface_manifest_conflict" });
  });

  it("advances every phase atomically with exact evidence and idempotent replay", async () => {
    const manifest = elevatedManifest();
    const stub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    const synced = await stub.syncLegacySurfaceManifest({
      version: 1,
      manifest,
      manifestDigest: "a".repeat(64),
    });
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    let projection = synced.projection;
    let requestedAt = Date.now();

    for (const targetPhase of LEGACY_SURFACE_PHASES.slice(1)) {
      requestedAt = Math.max(requestedAt + 10, projection.observationRequiredUntil);
      const input = advanceInput(manifest.surfaceId, projection.revision, targetPhase, requestedAt);
      const advanced = await stub.advanceLegacySurface(input);
      expect(advanced).toEqual({
        ok: true,
        replayed: false,
        projection: expect.objectContaining({
          phase: targetPhase,
          revision: projection.revision + 1,
          ...legacySurfaceControlsForPhase(targetPhase),
        }),
      });
      if (!advanced.ok) return;
      const replay = await stub.advanceLegacySurface(input);
      expect(replay).toEqual({ ok: true, replayed: true, projection: advanced.projection });
      projection = advanced.projection;
    }

    expect(projection).toMatchObject({
      phase: "approved_for_cleanup",
      readControl: "disabled",
      writeControl: "disabled",
      evidence: { required: 1, present: 1, complete: true },
    });
    const stored = await runInDurableObject(stub, async (_instance, state) => ({
      events: state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM legacy_surface_events WHERE event_kind = 'advance'",
      ).one().count,
      operations: state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM legacy_surface_operations",
      ).one().count,
    }));
    expect(stored).toEqual({ events: 10, operations: 10 });
  });

  it("rejects skipped phases, stale revisions, missing evidence and premature observation", async () => {
    const manifest = elevatedManifest();
    const stub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    const synced = await stub.syncLegacySurfaceManifest({
      version: 1,
      manifest,
      manifestDigest: "b".repeat(64),
    });
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    const now = Date.now();
    await expect(stub.advanceLegacySurface(advanceInput(
      manifest.surfaceId,
      synced.projection.revision,
      "censused",
      now,
    ))).resolves.toEqual({ ok: false, error: "legacy_surface_conflict" });
    await expect(stub.advanceLegacySurface({
      ...advanceInput(manifest.surfaceId, synced.projection.revision, "instrumented", now),
      evidence: [],
    })).resolves.toEqual({ ok: false, error: "legacy_surface_gate_blocked" });

    let projection = await advanceTo(stub, manifest, "write_observing", now + 20);
    const prematureAt = projection.observationStartedAt + 1;
    await expect(stub.advanceLegacySurface(advanceInput(
      manifest.surfaceId,
      projection.revision,
      "recovery_proven",
      prematureAt,
    ))).resolves.toEqual({ ok: false, error: "legacy_surface_gate_blocked" });
    await expect(stub.advanceLegacySurface(advanceInput(
      manifest.surfaceId,
      projection.revision - 1,
      "recovery_proven",
      projection.observationRequiredUntil,
    ))).resolves.toEqual({ ok: false, error: "legacy_surface_conflict" });

    const valid = advanceInput(
      manifest.surfaceId,
      projection.revision,
      "recovery_proven",
      projection.observationRequiredUntil,
    );
    const advanced = await stub.advanceLegacySurface(valid);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    projection = advanced.projection;
    await expect(stub.advanceLegacySurface({
      ...advanceInput(manifest.surfaceId, projection.revision, "read_disabled", valid.requestedAt + 10),
      operationId: valid.operationId,
    })).resolves.toEqual({ ok: false, error: "legacy_surface_conflict" });
  });

  it("rolls reads back independently, then rolls writes back to shadowing", async () => {
    const manifest = elevatedManifest();
    const stub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    const synced = await stub.syncLegacySurfaceManifest({
      version: 1,
      manifest,
      manifestDigest: "c".repeat(64),
    });
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    const projection = await advanceTo(stub, manifest, "read_observing", Date.now());
    const readRollback = rollbackInput(
      manifest.surfaceId,
      projection.revision,
      "read",
      projection.lastTransitionAt + 10,
    );
    const readResult = await stub.rollbackLegacySurface(readRollback);
    expect(readResult).toEqual({
      ok: true,
      replayed: false,
      projection: expect.objectContaining({
        phase: "recovery_proven",
        readControl: "enabled",
        writeControl: "disabled",
      }),
    });
    if (!readResult.ok) return;
    expect(await stub.rollbackLegacySurface(readRollback)).toEqual({
      ok: true,
      replayed: true,
      projection: readResult.projection,
    });

    const writeRollback = rollbackInput(
      manifest.surfaceId,
      readResult.projection.revision,
      "write",
      readResult.projection.lastTransitionAt + 10,
    );
    await expect(stub.rollbackLegacySurface(writeRollback)).resolves.toEqual({
      ok: true,
      replayed: false,
      projection: expect.objectContaining({
        phase: "shadowing",
        readControl: "enabled",
        writeControl: "enabled",
      }),
    });
  });

  it("records only declared content-free daily uses and returns authoritative controls", async () => {
    const manifest = discoveredManifest();
    const stub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    const synced = await stub.syncLegacySurfaceManifest({
      version: 1,
      manifest,
      manifestDigest: "9".repeat(64),
    });
    expect(synced.ok).toBe(true);
    const occurredAt = Date.now();
    const input = {
      version: 1,
      surfaceId: manifest.surfaceId,
      callerClass: "worker_api",
      access: "read",
      occurredAt,
      deploymentSha: "f".repeat(40),
    } as const;
    await expect(stub.recordLegacySurfaceUse(input)).resolves.toEqual({
      ok: true,
      projection: expect.objectContaining({
        phase: "discovered",
        readControl: "enabled",
        writeControl: "enabled",
      }),
    });
    await stub.recordLegacySurfaceUse(input);
    await stub.recordLegacySurfaceUse({
      ...input,
      occurredAt: occurredAt - 1,
      deploymentSha: "e".repeat(40),
    });
    await expect(stub.recordLegacySurfaceUse({ ...input, prompt: "SECRET_MARKER" }))
      .resolves.toEqual({ ok: false, error: "legacy_surface_conflict" });
    await expect(stub.recordLegacySurfaceUse({ ...input, callerClass: "background" }))
      .resolves.toEqual({ ok: false, error: "legacy_surface_conflict" });

    const rows = await runInDurableObject(stub, async (_instance, state) => (
      state.storage.sql.exec<{
        caller_class: string;
        access: string;
        count: number;
        last_occurred_at: number;
        deployment_sha: string;
      }>(
        `SELECT caller_class, access, count, last_occurred_at, deployment_sha
         FROM legacy_surface_daily`,
      ).toArray()
    ));
    expect(rows).toEqual([{
      caller_class: "worker_api",
      access: "read",
      count: 3,
      last_occurred_at: occurredAt,
      deployment_sha: "f".repeat(40),
    }]);
    expect(JSON.stringify(rows)).not.toContain("SECRET_MARKER");
  });

  it("fails closed when durable manifest storage is malformed", async () => {
    const manifest = discoveredManifest();
    const stub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    await stub.syncLegacySurfaceManifest({
      version: 1,
      manifest,
      manifestDigest: "8".repeat(64),
    });
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE legacy_surface_manifest SET manifest_json = '{}' WHERE id = 1");
    });
    await expect(stub.inspectLegacySurface())
      .resolves.toEqual({ ok: false, error: "legacy_surface_state_invalid" });
  });

  it("captures, restores and verifies one surface atom idempotently", async () => {
    const manifest = elevatedManifest();
    const digest = "7".repeat(64);
    const captureEpoch = `capture-${crypto.randomUUID()}`;
    const stub = env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId));
    const synced = await stub.syncLegacySurfaceManifest({ version: 1, manifest, manifestDigest: digest });
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    const advanced = await stub.advanceLegacySurface(advanceInput(
      manifest.surfaceId,
      synced.projection.revision,
      "instrumented",
      Date.now(),
    ));
    expect(advanced.ok).toBe(true);
    await stub.recordLegacySurfaceUse({
      version: 1,
      surfaceId: manifest.surfaceId,
      callerClass: "worker_api",
      access: "write",
      occurredAt: Date.now(),
      deploymentSha: "6".repeat(40),
    });
    const snapshot = await stub.captureLegacySurfaceState({
      version: 1,
      surfaceId: manifest.surfaceId,
      captureEpoch,
      manifestDigest: digest,
    });
    await expect(validateLegacySurfaceCaptureSnapshotDigest(snapshot)).resolves.toEqual(snapshot);

    await clearLegacySurfaceRows(stub);
    const restored = await stub.restoreLegacySurfaceState({ version: 1, snapshot });
    expect(restored).toEqual({
      ok: true,
      restored: true,
      projection: expect.objectContaining({ phase: "instrumented", revision: 1 }),
    });
    await expect(stub.restoreLegacySurfaceState({ version: 1, snapshot })).resolves.toEqual({
      ok: true,
      restored: false,
      projection: restored.ok ? restored.projection : expect.anything(),
    });
    await expect(stub.captureLegacySurfaceState({
      version: 1,
      surfaceId: manifest.surfaceId,
      captureEpoch,
      manifestDigest: digest,
    })).resolves.toEqual(snapshot);
    await expect(stub.restoreLegacySurfaceState({
      version: 1,
      snapshot: { ...snapshot, snapshotDigest: "0".repeat(64) },
    })).resolves.toEqual({ ok: false, error: "legacy_surface_restore_conflict" });
  });

  it("captures and reapplies the complete code-owned registry with exact aggregate validation", async () => {
    const coordinatorName = `legacy-capture-${crypto.randomUUID()}`;
    const adapter = await createLegacySurfaceRegistryCaptureAdapter(env, coordinatorName);
    const captureEpoch = `registry-${crypto.randomUUID()}`;
    const result = await adapter.capture(captureEpoch);
    expect(result).toMatchObject({
      captureEpoch,
      schemaVersion: "legacy-surface-registry-v1",
      stateClass: "authoritative",
      restoreBehavior: "restore",
      itemCount: 26,
    });
    if (!result.bytes) throw new Error("missing_registry_bytes");
    const parsed = await parseLegacySurfaceRegistryCapture(result.bytes);
    expect(parsed.surfaces).toHaveLength(13);
    expect(parsed.surfaces.every(({ state }) => state.phase === "discovered")).toBe(true);

    const corrupt = {
      ...parsed,
      itemCount: parsed.itemCount + 1,
    };
    await expect(parseLegacySurfaceRegistryCapture(new TextEncoder().encode(stableJson(corrupt))))
      .rejects.toThrow("restore_legacy_surface_registry_invalid");

    for (const manifest of LEGACY_SURFACE_MANIFEST) {
      await clearLegacySurfaceRows(env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId)));
    }
    await expect(applyLegacySurfaceRegistryRestore(env.INSTANCE_COORDINATOR, result.bytes)).resolves.toEqual({
      itemCount: 26,
      restoredSurfaces: 13,
    });
    await expect(applyLegacySurfaceRegistryRestore(env.INSTANCE_COORDINATOR, result.bytes)).resolves.toEqual({
      itemCount: 26,
      restoredSurfaces: 13,
    });
  });

  it("applies the complete registry through the checkpointed isolated restore orchestration", async () => {
    const fixture = await buildRestoreFixture();
    for (const manifest of LEGACY_SURFACE_MANIFEST) {
      await clearLegacySurfaceRows(env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId)));
    }
    let registryApplications = 0;
    const adapter = createRecordingRestoreAdapter(fixture, {
      restoreLegacySurfaceRegistry: async (entry) => {
        registryApplications += 1;
        await applyLegacySurfaceRegistryRestore(env.INSTANCE_COORDINATOR, entry.bytes);
      },
    });
    const result = await restoreIsolatedInstance({
      operationId: `legacy-registry-restore-${crypto.randomUUID()}`,
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter,
    });
    expect(registryApplications).toBe(1);
    expect(adapter.restoredLegacySurfaceRegistries).toHaveLength(1);
    for (const manifest of LEGACY_SURFACE_MANIFEST) {
      await expect(env.INSTANCE_COORDINATOR.getByName(legacySurfaceObjectName(manifest.surfaceId)).inspectLegacySurface())
        .resolves.toEqual({
          ok: true,
          projection: expect.objectContaining({
            surfaceId: manifest.surfaceId,
            phase: "discovered",
          }),
        });
    }

    const checkpoints = result.checkpoints.reduce((store, checkpoint) => {
      store.values.set(`${checkpoint.operationId}\0${checkpoint.phase}`, checkpoint);
      return store;
    }, new MemoryRestoreCheckpointStore());
    await restoreIsolatedInstance({
      operationId: result.checkpoints[0]!.operationId,
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints,
      adapter,
    });
    expect(registryApplications).toBe(1);
  });
});

function replaceRecord(
  manifest: readonly LegacySurfaceManifestRecordV1[],
  index: number,
  replacement: Partial<LegacySurfaceManifestRecordV1>,
): LegacySurfaceManifestRecordV1[] {
  return manifest.map((record, current) => current === index ? { ...record, ...replacement } : { ...record });
}

function elevatedManifest(): LegacySurfaceManifestRecordV1 {
  return {
    ...LEGACY_SURFACE_MANIFEST[0]!,
    surfaceId: uniqueSurfaceId(),
    manifestVersion: 2,
    owner: "operations",
    writeObservationMs: 100,
    readObservationMs: 100,
    maximumSupportedPhase: "approved_for_cleanup",
  };
}

function discoveredManifest(): LegacySurfaceManifestRecordV1 {
  return {
    ...LEGACY_SURFACE_MANIFEST[0]!,
    surfaceId: uniqueSurfaceId(),
    dataClasses: [...LEGACY_SURFACE_MANIFEST[0]!.dataClasses],
    callerClasses: [...LEGACY_SURFACE_MANIFEST[0]!.callerClasses],
  };
}

function uniqueSurfaceId(): string {
  return `legacy.test.${crypto.randomUUID()}`;
}

function evidenceFor(targetPhase: LegacySurfacePhase, observedAt: number): LegacySurfaceEvidenceReferenceV1[] {
  return LEGACY_SURFACE_PHASE_EVIDENCE[targetPhase].map((kind, index) => evidence(kind, observedAt, index));
}

function evidence(
  kind: LegacySurfaceEvidenceKind,
  observedAt: number,
  index = 0,
): LegacySurfaceEvidenceReferenceV1 {
  return {
    version: 1,
    kind,
    evidenceId: `evidence:${kind}:${observedAt}:${index}`,
    digest: index.toString(16).padStart(64, "a").slice(-64),
    deploymentSha: "1".repeat(40),
    observedAt,
    count: 1,
    result: kind.endsWith("approval") ? "approved" : "complete",
  };
}

function advanceInput(
  surfaceId: string,
  expectedRevision: number,
  targetPhase: LegacySurfacePhase,
  requestedAt: number,
) {
  return {
    version: 1 as const,
    surfaceId,
    expectedRevision,
    operationId: `operation:advance:${targetPhase}:${expectedRevision}`,
    targetPhase,
    requestedAt,
    evidence: evidenceFor(targetPhase, Math.max(1, requestedAt - 1)),
  };
}

function rollbackInput(
  surfaceId: string,
  expectedRevision: number,
  scope: "read" | "write",
  requestedAt: number,
) {
  return {
    version: 1 as const,
    surfaceId,
    expectedRevision,
    operationId: `operation:rollback:${scope}:${expectedRevision}`,
    scope,
    reason: "runtime_regression" as const,
    requestedAt,
    evidence: [evidence("rollback_rehearsal", Math.max(1, requestedAt - 1))],
  };
}

async function advanceTo(
  stub: ReturnType<typeof env.INSTANCE_COORDINATOR.getByName>,
  manifest: LegacySurfaceManifestRecordV1,
  target: LegacySurfacePhase,
  startAt: number,
): Promise<LegacySurfaceProjectionV1> {
  const inspected = await stub.inspectLegacySurface();
  if (!inspected.ok) throw new Error(inspected.error);
  let projection = inspected.projection;
  let requestedAt = Math.max(startAt, projection.lastTransitionAt);
  while (projection.phase !== target) {
    const next = nextLegacySurfacePhase(projection.phase);
    if (!next) throw new Error("target_unreachable");
    requestedAt = Math.max(requestedAt + 10, projection.observationRequiredUntil);
    const advanced = await stub.advanceLegacySurface(advanceInput(
      manifest.surfaceId,
      projection.revision,
      next,
      requestedAt,
    ));
    if (!advanced.ok) throw new Error(advanced.error);
    projection = advanced.projection;
  }
  return projection;
}

async function clearLegacySurfaceRows(
  stub: ReturnType<typeof env.INSTANCE_COORDINATOR.getByName>,
): Promise<void> {
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.transactionSync(() => {
      state.storage.sql.exec("DELETE FROM legacy_surface_daily");
      state.storage.sql.exec("DELETE FROM legacy_surface_operations");
      state.storage.sql.exec("DELETE FROM legacy_surface_events");
      state.storage.sql.exec("DELETE FROM legacy_surface_state");
      state.storage.sql.exec("DELETE FROM legacy_surface_manifest");
    });
  });
}
