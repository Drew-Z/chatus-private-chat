import { DurableObject } from "cloudflare:workers";
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

export class InstanceCoordinator extends DurableObject<Record<string, never>> {
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
        if (!sameRegistration(existing, registration)) return { ok: false, error: "instance_object_conflict" };
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
  return left.kind === right.kind
    && left.instanceName === right.instanceName
    && left.rootInstanceName === right.rootInstanceName
    && left.schemaVersion === right.schemaVersion
    && left.stateClass === right.stateClass
    && left.restoreBehavior === right.restoreBehavior;
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
