import { DurableObject } from "cloudflare:workers";
import {
  createProviderAttemptId,
  decodeProviderAttemptStartInput,
  decodeProviderAttemptTerminalInput,
  providerAttemptDiagnostic,
  type ProviderAttemptDiagnosticV1,
  type ProviderAttemptProjectionV1,
  type ProviderAttemptStartResultV1,
  type ProviderAttemptTerminalResultV1,
} from "./contracts/provider-attempt";
import type { InstanceCoordinator } from "./instance-coordinator";
import { captureDurableObjectState } from "./services/durable-object-capture";
import { INSTANCE_MAINTENANCE_COORDINATOR } from "./services/instance-capture";

export const PROVIDER_ATTEMPT_LEDGER_SCHEMA_VERSION = 1;
const PROVIDER_ATTEMPT_LEDGER_TABLES = new Set([
  "provider_attempt_schema_migrations",
  "provider_attempt_events",
  "provider_attempt_projection",
]);

type ProviderAttemptLedgerEnv = {
  INSTANCE_COORDINATOR: DurableObjectNamespace<InstanceCoordinator>;
};

type ProviderAttemptProjectionRow = {
  attempt_id: string;
  idempotency_key: string;
  turn_id: string;
  run_id: string;
  run_kind: ProviderAttemptProjectionV1["runKind"];
  logical_route_id: string;
  provider_id: string;
  offering_id: string;
  model: string;
  fallback_index: number;
  credential_class: ProviderAttemptProjectionV1["credentialClass"];
  operation_id: string;
  fence_id: string;
  operation_kind: ProviderAttemptProjectionV1["operation"]["kind"];
  operation_started_at: number;
  status: ProviderAttemptProjectionV1["status"];
  error_class: ProviderAttemptProjectionV1["errorClass"];
  started_at: number;
  ended_at: number;
};

export class ProviderAttemptLedger extends DurableObject<ProviderAttemptLedgerEnv> {
  private readonly providerId: string;

  constructor(ctx: DurableObjectState, env: ProviderAttemptLedgerEnv) {
    super(ctx, env);
    const providerId = ctx.id.name;
    if (!providerId) throw new Error("provider_attempt_ledger_instance_name_unavailable");
    this.providerId = providerId;
    ctx.blockConcurrencyWhile(async () => {
      this.applySchemaMigrations();
    });
  }

  async start(input: unknown): Promise<ProviderAttemptStartResultV1> {
    const normalized = decodeProviderAttemptStartInput(input);
    if (!normalized || normalized.providerId !== this.providerId) {
      throw new Error("provider_attempt_start_invalid");
    }
    await this.registerObject();
    return this.ctx.storage.transactionSync(() => {
      const existing = this.readProjectionByIdempotencyKey(normalized.idempotencyKey);
      if (existing) {
        if (!sameStartIdentity(existing, normalized)) throw new Error("provider_attempt_conflict");
        return { created: false, attempt: existing };
      }

      const attemptId = createProviderAttemptId();
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_attempt_projection(
          attempt_id, idempotency_key, turn_id, run_id, run_kind,
          logical_route_id, provider_id, offering_id, model, fallback_index,
          credential_class, operation_id, fence_id, operation_kind,
          operation_started_at, status, error_class, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', 'none', ?, 0)`,
        attemptId,
        normalized.idempotencyKey,
        normalized.turnId,
        normalized.runId,
        normalized.runKind,
        normalized.logicalRouteId,
        normalized.providerId,
        normalized.offeringId,
        normalized.model,
        normalized.fallbackIndex,
        normalized.credentialClass,
        normalized.operation.operationId,
        normalized.operation.fenceId,
        normalized.operation.kind,
        normalized.operation.startedAt,
        normalized.startedAt,
      );
      this.insertEvent(this.readProjectionByAttemptId(attemptId), "started", normalized.startedAt);
      return { created: true, attempt: this.requireProjection(attemptId) };
    });
  }

