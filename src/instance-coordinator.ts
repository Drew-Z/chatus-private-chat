import { DurableObject } from "cloudflare:workers";
import {
  LEGACY_SURFACE_DAILY_RETENTION_DAYS,
  LEGACY_SURFACE_PHASES,
  LEGACY_SURFACE_PHASE_EVIDENCE,
  decodeLegacySurfaceAdvanceInput,
  decodeLegacySurfaceCaptureInput,
  decodeLegacySurfaceDailyCount,
  decodeLegacySurfaceEvidenceReference,
  decodeLegacySurfaceEvent,
  decodeLegacySurfaceManifestRecord,
  decodeLegacySurfaceManifestSyncInput,
  decodeLegacySurfaceOperation,
  decodeLegacySurfaceProjection,
  decodeLegacySurfaceRollbackInput,
  decodeLegacySurfaceUseInput,
  legacySurfaceControlsForPhase,
  legacySurfaceCaptureSnapshotDigest,
  legacySurfacePhaseIndex,
  legacySurfaceRollbackTarget,
  nextLegacySurfacePhase,
  stableJson,
  validateLegacySurfaceCaptureSnapshotDigest,
  validateLegacySurfaceManifestUpgrade,
  type LegacySurfaceAdvanceInputV1,
  type LegacySurfaceAllowedActionV1,
  type LegacySurfaceBlockerCode,
  type LegacySurfaceCaptureSnapshotV1,
  type LegacySurfaceDailyCountV1,
  type LegacySurfaceEvidenceReferenceV1,
  type LegacySurfaceEventV1,
  type LegacySurfaceManifestRecordV1,
  type LegacySurfaceOperationV1,
  type LegacySurfacePhase,
  type LegacySurfaceProjectionResult,
  type LegacySurfaceProjectionV1,
  type LegacySurfaceRollbackInputV1,
  type LegacySurfaceTransitionResult,
  type LegacySurfaceUseRecordResult,
} from "./contracts/legacy-surface";
import {
  normalizeDrainProof,
  normalizeInstanceOperationState,
  normalizeInstanceObjectRegistration,
  normalizeInstanceMaintenanceState,
  type InstanceMaintenanceActivationInput,
  type InstanceMaintenanceInspection,
  type InstanceMaintenanceReleaseInput,
  type InstanceMaintenanceRequestInput,
  type InstanceMaintenanceResult,
  type InstanceMaintenanceStateV1,
  type InstanceOperationAcquireInput,
  type InstanceOperationReleaseInput,
  type InstanceOperationResult,
  type InstanceOperationStateV1,
  type InstanceObjectRegistrationV1,
  type InstanceObjectRegistryBaselineInput,
  type InstanceObjectRegistryResult,
} from "./services/instance-capture";

const INSTANCE_MAINTENANCE_STORAGE_KEY = "instance-maintenance:v1";
const INSTANCE_OPERATION_STORAGE_PREFIX = "instance-operation:v1:";
const INSTANCE_OBJECT_STORAGE_PREFIX = "instance-object:v1:";
const INSTANCE_OBJECT_BASELINE_KEY = "instance-object-registry-baseline:v1";
const LEGACY_SURFACE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const LEGACY_SURFACE_MAX_EVENT_EVIDENCE = 20;

type LegacySurfaceManifestRow = {
  surface_id: string;
  manifest_version: number;
  manifest_digest: string;
  manifest_json: string;
};

type LegacySurfaceStateRow = {
  surface_id: string;
  revision: number;
  phase: LegacySurfacePhase;
  read_control: "enabled" | "disabled";
  write_control: "enabled" | "disabled";
  manifest_version: number;
  manifest_digest: string;
  observation_started_at: number;
  observation_required_until: number;
  last_transition_at: number;
  last_deployment_sha: string;
};

type LegacySurfaceEventRow = {
  revision: number;
  event_kind: string;
  before_phase: string;
  after_phase: string;
  operation_id: string;
  input_digest: string;
  at: number;
  deployment_sha: string;
  reason: string;
  evidence_json: string;
};

type LegacySurfaceOperationRow = {
  operation_id: string;
  input_digest: string;
  result_json: string;
  completed_at: number;
};

type LegacySurfaceDailyRow = {
  day: string;
  caller_class: string;
  access: string;
  count: number;
  last_occurred_at: number;
  deployment_sha: string;
};

