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
import {
  PROVIDER_USAGE_TOKEN_FIELDS,
  calculateProviderCostMicros,
  decodeProviderBudgetOperatorActionInput,
  decodeProviderBudgetPolicyInput,
  decodeProviderCostEvidenceInput,
  decodeProviderPriceCatalogInput,
  decodeProviderReconciliationImportInput,
  decodeProviderUsageEvidenceInput,
  emptyProviderTokenUsage,
  sameProviderTokenUsage,
  type ProviderCostEvidenceInputV1,
  type ProviderCostEvidenceResultV1,
  type ProviderBudgetBalanceProjectionV1,
  type ProviderBudgetDecisionReason,
  type ProviderBudgetDecisionStatus,
  type ProviderBudgetDecisionV1,
  type ProviderBudgetMode,
  type ProviderBudgetOperatorActionResultV1,
  type ProviderBudgetPolicyInputV1,
  type ProviderBudgetPolicyProjectionV1,
  type ProviderBudgetPolicyResultV1,
  type ProviderBudgetReservationProjectionV1,
  type ProviderBudgetReservationStatus,
  type ProviderFinanceAttemptProjectionV1,
  type ProviderFinanceSnapshotV1,
  type ProviderPriceCatalogInputV1,
  type ProviderPriceCatalogResultV1,
  type ProviderReconciliationImportResultV1,
  type ProviderReconciliationProjectionV1,
  type ProviderTokenUsageV1,
  type ProviderUsageEvidenceInputV1,
  type ProviderUsageEvidenceResultV1,
  type ProviderUsageTokenField,
} from "./contracts/provider-finance";
import type { InstanceCoordinator } from "./instance-coordinator";
import { captureDurableObjectState } from "./services/durable-object-capture";
import { INSTANCE_MAINTENANCE_COORDINATOR } from "./services/instance-capture";