  terminal(input: unknown): ProviderAttemptTerminalResultV1 {
    const normalized = decodeProviderAttemptTerminalInput(input);
    if (!normalized) throw new Error("provider_attempt_terminal_invalid");
    return this.ctx.storage.transactionSync(() => {
      const existing = this.requireProjection(normalized.attemptId);
      if (existing.providerId !== this.providerId || normalized.endedAt < existing.startedAt) {
        throw new Error("provider_attempt_terminal_invalid");
      }
      if (existing.status !== "started") {
        if (existing.status !== normalized.status || existing.errorClass !== normalized.errorClass) {
          throw new Error("provider_attempt_conflict");
        }
        return { updated: false, attempt: existing };
      }

      this.ctx.storage.sql.exec(
        `UPDATE provider_attempt_projection
         SET status = ?, error_class = ?, ended_at = ?
         WHERE attempt_id = ? AND status = 'started'`,
        normalized.status,
        normalized.errorClass,
        normalized.endedAt,
        normalized.attemptId,
      );
      const updated = this.requireProjection(normalized.attemptId);
      this.insertEvent(updated, "terminal", normalized.endedAt);
      return { updated: true, attempt: updated };
    });
  }

  listRecent(input: { limit?: number } = {}): ProviderAttemptDiagnosticV1[] {
    const limit = typeof input.limit === "number" && Number.isInteger(input.limit)
      ? Math.min(100, Math.max(1, input.limit))
      : 25;
    return this.ctx.storage.sql.exec<ProviderAttemptProjectionRow>(
      `${projectionSelect()} ORDER BY started_at DESC, attempt_id DESC LIMIT ?`,
      limit,
    ).toArray().map(projectionFromRow).map(providerAttemptDiagnostic);
  }

  async captureInstanceState(captureEpoch: string) {
    if (!isCaptureEpoch(captureEpoch)) throw new Error("capture_epoch_invalid");
    return captureDurableObjectState(
      this.ctx.storage,
      `provider-attempt-ledger-v${PROVIDER_ATTEMPT_LEDGER_SCHEMA_VERSION}`,
      (table) => PROVIDER_ATTEMPT_LEDGER_TABLES.has(table),
    );
  }

  private async registerObject(): Promise<void> {
    const registered = await this.env.INSTANCE_COORDINATOR
      .getByName(INSTANCE_MAINTENANCE_COORDINATOR)
      .registerObject({
        version: 1,
        kind: "provider_attempt_ledger",
        instanceName: this.providerId,
        rootInstanceName: "",
        schemaVersion: `provider-attempt-ledger-v${PROVIDER_ATTEMPT_LEDGER_SCHEMA_VERSION}`,
        stateClass: "authoritative",
        restoreBehavior: "restore",
        registeredAt: Date.now(),
      });
    if (!registered.ok) throw new Error(registered.error);
  }