export class InstanceCoordinator extends DurableObject<Record<string, never>> {
  private readonly objectName: string;

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    const objectName = ctx.id.name;
    if (!objectName) throw new Error("instance_coordinator_name_unavailable");
    this.objectName = objectName;
    ctx.blockConcurrencyWhile(async () => {
      this.applyLegacySurfaceSchemaMigrations();
    });
  }

  async syncLegacySurfaceManifest(input: unknown): Promise<LegacySurfaceProjectionResult> {
    const normalized = decodeLegacySurfaceManifestSyncInput(input);
    if (!normalized || !this.matchesLegacySurfaceObject(normalized.manifest.surfaceId)) {
      return { ok: false, error: "legacy_surface_manifest_conflict" };
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        const stored = this.readLegacySurfaceRows(true);
        if (!stored) {
          const controls = legacySurfaceControlsForPhase("discovered");
          this.ctx.storage.sql.exec(
            `INSERT INTO legacy_surface_manifest(
              id, surface_id, manifest_version, manifest_digest, manifest_json
            ) VALUES (1, ?, ?, ?, ?)`,
            normalized.manifest.surfaceId,
            normalized.manifest.manifestVersion,
            normalized.manifestDigest,
            stableJson(normalized.manifest),
          );
          this.ctx.storage.sql.exec(
            `INSERT INTO legacy_surface_state(
              id, surface_id, revision, phase, read_control, write_control,
              manifest_version, manifest_digest, observation_started_at,
              observation_required_until, last_transition_at, last_deployment_sha
            ) VALUES (1, ?, 0, 'discovered', ?, ?, ?, ?, 0, 0, 0, '')`,
            normalized.manifest.surfaceId,
            controls.readControl,
            controls.writeControl,
            normalized.manifest.manifestVersion,
            normalized.manifestDigest,
          );
          const created = this.requireLegacySurfaceRows();
          return { ok: true, projection: this.legacySurfaceProjection(created) };
        }
        const upgraded = validateLegacySurfaceManifestUpgrade([stored.manifest], [normalized.manifest]);
        if (!upgraded) return { ok: false, error: "legacy_surface_manifest_conflict" };
        if (
          stableJson(stored.manifest) === stableJson(normalized.manifest)
          && stored.state.manifest_digest === normalized.manifestDigest
        ) return { ok: true, projection: this.legacySurfaceProjection(stored) };

        const revision = stored.state.revision + 1;
        const at = Date.now();
        const inputDigest = normalized.manifestDigest;
        this.ctx.storage.sql.exec(
          `UPDATE legacy_surface_manifest SET
            manifest_version = ?, manifest_digest = ?, manifest_json = ? WHERE id = 1`,
          normalized.manifest.manifestVersion,
          normalized.manifestDigest,
          stableJson(normalized.manifest),
        );
        this.ctx.storage.sql.exec(
          `UPDATE legacy_surface_state SET
            revision = ?, manifest_version = ?, manifest_digest = ?, last_transition_at = ? WHERE id = 1`,
          revision,
          normalized.manifest.manifestVersion,
          normalized.manifestDigest,
          at,
        );
        this.insertLegacySurfaceEvent({
          revision,
          kind: "manifest_sync",
          beforePhase: stored.state.phase,
          afterPhase: stored.state.phase,
          operationId: `manifest:${normalized.manifest.manifestVersion}:${normalized.manifestDigest.slice(0, 32)}`,
          inputDigest,
          at,
          deploymentSha: stored.state.last_deployment_sha,
          reason: "",
          evidence: [],
        });
        const updated = this.requireLegacySurfaceRows();
        return { ok: true, projection: this.legacySurfaceProjection(updated) };
      });
    } catch {
      return { ok: false, error: "legacy_surface_state_invalid" };
    }
  }

  inspectLegacySurface(expectedManifest?: unknown): LegacySurfaceProjectionResult {
    try {
      const stored = this.readLegacySurfaceRows(false);
      if (!stored) return { ok: false, error: "legacy_surface_not_found" };
      if (expectedManifest !== undefined) {
        const expected = decodeLegacySurfaceManifestSyncInput(expectedManifest);
        if (
          !expected
          || !this.matchesLegacySurfaceObject(expected.manifest.surfaceId)
          || !validateLegacySurfaceManifestUpgrade([stored.manifest], [expected.manifest])
          || stableJson(stored.manifest) !== stableJson(expected.manifest)
          || stored.state.manifest_digest !== expected.manifestDigest
        ) return { ok: false, error: "legacy_surface_manifest_conflict" };
      }
      return { ok: true, projection: this.legacySurfaceProjection(stored) };
    } catch {
      return { ok: false, error: "legacy_surface_state_invalid" };
    }
  }

  async advanceLegacySurface(input: unknown): Promise<LegacySurfaceTransitionResult> {
    const normalized = decodeLegacySurfaceAdvanceInput(input);
    if (!normalized || !this.matchesLegacySurfaceObject(normalized.surfaceId)) {
      return { ok: false, error: "legacy_surface_conflict" };
    }
    const inputDigest = await legacySurfaceInputDigest(normalized);
    try {
      return this.ctx.storage.transactionSync(() => this.advanceLegacySurfaceNormalized(normalized, inputDigest));
    } catch {
      return { ok: false, error: "legacy_surface_state_invalid" };
    }
  }

  async rollbackLegacySurface(input: unknown): Promise<LegacySurfaceTransitionResult> {
    const normalized = decodeLegacySurfaceRollbackInput(input);
    if (!normalized || !this.matchesLegacySurfaceObject(normalized.surfaceId)) {
      return { ok: false, error: "legacy_surface_conflict" };
    }
    const inputDigest = await legacySurfaceInputDigest(normalized);
    try {
      return this.ctx.storage.transactionSync(() => this.rollbackLegacySurfaceNormalized(normalized, inputDigest));
    } catch {
      return { ok: false, error: "legacy_surface_state_invalid" };
    }
  }

  recordLegacySurfaceUse(input: unknown): LegacySurfaceUseRecordResult {
    const normalized = decodeLegacySurfaceUseInput(input);
    if (!normalized || !this.matchesLegacySurfaceObject(normalized.surfaceId)) {
      return { ok: false, error: "legacy_surface_conflict" };
    }
    const now = Date.now();
    if (
      normalized.occurredAt > now + LEGACY_SURFACE_CLOCK_SKEW_MS
      || normalized.occurredAt < now - 7 * 24 * 60 * 60 * 1_000
    ) return { ok: false, error: "legacy_surface_conflict" };
    try {
      return this.ctx.storage.transactionSync(() => {
        const stored = this.readLegacySurfaceRows(false);
        if (!stored) return { ok: false, error: "legacy_surface_not_found" };
        if (!stored.manifest.callerClasses.includes(normalized.callerClass)) {
          return { ok: false, error: "legacy_surface_conflict" };
        }
        const day = new Date(normalized.occurredAt).toISOString().slice(0, 10);
        const existing = this.ctx.storage.sql.exec<{ count: number }>(
          `SELECT count FROM legacy_surface_daily
           WHERE day = ? AND caller_class = ? AND access = ?`,
          day,
          normalized.callerClass,
          normalized.access,
        ).toArray();
        if (existing.length > 1 || (existing[0] && !isSafeNonNegativeInteger(existing[0].count))) {
          throw new Error("legacy_surface_state_invalid");
        }
        if (existing[0]?.count === Number.MAX_SAFE_INTEGER) throw new Error("legacy_surface_state_invalid");
        this.ctx.storage.sql.exec(
          `INSERT INTO legacy_surface_daily(day, caller_class, access, count, last_occurred_at, deployment_sha)
           VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(day, caller_class, access) DO UPDATE SET
             count = count + 1,
             deployment_sha = CASE
               WHEN excluded.last_occurred_at >= last_occurred_at THEN excluded.deployment_sha
               ELSE deployment_sha
             END,
             last_occurred_at = MAX(last_occurred_at, excluded.last_occurred_at)`,
          day,
          normalized.callerClass,
          normalized.access,
          normalized.occurredAt,
          normalized.deploymentSha,
        );
        this.ctx.storage.sql.exec(
          `DELETE FROM legacy_surface_daily
           WHERE caller_class = ? AND access = ? AND day NOT IN (
             SELECT day FROM legacy_surface_daily
             WHERE caller_class = ? AND access = ?
             ORDER BY day DESC LIMIT ?
           )`,
          normalized.callerClass,
          normalized.access,
          normalized.callerClass,
          normalized.access,
          LEGACY_SURFACE_DAILY_RETENTION_DAYS,
        );
        const projection = this.legacySurfaceProjection(this.requireLegacySurfaceRows());
        return { ok: true, projection: {
          revision: projection.revision,
          phase: projection.phase,
          readControl: projection.readControl,
          writeControl: projection.writeControl,
          blockerCodes: projection.blockerCodes,
        } };
      });
    } catch {
      return { ok: false, error: "legacy_surface_state_invalid" };
    }
  }

  async captureLegacySurfaceState(input: unknown): Promise<LegacySurfaceCaptureSnapshotV1> {
    const normalized = decodeLegacySurfaceCaptureInput(input);
    if (!normalized || !this.matchesLegacySurfaceObject(normalized.surfaceId)) {
      throw new Error("legacy_surface_capture_invalid");
    }
    const base = this.legacySurfaceCaptureBase(normalized.captureEpoch);
    if (base.state.manifestDigest !== normalized.manifestDigest) {
      throw new Error("legacy_surface_manifest_conflict");
    }
    return {
      ...base,
      snapshotDigest: await legacySurfaceCaptureSnapshotDigest(base),
    };
  }

  async restoreLegacySurfaceState(input: unknown): Promise<{
    ok: true;
    restored: boolean;
    projection: LegacySurfaceProjectionV1;
  } | { ok: false; error: "legacy_surface_restore_conflict" | "legacy_surface_state_invalid" }> {
    if (!hasExactObjectKeys(input, ["version", "snapshot"]) || input.version !== 1) {
      return { ok: false, error: "legacy_surface_restore_conflict" };
    }
    const snapshot = await validateLegacySurfaceCaptureSnapshotDigest(input.snapshot);
    if (!snapshot || snapshot.coordinatorName !== this.objectName) {
      return { ok: false, error: "legacy_surface_restore_conflict" };
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        const existing = this.readLegacySurfaceRows(false);
        const { snapshotDigest: _snapshotDigest, ...expectedBase } = snapshot;
        if (existing) {
          const currentBase = this.legacySurfaceCaptureBase(snapshot.captureEpoch);
          if (stableJson(currentBase) !== stableJson(expectedBase)) {
            return { ok: false, error: "legacy_surface_restore_conflict" };
          }
          return { ok: true, restored: false, projection: this.legacySurfaceProjection(existing) };
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO legacy_surface_manifest(
            id, surface_id, manifest_version, manifest_digest, manifest_json
          ) VALUES (1, ?, ?, ?, ?)`,
          snapshot.manifest.surfaceId,
          snapshot.manifest.manifestVersion,
          snapshot.state.manifestDigest,
          stableJson(snapshot.manifest),
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO legacy_surface_state(
            id, surface_id, revision, phase, read_control, write_control,
            manifest_version, manifest_digest, observation_started_at,
            observation_required_until, last_transition_at, last_deployment_sha
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          snapshot.state.surfaceId,
          snapshot.state.revision,
          snapshot.state.phase,
          snapshot.state.readControl,
          snapshot.state.writeControl,
          snapshot.state.manifestVersion,
          snapshot.state.manifestDigest,
          snapshot.state.observationStartedAt,
          snapshot.state.observationRequiredUntil,
          snapshot.state.lastTransitionAt,
          snapshot.state.lastDeploymentSha,
        );
        for (const event of snapshot.events) this.restoreLegacySurfaceEvent(event);
        for (const operation of snapshot.operations) this.restoreLegacySurfaceOperation(operation);
        for (const daily of snapshot.daily) this.restoreLegacySurfaceDaily(daily);
        return {
          ok: true,
          restored: true,
          projection: this.legacySurfaceProjection(this.requireLegacySurfaceRows()),
        };
      });
    } catch {
      return { ok: false, error: "legacy_surface_state_invalid" };
    }
  }

  async requestMaintenance(input: InstanceMaintenanceRequestInput): Promise<InstanceMaintenanceResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.readState();
      if (stored.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const baseline = await this.readObjectRegistryBaseline();
      if (baseline.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const operationId = normalizeId(input?.operationId);
      const captureEpoch = normalizeId(input?.captureEpoch);
      if (!operationId || !captureEpoch || !isSafeTimestamp(input?.requestedAt)) {
        return { ok: false, error: "instance_maintenance_conflict" };
      }
      if (stored.state && stored.state.phase !== "released") {
        return stored.state.operationId === operationId && stored.state.captureEpoch === captureEpoch
          ? { ok: true, state: stored.state }
          : { ok: false, error: "instance_maintenance_busy" };
      }
      const state: InstanceMaintenanceStateV1 = {
        version: 1,
        revision: (stored.state?.revision || 0) + 1,
        operationId,
        captureEpoch,
        phase: "requested",
        requestedAt: input.requestedAt,
        activatedAt: 0,
        releasedAt: 0,
        outcome: "pending",
        archiveEvidenceId: "",
        lastError: "",
      };
      await this.ctx.storage.put(INSTANCE_MAINTENANCE_STORAGE_KEY, state);
      return { ok: true, state };
    });
  }

  async activateMaintenance(input: InstanceMaintenanceActivationInput): Promise<InstanceMaintenanceResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.readState();
      if (stored.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const state = stored.state;
      const proof = normalizeDrainProof(input?.proof);
      if (!state || !matchesState(state, input)) {
        return { ok: false, error: "instance_maintenance_conflict" };
      }
      if (state.phase === "active") return { ok: true, state };
      if (state.revision !== input.expectedRevision) {
        return { ok: false, error: "instance_maintenance_conflict" };
      }
      if (state.phase !== "requested") return { ok: false, error: "instance_maintenance_conflict" };
      if (!proof) return { ok: false, error: "instance_maintenance_not_drained" };
      const operations = await this.readOperations();
      if (operations.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      if (operations.operations.length !== 0) {
        return { ok: false, error: "instance_maintenance_not_drained" };
      }
      const active: InstanceMaintenanceStateV1 = {
        ...state,
        revision: state.revision + 1,
        phase: "active",
        activatedAt: proof.observedAt,
      };
      await this.ctx.storage.put(INSTANCE_MAINTENANCE_STORAGE_KEY, active);
      return { ok: true, state: active };
    });
  }

  async releaseMaintenance(input: InstanceMaintenanceReleaseInput): Promise<InstanceMaintenanceResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.readState();
      if (stored.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const state = stored.state;
      if (
        state?.phase === "released"
        && matchesState(state, input)
        && state.outcome === input.outcome
        && state.archiveEvidenceId === (input.archiveEvidenceId || "")
      ) return { ok: true, state };
      if (
        !state || !matchesState(state, input) || state.revision !== input.expectedRevision
        || (state.phase !== "active" && !(state.phase === "requested" && input.outcome === "failed"))
        || (input.outcome !== "captured" && input.outcome !== "failed")
        || !isSafeTimestamp(input.releasedAt)
      ) return { ok: false, error: "instance_maintenance_conflict" };
      const archiveEvidenceId = input.outcome === "captured" ? normalizeId(input.archiveEvidenceId) : "";
      const lastError = input.outcome === "failed" ? normalizeError(input.lastError) : "";
      if (
        (input.outcome === "captured" && !archiveEvidenceId)
        || (input.outcome === "failed" && (!lastError || Boolean(input.archiveEvidenceId)))
      ) {
        return { ok: false, error: "instance_maintenance_conflict" };
      }
      const released: InstanceMaintenanceStateV1 = {
        ...state,
        revision: state.revision + 1,
        phase: "released",
        releasedAt: input.releasedAt,
        outcome: input.outcome,
        archiveEvidenceId,
        lastError,
      };
      await this.ctx.storage.put(INSTANCE_MAINTENANCE_STORAGE_KEY, released);
      return { ok: true, state: released };
    });
  }

  async inspectMaintenance(): Promise<InstanceMaintenanceInspection> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.readState();
      if (stored.invalid) return { blocked: true, error: "instance_maintenance_state_invalid" };
      if (!stored.state) return { blocked: false };
      return stored.state.phase === "released"
        ? { blocked: false, state: stored.state }
        : { blocked: true, state: stored.state };
    });
  }

  async acquireOperation(input: InstanceOperationAcquireInput): Promise<InstanceOperationResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const operation = normalizeInstanceOperationState(input);
      if (!operation) return { ok: false, error: "instance_operation_conflict" };
      const stored = await this.readState();
      if (stored.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      if (stored.state && stored.state.phase !== "released") {
        return { ok: false, error: "instance_maintenance_busy" };
      }
      const operations = await this.readOperations();
      if (operations.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const rawExisting = await this.ctx.storage.get(this.operationKey(operation.fenceId));
      if (rawExisting !== undefined) {
        const existing = normalizeInstanceOperationState(rawExisting);
        if (!existing) return { ok: false, error: "instance_maintenance_state_invalid" };
        return sameOperationFence(existing, operation)
          ? { ok: true, operation: existing, activeOperations: operations.operations.length }
          : { ok: false, error: "instance_operation_conflict" };
      }
      await this.ctx.storage.put(this.operationKey(operation.fenceId), operation);
      return { ok: true, operation, activeOperations: operations.operations.length + 1 };
    });
  }

  async releaseOperation(input: InstanceOperationReleaseInput): Promise<InstanceOperationResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const requested = normalizeInstanceOperationState({
        version: 1,
        operationId: input?.operationId,
        fenceId: input?.fenceId,
        kind: input?.kind,
        startedAt: 0,
      });
      if (!requested) return { ok: false, error: "instance_operation_conflict" };
      const operations = await this.readOperations();
      if (operations.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const rawExisting = await this.ctx.storage.get(this.operationKey(requested.fenceId));
      if (rawExisting === undefined) return { ok: true, activeOperations: operations.operations.length };
      const existing = normalizeInstanceOperationState(rawExisting);
      if (!existing) return { ok: false, error: "instance_maintenance_state_invalid" };
      if (!sameOperationFence(existing, requested)) return { ok: false, error: "instance_operation_conflict" };
      await this.ctx.storage.delete(this.operationKey(existing.fenceId));
      return { ok: true, activeOperations: operations.operations.length - 1 };
    });
  }

  async registerObject(input: InstanceObjectRegistrationV1): Promise<InstanceObjectRegistryResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const registration = normalizeInstanceObjectRegistration(input);
      if (!registration) return { ok: false, error: "instance_object_conflict" };
      const stored = await this.readState();
      if (stored.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const baseline = await this.readObjectRegistryBaseline();
      if (baseline.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const key = this.objectKey(registration);
      const rawExisting = await this.ctx.storage.get(key);
      if (rawExisting !== undefined) {
        const existing = normalizeInstanceObjectRegistration(rawExisting);
        if (!existing) return { ok: false, error: "instance_maintenance_state_invalid" };
        if (!sameRegistration(existing, registration)) {
          if (!isForwardSchemaRegistrationUpgrade(existing, registration)) {
            return { ok: false, error: "instance_object_conflict" };
          }
          if (stored.state && stored.state.phase !== "released") {
            return { ok: false, error: "instance_maintenance_busy" };
          }
          await this.ctx.storage.put(key, registration);
          await this.ctx.storage.delete(INSTANCE_OBJECT_BASELINE_KEY);
          const objects = await this.readRegisteredObjects();
          if (!objects) return { ok: false, error: "instance_maintenance_state_invalid" };
          return this.registryResult(objects, { complete: false });
        }
        const objects = await this.readRegisteredObjects();
        if (!objects) return { ok: false, error: "instance_maintenance_state_invalid" };
        return this.registryResult(objects, baseline);
      }
      if (stored.state && stored.state.phase !== "released") {
        return { ok: false, error: "instance_maintenance_busy" };
      }
      await this.ctx.storage.put(key, registration);
      await this.ctx.storage.delete(INSTANCE_OBJECT_BASELINE_KEY);
      const objects = await this.readRegisteredObjects();
      if (!objects) return { ok: false, error: "instance_maintenance_state_invalid" };
      return this.registryResult(objects, { complete: false });
    });
  }

  async listRegisteredObjects(): Promise<InstanceObjectRegistryResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.readState();
      if (stored.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const baseline = await this.readObjectRegistryBaseline();
      if (baseline.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      const objects = await this.readRegisteredObjects();
      if (!objects) {
        return { ok: false, error: "instance_maintenance_state_invalid" };
      }
      return this.registryResult(objects, baseline);
    });
  }

  async confirmObjectRegistryBaseline(
    input: InstanceObjectRegistryBaselineInput,
  ): Promise<InstanceObjectRegistryResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.readState();
      if (stored.invalid) return { ok: false, error: "instance_maintenance_state_invalid" };
      if (stored.state && stored.state.phase !== "released") {
        return { ok: false, error: "instance_maintenance_busy" };
      }
      if (!hasExactObjectKeys(input, ["version", "inventoryId", "objects", "confirmedAt"])) {
        return { ok: false, error: "instance_object_conflict" };
      }
      const inventoryId = normalizeId(input?.inventoryId);
      const inventory = normalizeObjectInventory(input?.objects);
      const current = await this.readRegisteredObjects();
      if (
        input?.version !== 1 || !inventoryId || !isSafeTimestamp(input.confirmedAt)
        || !inventory || !current
        || inventory.some(({ registeredAt }) => registeredAt > input.confirmedAt)
      ) return { ok: false, error: "instance_object_conflict" };
      const inventoryByKey = new Map(inventory.map((object) => [this.objectKey(object), object]));
      const currentByKey = new Map(current.map((object) => [this.objectKey(object), object]));
      if (current.some((object) => {
        const expected = inventoryByKey.get(this.objectKey(object));
        return !expected || !sameRegistration(object, expected);
      })) return { ok: false, error: "instance_object_conflict" };
      const missing = inventory.filter((object) => !currentByKey.has(this.objectKey(object)));
      if (missing.length) {
        await this.ctx.storage.put(Object.fromEntries(missing.map((object) => [this.objectKey(object), object])));
      }
      const objects = inventory.map((object) => currentByKey.get(this.objectKey(object)) || object);
      const digest = await objectRegistryDigest(objects);
      await this.ctx.storage.put(INSTANCE_OBJECT_BASELINE_KEY, {
        version: 1,
        inventoryId,
        confirmedObjects: objects.length,
        registryDigest: digest,
        confirmedAt: input.confirmedAt,
      });
      return {
        ok: true,
        objects,
        baselineComplete: true,
        registryDigest: digest,
        baselineConfirmedAt: input.confirmedAt,
        baselineInventoryId: inventoryId,
      };
    });
  }

  private advanceLegacySurfaceNormalized(
    input: LegacySurfaceAdvanceInputV1,
    inputDigest: string,
  ): LegacySurfaceTransitionResult {
    const stored = this.readLegacySurfaceRows(false);
    if (!stored) return { ok: false, error: "legacy_surface_not_found" };
    const replay = this.readLegacySurfaceOperation(input.operationId);
    if (replay) {
      if (replay.input_digest !== inputDigest) return { ok: false, error: "legacy_surface_conflict" };
      const projection = decodeStoredProjection(replay.result_json);
      return { ok: true, replayed: true, projection };
    }
    if (!isValidLegacySurfaceMutationTime(input.requestedAt, stored.state.last_transition_at)) {
      return { ok: false, error: "legacy_surface_conflict" };
    }
    if (stored.state.revision !== input.expectedRevision) {
      return { ok: false, error: "legacy_surface_conflict" };
    }
    const target = nextLegacySurfacePhase(stored.state.phase);
    if (!target || target !== input.targetPhase) return { ok: false, error: "legacy_surface_conflict" };
    if (legacySurfacePhaseIndex(target) > legacySurfacePhaseIndex(stored.manifest.maximumSupportedPhase)) {
      return { ok: false, error: "legacy_surface_gate_blocked" };
    }
    if (
      (stored.state.phase === "write_observing" || stored.state.phase === "read_observing")
      && input.requestedAt < stored.state.observation_required_until
    ) return { ok: false, error: "legacy_surface_gate_blocked" };
    if (!hasExactLegacySurfaceEvidence(input.evidence, target, input.requestedAt)) {
      return { ok: false, error: "legacy_surface_gate_blocked" };
    }

    const revision = stored.state.revision + 1;
    const controls = legacySurfaceControlsForPhase(target);
    const observationMs = target === "write_observing"
      ? stored.manifest.writeObservationMs
      : target === "read_observing" ? stored.manifest.readObservationMs : 0;
    const observationStartedAt = observationMs > 0 ? input.requestedAt : stored.state.observation_started_at;
    const observationRequiredUntil = observationMs > 0
      ? input.requestedAt + observationMs
      : stored.state.observation_required_until;
    if (!Number.isSafeInteger(observationRequiredUntil)) {
      return { ok: false, error: "legacy_surface_gate_blocked" };
    }
    const deploymentSha = input.evidence.find(({ kind }) => kind === "deployment")?.deploymentSha
      || input.evidence[0]?.deploymentSha
      || stored.state.last_deployment_sha;
    this.ctx.storage.sql.exec(
      `UPDATE legacy_surface_state SET
        revision = ?, phase = ?, read_control = ?, write_control = ?,
        observation_started_at = ?, observation_required_until = ?,
        last_transition_at = ?, last_deployment_sha = ?
       WHERE id = 1`,
      revision,
      target,
      controls.readControl,
      controls.writeControl,
      observationStartedAt,
      observationRequiredUntil,
      input.requestedAt,
      deploymentSha,
    );
    this.insertLegacySurfaceEvent({
      revision,
      kind: "advance",
      beforePhase: stored.state.phase,
      afterPhase: target,
      operationId: input.operationId,
      inputDigest,
      at: input.requestedAt,
      deploymentSha,
      reason: "",
      evidence: input.evidence,
    });
    const projection = this.legacySurfaceProjection(this.requireLegacySurfaceRows());
    this.insertLegacySurfaceOperation(input.operationId, inputDigest, projection, input.requestedAt);
    return { ok: true, replayed: false, projection };
  }

  private rollbackLegacySurfaceNormalized(
    input: LegacySurfaceRollbackInputV1,
    inputDigest: string,
  ): LegacySurfaceTransitionResult {
    const stored = this.readLegacySurfaceRows(false);
    if (!stored) return { ok: false, error: "legacy_surface_not_found" };
    const replay = this.readLegacySurfaceOperation(input.operationId);
    if (replay) {
      if (replay.input_digest !== inputDigest) return { ok: false, error: "legacy_surface_conflict" };
      return { ok: true, replayed: true, projection: decodeStoredProjection(replay.result_json) };
    }
    if (
      stored.state.revision !== input.expectedRevision
      || !isValidLegacySurfaceMutationTime(input.requestedAt, stored.state.last_transition_at)
    ) return { ok: false, error: "legacy_surface_conflict" };
    const target = legacySurfaceRollbackTarget(stored.state.phase, input.scope);
    if (!target || !hasExactRollbackEvidence(input.evidence, input.requestedAt)) {
      return { ok: false, error: "legacy_surface_gate_blocked" };
    }
    const revision = stored.state.revision + 1;
    const controls = legacySurfaceControlsForPhase(target);
    const deploymentSha = input.evidence[0]!.deploymentSha;
    this.ctx.storage.sql.exec(
      `UPDATE legacy_surface_state SET
        revision = ?, phase = ?, read_control = ?, write_control = ?,
        observation_started_at = 0, observation_required_until = 0,
        last_transition_at = ?, last_deployment_sha = ?
       WHERE id = 1`,
      revision,
      target,
      controls.readControl,
      controls.writeControl,
      input.requestedAt,
      deploymentSha,
    );
    this.insertLegacySurfaceEvent({
      revision,
      kind: input.scope === "read" ? "rollback_read" : "rollback_write",
      beforePhase: stored.state.phase,
      afterPhase: target,
      operationId: input.operationId,
      inputDigest,
      at: input.requestedAt,
      deploymentSha,
      reason: input.reason,
      evidence: input.evidence,
    });
    const projection = this.legacySurfaceProjection(this.requireLegacySurfaceRows());
    this.insertLegacySurfaceOperation(input.operationId, inputDigest, projection, input.requestedAt);
    return { ok: true, replayed: false, projection };
  }

  private readLegacySurfaceRows(allowMissing: boolean): {
    manifest: LegacySurfaceManifestRecordV1;
    state: LegacySurfaceStateRow;
  } | undefined {
    const manifestRows = this.ctx.storage.sql.exec<LegacySurfaceManifestRow>(
      `SELECT surface_id, manifest_version, manifest_digest, manifest_json
       FROM legacy_surface_manifest WHERE id = 1`,
    ).toArray();
    const stateRows = this.ctx.storage.sql.exec<LegacySurfaceStateRow>(
      `SELECT surface_id, revision, phase, read_control, write_control,
        manifest_version, manifest_digest, observation_started_at,
        observation_required_until, last_transition_at, last_deployment_sha
       FROM legacy_surface_state WHERE id = 1`,
    ).toArray();
    if (manifestRows.length === 0 && stateRows.length === 0) return undefined;
    if (manifestRows.length !== 1 || stateRows.length !== 1) throw new Error("legacy_surface_state_invalid");
    const manifestRow = manifestRows[0]!;
    const state = stateRows[0]!;
    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(manifestRow.manifest_json);
    } catch {
      throw new Error("legacy_surface_state_invalid");
    }
    const manifest = decodeLegacySurfaceManifestRecord(rawManifest);
    const phase = isLegacySurfacePhaseValue(state.phase) ? state.phase : undefined;
    const controls = phase ? legacySurfaceControlsForPhase(phase) : undefined;
    if (
      !manifest || !this.matchesLegacySurfaceObject(manifest.surfaceId)
      || manifest.surfaceId !== manifestRow.surface_id
      || manifest.manifestVersion !== manifestRow.manifest_version
      || !isDigest(manifestRow.manifest_digest)
      || state.surface_id !== manifest.surfaceId
      || !isSafeNonNegativeInteger(state.revision) || !phase || !controls
      || state.read_control !== controls.readControl || state.write_control !== controls.writeControl
      || state.manifest_version !== manifest.manifestVersion
      || state.manifest_digest !== manifestRow.manifest_digest
      || !isSafeNonNegativeInteger(state.observation_started_at)
      || !isSafeNonNegativeInteger(state.observation_required_until)
      || state.observation_required_until < state.observation_started_at
      || !isSafeNonNegativeInteger(state.last_transition_at)
      || (state.last_deployment_sha !== "" && !isDeploymentSha(state.last_deployment_sha))
    ) throw new Error("legacy_surface_state_invalid");
    state.phase = phase;
    return { manifest, state };
  }

  private requireLegacySurfaceRows(): {
    manifest: LegacySurfaceManifestRecordV1;
    state: LegacySurfaceStateRow;
  } {
    const stored = this.readLegacySurfaceRows(false);
    if (!stored) throw new Error("legacy_surface_state_invalid");
    return stored;
  }

  private legacySurfaceProjection(stored: {
    manifest: LegacySurfaceManifestRecordV1;
    state: LegacySurfaceStateRow;
  }): LegacySurfaceProjectionV1 {
    const requiredKinds = LEGACY_SURFACE_PHASE_EVIDENCE[stored.state.phase];
    const phaseEvidence = this.readLegacySurfacePhaseEvidence(stored.state.phase);
    const present = requiredKinds.filter((kind) => phaseEvidence.some((entry) => entry.kind === kind)).length;
    const now = Date.now();
    const observationIncomplete = (
      stored.state.phase === "write_observing" || stored.state.phase === "read_observing"
    ) && now < stored.state.observation_required_until;
    const blockerCodes: LegacySurfaceBlockerCode[] = [];
    if (stored.state.phase === stored.manifest.maximumSupportedPhase) blockerCodes.push("maximum_phase_reached");
    if (present !== requiredKinds.length) blockerCodes.push("missing_evidence");
    if (observationIncomplete) blockerCodes.push("observation_incomplete");
    if (stored.manifest.owner === "unassigned") blockerCodes.push("owner_unassigned");
    blockerCodes.sort(compareStrings);

    const allowedActions: LegacySurfaceAllowedActionV1[] = [];
    const next = nextLegacySurfacePhase(stored.state.phase);
    if (
      next && !observationIncomplete
      && legacySurfacePhaseIndex(next) <= legacySurfacePhaseIndex(stored.manifest.maximumSupportedPhase)
    ) allowedActions.push({ kind: "advance", targetPhase: next });
    const readTarget = legacySurfaceRollbackTarget(stored.state.phase, "read");
    if (readTarget) allowedActions.push({ kind: "rollback", scope: "read", targetPhase: readTarget });
    const writeTarget = legacySurfaceRollbackTarget(stored.state.phase, "write");
    if (writeTarget) allowedActions.push({ kind: "rollback", scope: "write", targetPhase: writeTarget });
    const projection: LegacySurfaceProjectionV1 = {
      version: 1,
      surfaceId: stored.manifest.surfaceId,
      revision: stored.state.revision,
      manifestVersion: stored.manifest.manifestVersion,
      manifestDigest: stored.state.manifest_digest,
      phase: stored.state.phase,
      readControl: stored.state.read_control === "disabled" ? "disabled" : "enabled",
      writeControl: stored.state.write_control === "disabled" ? "disabled" : "enabled",
      owner: stored.manifest.owner,
      blockerCodes,
      observationStartedAt: stored.state.observation_started_at,
      observationRequiredUntil: stored.state.observation_required_until,
      lastTransitionAt: stored.state.last_transition_at,
      lastDeploymentSha: stored.state.last_deployment_sha,
      evidence: { required: requiredKinds.length, present, complete: present === requiredKinds.length },
      allowedActions,
    };
    if (!decodeLegacySurfaceProjection(projection)) throw new Error("legacy_surface_state_invalid");
    return projection;
  }

  private readLegacySurfacePhaseEvidence(phase: LegacySurfacePhase): LegacySurfaceEvidenceReferenceV1[] {
    if (phase === "discovered") return [];
    const rows = this.ctx.storage.sql.exec<Pick<LegacySurfaceEventRow, "evidence_json">>(
      `SELECT evidence_json FROM legacy_surface_events
       WHERE event_kind = 'advance' AND after_phase = ?
       ORDER BY revision DESC LIMIT 1`,
      phase,
    ).toArray();
    if (rows.length === 0) return [];
    if (rows.length !== 1) throw new Error("legacy_surface_state_invalid");
    return decodeStoredEvidence(rows[0]!.evidence_json);
  }

  private legacySurfaceCaptureBase(
    captureEpoch: string,
  ): Omit<LegacySurfaceCaptureSnapshotV1, "snapshotDigest"> {
    const stored = this.requireLegacySurfaceRows();
    const state = {
      version: 1 as const,
      surfaceId: stored.state.surface_id,
      revision: stored.state.revision,
      phase: stored.state.phase,
      readControl: stored.state.read_control,
      writeControl: stored.state.write_control,
      manifestVersion: stored.state.manifest_version,
      manifestDigest: stored.state.manifest_digest,
      observationStartedAt: stored.state.observation_started_at,
      observationRequiredUntil: stored.state.observation_required_until,
      lastTransitionAt: stored.state.last_transition_at,
      lastDeploymentSha: stored.state.last_deployment_sha,
    };
    const events: LegacySurfaceEventV1[] = [];
    for (const row of this.ctx.storage.sql.exec<LegacySurfaceEventRow>(
      `SELECT revision, event_kind, before_phase, after_phase, operation_id, input_digest,
        at, deployment_sha, reason, evidence_json
       FROM legacy_surface_events ORDER BY revision`,
    ).toArray()) {
      const event = decodeLegacySurfaceEvent({
        version: 1,
        revision: row.revision,
        action: row.event_kind,
        beforePhase: row.before_phase,
        afterPhase: row.after_phase,
        operationId: row.operation_id,
        inputDigest: row.input_digest,
        at: row.at,
        deploymentSha: row.deployment_sha,
        reason: row.reason,
        evidence: decodeStoredEvidence(row.evidence_json),
      });
      if (!event) throw new Error("legacy_surface_state_invalid");
      events.push(event);
    }
    const operations: LegacySurfaceOperationV1[] = [];
    for (const row of this.ctx.storage.sql.exec<LegacySurfaceOperationRow>(
      `SELECT operation_id, input_digest, result_json, completed_at
       FROM legacy_surface_operations ORDER BY operation_id`,
    ).toArray()) {
      const operation = decodeLegacySurfaceOperation({
        version: 1,
        operationId: row.operation_id,
        inputDigest: row.input_digest,
        result: decodeStoredProjection(row.result_json),
        completedAt: row.completed_at,
      });
      if (!operation) throw new Error("legacy_surface_state_invalid");
      operations.push(operation);
    }
    const daily: LegacySurfaceDailyCountV1[] = [];
    for (const row of this.ctx.storage.sql.exec<LegacySurfaceDailyRow>(
      `SELECT day, caller_class, access, count, last_occurred_at, deployment_sha
       FROM legacy_surface_daily ORDER BY day, caller_class, access`,
    ).toArray()) {
      const count = decodeLegacySurfaceDailyCount({
        version: 1,
        day: row.day,
        callerClass: row.caller_class,
        access: row.access,
        count: row.count,
        lastOccurredAt: row.last_occurred_at,
        deploymentSha: row.deployment_sha,
      });
      if (!count) throw new Error("legacy_surface_state_invalid");
      daily.push(count);
    }
    return {
      version: 1,
      schemaVersion: "legacy-surface-registry-v1",
      captureEpoch,
      coordinatorName: this.objectName,
      manifest: stored.manifest,
      state,
      events,
      operations,
      daily,
      itemCount: 2 + events.length + operations.length + daily.length,
    };
  }

  private restoreLegacySurfaceEvent(event: LegacySurfaceEventV1): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO legacy_surface_events(
        revision, event_kind, before_phase, after_phase, operation_id, input_digest,
        at, deployment_sha, reason, evidence_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.revision,
      event.action,
      event.beforePhase,
      event.afterPhase,
      event.operationId,
      event.inputDigest,
      event.at,
      event.deploymentSha,
      event.reason,
      stableJson(event.evidence),
    );
  }

  private restoreLegacySurfaceOperation(operation: LegacySurfaceOperationV1): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO legacy_surface_operations(operation_id, input_digest, result_json, completed_at)
       VALUES (?, ?, ?, ?)`,
      operation.operationId,
      operation.inputDigest,
      stableJson(operation.result),
      operation.completedAt,
    );
  }

  private restoreLegacySurfaceDaily(daily: LegacySurfaceDailyCountV1): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO legacy_surface_daily(
        day, caller_class, access, count, last_occurred_at, deployment_sha
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      daily.day,
      daily.callerClass,
      daily.access,
      daily.count,
      daily.lastOccurredAt,
      daily.deploymentSha,
    );
  }

  private readLegacySurfaceOperation(operationId: string): LegacySurfaceOperationRow | undefined {
    const rows = this.ctx.storage.sql.exec<LegacySurfaceOperationRow>(
      `SELECT operation_id, input_digest, result_json, completed_at
       FROM legacy_surface_operations WHERE operation_id = ?`,
      operationId,
    ).toArray();
    if (rows.length > 1) throw new Error("legacy_surface_state_invalid");
    const row = rows[0];
    if (row && (
      row.operation_id !== operationId || !isDigest(row.input_digest) || !isSafePositiveInteger(row.completed_at)
    )) {
      throw new Error("legacy_surface_state_invalid");
    }
    return row;
  }

  private insertLegacySurfaceOperation(
    operationId: string,
    inputDigest: string,
    projection: LegacySurfaceProjectionV1,
    completedAt: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO legacy_surface_operations(operation_id, input_digest, result_json, completed_at)
       VALUES (?, ?, ?, ?)`,
      operationId,
      inputDigest,
      stableJson(projection),
      completedAt,
    );
  }

  private insertLegacySurfaceEvent(input: {
    revision: number;
    kind: "manifest_sync" | "advance" | "rollback_read" | "rollback_write";
    beforePhase: LegacySurfacePhase;
    afterPhase: LegacySurfacePhase;
    operationId: string;
    inputDigest: string;
    at: number;
    deploymentSha: string;
    reason: string;
    evidence: LegacySurfaceEvidenceReferenceV1[];
  }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO legacy_surface_events(
        revision, event_kind, before_phase, after_phase, operation_id, input_digest,
        at, deployment_sha, reason, evidence_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.revision,
      input.kind,
      input.beforePhase,
      input.afterPhase,
      input.operationId,
      input.inputDigest,
      input.at,
      input.deploymentSha,
      input.reason,
      stableJson(input.evidence),
    );
  }

  private matchesLegacySurfaceObject(surfaceId: string): boolean {
    return this.objectName === `$legacy-surface:${surfaceId}`;
  }

  private applyLegacySurfaceSchemaMigrations(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS legacy_surface_schema_migrations(
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      const current = this.ctx.storage.sql.exec<{ version: number }>(
        "SELECT COALESCE(MAX(version), 0) AS version FROM legacy_surface_schema_migrations",
      ).one().version;
      if (current < 1) {
        this.ctx.storage.sql.exec(`
          CREATE TABLE legacy_surface_manifest(
            id INTEGER PRIMARY KEY CHECK(id = 1),
            surface_id TEXT NOT NULL UNIQUE,
            manifest_version INTEGER NOT NULL CHECK(manifest_version > 0),
            manifest_digest TEXT NOT NULL,
            manifest_json TEXT NOT NULL
          );
          CREATE TABLE legacy_surface_state(
            id INTEGER PRIMARY KEY CHECK(id = 1),
            surface_id TEXT NOT NULL UNIQUE,
            revision INTEGER NOT NULL CHECK(revision >= 0),
            phase TEXT NOT NULL CHECK(phase IN (
              'discovered', 'instrumented', 'censused', 'parity_proven', 'shadowing',
              'write_disabled', 'write_observing', 'recovery_proven',
              'read_disabled', 'read_observing', 'approved_for_cleanup'
            )),
            read_control TEXT NOT NULL CHECK(read_control IN ('enabled', 'disabled')),
            write_control TEXT NOT NULL CHECK(write_control IN ('enabled', 'disabled')),
            manifest_version INTEGER NOT NULL CHECK(manifest_version > 0),
            manifest_digest TEXT NOT NULL,
            observation_started_at INTEGER NOT NULL CHECK(observation_started_at >= 0),
            observation_required_until INTEGER NOT NULL CHECK(observation_required_until >= 0),
            last_transition_at INTEGER NOT NULL CHECK(last_transition_at >= 0),
            last_deployment_sha TEXT NOT NULL
          );
          CREATE TABLE legacy_surface_events(
            revision INTEGER PRIMARY KEY CHECK(revision > 0),
            event_kind TEXT NOT NULL CHECK(event_kind IN (
              'manifest_sync', 'advance', 'rollback_read', 'rollback_write'
            )),
            before_phase TEXT NOT NULL,
            after_phase TEXT NOT NULL,
            operation_id TEXT NOT NULL UNIQUE,
            input_digest TEXT NOT NULL,
            at INTEGER NOT NULL CHECK(at > 0),
            deployment_sha TEXT NOT NULL,
            reason TEXT NOT NULL,
            evidence_json TEXT NOT NULL
          );
          CREATE TABLE legacy_surface_operations(
            operation_id TEXT PRIMARY KEY,
            input_digest TEXT NOT NULL,
            result_json TEXT NOT NULL,
            completed_at INTEGER NOT NULL CHECK(completed_at > 0)
          );
          CREATE TABLE legacy_surface_daily(
            day TEXT NOT NULL,
            caller_class TEXT NOT NULL,
            access TEXT NOT NULL CHECK(access IN ('read', 'write')),
            count INTEGER NOT NULL CHECK(count > 0),
            last_occurred_at INTEGER NOT NULL CHECK(last_occurred_at > 0),
            deployment_sha TEXT NOT NULL,
            PRIMARY KEY(day, caller_class, access)
          );
          CREATE INDEX legacy_surface_daily_recent_idx
            ON legacy_surface_daily(caller_class, access, day DESC);
        `);
        this.ctx.storage.sql.exec(
          "INSERT INTO legacy_surface_schema_migrations(version, applied_at) VALUES (1, ?)",
          Date.now(),
        );
      }
    });
  }

  private async readState(): Promise<{ state?: InstanceMaintenanceStateV1; invalid: boolean }> {
    const value = await this.ctx.storage.get(INSTANCE_MAINTENANCE_STORAGE_KEY);
    if (value === undefined) return { invalid: false };
    const state = normalizeInstanceMaintenanceState(value);
    return state ? { state, invalid: false } : { invalid: true };
  }

  private async readOperations(): Promise<{ operations: InstanceOperationStateV1[]; invalid: boolean }> {
    const values = await this.ctx.storage.list({ prefix: INSTANCE_OPERATION_STORAGE_PREFIX });
    const operations = [...values.values()].map(normalizeInstanceOperationState);
    return operations.some((operation) => !operation)
      ? { operations: [], invalid: true }
      : { operations: operations as InstanceOperationStateV1[], invalid: false };
  }

  private async readRegisteredObjects(): Promise<InstanceObjectRegistrationV1[] | undefined> {
    const values = await this.ctx.storage.list({ prefix: INSTANCE_OBJECT_STORAGE_PREFIX });
    const objects = [...values.values()].map(normalizeInstanceObjectRegistration);
    if (objects.some((object) => !object)) return undefined;
    const normalized = objects as InstanceObjectRegistrationV1[];
    normalized.sort((left, right) => (
      compareStrings(left.kind, right.kind) || compareStrings(left.instanceName, right.instanceName)
    ));
    return normalized;
  }

  private async readObjectRegistryBaseline(): Promise<{
    complete: boolean;
    invalid: boolean;
    confirmedObjects?: number;
    registryDigest?: string;
    confirmedAt?: number;
    inventoryId?: string;
  }> {
    const value = await this.ctx.storage.get(INSTANCE_OBJECT_BASELINE_KEY);
    if (value === undefined) return { complete: false, invalid: false };
    if (
      !value || typeof value !== "object" || Array.isArray(value)
      || (value as { version?: unknown }).version !== 1
      || !Number.isSafeInteger((value as { confirmedObjects?: unknown }).confirmedObjects)
      || (value as { confirmedObjects: number }).confirmedObjects < 0
      || typeof (value as { registryDigest?: unknown }).registryDigest !== "string"
      || !/^[a-f0-9]{64}$/.test((value as { registryDigest: string }).registryDigest)
      || !normalizeId((value as { inventoryId?: unknown }).inventoryId)
      || !isSafeTimestamp((value as { confirmedAt?: unknown }).confirmedAt)
      || Object.keys(value).sort().join(",") !== "confirmedAt,confirmedObjects,inventoryId,registryDigest,version"
    ) return { complete: false, invalid: true };
    return {
      complete: true,
      invalid: false,
      confirmedObjects: (value as { confirmedObjects: number }).confirmedObjects,
      registryDigest: (value as { registryDigest: string }).registryDigest,
      confirmedAt: (value as { confirmedAt: number }).confirmedAt,
      inventoryId: (value as { inventoryId: string }).inventoryId,
    };
  }

  private async registryResult(
    objects: InstanceObjectRegistrationV1[],
    baseline: {
      complete: boolean;
      confirmedObjects?: number;
      registryDigest?: string;
      confirmedAt?: number;
      inventoryId?: string;
    },
  ): Promise<Extract<InstanceObjectRegistryResult, { ok: true }>> {
    const registryDigest = await objectRegistryDigest(objects);
    const baselineComplete = baseline.complete
      && baseline.confirmedObjects === objects.length
      && baseline.registryDigest === registryDigest;
    return {
      ok: true,
      objects,
      baselineComplete,
      registryDigest,
      baselineConfirmedAt: baselineComplete ? baseline.confirmedAt || 0 : 0,
      baselineInventoryId: baselineComplete ? baseline.inventoryId || "" : "",
    };
  }

  private operationKey(fenceId: string): string {
    return `${INSTANCE_OPERATION_STORAGE_PREFIX}${fenceId}`;
  }

  private objectKey(registration: InstanceObjectRegistrationV1): string {
    return `${INSTANCE_OBJECT_STORAGE_PREFIX}${registration.kind}:${registration.instanceName}`;
  }
}

async function legacySurfaceInputDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeStoredProjection(value: string): LegacySurfaceProjectionV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("legacy_surface_state_invalid");
  }
  const projection = decodeLegacySurfaceProjection(parsed);
  if (!projection) throw new Error("legacy_surface_state_invalid");
  return projection;
}

function decodeStoredEvidence(value: string): LegacySurfaceEvidenceReferenceV1[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("legacy_surface_state_invalid");
  }
  if (!Array.isArray(parsed) || parsed.length > LEGACY_SURFACE_MAX_EVENT_EVIDENCE) {
    throw new Error("legacy_surface_state_invalid");
  }
  const evidence: LegacySurfaceEvidenceReferenceV1[] = [];
  for (const value of parsed) {
    const entry = decodeLegacySurfaceEvidenceReference(value);
    if (!entry) throw new Error("legacy_surface_state_invalid");
    evidence.push(entry);
  }
  return evidence;
}

function hasExactLegacySurfaceEvidence(
  evidence: LegacySurfaceEvidenceReferenceV1[],
  target: LegacySurfacePhase,
  requestedAt: number,
): boolean {
  const required = [...LEGACY_SURFACE_PHASE_EVIDENCE[target]].sort(compareStrings);
  const supplied = evidence.map(({ kind }) => kind).sort(compareStrings);
  return required.length === supplied.length
    && required.every((kind, index) => kind === supplied[index])
    && evidence.every(({ observedAt }) => observedAt <= requestedAt);
}

function hasExactRollbackEvidence(
  evidence: LegacySurfaceEvidenceReferenceV1[],
  requestedAt: number,
): boolean {
  return evidence.length === 1
    && evidence[0]!.kind === "rollback_rehearsal"
    && evidence[0]!.observedAt <= requestedAt;
}

function isValidLegacySurfaceMutationTime(value: number, lastTransitionAt: number): boolean {
  const now = Date.now();
  return value >= lastTransitionAt
    && value >= now - LEGACY_SURFACE_CLOCK_SKEW_MS
    && value <= now + LEGACY_SURFACE_CLOCK_SKEW_MS;
}

function isLegacySurfacePhaseValue(value: unknown): value is LegacySurfacePhase {
  return typeof value === "string" && (LEGACY_SURFACE_PHASES as readonly string[]).includes(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isDeploymentSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

async function objectRegistryDigest(objects: InstanceObjectRegistrationV1[]): Promise<string> {
  const identities = objects.map(({ registeredAt: _registeredAt, ...object }) => object);
  const bytes = new TextEncoder().encode(JSON.stringify(identities));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeObjectInventory(value: unknown): InstanceObjectRegistrationV1[] | undefined {
  if (!Array.isArray(value) || value.length > 10_000) return undefined;
  const objects = value.map(normalizeInstanceObjectRegistration);
  if (objects.some((object) => !object)) return undefined;
  const normalized = objects as InstanceObjectRegistrationV1[];
  normalized.sort((left, right) => (
    compareStrings(left.kind, right.kind) || compareStrings(left.instanceName, right.instanceName)
  ));
  const keys = normalized.map(({ kind, instanceName }) => `${kind}\0${instanceName}`);
  return new Set(keys).size === keys.length ? normalized : undefined;
}

function sameRegistration(left: InstanceObjectRegistrationV1, right: InstanceObjectRegistrationV1): boolean {
  return sameRegistrationIdentityAndPolicy(left, right)
    && left.schemaVersion === right.schemaVersion;
}

function sameRegistrationIdentityAndPolicy(
  left: InstanceObjectRegistrationV1,
  right: InstanceObjectRegistrationV1,
): boolean {
  return left.kind === right.kind
    && left.instanceName === right.instanceName
    && left.rootInstanceName === right.rootInstanceName
    && left.stateClass === right.stateClass
    && left.restoreBehavior === right.restoreBehavior;
}

function isForwardSchemaRegistrationUpgrade(
  existing: InstanceObjectRegistrationV1,
  registration: InstanceObjectRegistrationV1,
): boolean {
  if (!sameRegistrationIdentityAndPolicy(existing, registration)) return false;
  const current = parseSchemaVersion(existing.schemaVersion);
  const next = parseSchemaVersion(registration.schemaVersion);
  return Boolean(current && next && current.family === next.family && next.version > current.version);
}

function parseSchemaVersion(value: string): { family: string; version: number } | undefined {
  const match = /^([a-z][a-z0-9-]*)-v([1-9][0-9]*)$/.exec(value);
  if (!match) return undefined;
  const version = Number(match[2]);
  return Number.isSafeInteger(version) ? { family: match[1]!, version } : undefined;
}

function sameOperationFence(left: InstanceOperationStateV1, right: InstanceOperationStateV1): boolean {
  return left.operationId === right.operationId
    && left.fenceId === right.fenceId
    && left.kind === right.kind;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchesState(
  state: InstanceMaintenanceStateV1,
  input: { operationId?: unknown; captureEpoch?: unknown },
): boolean {
  return state.operationId === normalizeId(input.operationId) && state.captureEpoch === normalizeId(input.captureEpoch);
}

function normalizeId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(normalized)
    ? normalized
    : "";
}

function normalizeError(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9_]{0,79}$/.test(normalized) ? normalized : "";
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasExactObjectKeys(value: unknown, expected: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