export const PROVIDER_ATTEMPT_LEDGER_SCHEMA_VERSION = 3;
const PROVIDER_ATTEMPT_LEDGER_TABLES = new Set([
  "provider_attempt_schema_migrations",
  "provider_attempt_events",
  "provider_attempt_projection",
  "provider_price_catalog",
  "provider_attempt_price_binding",
  "provider_usage_evidence",
  "provider_usage_projection",
  "provider_cost_evidence",
  "provider_reconciliation_imports",
  "provider_budget_policies",
  "provider_budget_events",
  "provider_budget_decisions",
  "provider_budget_reservations",
  "provider_budget_projection",
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

type ProviderUsageProjectionRow = {
  attempt_id: string;
  current_input_no_cache_tokens: number | null;
  current_cache_read_input_tokens: number | null;
  current_cache_write_input_tokens: number | null;
  current_output_text_tokens: number | null;
  current_reasoning_output_tokens: number | null;
  input_no_cache_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_write_input_tokens: number | null;
  output_text_tokens: number | null;
  reasoning_output_tokens: number | null;
  evidence_class: "unknown" | "estimated" | "reported" | "reconciled";
  known_evidence_count: number;
  missing_evidence_count: number;
  latest_observed_at: number;
};

type ProviderFinanceAttemptRow = ProviderAttemptProjectionRow & {
  usage_input_no_cache_tokens: number | null;
  usage_cache_read_input_tokens: number | null;
  usage_cache_write_input_tokens: number | null;
  usage_output_text_tokens: number | null;
  usage_reasoning_output_tokens: number | null;
  usage_evidence_class: ProviderUsageProjectionRow["evidence_class"] | null;
  catalog_version_id: string | null;
  price_resolution: "matched" | "missing" | null;
};

type ProviderFinanceAggregateRow = {
  calls: number;
  succeeded: number;
  failures: number;
  retries: number;
  fallbacks: number;
  average_latency_ms: number | null;
  unknown_usage_attempts: number;
  provisional_cost_attempts: number;
  unknown_cost_attempts: number;
  usage_input_no_cache_tokens: number | null;
  usage_cache_read_input_tokens: number | null;
  usage_cache_write_input_tokens: number | null;
  usage_output_text_tokens: number | null;
  usage_reasoning_output_tokens: number | null;
};

type ProviderFinanceCostAggregateRow = {
  currency: string;
  provisional_micros: number;
  settled_micros: number;
  corrected_micros: number;
  total_micros: number;
};

type ProviderUsageEvidenceRow = {
  evidence_id: string;
  attempt_id: string;
  mode: ProviderUsageEvidenceInputV1["mode"];
  evidence_class: ProviderUsageEvidenceInputV1["evidenceClass"];
  source: ProviderUsageEvidenceInputV1["source"];
  observed_at: number;
  input_no_cache_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_write_input_tokens: number | null;
  output_text_tokens: number | null;
  reasoning_output_tokens: number | null;
  effective_input_no_cache_tokens: number | null;
  effective_cache_read_input_tokens: number | null;
  effective_cache_write_input_tokens: number | null;
  effective_output_text_tokens: number | null;
  effective_reasoning_output_tokens: number | null;
};

type ProviderPriceCatalogRow = {
  catalog_version_id: string;
  provider_id: string;
  offering_id: string;
  model: string;
  currency: string;
  precision: number;
  unit: ProviderPriceCatalogInputV1["unit"];
  input_no_cache_price_micros: number | null;
  cache_read_input_price_micros: number | null;
  cache_write_input_price_micros: number | null;
  output_text_price_micros: number | null;
  reasoning_output_price_micros: number | null;
  effective_from: number;
  effective_to: number | null;
  approver: string;
  provenance: string;
  created_at: number;
};

type ProviderCostEvidenceRow = {
  event_id: string;
  attempt_id: string;
  kind: ProviderCostEvidenceInputV1["kind"];
  evidence_class: ProviderCostEvidenceInputV1["evidenceClass"];
  currency: string;
  amount_micros: number;
  supersedes_event_id: string | null;
  source_evidence_id: string | null;
  observed_at: number;
};

type ProviderReconciliationRow = {
  reconciliation_id: string;
  fingerprint: string;
  revision: number;
  supersedes_reconciliation_id: string | null;
  provider_id: string;
  account_fingerprint: string;
  period_start: number;
  period_end: number;
  currency: string;
  reported_total_micros: number;
  matched_total_micros: number;
  unmatched_variance_micros: number;
  status: ProviderReconciliationProjectionV1["status"];
  imported_at: number;
};

type ProviderBudgetPolicyRow = {
  policy_id: string;
  policy_version: number;
  idempotency_key: string;
  provider_id: string;
  currency: string;
  mode: ProviderBudgetMode;
  period_start: number;
  period_end: number;
  limit_micros: number;
  max_attempt_reserve_micros: number;
  hold_review_after_ms: number;
  allow_unknown_price: number;
  approver: string;
  created_at: number;
};

type ProviderBudgetDecisionRow = {
  idempotency_key: string;
  attempt_id: string | null;
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
  started_at: number;
  policy_id: string | null;
  policy_version: number | null;
  status: ProviderBudgetDecisionStatus;
  reason: ProviderBudgetDecisionReason;
  requested_micros: number;
  reservation_id: string | null;
};

type ProviderBudgetReservationRow = {
  reservation_id: string;
  attempt_id: string;
  policy_id: string;
  policy_version: number;
  currency: string;
  status: ProviderBudgetReservationStatus;
  reserved_micros: number;
  settled_micros: number;
  released_micros: number;
  held_micros: number;
  created_at: number;
  updated_at: number;
  review_after: number;
};

type ProviderBudgetProjectionRow = {
  policy_id: string;
  policy_version: number;
  provider_id: string;
  currency: string;
  mode: ProviderBudgetMode;
  period_start: number;
  period_end: number;
  limit_micros: number;
  settled_micros: number;
  reserved_micros: number;
  held_micros: number;
  denial_count: number;
  alert_count: number;
  updated_at: number;
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
    const result = this.ctx.storage.transactionSync(() => this.startNormalized(normalized));
    if (result.denied) {
      throw new Error(result.reason === "price_unknown"
        ? "provider_budget_policy_unknown"
        : "provider_budget_exceeded");
    }
    return result.result;
  }

  async addBudgetPolicy(input: unknown): Promise<ProviderBudgetPolicyResultV1> {
    const normalized = decodeProviderBudgetPolicyInput(input);
    if (!normalized || normalized.providerId !== this.providerId) {
      throw new Error("provider_budget_policy_invalid");
    }
    await this.registerObject();
    return this.ctx.storage.transactionSync(() => {
      const replay = this.readBudgetPolicyByIdempotencyKey(normalized.idempotencyKey);
      if (replay) {
        const policy = budgetPolicyFromRow(replay);
        if (!sameBudgetPolicyInput(replay, normalized)) throw new Error("provider_budget_policy_conflict");
        return { created: false, policy };
      }
      const latest = this.readLatestBudgetPolicy(normalized.policyId);
      const latestVersion = latest?.policy_version ?? 0;
      if (latestVersion !== normalized.expectedPreviousVersion) {
        throw new Error("provider_budget_policy_conflict");
      }
      if (!latest && normalized.mode !== "shadow") {
        throw new Error("provider_budget_policy_transition");
      }
      const overlap = this.ctx.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM provider_budget_policies
         WHERE provider_id = ? AND currency = ? AND policy_id <> ?
           AND period_start < ? AND period_end > ?`,
        this.providerId,
        normalized.currency,
        normalized.policyId,
        normalized.periodEnd,
        normalized.periodStart,
      ).one().count;
      if (overlap > 0) throw new Error("provider_budget_policy_overlap");
      if (latest && (
        latest.provider_id !== normalized.providerId
        || latest.currency !== normalized.currency
        || latest.period_start !== normalized.periodStart
        || latest.period_end !== normalized.periodEnd
      )) throw new Error("provider_budget_policy_conflict");

      const policyVersion = latestVersion + 1;
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_budget_policies(
          policy_id, policy_version, idempotency_key, provider_id, currency, mode,
          period_start, period_end, limit_micros, max_attempt_reserve_micros,
          hold_review_after_ms, allow_unknown_price, approver, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        normalized.policyId,
        policyVersion,
        normalized.idempotencyKey,
        normalized.providerId,
        normalized.currency,
        normalized.mode,
        normalized.periodStart,
        normalized.periodEnd,
        normalized.limitMicros,
        normalized.maxAttemptReserveMicros,
        normalized.holdReviewAfterMs,
        normalized.approver,
        normalized.createdAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_budget_projection(
          policy_id, policy_version, provider_id, currency, mode, period_start,
          period_end, limit_micros, settled_micros, reserved_micros, held_micros,
          denial_count, alert_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?)
        ON CONFLICT(policy_id) DO UPDATE SET
          policy_version = excluded.policy_version,
          mode = excluded.mode,
          limit_micros = excluded.limit_micros,
          updated_at = excluded.updated_at`,
        normalized.policyId,
        policyVersion,
        normalized.providerId,
        normalized.currency,
        normalized.mode,
        normalized.periodStart,
        normalized.periodEnd,
        normalized.limitMicros,
        normalized.createdAt,
      );
      return {
        created: true,
        policy: budgetPolicyProjectionFromInput(normalized, policyVersion),
      };
    });
  }

  reconcileBudgetReservation(input: unknown): ProviderBudgetOperatorActionResultV1 {
    const normalized = decodeProviderBudgetOperatorActionInput(input);
    if (!normalized || normalized.providerId !== this.providerId) {
      throw new Error("provider_budget_action_invalid");
    }
    return this.ctx.storage.transactionSync(() => this.applyBudgetOperatorAction(normalized));
  }

  private startNormalized(
    normalized: NonNullable<ReturnType<typeof decodeProviderAttemptStartInput>>,
  ): { denied: true; reason: ProviderBudgetDecisionReason } | {
    denied: false;
    result: ProviderAttemptStartResultV1;
  } {
    const replayDecision = this.readBudgetDecision(normalized.idempotencyKey);
    if (replayDecision) {
      if (!sameBudgetDecisionIdentity(replayDecision, normalized)) throw new Error("provider_attempt_conflict");
      if (replayDecision.status === "denied") {
        return { denied: true, reason: replayDecision.reason };
      }
      const replayAttempt = this.readProjectionByIdempotencyKey(normalized.idempotencyKey);
      if (!replayAttempt || !sameStartIdentity(replayAttempt, normalized)) {
        throw new Error("provider_attempt_conflict");
      }
      return {
        denied: false,
        result: {
          created: false,
          attempt: replayAttempt,
          budgetDecision: budgetDecisionFromRow(replayDecision),
        },
      };
    }

    const existing = this.readProjectionByIdempotencyKey(normalized.idempotencyKey);
    if (existing) {
      if (!sameStartIdentity(existing, normalized)) throw new Error("provider_attempt_conflict");
      return { denied: false, result: { created: false, attempt: existing } };
    }

    const policyRow = this.readActiveBudgetPolicy(normalized.startedAt);
    if (!policyRow || policyRow.mode === "disabled") {
      return { denied: false, result: { created: true, attempt: this.insertAttempt(normalized) } };
    }
    const policy = budgetPolicyFromRow(policyRow);
    const requestedMicros = policy.maxAttemptReserveMicros;
    const balance = this.requireBudgetProjection(policy.policyId);
    const availableMicros = budgetAvailableMicros(balance);
    const price = this.resolveAttemptPrice(normalized.offeringId, normalized.model, normalized.startedAt);
    const excluded = normalized.credentialClass === "user";
    const reason: ProviderBudgetDecisionReason = excluded
      ? "byok_excluded"
      : !price
        ? "price_unknown"
        : availableMicros < requestedMicros
          ? "insufficient_balance"
          : "within_limit";
    const status: ProviderBudgetDecisionStatus = excluded
      ? "excluded"
      : policy.mode === "hard"
        ? reason === "within_limit" ? "reserved" : "denied"
        : reason === "within_limit" ? "observed" : "would_deny";
    const reservationId = status === "reserved" ? `reservation_${crypto.randomUUID()}` : null;

    if (status === "denied") {
      this.insertBudgetDecision(normalized, policy, status, reason, requestedMicros, null, null);
      this.appendBudgetEvent(
        policy,
        null,
        null,
        status,
        requestedMicros,
        reason,
        normalized.startedAt,
        `budget-decision:${normalized.idempotencyKey}`,
      );
      this.ctx.storage.sql.exec(
        `UPDATE provider_budget_projection
         SET denial_count = denial_count + 1, updated_at = ? WHERE policy_id = ?`,
        normalized.startedAt,
        policy.policyId,
      );
      return { denied: true, reason };
    }

    const attempt = this.insertAttempt(normalized);
    if (reservationId) {
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_budget_reservations(
          reservation_id, attempt_id, policy_id, policy_version, currency, status,
          reserved_micros, settled_micros, released_micros, held_micros,
          created_at, updated_at, review_after
        ) VALUES (?, ?, ?, ?, ?, 'reserved', ?, 0, 0, 0, ?, ?, ?)`,
        reservationId,
        attempt.attemptId,
        policy.policyId,
        policy.policyVersion,
        policy.currency,
        requestedMicros,
        normalized.startedAt,
        normalized.startedAt,
        normalized.startedAt + policy.holdReviewAfterMs,
      );
      this.ctx.storage.sql.exec(
        `UPDATE provider_budget_projection
         SET reserved_micros = reserved_micros + ?, updated_at = ? WHERE policy_id = ?`,
        requestedMicros,
        normalized.startedAt,
        policy.policyId,
      );
    } else if (status === "would_deny" && policy.mode === "soft") {
      this.ctx.storage.sql.exec(
        `UPDATE provider_budget_projection
         SET alert_count = alert_count + 1, updated_at = ? WHERE policy_id = ?`,
        normalized.startedAt,
        policy.policyId,
      );
    }
    this.insertBudgetDecision(
      normalized,
      policy,
      status,
      reason,
      requestedMicros,
      reservationId,
      attempt.attemptId,
    );
    this.appendBudgetEvent(
      policy,
      attempt.attemptId,
      reservationId,
      status,
      requestedMicros,
      reason,
      normalized.startedAt,
      `budget-decision:${normalized.idempotencyKey}`,
    );
    return {
      denied: false,
      result: {
        created: true,
        attempt,
        budgetDecision: {
          version: 1,
          policyId: policy.policyId,
          policyVersion: policy.policyVersion,
          status,
          reason,
          requestedMicros,
          reservationId,
        },
      },
    };
  }

  private insertAttempt(
    normalized: NonNullable<ReturnType<typeof decodeProviderAttemptStartInput>>,
  ): ProviderAttemptProjectionV1 {
      const existing = this.readProjectionByIdempotencyKey(normalized.idempotencyKey);
      if (existing) {
        if (!sameStartIdentity(existing, normalized)) throw new Error("provider_attempt_conflict");
        return existing;
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
      this.bindAttemptPrice(attemptId, normalized.offeringId, normalized.model, normalized.startedAt);
      this.insertEvent(this.readProjectionByAttemptId(attemptId), "started", normalized.startedAt);
      return this.requireProjection(attemptId);
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
      this.settleBudgetReservation(normalized.attemptId, normalized.endedAt);
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

  async addPriceCatalog(input: unknown): Promise<ProviderPriceCatalogResultV1> {
    const normalized = decodeProviderPriceCatalogInput(input);
    if (!normalized || normalized.providerId !== this.providerId) {
      throw new Error("provider_price_catalog_invalid");
    }
    await this.registerObject();
    return this.ctx.storage.transactionSync(() => {
      const existing = this.readPriceCatalog(normalized.catalogVersionId);
      if (existing) {
        if (!samePriceCatalog(existing, normalized)) throw new Error("provider_price_catalog_conflict");
        return { created: false, catalog: existing };
      }
      const overlap = this.ctx.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM provider_price_catalog
         WHERE offering_id = ? AND model = ?
           AND (? IS NULL OR effective_from < ?)
           AND (effective_to IS NULL OR effective_to > ?)`,
        normalized.offeringId,
        normalized.model,
        normalized.effectiveTo,
        normalized.effectiveTo,
        normalized.effectiveFrom,
      ).one().count;
      if (overlap > 0) throw new Error("provider_price_catalog_overlap");
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_price_catalog(
          catalog_version_id, provider_id, offering_id, model, currency, precision, unit,
          input_no_cache_price_micros, cache_read_input_price_micros,
          cache_write_input_price_micros, output_text_price_micros,
          reasoning_output_price_micros, effective_from, effective_to,
          approver, provenance, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized.catalogVersionId,
        normalized.providerId,
        normalized.offeringId,
        normalized.model,
        normalized.currency,
        normalized.precision,
        normalized.unit,
        normalized.inputNoCachePriceMicros,
        normalized.cacheReadInputPriceMicros,
        normalized.cacheWriteInputPriceMicros,
        normalized.outputTextPriceMicros,
        normalized.reasoningOutputPriceMicros,
        normalized.effectiveFrom,
        normalized.effectiveTo,
        normalized.approver,
        normalized.provenance,
        normalized.createdAt,
      );
      return { created: true, catalog: normalized };
    });
  }

  appendUsage(input: unknown): ProviderUsageEvidenceResultV1 {
    const normalized = decodeProviderUsageEvidenceInput(input);
    if (!normalized) throw new Error("provider_usage_evidence_invalid");
    return this.ctx.storage.transactionSync(() => {
      const attempt = this.requireProjection(normalized.attemptId);
      if (attempt.providerId !== this.providerId || normalized.observedAt < attempt.startedAt) {
        throw new Error("provider_usage_evidence_invalid");
      }
      const duplicate = this.readUsageEvidence(normalized.evidenceId);
      if (duplicate) {
        const stored = usageEvidenceFromRow(duplicate);
        if (!sameUsageEvidence(stored.input, normalized)) throw new Error("provider_usage_evidence_conflict");
        return { created: false, evidenceId: normalized.evidenceId, effectiveDelta: stored.effectiveDelta };
      }

      const projection = this.readUsageProjection(normalized.attemptId);
      const effectiveDelta = normalizeUsageDelta(normalized, projection);
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_usage_evidence(
          evidence_id, attempt_id, mode, evidence_class, source, observed_at,
          input_no_cache_tokens, cache_read_input_tokens, cache_write_input_tokens,
          output_text_tokens, reasoning_output_tokens,
          effective_input_no_cache_tokens, effective_cache_read_input_tokens,
          effective_cache_write_input_tokens, effective_output_text_tokens,
          effective_reasoning_output_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized.evidenceId,
        normalized.attemptId,
        normalized.mode,
        normalized.evidenceClass,
        normalized.source,
        normalized.observedAt,
        normalized.inputNoCacheTokens,
        normalized.cacheReadInputTokens,
        normalized.cacheWriteInputTokens,
        normalized.outputTextTokens,
        normalized.reasoningOutputTokens,
        effectiveDelta.inputNoCacheTokens,
        effectiveDelta.cacheReadInputTokens,
        effectiveDelta.cacheWriteInputTokens,
        effectiveDelta.outputTextTokens,
        effectiveDelta.reasoningOutputTokens,
      );
      this.writeUsageProjection(normalized, projection, effectiveDelta);
      this.appendCalculatedCost(normalized, effectiveDelta);
      this.reconcileBudgetReservationFromEvidence(normalized.attemptId, normalized.observedAt);
      return { created: true, evidenceId: normalized.evidenceId, effectiveDelta };
    });
  }

  appendCostEvidence(input: unknown): ProviderCostEvidenceResultV1 {
    const normalized = decodeProviderCostEvidenceInput(input);
    if (!normalized) throw new Error("provider_cost_evidence_invalid");
    return this.ctx.storage.transactionSync(() => {
      const result = this.appendCostEvidenceNormalized(normalized);
      this.reconcileBudgetReservationFromEvidence(normalized.attemptId, normalized.observedAt);
      return result;
    });
  }

  async importReconciliation(input: unknown): Promise<ProviderReconciliationImportResultV1> {
    const normalized = decodeProviderReconciliationImportInput(input);
    if (!normalized || normalized.providerId !== this.providerId) {
      throw new Error("provider_reconciliation_invalid");
    }
    await this.registerObject();
    return this.ctx.storage.transactionSync(() => {
      const replay = this.readReconciliationByFingerprintAndImportedAt(
        normalized.fingerprint,
        normalized.importedAt,
      );
      if (replay) {
        const projection = reconciliationFromRow(replay);
        if (!sameReconciliation(projection, normalized)) throw new Error("provider_reconciliation_conflict");
        return { created: false, reconciliation: projection };
      }
      const latest = this.readReconciliationByFingerprint(normalized.fingerprint);
      if (latest) {
        const latestProjection = reconciliationFromRow(latest);
        if (!sameReconciliationIdentity(latestProjection, normalized) || normalized.importedAt <= latest.imported_at) {
          throw new Error("provider_reconciliation_conflict");
        }
        if (sameReconciliationState(latestProjection, normalized)) {
          return { created: false, reconciliation: latestProjection };
        }
      }
      const reconciliationId = `reconciliation_${crypto.randomUUID()}`;
      const revision = (latest?.revision ?? 0) + 1;
      const supersedesReconciliationId = latest?.reconciliation_id ?? null;
      const variance = normalized.reportedTotalMicros - normalized.matchedTotalMicros;
      this.ctx.storage.sql.exec(
        `INSERT INTO provider_reconciliation_imports(
          reconciliation_id, fingerprint, revision, supersedes_reconciliation_id,
          provider_id, account_fingerprint,
          period_start, period_end, currency, reported_total_micros,
          matched_total_micros, unmatched_variance_micros, status, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        reconciliationId,
        normalized.fingerprint,
        revision,
        supersedesReconciliationId,
        normalized.providerId,
        normalized.accountFingerprint,
        normalized.periodStart,
        normalized.periodEnd,
        normalized.currency,
        normalized.reportedTotalMicros,
        normalized.matchedTotalMicros,
        variance,
        normalized.status,
        normalized.importedAt,
      );
      return {
        created: true,
        reconciliation: {
          ...normalized,
          reconciliationId,
          revision,
          supersedesReconciliationId,
          unmatchedVarianceMicros: variance,
        },
      };
    });
  }

  getFinanceSnapshot(input: { periodStart?: number; limit?: number } = {}): ProviderFinanceSnapshotV1 {
    const generatedAt = Date.now();
    this.ctx.storage.transactionSync(() => this.promoteDueBudgetHolds(generatedAt));
    const periodStart = isNonNegativeSafeInteger(input.periodStart)
      ? Math.min(input.periodStart, generatedAt)
      : Math.max(0, generatedAt - 30 * 24 * 60 * 60 * 1_000);
    const limit = isNonNegativeSafeInteger(input.limit)
      ? Math.min(100, Math.max(1, input.limit))
      : 25;
    const aggregate = this.readFinanceAggregates(periodStart);
    const attemptRows = this.readFinanceAttemptRows(periodStart, limit);
    const costRowsByAttempt = this.readFinanceAttemptCostRows(periodStart, limit);
    const attempts = attemptRows.map((row) => this.financeAttemptFromRow(
      row,
      costRowsByAttempt.get(row.attempt_id) ?? [],
    ));
    const costs = this.readFinanceCostAggregates(periodStart).map((row) => ({
      currency: row.currency,
      provisionalMicros: requireSafeAggregate(row.provisional_micros),
      settledMicros: requireSafeAggregate(row.settled_micros),
      correctedMicros: requireSafeAggregate(row.corrected_micros),
      totalMicros: requireSafeAggregate(row.total_micros),
      unknownAttempts: requireNonNegativeAggregate(aggregate.unknown_cost_attempts),
    }));
    const usage: ProviderTokenUsageV1 = {
      inputNoCacheTokens: nullableSafeAggregate(aggregate.usage_input_no_cache_tokens),
      cacheReadInputTokens: nullableSafeAggregate(aggregate.usage_cache_read_input_tokens),
      cacheWriteInputTokens: nullableSafeAggregate(aggregate.usage_cache_write_input_tokens),
      outputTextTokens: nullableSafeAggregate(aggregate.usage_output_text_tokens),
      reasoningOutputTokens: nullableSafeAggregate(aggregate.usage_reasoning_output_tokens),
    };
    return {
      version: 1,
      providerId: this.providerId,
      generatedAt,
      periodStart,
      capacity: {
        calls: requireNonNegativeAggregate(aggregate.calls),
        succeeded: requireNonNegativeAggregate(aggregate.succeeded),
        failures: requireNonNegativeAggregate(aggregate.failures),
        retries: requireNonNegativeAggregate(aggregate.retries),
        fallbacks: requireNonNegativeAggregate(aggregate.fallbacks),
        averageLatencyMs: nullableNonNegativeAggregate(aggregate.average_latency_ms),
        unknownUsageAttempts: requireNonNegativeAggregate(aggregate.unknown_usage_attempts),
        provisionalCostAttempts: requireNonNegativeAggregate(aggregate.provisional_cost_attempts),
      },
      usage,
      costs,
      attempts,
      reconciliations: this.ctx.storage.sql.exec<ProviderReconciliationRow>(
        "SELECT * FROM provider_reconciliation_imports ORDER BY imported_at DESC, reconciliation_id DESC LIMIT 50",
      ).toArray().map(reconciliationFromRow),
      catalogs: this.ctx.storage.sql.exec<ProviderPriceCatalogRow>(
        "SELECT * FROM provider_price_catalog ORDER BY effective_from DESC, catalog_version_id DESC LIMIT 100",
      ).toArray().map(priceCatalogFromRow),
      budgetPolicies: this.ctx.storage.sql.exec<ProviderBudgetPolicyRow>(
        `SELECT * FROM provider_budget_policies
         ORDER BY created_at DESC, policy_id DESC, policy_version DESC LIMIT 100`,
      ).toArray().map(budgetPolicyFromRow),
      budgetBalances: this.readBudgetBalances(),
      budgetReservations: this.ctx.storage.sql.exec<ProviderBudgetReservationRow>(
        `SELECT * FROM provider_budget_reservations
         ORDER BY updated_at DESC, reservation_id DESC LIMIT 100`,
      ).toArray().map(budgetReservationFromRow),
    };
  }

  private readFinanceAggregates(periodStart: number): ProviderFinanceAggregateRow {
    return this.ctx.storage.sql.exec<ProviderFinanceAggregateRow>(
      `WITH period_attempts AS (
         SELECT * FROM provider_attempt_projection WHERE started_at >= ?
       ), cost_state AS (
         SELECT evidence.attempt_id,
           COUNT(*) AS evidence_count,
           MAX(CASE WHEN evidence.evidence_class = 'reconciled' THEN 1 ELSE 0 END) AS has_reconciled,
           MAX(CASE WHEN evidence.evidence_class = 'corrected' THEN 1 ELSE 0 END) AS has_corrected
         FROM provider_cost_evidence evidence
         INNER JOIN period_attempts attempt ON attempt.attempt_id = evidence.attempt_id
         GROUP BY evidence.attempt_id
       )
       SELECT
         COUNT(*) AS calls,
         COALESCE(SUM(CASE WHEN attempt.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
         COALESCE(SUM(CASE WHEN attempt.status NOT IN ('started', 'succeeded') THEN 1 ELSE 0 END), 0) AS failures,
         COALESCE(SUM(CASE WHEN attempt.fallback_index > 0 THEN 1 ELSE 0 END), 0) AS retries,
         COALESCE(SUM(CASE WHEN attempt.fallback_index > 0 THEN 1 ELSE 0 END), 0) AS fallbacks,
         ROUND(AVG(CASE
           WHEN attempt.ended_at >= attempt.started_at AND attempt.ended_at > 0
             THEN attempt.ended_at - attempt.started_at
           ELSE NULL
         END)) AS average_latency_ms,
         COALESCE(SUM(CASE
           WHEN usage.attempt_id IS NULL
             OR usage.input_no_cache_tokens IS NULL
             OR usage.cache_read_input_tokens IS NULL
             OR usage.cache_write_input_tokens IS NULL
             OR usage.output_text_tokens IS NULL
             OR usage.reasoning_output_tokens IS NULL
           THEN 1 ELSE 0
         END), 0) AS unknown_usage_attempts,
         COALESCE(SUM(CASE
           WHEN cost.evidence_count > 0 AND cost.has_reconciled = 0 AND cost.has_corrected = 0
           THEN 1 ELSE 0
         END), 0) AS provisional_cost_attempts,
         COALESCE(SUM(CASE WHEN cost.evidence_count IS NULL THEN 1 ELSE 0 END), 0) AS unknown_cost_attempts,
         CASE WHEN COUNT(*) = COUNT(usage.input_no_cache_tokens)
           THEN SUM(usage.input_no_cache_tokens) ELSE NULL END AS usage_input_no_cache_tokens,
         CASE WHEN COUNT(*) = COUNT(usage.cache_read_input_tokens)
           THEN SUM(usage.cache_read_input_tokens) ELSE NULL END AS usage_cache_read_input_tokens,
         CASE WHEN COUNT(*) = COUNT(usage.cache_write_input_tokens)
           THEN SUM(usage.cache_write_input_tokens) ELSE NULL END AS usage_cache_write_input_tokens,
         CASE WHEN COUNT(*) = COUNT(usage.output_text_tokens)
           THEN SUM(usage.output_text_tokens) ELSE NULL END AS usage_output_text_tokens,
         CASE WHEN COUNT(*) = COUNT(usage.reasoning_output_tokens)
           THEN SUM(usage.reasoning_output_tokens) ELSE NULL END AS usage_reasoning_output_tokens
       FROM period_attempts attempt
       LEFT JOIN provider_usage_projection usage ON usage.attempt_id = attempt.attempt_id
       LEFT JOIN cost_state cost ON cost.attempt_id = attempt.attempt_id`,
      periodStart,
    ).one();
  }

  private readFinanceAttemptRows(periodStart: number, limit: number): ProviderFinanceAttemptRow[] {
    return this.ctx.storage.sql.exec<ProviderFinanceAttemptRow>(
      `SELECT
         attempt.attempt_id, attempt.idempotency_key, attempt.turn_id, attempt.run_id, attempt.run_kind,
         attempt.logical_route_id, attempt.provider_id, attempt.offering_id, attempt.model,
         attempt.fallback_index, attempt.credential_class, attempt.operation_id, attempt.fence_id,
         attempt.operation_kind, attempt.operation_started_at, attempt.status, attempt.error_class,
         attempt.started_at, attempt.ended_at,
         usage.input_no_cache_tokens AS usage_input_no_cache_tokens,
         usage.cache_read_input_tokens AS usage_cache_read_input_tokens,
         usage.cache_write_input_tokens AS usage_cache_write_input_tokens,
         usage.output_text_tokens AS usage_output_text_tokens,
         usage.reasoning_output_tokens AS usage_reasoning_output_tokens,
         usage.evidence_class AS usage_evidence_class,
         binding.catalog_version_id,
         binding.resolution AS price_resolution
       FROM provider_attempt_projection attempt
       LEFT JOIN provider_usage_projection usage ON usage.attempt_id = attempt.attempt_id
       LEFT JOIN provider_attempt_price_binding binding ON binding.attempt_id = attempt.attempt_id
       WHERE attempt.started_at >= ?
       ORDER BY attempt.started_at DESC, attempt.attempt_id DESC
       LIMIT ?`,
      periodStart,
      limit,
    ).toArray();
  }

  private readFinanceAttemptCostRows(
    periodStart: number,
    limit: number,
  ): Map<string, ProviderCostEvidenceRow[]> {
    const rows = this.ctx.storage.sql.exec<ProviderCostEvidenceRow>(
      `SELECT evidence.*
       FROM provider_cost_evidence evidence
       INNER JOIN (
         SELECT attempt_id FROM provider_attempt_projection
         WHERE started_at >= ?
         ORDER BY started_at DESC, attempt_id DESC
         LIMIT ?
       ) attempt ON attempt.attempt_id = evidence.attempt_id
       ORDER BY evidence.attempt_id, evidence.seq`,
      periodStart,
      limit,
    ).toArray();
    const byAttempt = new Map<string, ProviderCostEvidenceRow[]>();
    for (const row of rows) {
      const existing = byAttempt.get(row.attempt_id) ?? [];
      existing.push(row);
      byAttempt.set(row.attempt_id, existing);
    }
    return byAttempt;
  }

  private readFinanceCostAggregates(periodStart: number): ProviderFinanceCostAggregateRow[] {
    return this.ctx.storage.sql.exec<ProviderFinanceCostAggregateRow>(
      `WITH period_attempts AS (
         SELECT attempt_id FROM provider_attempt_projection WHERE started_at >= ?
       )
       SELECT evidence.currency,
         COALESCE(SUM(CASE
           WHEN evidence.evidence_class IN ('estimated', 'reported') THEN evidence.amount_micros ELSE 0
         END), 0) AS provisional_micros,
         COALESCE(SUM(CASE
           WHEN evidence.evidence_class = 'reconciled' THEN evidence.amount_micros ELSE 0
         END), 0) AS settled_micros,
         COALESCE(SUM(CASE
           WHEN evidence.evidence_class = 'corrected' THEN evidence.amount_micros ELSE 0
         END), 0) AS corrected_micros,
         COALESCE(SUM(evidence.amount_micros), 0) AS total_micros
       FROM provider_cost_evidence evidence
       INNER JOIN period_attempts attempt ON attempt.attempt_id = evidence.attempt_id
       GROUP BY evidence.currency
       ORDER BY evidence.currency`,
      periodStart,
    ).toArray();
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

  private bindAttemptPrice(attemptId: string, offeringId: string, model: string, startedAt: number): void {
    const catalog = this.resolveAttemptPrice(offeringId, model, startedAt);
    this.ctx.storage.sql.exec(
      `INSERT INTO provider_attempt_price_binding(attempt_id, catalog_version_id, resolution, bound_at)
       VALUES (?, ?, ?, ?)`,
      attemptId,
      catalog?.catalog_version_id ?? null,
      catalog ? "matched" : "missing",
      startedAt,
    );
  }

  private resolveAttemptPrice(
    offeringId: string,
    model: string,
    startedAt: number,
  ): ProviderPriceCatalogRow | undefined {
    return this.ctx.storage.sql.exec<ProviderPriceCatalogRow>(
      `SELECT * FROM provider_price_catalog
       WHERE provider_id = ? AND offering_id = ? AND model = ?
         AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC, catalog_version_id DESC LIMIT 1`,
      this.providerId,
      offeringId,
      model,
      startedAt,
      startedAt,
    ).toArray()[0];
  }

  private readBudgetPolicyByIdempotencyKey(idempotencyKey: string): ProviderBudgetPolicyRow | undefined {
    return this.ctx.storage.sql.exec<ProviderBudgetPolicyRow>(
      "SELECT * FROM provider_budget_policies WHERE idempotency_key = ? LIMIT 1",
      idempotencyKey,
    ).toArray()[0];
  }

  private readLatestBudgetPolicy(policyId: string): ProviderBudgetPolicyRow | undefined {
    return this.ctx.storage.sql.exec<ProviderBudgetPolicyRow>(
      `SELECT * FROM provider_budget_policies
       WHERE policy_id = ? ORDER BY policy_version DESC LIMIT 1`,
      policyId,
    ).toArray()[0];
  }

  private readActiveBudgetPolicy(at: number): ProviderBudgetPolicyRow | undefined {
    return this.ctx.storage.sql.exec<ProviderBudgetPolicyRow>(
      `SELECT * FROM provider_budget_policies
       WHERE provider_id = ? AND period_start <= ? AND period_end > ?
       ORDER BY created_at DESC, policy_version DESC LIMIT 1`,
      this.providerId,
      at,
      at,
    ).toArray()[0];
  }

  private readBudgetDecision(idempotencyKey: string): ProviderBudgetDecisionRow | undefined {
    return this.ctx.storage.sql.exec<ProviderBudgetDecisionRow>(
      "SELECT * FROM provider_budget_decisions WHERE idempotency_key = ? LIMIT 1",
      idempotencyKey,
    ).toArray()[0];
  }

  private insertBudgetDecision(
    attempt: NonNullable<ReturnType<typeof decodeProviderAttemptStartInput>>,
    policy: ProviderBudgetPolicyProjectionV1,
    status: ProviderBudgetDecisionStatus,
    reason: ProviderBudgetDecisionReason,
    requestedMicros: number,
    reservationId: string | null,
    attemptId: string | null,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO provider_budget_decisions(
        idempotency_key, attempt_id, turn_id, run_id, run_kind, logical_route_id,
        provider_id, offering_id, model, fallback_index, credential_class,
        operation_id, fence_id, operation_kind, operation_started_at, started_at,
        policy_id, policy_version, status, reason, requested_micros, reservation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attempt.idempotencyKey,
      attemptId,
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
      attempt.startedAt,
      policy.policyId,
      policy.policyVersion,
      status,
      reason,
      requestedMicros,
      reservationId,
    );
  }

  private appendBudgetEvent(
    policy: Pick<ProviderBudgetPolicyProjectionV1, "policyId" | "policyVersion">,
    attemptId: string | null,
    reservationId: string | null,
    kind: ProviderBudgetDecisionStatus | "settled" | "released" | "held" | "review_required"
      | "reconciled" | "operator_released" | "alerted",
    amountMicros: number,
    reason: string,
    at: number,
    idempotencyKey: string,
  ): boolean {
    const existing = this.ctx.storage.sql.exec<{
      policy_id: string;
      policy_version: number;
      attempt_id: string | null;
      reservation_id: string | null;
      event_kind: string;
      amount_micros: number;
      reason: string;
      at: number;
    }>(
      "SELECT * FROM provider_budget_events WHERE idempotency_key = ? LIMIT 1",
      idempotencyKey,
    ).toArray()[0];
    if (existing) {
      if (
        existing.policy_id !== policy.policyId
        || existing.policy_version !== policy.policyVersion
        || existing.attempt_id !== attemptId
        || existing.reservation_id !== reservationId
        || existing.event_kind !== kind
        || existing.amount_micros !== amountMicros
        || existing.reason !== reason
      ) throw new Error("provider_budget_event_conflict");
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO provider_budget_events(
        event_id, idempotency_key, policy_id, policy_version, attempt_id,
        reservation_id, event_kind, amount_micros, reason, at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `budget_event_${crypto.randomUUID()}`,
      idempotencyKey,
      policy.policyId,
      policy.policyVersion,
      attemptId,
      reservationId,
      kind,
      amountMicros,
      reason,
      at,
    );
    return true;
  }

  private readBudgetReservationByAttempt(attemptId: string): ProviderBudgetReservationRow | undefined {
    return this.ctx.storage.sql.exec<ProviderBudgetReservationRow>(
      "SELECT * FROM provider_budget_reservations WHERE attempt_id = ? LIMIT 1",
      attemptId,
    ).toArray()[0];
  }

  private readBudgetReservation(reservationId: string): ProviderBudgetReservationRow | undefined {
    return this.ctx.storage.sql.exec<ProviderBudgetReservationRow>(
      "SELECT * FROM provider_budget_reservations WHERE reservation_id = ? LIMIT 1",
      reservationId,
    ).toArray()[0];
  }

  private requireBudgetProjection(policyId: string): ProviderBudgetProjectionRow {
    const row = this.ctx.storage.sql.exec<ProviderBudgetProjectionRow>(
      "SELECT * FROM provider_budget_projection WHERE policy_id = ? LIMIT 1",
      policyId,
    ).toArray()[0];
    if (!row) throw new Error("provider_budget_projection_missing");
    return row;
  }

  private readKnownBudgetCost(attemptId: string, currency: string): number | undefined {
    const usage = this.readUsageProjection(attemptId);
    if (!usage || [
      usage.input_no_cache_tokens,
      usage.cache_read_input_tokens,
      usage.cache_write_input_tokens,
      usage.output_text_tokens,
      usage.reasoning_output_tokens,
    ].some((value) => value === null)) return undefined;
    const binding = this.ctx.storage.sql.exec<{
      catalog_version_id: string | null;
      resolution: "matched" | "missing";
    }>(
      "SELECT catalog_version_id, resolution FROM provider_attempt_price_binding WHERE attempt_id = ? LIMIT 1",
      attemptId,
    ).toArray()[0];
    if (!binding || binding.resolution !== "matched" || !binding.catalog_version_id) return undefined;
    const aggregate = this.ctx.storage.sql.exec<{ count: number; amount: number | null }>(
      `SELECT COUNT(*) AS count, SUM(amount_micros) AS amount
       FROM provider_cost_evidence WHERE attempt_id = ? AND currency = ?`,
      attemptId,
      currency,
    ).one();
    if (aggregate.count < 1 || aggregate.amount === null) return undefined;
    return Math.max(0, requireSafeAggregate(aggregate.amount));
  }

  private settleBudgetReservation(attemptId: string, at: number): void {
    const reservation = this.readBudgetReservationByAttempt(attemptId);
    if (!reservation || reservation.status !== "reserved") return;
    const amount = this.readKnownBudgetCost(attemptId, reservation.currency);
    if (amount !== undefined) {
      this.finalizeBudgetReservation(reservation, amount, "settled", "terminal_cost", at);
      return;
    }
    this.ctx.storage.sql.exec(
      `UPDATE provider_budget_reservations
       SET status = 'held', held_micros = reserved_micros, updated_at = ?
       WHERE reservation_id = ? AND status = 'reserved'`,
      at,
      reservation.reservation_id,
    );
    this.ctx.storage.sql.exec(
      `UPDATE provider_budget_projection
       SET reserved_micros = reserved_micros - ?, held_micros = held_micros + ?, updated_at = ?
       WHERE policy_id = ?`,
      reservation.reserved_micros,
      reservation.reserved_micros,
      at,
      reservation.policy_id,
    );
    this.appendBudgetEvent(
      { policyId: reservation.policy_id, policyVersion: reservation.policy_version },
      reservation.attempt_id,
      reservation.reservation_id,
      "held",
      reservation.reserved_micros,
      "cost_unknown",
      at,
      `budget-transition:${reservation.reservation_id}:held`,
    );
  }

  private reconcileBudgetReservationFromEvidence(attemptId: string, at: number): void {
    const attempt = this.requireProjection(attemptId);
    if (attempt.status === "started") return;
    const reservation = this.readBudgetReservationByAttempt(attemptId);
    if (!reservation || reservation.status === "operator_released") return;
    const amount = this.readKnownBudgetCost(attemptId, reservation.currency);
    if (amount === undefined) return;
    if (reservation.status === "settled" || reservation.status === "reconciled") {
      if (amount === reservation.settled_micros) return;
      this.adjustFinalizedBudgetReservation(reservation, amount, at);
      return;
    }
    this.finalizeBudgetReservation(
      reservation,
      amount,
      reservation.status === "reserved" ? "settled" : "reconciled",
      "late_cost_evidence",
      at,
    );
  }

  private adjustFinalizedBudgetReservation(
    reservation: ProviderBudgetReservationRow,
    amountMicros: number,
    at: number,
  ): void {
    const delta = amountMicros - reservation.settled_micros;
    const releasedMicros = Math.max(0, reservation.reserved_micros - amountMicros);
    this.ctx.storage.sql.exec(
      `UPDATE provider_budget_projection SET
        settled_micros = settled_micros + ?,
        alert_count = alert_count + ?,
        updated_at = ?
       WHERE policy_id = ?`,
      delta,
      amountMicros > reservation.reserved_micros ? 1 : 0,
      at,
      reservation.policy_id,
    );
    this.ctx.storage.sql.exec(
      `UPDATE provider_budget_reservations SET
        status = 'reconciled', settled_micros = ?, released_micros = ?, updated_at = ?
       WHERE reservation_id = ?`,
      amountMicros,
      releasedMicros,
      at,
      reservation.reservation_id,
    );
    this.appendBudgetEvent(
      { policyId: reservation.policy_id, policyVersion: reservation.policy_version },
      reservation.attempt_id,
      reservation.reservation_id,
      "reconciled",
      delta,
      "corrected_cost_evidence",
      at,
      `budget-transition:${reservation.reservation_id}:reconciled:${at}:${amountMicros}`,
    );
  }

  private finalizeBudgetReservation(
    reservation: ProviderBudgetReservationRow,
    amountMicros: number,
    status: "settled" | "reconciled" | "operator_released",
    reason: string,
    at: number,
  ): void {
    const reservedToRemove = reservation.status === "reserved" ? reservation.reserved_micros : 0;
    const heldToRemove = reservation.status === "held" || reservation.status === "review_required"
      ? reservation.held_micros
      : 0;
    const releasedMicros = Math.max(0, reservation.reserved_micros - amountMicros);
    this.ctx.storage.sql.exec(
      `UPDATE provider_budget_projection SET
        reserved_micros = reserved_micros - ?,
        held_micros = held_micros - ?,
        settled_micros = settled_micros + ?,
        alert_count = alert_count + ?,
        updated_at = ?
       WHERE policy_id = ?`,
      reservedToRemove,
      heldToRemove,
      amountMicros,
      amountMicros > reservation.reserved_micros ? 1 : 0,
      at,
      reservation.policy_id,
    );
    this.ctx.storage.sql.exec(
      `UPDATE provider_budget_reservations SET
        status = ?, settled_micros = ?, released_micros = ?, held_micros = 0, updated_at = ?
       WHERE reservation_id = ?`,
      status,
      amountMicros,
      releasedMicros,
      at,
      reservation.reservation_id,
    );
    this.appendBudgetEvent(
      { policyId: reservation.policy_id, policyVersion: reservation.policy_version },
      reservation.attempt_id,
      reservation.reservation_id,
      status,
      amountMicros,
      reason,
      at,
      `budget-transition:${reservation.reservation_id}:${status}`,
    );
    if (releasedMicros > 0) {
      this.appendBudgetEvent(
        { policyId: reservation.policy_id, policyVersion: reservation.policy_version },
        reservation.attempt_id,
        reservation.reservation_id,
        "released",
        releasedMicros,
        reason,
        at,
        `budget-transition:${reservation.reservation_id}:${status}:released`,
      );
    }
  }

  private promoteDueBudgetHolds(at: number): void {
    const due = this.ctx.storage.sql.exec<ProviderBudgetReservationRow>(
      `SELECT * FROM provider_budget_reservations
       WHERE status = 'held' AND review_after <= ?
       ORDER BY review_after, reservation_id LIMIT 100`,
      at,
    ).toArray();
    for (const reservation of due) {
      this.ctx.storage.sql.exec(
        `UPDATE provider_budget_reservations SET status = 'review_required', updated_at = ?
         WHERE reservation_id = ? AND status = 'held'`,
        at,
        reservation.reservation_id,
      );
      this.appendBudgetEvent(
        { policyId: reservation.policy_id, policyVersion: reservation.policy_version },
        reservation.attempt_id,
        reservation.reservation_id,
        "review_required",
        reservation.held_micros,
        "hold_review_due",
        at,
        `budget-transition:${reservation.reservation_id}:review_required`,
      );
    }
  }

  private applyBudgetOperatorAction(
    input: NonNullable<ReturnType<typeof decodeProviderBudgetOperatorActionInput>>,
  ): ProviderBudgetOperatorActionResultV1 {
    const kind = input.action === "release" ? "operator_released" : "reconciled";
    const existing = this.ctx.storage.sql.exec<{
      reservation_id: string | null;
      event_kind: string;
      amount_micros: number;
      reason: string;
      at: number;
    }>(
      "SELECT * FROM provider_budget_events WHERE idempotency_key = ? LIMIT 1",
      input.idempotencyKey,
    ).toArray()[0];
    if (existing) {
      if (
        existing.reservation_id !== input.reservationId
        || existing.event_kind !== kind
        || existing.amount_micros !== input.amountMicros
        || existing.reason !== input.reason
      ) throw new Error("provider_budget_action_conflict");
      const replay = this.readBudgetReservation(input.reservationId);
      if (!replay) throw new Error("provider_budget_reservation_missing");
      return { updated: false, reservation: budgetReservationFromRow(replay) };
    }
    const reservation = this.readBudgetReservation(input.reservationId);
    if (!reservation) throw new Error("provider_budget_reservation_missing");
    if (reservation.status !== "reserved"
      && reservation.status !== "held"
      && reservation.status !== "review_required") {
      throw new Error("provider_budget_action_conflict");
    }
    const reservedToRemove = reservation.status === "reserved" ? reservation.reserved_micros : 0;
    const heldToRemove = reservation.status === "held" || reservation.status === "review_required"
      ? reservation.held_micros
      : 0;
    const releasedMicros = Math.max(0, reservation.reserved_micros - input.amountMicros);
    this.ctx.storage.sql.exec(
      `UPDATE provider_budget_projection SET
        reserved_micros = reserved_micros - ?, held_micros = held_micros - ?,
        settled_micros = settled_micros + ?, alert_count = alert_count + ?, updated_at = ?
       WHERE policy_id = ?`,
      reservedToRemove,
      heldToRemove,
      input.amountMicros,
      input.amountMicros > reservation.reserved_micros ? 1 : 0,
      input.at,
      reservation.policy_id,
    );
    this.ctx.storage.sql.exec(
      `UPDATE provider_budget_reservations SET
        status = ?, settled_micros = ?, released_micros = ?, held_micros = 0, updated_at = ?
       WHERE reservation_id = ?`,
      kind,
      input.amountMicros,
      releasedMicros,
      input.at,
      input.reservationId,
    );
    this.appendBudgetEvent(
      { policyId: reservation.policy_id, policyVersion: reservation.policy_version },
      reservation.attempt_id,
      reservation.reservation_id,
      kind,
      input.amountMicros,
      input.reason,
      input.at,
      input.idempotencyKey,
    );
    const updated = this.readBudgetReservation(input.reservationId);
    if (!updated) throw new Error("provider_budget_reservation_missing");
    return { updated: true, reservation: budgetReservationFromRow(updated) };
  }

  private readBudgetBalances(): ProviderBudgetBalanceProjectionV1[] {
    const counts = this.ctx.storage.sql.exec<{
      policy_id: string;
      pending_count: number;
      review_count: number;
    }>(
      `SELECT policy_id,
         SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN status = 'review_required' THEN 1 ELSE 0 END) AS review_count
       FROM provider_budget_reservations GROUP BY policy_id`,
    ).toArray();
    const byPolicy = new Map(counts.map((row) => [row.policy_id, row]));
    return this.ctx.storage.sql.exec<ProviderBudgetProjectionRow>(
      "SELECT * FROM provider_budget_projection ORDER BY updated_at DESC, policy_id DESC LIMIT 100",
    ).toArray().map((row) => budgetBalanceFromRow(row, byPolicy.get(row.policy_id)));
  }

  private readPriceCatalog(catalogVersionId: string): ProviderPriceCatalogInputV1 | undefined {
    const row = this.ctx.storage.sql.exec<ProviderPriceCatalogRow>(
      "SELECT * FROM provider_price_catalog WHERE catalog_version_id = ? LIMIT 1",
      catalogVersionId,
    ).toArray()[0];
    return row ? priceCatalogFromRow(row) : undefined;
  }

  private readUsageEvidence(evidenceId: string): ProviderUsageEvidenceRow | undefined {
    return this.ctx.storage.sql.exec<ProviderUsageEvidenceRow>(
      "SELECT * FROM provider_usage_evidence WHERE evidence_id = ? LIMIT 1",
      evidenceId,
    ).toArray()[0];
  }

  private readUsageProjection(attemptId: string): ProviderUsageProjectionRow | undefined {
    return this.ctx.storage.sql.exec<ProviderUsageProjectionRow>(
      "SELECT * FROM provider_usage_projection WHERE attempt_id = ? LIMIT 1",
      attemptId,
    ).toArray()[0];
  }

  private writeUsageProjection(
    evidence: ProviderUsageEvidenceInputV1,
    existing: ProviderUsageProjectionRow | undefined,
    effectiveDelta: ProviderTokenUsageV1,
  ): void {
    const current = currentUsageFromProjection(existing);
    const total = totalUsageFromProjection(existing);
    const nextCurrent = { ...current };
    const nextTotal = { ...total };
    for (const field of PROVIDER_USAGE_TOKEN_FIELDS) {
      if (evidence.mode === "cumulative" && evidence[field] !== null) {
        nextCurrent[field] = Math.max(current[field] ?? 0, evidence[field]);
      }
      if (effectiveDelta[field] !== null) {
        nextTotal[field] = (total[field] ?? 0) + effectiveDelta[field];
      }
    }
    const hasKnown = PROVIDER_USAGE_TOKEN_FIELDS.some((field) => evidence[field] !== null);
    const evidenceClass = hasKnown
      ? maxUsageEvidenceClass(existing?.evidence_class ?? "unknown", evidence.evidenceClass)
      : existing?.evidence_class ?? "unknown";
    this.ctx.storage.sql.exec(
      `INSERT INTO provider_usage_projection(
        attempt_id,
        current_input_no_cache_tokens, current_cache_read_input_tokens,
        current_cache_write_input_tokens, current_output_text_tokens,
        current_reasoning_output_tokens,
        input_no_cache_tokens, cache_read_input_tokens, cache_write_input_tokens,
        output_text_tokens, reasoning_output_tokens, evidence_class,
        known_evidence_count, missing_evidence_count, latest_observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attempt_id) DO UPDATE SET
        current_input_no_cache_tokens = excluded.current_input_no_cache_tokens,
        current_cache_read_input_tokens = excluded.current_cache_read_input_tokens,
        current_cache_write_input_tokens = excluded.current_cache_write_input_tokens,
        current_output_text_tokens = excluded.current_output_text_tokens,
        current_reasoning_output_tokens = excluded.current_reasoning_output_tokens,
        input_no_cache_tokens = excluded.input_no_cache_tokens,
        cache_read_input_tokens = excluded.cache_read_input_tokens,
        cache_write_input_tokens = excluded.cache_write_input_tokens,
        output_text_tokens = excluded.output_text_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens,
        evidence_class = excluded.evidence_class,
        known_evidence_count = excluded.known_evidence_count,
        missing_evidence_count = excluded.missing_evidence_count,
        latest_observed_at = excluded.latest_observed_at`,
      evidence.attemptId,
      nextCurrent.inputNoCacheTokens,
      nextCurrent.cacheReadInputTokens,
      nextCurrent.cacheWriteInputTokens,
      nextCurrent.outputTextTokens,
      nextCurrent.reasoningOutputTokens,
      nextTotal.inputNoCacheTokens,
      nextTotal.cacheReadInputTokens,
      nextTotal.cacheWriteInputTokens,
      nextTotal.outputTextTokens,
      nextTotal.reasoningOutputTokens,
      evidenceClass,
      (existing?.known_evidence_count ?? 0) + (hasKnown ? 1 : 0),
      (existing?.missing_evidence_count ?? 0) + (hasKnown ? 0 : 1),
      Math.max(existing?.latest_observed_at ?? 0, evidence.observedAt),
    );
  }

  private appendCalculatedCost(
    evidence: ProviderUsageEvidenceInputV1,
    effectiveDelta: ProviderTokenUsageV1,
  ): void {
    if (!PROVIDER_USAGE_TOKEN_FIELDS.some((field) => effectiveDelta[field] !== null)) return;
    const binding = this.ctx.storage.sql.exec<{
      catalog_version_id: string | null;
      resolution: "matched" | "missing";
    }>(
      "SELECT catalog_version_id, resolution FROM provider_attempt_price_binding WHERE attempt_id = ? LIMIT 1",
      evidence.attemptId,
    ).toArray()[0];
    if (!binding || binding.resolution !== "matched" || !binding.catalog_version_id) return;
    const catalog = this.readPriceCatalog(binding.catalog_version_id);
    if (!catalog) throw new Error("provider_price_catalog_missing");
    const calculated = calculateProviderCostMicros(effectiveDelta, catalog);
    this.appendCostEvidenceNormalized({
      version: 1,
      eventId: `cost:auto:${evidence.evidenceId}`,
      attemptId: evidence.attemptId,
      kind: "calculated",
      evidenceClass: "estimated",
      currency: catalog.currency,
      amountMicros: calculated.amountMicros,
      supersedesEventId: null,
      sourceEvidenceId: evidence.evidenceId,
      observedAt: evidence.observedAt,
    });
  }

  private appendCostEvidenceNormalized(normalized: ProviderCostEvidenceInputV1): ProviderCostEvidenceResultV1 {
    const attempt = this.requireProjection(normalized.attemptId);
    if (attempt.providerId !== this.providerId || normalized.observedAt < attempt.startedAt) {
      throw new Error("provider_cost_evidence_invalid");
    }
    const existing = this.readCostEvidence(normalized.eventId);
    if (existing) {
      const event = costEvidenceFromRow(existing);
      if (!sameCostEvidence(event, normalized)) throw new Error("provider_cost_evidence_conflict");
      return { created: false, event };
    }
    if (normalized.supersedesEventId) {
      const superseded = this.readCostEvidence(normalized.supersedesEventId);
      if (!superseded
        || superseded.attempt_id !== normalized.attemptId
        || superseded.currency !== normalized.currency
        || superseded.observed_at > normalized.observedAt) {
        throw new Error("provider_cost_supersedes_invalid");
      }
      const alreadySuperseded = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM provider_cost_evidence WHERE supersedes_event_id = ?",
        normalized.supersedesEventId,
      ).one().count;
      if (alreadySuperseded > 0) throw new Error("provider_cost_supersedes_conflict");
    }
    if (normalized.sourceEvidenceId) {
      const source = this.readUsageEvidence(normalized.sourceEvidenceId);
      if (!source
        || source.attempt_id !== normalized.attemptId
        || source.observed_at > normalized.observedAt) {
        throw new Error("provider_cost_source_invalid");
      }
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO provider_cost_evidence(
        event_id, attempt_id, kind, evidence_class, currency, amount_micros,
        supersedes_event_id, source_evidence_id, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      normalized.eventId,
      normalized.attemptId,
      normalized.kind,
      normalized.evidenceClass,
      normalized.currency,
      normalized.amountMicros,
      normalized.supersedesEventId,
      normalized.sourceEvidenceId,
      normalized.observedAt,
    );
    return { created: true, event: normalized };
  }

  private readCostEvidence(eventId: string): ProviderCostEvidenceRow | undefined {
    return this.ctx.storage.sql.exec<ProviderCostEvidenceRow>(
      "SELECT * FROM provider_cost_evidence WHERE event_id = ? LIMIT 1",
      eventId,
    ).toArray()[0];
  }

  private readReconciliationByFingerprint(fingerprint: string): ProviderReconciliationRow | undefined {
    return this.ctx.storage.sql.exec<ProviderReconciliationRow>(
      `SELECT * FROM provider_reconciliation_imports
       WHERE fingerprint = ? ORDER BY revision DESC LIMIT 1`,
      fingerprint,
    ).toArray()[0];
  }

  private readReconciliationByFingerprintAndImportedAt(
    fingerprint: string,
    importedAt: number,
  ): ProviderReconciliationRow | undefined {
    return this.ctx.storage.sql.exec<ProviderReconciliationRow>(
      `SELECT * FROM provider_reconciliation_imports
       WHERE fingerprint = ? AND imported_at = ? LIMIT 1`,
      fingerprint,
      importedAt,
    ).toArray()[0];
  }

  private financeAttemptFromRow(
    row: ProviderFinanceAttemptRow,
    costRows: ProviderCostEvidenceRow[],
  ): ProviderFinanceAttemptProjectionV1 {
    const usage: ProviderTokenUsageV1 = {
      inputNoCacheTokens: row.usage_input_no_cache_tokens,
      cacheReadInputTokens: row.usage_cache_read_input_tokens,
      cacheWriteInputTokens: row.usage_cache_write_input_tokens,
      outputTextTokens: row.usage_output_text_tokens,
      reasoningOutputTokens: row.usage_reasoning_output_tokens,
    };
    const knownFields = PROVIDER_USAGE_TOKEN_FIELDS.filter((field) => usage[field] !== null).length;
    const usageState = knownFields === 0
      ? "unknown"
      : knownFields < PROVIDER_USAGE_TOKEN_FIELDS.length
        ? "partial"
        : row.usage_evidence_class === "reconciled"
          ? "reconciled"
          : row.usage_evidence_class === "estimated"
            ? "estimated"
            : "reported";
    const costs = aggregateCostRows(costRows);
    const costState = costRows.length === 0
      ? "unknown"
      : costRows.some((event) => event.evidence_class === "corrected")
        ? "corrected"
        : costRows.some((event) => event.evidence_class === "reconciled")
          ? "settled"
          : "provisional";
    return {
      attemptId: row.attempt_id,
      runKind: row.run_kind,
      logicalRouteId: row.logical_route_id,
      offeringId: row.offering_id,
      model: row.model,
      fallbackIndex: row.fallback_index,
      status: row.status,
      errorClass: row.error_class,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      latencyMs: row.ended_at >= row.started_at && row.ended_at > 0 ? row.ended_at - row.started_at : null,
      priceResolution: row.price_resolution ?? "missing",
      catalogVersionId: row.catalog_version_id,
      usageState,
      usage,
      costState,
      costs,
    };
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
      if (current < 2) {
        this.ctx.storage.sql.exec(`
          CREATE TABLE provider_price_catalog(
            catalog_version_id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            offering_id TEXT NOT NULL,
            model TEXT NOT NULL,
            currency TEXT NOT NULL,
            precision INTEGER NOT NULL,
            unit TEXT NOT NULL CHECK(unit = 'million_tokens'),
            input_no_cache_price_micros INTEGER,
            cache_read_input_price_micros INTEGER,
            cache_write_input_price_micros INTEGER,
            output_text_price_micros INTEGER,
            reasoning_output_price_micros INTEGER,
            effective_from INTEGER NOT NULL,
            effective_to INTEGER,
            approver TEXT NOT NULL,
            provenance TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX provider_price_catalog_selection_idx
            ON provider_price_catalog(offering_id, model, effective_from DESC);
          CREATE TABLE provider_attempt_price_binding(
            attempt_id TEXT PRIMARY KEY,
            catalog_version_id TEXT,
            resolution TEXT NOT NULL CHECK(resolution IN ('matched', 'missing')),
            bound_at INTEGER NOT NULL
          );
          CREATE TABLE provider_usage_evidence(
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            evidence_id TEXT NOT NULL UNIQUE,
            attempt_id TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('cumulative', 'delta', 'missing')),
            evidence_class TEXT NOT NULL CHECK(evidence_class IN ('reported', 'estimated', 'reconciled')),
            source TEXT NOT NULL,
            observed_at INTEGER NOT NULL,
            input_no_cache_tokens INTEGER,
            cache_read_input_tokens INTEGER,
            cache_write_input_tokens INTEGER,
            output_text_tokens INTEGER,
            reasoning_output_tokens INTEGER,
            effective_input_no_cache_tokens INTEGER,
            effective_cache_read_input_tokens INTEGER,
            effective_cache_write_input_tokens INTEGER,
            effective_output_text_tokens INTEGER,
            effective_reasoning_output_tokens INTEGER
          );
          CREATE INDEX provider_usage_evidence_attempt_idx
            ON provider_usage_evidence(attempt_id, seq);
          CREATE TABLE provider_usage_projection(
            attempt_id TEXT PRIMARY KEY,
            current_input_no_cache_tokens INTEGER,
            current_cache_read_input_tokens INTEGER,
            current_cache_write_input_tokens INTEGER,
            current_output_text_tokens INTEGER,
            current_reasoning_output_tokens INTEGER,
            input_no_cache_tokens INTEGER,
            cache_read_input_tokens INTEGER,
            cache_write_input_tokens INTEGER,
            output_text_tokens INTEGER,
            reasoning_output_tokens INTEGER,
            evidence_class TEXT NOT NULL CHECK(evidence_class IN ('unknown', 'estimated', 'reported', 'reconciled')),
            known_evidence_count INTEGER NOT NULL,
            missing_evidence_count INTEGER NOT NULL,
            latest_observed_at INTEGER NOT NULL
          );
          CREATE TABLE provider_cost_evidence(
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            attempt_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('calculated', 'reversal', 'replacement', 'correction')),
            evidence_class TEXT NOT NULL CHECK(evidence_class IN ('estimated', 'reported', 'reconciled', 'corrected')),
            currency TEXT NOT NULL,
            amount_micros INTEGER NOT NULL,
            supersedes_event_id TEXT,
            source_evidence_id TEXT,
            observed_at INTEGER NOT NULL
          );
          CREATE INDEX provider_cost_evidence_attempt_idx
            ON provider_cost_evidence(attempt_id, seq);
          CREATE UNIQUE INDEX provider_cost_evidence_single_supersede_idx
            ON provider_cost_evidence(supersedes_event_id)
            WHERE supersedes_event_id IS NOT NULL;
          CREATE TABLE provider_reconciliation_imports(
            reconciliation_id TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            revision INTEGER NOT NULL,
            supersedes_reconciliation_id TEXT,
            provider_id TEXT NOT NULL,
            account_fingerprint TEXT NOT NULL,
            period_start INTEGER NOT NULL,
            period_end INTEGER NOT NULL,
            currency TEXT NOT NULL,
            reported_total_micros INTEGER NOT NULL,
            matched_total_micros INTEGER NOT NULL,
            unmatched_variance_micros INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('matched', 'partial', 'disputed', 'corrected', 'closed')),
            imported_at INTEGER NOT NULL,
            UNIQUE(fingerprint, revision),
            UNIQUE(fingerprint, imported_at)
          );
          CREATE INDEX provider_reconciliation_period_idx
            ON provider_reconciliation_imports(period_start DESC, reconciliation_id DESC);
          CREATE UNIQUE INDEX provider_reconciliation_single_supersede_idx
            ON provider_reconciliation_imports(supersedes_reconciliation_id)
            WHERE supersedes_reconciliation_id IS NOT NULL;
          INSERT INTO provider_attempt_price_binding(attempt_id, catalog_version_id, resolution, bound_at)
            SELECT attempt_id, NULL, 'missing', started_at FROM provider_attempt_projection;
        `);
        this.ctx.storage.sql.exec(
          "INSERT INTO provider_attempt_schema_migrations(version, applied_at) VALUES (2, ?)",
          Date.now(),
        );
      }
      if (current < 3) {
        this.ctx.storage.sql.exec(`
          CREATE TABLE provider_budget_policies(
            policy_id TEXT NOT NULL,
            policy_version INTEGER NOT NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            provider_id TEXT NOT NULL,
            currency TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('disabled', 'shadow', 'soft', 'hard')),
            period_start INTEGER NOT NULL,
            period_end INTEGER NOT NULL,
            limit_micros INTEGER NOT NULL,
            max_attempt_reserve_micros INTEGER NOT NULL,
            hold_review_after_ms INTEGER NOT NULL,
            allow_unknown_price INTEGER NOT NULL CHECK(allow_unknown_price = 0),
            approver TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY(policy_id, policy_version)
          );
          CREATE INDEX provider_budget_policies_active_idx
            ON provider_budget_policies(provider_id, period_start, period_end, policy_version DESC);
          CREATE TABLE provider_budget_events(
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE,
            idempotency_key TEXT NOT NULL UNIQUE,
            policy_id TEXT NOT NULL,
            policy_version INTEGER NOT NULL,
            attempt_id TEXT,
            reservation_id TEXT,
            event_kind TEXT NOT NULL CHECK(event_kind IN (
              'excluded', 'observed', 'would_deny', 'reserved', 'denied',
              'settled', 'released', 'held', 'review_required',
              'reconciled', 'operator_released', 'alerted'
            )),
            amount_micros INTEGER NOT NULL,
            reason TEXT NOT NULL,
            at INTEGER NOT NULL
          );
          CREATE INDEX provider_budget_events_policy_idx
            ON provider_budget_events(policy_id, seq);
          CREATE TABLE provider_budget_decisions(
            idempotency_key TEXT PRIMARY KEY,
            attempt_id TEXT UNIQUE,
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
            started_at INTEGER NOT NULL,
            policy_id TEXT,
            policy_version INTEGER,
            status TEXT NOT NULL CHECK(status IN ('excluded', 'observed', 'would_deny', 'reserved', 'denied')),
            reason TEXT NOT NULL CHECK(reason IN (
              'byok_excluded', 'budget_disabled', 'within_limit',
              'insufficient_balance', 'price_unknown'
            )),
            requested_micros INTEGER NOT NULL,
            reservation_id TEXT UNIQUE
          );
          CREATE TABLE provider_budget_reservations(
            reservation_id TEXT PRIMARY KEY,
            attempt_id TEXT NOT NULL UNIQUE,
            policy_id TEXT NOT NULL,
            policy_version INTEGER NOT NULL,
            currency TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN (
              'reserved', 'settled', 'held', 'review_required',
              'reconciled', 'operator_released'
            )),
            reserved_micros INTEGER NOT NULL,
            settled_micros INTEGER NOT NULL,
            released_micros INTEGER NOT NULL,
            held_micros INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            review_after INTEGER NOT NULL
          );
          CREATE INDEX provider_budget_reservations_status_idx
            ON provider_budget_reservations(status, review_after, updated_at);
          CREATE TABLE provider_budget_projection(
            policy_id TEXT PRIMARY KEY,
            policy_version INTEGER NOT NULL,
            provider_id TEXT NOT NULL,
            currency TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('disabled', 'shadow', 'soft', 'hard')),
            period_start INTEGER NOT NULL,
            period_end INTEGER NOT NULL,
            limit_micros INTEGER NOT NULL,
            settled_micros INTEGER NOT NULL,
            reserved_micros INTEGER NOT NULL,
            held_micros INTEGER NOT NULL,
            denial_count INTEGER NOT NULL,
            alert_count INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `);
        this.ctx.storage.sql.exec(
          "INSERT INTO provider_attempt_schema_migrations(version, applied_at) VALUES (3, ?)",
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

function normalizeUsageDelta(
  evidence: ProviderUsageEvidenceInputV1,
  projection: ProviderUsageProjectionRow | undefined,
): ProviderTokenUsageV1 {
  if (evidence.mode === "missing") return emptyProviderTokenUsage();
  if (evidence.mode === "delta") {
    return tokenUsageFromEvidence(evidence);
  }
  const current = currentUsageFromProjection(projection);
  const delta = emptyProviderTokenUsage();
  for (const field of PROVIDER_USAGE_TOKEN_FIELDS) {
    const value = evidence[field];
    delta[field] = value === null ? null : Math.max(0, value - (current[field] ?? 0));
  }
  return delta;
}

function currentUsageFromProjection(row: ProviderUsageProjectionRow | undefined): ProviderTokenUsageV1 {
  if (!row) return emptyProviderTokenUsage();
  return {
    inputNoCacheTokens: row.current_input_no_cache_tokens,
    cacheReadInputTokens: row.current_cache_read_input_tokens,
    cacheWriteInputTokens: row.current_cache_write_input_tokens,
    outputTextTokens: row.current_output_text_tokens,
    reasoningOutputTokens: row.current_reasoning_output_tokens,
  };
}

function totalUsageFromProjection(row: ProviderUsageProjectionRow | undefined): ProviderTokenUsageV1 {
  if (!row) return emptyProviderTokenUsage();
  return {
    inputNoCacheTokens: row.input_no_cache_tokens,
    cacheReadInputTokens: row.cache_read_input_tokens,
    cacheWriteInputTokens: row.cache_write_input_tokens,
    outputTextTokens: row.output_text_tokens,
    reasoningOutputTokens: row.reasoning_output_tokens,
  };
}

function tokenUsageFromEvidence(evidence: ProviderUsageEvidenceInputV1): ProviderTokenUsageV1 {
  return {
    inputNoCacheTokens: evidence.inputNoCacheTokens,
    cacheReadInputTokens: evidence.cacheReadInputTokens,
    cacheWriteInputTokens: evidence.cacheWriteInputTokens,
    outputTextTokens: evidence.outputTextTokens,
    reasoningOutputTokens: evidence.reasoningOutputTokens,
  };
}

function usageEvidenceFromRow(row: ProviderUsageEvidenceRow): {
  input: ProviderUsageEvidenceInputV1;
  effectiveDelta: ProviderTokenUsageV1;
} {
  return {
    input: {
      version: 1,
      evidenceId: row.evidence_id,
      attemptId: row.attempt_id,
      mode: row.mode,
      evidenceClass: row.evidence_class,
      source: row.source,
      observedAt: row.observed_at,
      inputNoCacheTokens: row.input_no_cache_tokens,
      cacheReadInputTokens: row.cache_read_input_tokens,
      cacheWriteInputTokens: row.cache_write_input_tokens,
      outputTextTokens: row.output_text_tokens,
      reasoningOutputTokens: row.reasoning_output_tokens,
    },
    effectiveDelta: {
      inputNoCacheTokens: row.effective_input_no_cache_tokens,
      cacheReadInputTokens: row.effective_cache_read_input_tokens,
      cacheWriteInputTokens: row.effective_cache_write_input_tokens,
      outputTextTokens: row.effective_output_text_tokens,
      reasoningOutputTokens: row.effective_reasoning_output_tokens,
    },
  };
}

function priceCatalogFromRow(row: ProviderPriceCatalogRow): ProviderPriceCatalogInputV1 {
  return {
    version: 1,
    catalogVersionId: row.catalog_version_id,
    providerId: row.provider_id,
    offeringId: row.offering_id,
    model: row.model,
    currency: row.currency,
    precision: row.precision,
    unit: row.unit,
    inputNoCachePriceMicros: row.input_no_cache_price_micros,
    cacheReadInputPriceMicros: row.cache_read_input_price_micros,
    cacheWriteInputPriceMicros: row.cache_write_input_price_micros,
    outputTextPriceMicros: row.output_text_price_micros,
    reasoningOutputPriceMicros: row.reasoning_output_price_micros,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    approver: row.approver,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

function costEvidenceFromRow(row: ProviderCostEvidenceRow): ProviderCostEvidenceInputV1 {
  return {
    version: 1,
    eventId: row.event_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    evidenceClass: row.evidence_class,
    currency: row.currency,
    amountMicros: row.amount_micros,
    supersedesEventId: row.supersedes_event_id,
    sourceEvidenceId: row.source_evidence_id,
    observedAt: row.observed_at,
  };
}

function reconciliationFromRow(row: ProviderReconciliationRow): ProviderReconciliationProjectionV1 {
  return {
    version: 1,
    reconciliationId: row.reconciliation_id,
    revision: row.revision,
    supersedesReconciliationId: row.supersedes_reconciliation_id,
    fingerprint: row.fingerprint,
    providerId: row.provider_id,
    accountFingerprint: row.account_fingerprint,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    reportedTotalMicros: row.reported_total_micros,
    matchedTotalMicros: row.matched_total_micros,
    unmatchedVarianceMicros: row.unmatched_variance_micros,
    status: row.status,
    importedAt: row.imported_at,
  };
}

function sameUsageEvidence(left: ProviderUsageEvidenceInputV1, right: ProviderUsageEvidenceInputV1): boolean {
  return left.evidenceId === right.evidenceId
    && left.attemptId === right.attemptId
    && left.mode === right.mode
    && left.evidenceClass === right.evidenceClass
    && left.source === right.source
    && left.observedAt === right.observedAt
    && sameProviderTokenUsage(left, right);
}

function samePriceCatalog(left: ProviderPriceCatalogInputV1, right: ProviderPriceCatalogInputV1): boolean {
  return left.catalogVersionId === right.catalogVersionId
    && left.providerId === right.providerId
    && left.offeringId === right.offeringId
    && left.model === right.model
    && left.currency === right.currency
    && left.precision === right.precision
    && left.unit === right.unit
    && left.inputNoCachePriceMicros === right.inputNoCachePriceMicros
    && left.cacheReadInputPriceMicros === right.cacheReadInputPriceMicros
    && left.cacheWriteInputPriceMicros === right.cacheWriteInputPriceMicros
    && left.outputTextPriceMicros === right.outputTextPriceMicros
    && left.reasoningOutputPriceMicros === right.reasoningOutputPriceMicros
    && left.effectiveFrom === right.effectiveFrom
    && left.effectiveTo === right.effectiveTo
    && left.approver === right.approver
    && left.provenance === right.provenance
    && left.createdAt === right.createdAt;
}

function sameCostEvidence(left: ProviderCostEvidenceInputV1, right: ProviderCostEvidenceInputV1): boolean {
  return left.eventId === right.eventId
    && left.attemptId === right.attemptId
    && left.kind === right.kind
    && left.evidenceClass === right.evidenceClass
    && left.currency === right.currency
    && left.amountMicros === right.amountMicros
    && left.supersedesEventId === right.supersedesEventId
    && left.sourceEvidenceId === right.sourceEvidenceId
    && left.observedAt === right.observedAt;
}

function sameReconciliation(
  left: ProviderReconciliationProjectionV1,
  right: NonNullable<ReturnType<typeof decodeProviderReconciliationImportInput>>,
): boolean {
  return sameReconciliationState(left, right)
    && left.importedAt === right.importedAt;
}

function sameReconciliationIdentity(
  left: ProviderReconciliationProjectionV1,
  right: NonNullable<ReturnType<typeof decodeProviderReconciliationImportInput>>,
): boolean {
  return left.fingerprint === right.fingerprint
    && left.providerId === right.providerId
    && left.accountFingerprint === right.accountFingerprint
    && left.periodStart === right.periodStart
    && left.periodEnd === right.periodEnd
    && left.currency === right.currency;
}

function sameReconciliationState(
  left: ProviderReconciliationProjectionV1,
  right: NonNullable<ReturnType<typeof decodeProviderReconciliationImportInput>>,
): boolean {
  return sameReconciliationIdentity(left, right)
    && left.reportedTotalMicros === right.reportedTotalMicros
    && left.matchedTotalMicros === right.matchedTotalMicros
    && left.status === right.status;
}

function budgetPolicyFromRow(row: ProviderBudgetPolicyRow): ProviderBudgetPolicyProjectionV1 {
  return {
    version: 1,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    providerId: row.provider_id,
    currency: row.currency,
    mode: row.mode,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    limitMicros: row.limit_micros,
    maxAttemptReserveMicros: row.max_attempt_reserve_micros,
    holdReviewAfterMs: row.hold_review_after_ms as ProviderBudgetPolicyProjectionV1["holdReviewAfterMs"],
    allowUnknownPrice: false,
    approver: row.approver,
    createdAt: row.created_at,
    expectedPreviousVersion: row.policy_version - 1,
  };
}

function budgetPolicyProjectionFromInput(
  input: ProviderBudgetPolicyInputV1,
  policyVersion: number,
): ProviderBudgetPolicyProjectionV1 {
  const { idempotencyKey: _idempotencyKey, ...projection } = input;
  return { ...projection, policyVersion };
}

function sameBudgetPolicyInput(
  left: ProviderBudgetPolicyRow,
  right: ProviderBudgetPolicyInputV1,
): boolean {
  return left.policy_id === right.policyId
    && left.idempotency_key === right.idempotencyKey
    && left.provider_id === right.providerId
    && left.currency === right.currency
    && left.mode === right.mode
    && left.period_start === right.periodStart
    && left.period_end === right.periodEnd
    && left.limit_micros === right.limitMicros
    && left.max_attempt_reserve_micros === right.maxAttemptReserveMicros
    && left.hold_review_after_ms === right.holdReviewAfterMs
    && right.allowUnknownPrice === false
    && left.approver === right.approver
    && left.policy_version - 1 === right.expectedPreviousVersion;
}

function sameBudgetDecisionIdentity(
  row: ProviderBudgetDecisionRow,
  input: NonNullable<ReturnType<typeof decodeProviderAttemptStartInput>>,
): boolean {
  return row.idempotency_key === input.idempotencyKey
    && row.turn_id === input.turnId
    && row.run_id === input.runId
    && row.run_kind === input.runKind
    && row.logical_route_id === input.logicalRouteId
    && row.provider_id === input.providerId
    && row.offering_id === input.offeringId
    && row.model === input.model
    && row.fallback_index === input.fallbackIndex
    && row.credential_class === input.credentialClass
    && row.operation_id === input.operation.operationId
    && row.fence_id === input.operation.fenceId
    && row.operation_kind === input.operation.kind
    && row.operation_started_at === input.operation.startedAt;
}

function budgetDecisionFromRow(row: ProviderBudgetDecisionRow): ProviderBudgetDecisionV1 {
  return {
    version: 1,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    status: row.status,
    reason: row.reason,
    requestedMicros: row.requested_micros,
    reservationId: row.reservation_id,
  };
}

function budgetReservationFromRow(row: ProviderBudgetReservationRow): ProviderBudgetReservationProjectionV1 {
  return {
    version: 1,
    reservationId: row.reservation_id,
    attemptId: row.attempt_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    currency: row.currency,
    status: row.status,
    reservedMicros: row.reserved_micros,
    settledMicros: row.settled_micros,
    releasedMicros: row.released_micros,
    heldMicros: row.held_micros,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewAfter: row.review_after,
  };
}

function budgetAvailableMicros(row: ProviderBudgetProjectionRow): number {
  return Math.max(0, row.limit_micros - row.settled_micros - row.reserved_micros - row.held_micros);
}

function budgetBalanceFromRow(
  row: ProviderBudgetProjectionRow,
  counts?: { pending_count: number; review_count: number },
): ProviderBudgetBalanceProjectionV1 {
  return {
    version: 1,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    providerId: row.provider_id,
    currency: row.currency,
    mode: row.mode,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    limitMicros: requireNonNegativeAggregate(row.limit_micros),
    settledMicros: requireNonNegativeAggregate(row.settled_micros),
    reservedMicros: requireNonNegativeAggregate(row.reserved_micros),
    heldMicros: requireNonNegativeAggregate(row.held_micros),
    availableMicros: budgetAvailableMicros(row),
    denialCount: requireNonNegativeAggregate(row.denial_count),
    alertCount: requireNonNegativeAggregate(row.alert_count),
    pendingSettlementCount: requireNonNegativeAggregate(counts?.pending_count ?? 0),
    reviewRequiredCount: requireNonNegativeAggregate(counts?.review_count ?? 0),
    updatedAt: row.updated_at,
  };
}

function maxUsageEvidenceClass(
  left: ProviderUsageProjectionRow["evidence_class"],
  right: ProviderUsageEvidenceInputV1["evidenceClass"],
): ProviderUsageProjectionRow["evidence_class"] {
  const rank = { unknown: 0, estimated: 1, reported: 2, reconciled: 3 } as const;
  return rank[right] > rank[left] ? right : left;
}

function aggregateCostRows(rows: ProviderCostEvidenceRow[]): ProviderFinanceAttemptProjectionV1["costs"] {
  const byCurrency = new Map<string, ProviderFinanceAttemptProjectionV1["costs"][number]>();
  for (const row of rows) {
    const item = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      provisionalMicros: 0,
      settledMicros: 0,
      correctedMicros: 0,
      totalMicros: 0,
    };
    if (row.evidence_class === "estimated" || row.evidence_class === "reported") {
      item.provisionalMicros += row.amount_micros;
    } else if (row.evidence_class === "reconciled") {
      item.settledMicros += row.amount_micros;
    } else {
      item.correctedMicros += row.amount_micros;
    }
    item.totalMicros += row.amount_micros;
    byCurrency.set(row.currency, item);
  }
  return [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

function requireSafeAggregate(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("provider_finance_snapshot_overflow");
  }
  return value;
}

function requireNonNegativeAggregate(value: unknown): number {
  const normalized = requireSafeAggregate(value);
  if (normalized < 0) throw new Error("provider_finance_snapshot_invalid");
  return normalized;
}

function nullableSafeAggregate(value: unknown): number | null {
  return value === null ? null : requireSafeAggregate(value);
}

function nullableNonNegativeAggregate(value: unknown): number | null {
  return value === null ? null : requireNonNegativeAggregate(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCaptureEpoch(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(value);
}