  private applySchemaMigrations(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS provider_attempt_schema_migrations(
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      const current = this.ctx.storage.sql.exec<{ version: number }>(
        "SELECT COALESCE(MAX(version), 0) AS version FROM provider_attempt_schema_migrations",
      ).one().version;
      if (current < 1) {
        this.ctx.storage.sql.exec(`
          CREATE TABLE provider_attempt_events(
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_id TEXT NOT NULL,
            event_kind TEXT NOT NULL CHECK(event_kind IN ('started', 'terminal')),
            turn_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            run_kind TEXT NOT NULL,
            logical_route_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            offering_id TEXT NOT NULL,
            model TEXT NOT NULL,
            fallback_index INTEGER NOT NULL,
            credential_class TEXT NOT NULL,
            operation_id TEXT NOT NULL,
            fence_id TEXT NOT NULL,
            operation_kind TEXT NOT NULL,
            operation_started_at INTEGER NOT NULL,
            status TEXT NOT NULL,
            error_class TEXT NOT NULL,
            at INTEGER NOT NULL,
            UNIQUE(attempt_id, event_kind)
          );
          CREATE INDEX provider_attempt_events_turn_run_idx
            ON provider_attempt_events(turn_id, run_id, seq);
          CREATE TABLE provider_attempt_projection(
            attempt_id TEXT PRIMARY KEY,
            idempotency_key TEXT NOT NULL UNIQUE,
            turn_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            run_kind TEXT NOT NULL,
            logical_route_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            offering_id TEXT NOT NULL,
            model TEXT NOT NULL,
            fallback_index INTEGER NOT NULL,
            credential_class TEXT NOT NULL,
            operation_id TEXT NOT NULL,
            fence_id TEXT NOT NULL,
            operation_kind TEXT NOT NULL,
            operation_started_at INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('started', 'succeeded', 'failed', 'cancelled', 'timed_out')),
            error_class TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER NOT NULL
          );
          CREATE INDEX provider_attempt_projection_recent_idx
            ON provider_attempt_projection(started_at DESC, attempt_id DESC);
        `);
        this.ctx.storage.sql.exec(
          "INSERT INTO provider_attempt_schema_migrations(version, applied_at) VALUES (1, ?)",
          Date.now(),
        );
      }
    });
  }

  private insertEvent(
    attempt: ProviderAttemptProjectionV1 | undefined,
    eventKind: "started" | "terminal",
    at: number,
  ): void {
    if (!attempt) throw new Error("provider_attempt_missing");
    this.ctx.storage.sql.exec(
      `INSERT INTO provider_attempt_events(
        attempt_id, event_kind, turn_id, run_id, run_kind,
        logical_route_id, provider_id, offering_id, model, fallback_index,
        credential_class, operation_id, fence_id, operation_kind,
        operation_started_at, status, error_class, at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attempt.attemptId,
      eventKind,
      attempt.turnId,
      attempt.runId,
      attempt.runKind,
      attempt.logicalRouteId,
      attempt.providerId,
      attempt.offeringId,
      attempt.model,
      attempt.fallbackIndex,
      attempt.credentialClass,
      attempt.operation.operationId,
      attempt.operation.fenceId,
      attempt.operation.kind,
      attempt.operation.startedAt,
      attempt.status,
      attempt.errorClass,
      at,
    );
  }

  private readProjectionByIdempotencyKey(idempotencyKey: string): ProviderAttemptProjectionV1 | undefined {
    const row = this.ctx.storage.sql.exec<ProviderAttemptProjectionRow>(
      `${projectionSelect()} WHERE idempotency_key = ? LIMIT 1`,
      idempotencyKey,
    ).toArray()[0];
    return row ? projectionFromRow(row) : undefined;
  }

  private readProjectionByAttemptId(attemptId: string): ProviderAttemptProjectionV1 | undefined {
    const row = this.ctx.storage.sql.exec<ProviderAttemptProjectionRow>(
      `${projectionSelect()} WHERE attempt_id = ? LIMIT 1`,
      attemptId,
    ).toArray()[0];
    return row ? projectionFromRow(row) : undefined;
  }

  private requireProjection(attemptId: string): ProviderAttemptProjectionV1 {
    const attempt = this.readProjectionByAttemptId(attemptId);
    if (!attempt) throw new Error("provider_attempt_missing");
    return attempt;
  }
}

function projectionSelect(): string {
  return `SELECT
    attempt_id, idempotency_key, turn_id, run_id, run_kind,
    logical_route_id, provider_id, offering_id, model, fallback_index,
    credential_class, operation_id, fence_id, operation_kind,
    operation_started_at, status, error_class, started_at, ended_at
    FROM provider_attempt_projection`;
}

function projectionFromRow(row: ProviderAttemptProjectionRow): ProviderAttemptProjectionV1 {
  return {
    version: 1,
    attemptId: row.attempt_id,
    idempotencyKey: row.idempotency_key,
    turnId: row.turn_id,
    runId: row.run_id,
    runKind: row.run_kind,
    logicalRouteId: row.logical_route_id,
    providerId: row.provider_id,
    offeringId: row.offering_id,
    model: row.model,
    fallbackIndex: row.fallback_index,
    credentialClass: row.credential_class,
    operation: {
      version: 1,
      operationId: row.operation_id,
      fenceId: row.fence_id,
      kind: row.operation_kind,
      startedAt: row.operation_started_at,
    },
    status: row.status,
    errorClass: row.error_class,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function sameStartIdentity(
  existing: ProviderAttemptProjectionV1,
  input: NonNullable<ReturnType<typeof decodeProviderAttemptStartInput>>,
): boolean {
  return existing.turnId === input.turnId
    && existing.runId === input.runId
    && existing.runKind === input.runKind
    && existing.logicalRouteId === input.logicalRouteId
    && existing.providerId === input.providerId
    && existing.offeringId === input.offeringId
    && existing.model === input.model
    && existing.fallbackIndex === input.fallbackIndex
    && existing.credentialClass === input.credentialClass
    && existing.operation.operationId === input.operation.operationId
    && existing.operation.fenceId === input.operation.fenceId
    && existing.operation.kind === input.operation.kind
    && existing.operation.startedAt === input.operation.startedAt;
}

function isCaptureEpoch(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(value);
}
