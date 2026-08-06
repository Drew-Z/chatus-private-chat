import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  PROVIDER_ATTEMPT_DATA_POLICY,
  createProviderRunId,
  createProviderTurnId,
  providerAttemptIdempotencyKey,
  providerOfferingId,
  type ProviderAttemptStartInputV1,
} from "../src/contracts/provider-attempt";
import { PROVIDER_FINANCE_DATA_POLICY } from "../src/contracts/provider-finance";
import {
  createProviderAttemptRuntime,
  projectProviderAttemptFailure,
} from "../src/services/provider-attempt-runtime";

describe("ProviderAttemptLedger", () => {
  it("atomically appends one start and one terminal event with a durable projection", async () => {
    const providerId = uniqueId("provider");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const input = startInput(providerId);

    const started = await ledger.start(input);
    expect(started.created).toBe(true);
    expect(started.attempt).toMatchObject({
      providerId,
      status: "started",
      errorClass: "none",
      fallbackIndex: 0,
    });
    const terminal = await ledger.terminal({
      version: 1,
      attemptId: started.attempt.attemptId,
      status: "succeeded",
      errorClass: "none",
      endedAt: input.startedAt + 20,
    });
    expect(terminal.updated).toBe(true);
    expect(terminal.attempt).toMatchObject({ status: "succeeded", endedAt: input.startedAt + 20 });

    const stored = await runInDurableObject(ledger, async (_instance, state) => ({
      events: state.storage.sql.exec<{ event_kind: string; status: string }>(
        "SELECT event_kind, status FROM provider_attempt_events ORDER BY seq",
      ).toArray(),
      projections: state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM provider_attempt_projection",
      ).one().count,
    }));
    expect(stored).toEqual({
      events: [
        { event_kind: "started", status: "started" },
        { event_kind: "terminal", status: "succeeded" },
      ],
      projections: 1,
    });
  });

  it("replays identical semantic writes without duplicating or rewriting evidence", async () => {
    const providerId = uniqueId("replay");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const input = startInput(providerId);
    const first = await ledger.start(input);
    const replay = await ledger.start({ ...input, startedAt: input.startedAt + 10 });
    expect(replay).toEqual({ created: false, attempt: first.attempt });

    const terminalInput = {
      version: 1 as const,
      attemptId: first.attempt.attemptId,
      status: "failed" as const,
      errorClass: "upstream_rate_limited" as const,
      endedAt: input.startedAt + 20,
    };
    const terminal = await ledger.terminal(terminalInput);
    const terminalReplay = await ledger.terminal({ ...terminalInput, endedAt: input.startedAt + 50 });
    expect(terminalReplay).toEqual({ updated: false, attempt: terminal.attempt });

    await expect(runInDurableObject(ledger, async (_instance, state) => (
      state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM provider_attempt_events").one().count
    ))).resolves.toBe(2);
  });

  it("fails closed on attribution or terminal conflicts", async () => {
    const providerId = uniqueId("conflict");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const input = startInput(providerId);
    const started = await ledger.start(input);

    await runInDurableObject(ledger, async (instance) => {
      await expect(instance.start({ ...input, model: "rewritten-browser-model" }))
        .rejects.toThrow("provider_attempt_conflict");
    });
    await ledger.terminal({
      version: 1,
      attemptId: started.attempt.attemptId,
      status: "failed",
      errorClass: "upstream_unavailable",
      endedAt: input.startedAt + 20,
    });
    await runInDurableObject(ledger, async (instance) => {
      expect(() => instance.terminal({
        version: 1,
        attemptId: started.attempt.attemptId,
        status: "succeeded",
        errorClass: "none",
        endedAt: input.startedAt + 30,
      })).toThrow("provider_attempt_conflict");
    });
  });

  it("rejects extra content fields and returns only bounded secret-safe diagnostics", async () => {
    const providerId = uniqueId("privacy");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const input = startInput(providerId);
    await runInDurableObject(ledger, async (instance) => {
      await expect(instance.start({ ...input, prompt: "SECRET_PROMPT_MARKER" }))
        .rejects.toThrow("provider_attempt_start_invalid");
    });
    const started = await ledger.start(input);
    await ledger.terminal({
      version: 1,
      attemptId: started.attempt.attemptId,
      status: "cancelled",
      errorClass: "request_cancelled",
      endedAt: input.startedAt + 20,
    });

    const diagnostics = await ledger.listRecent({ limit: 10 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).not.toHaveProperty("operation");
    expect(diagnostics[0]).not.toHaveProperty("idempotencyKey");
    expect(JSON.stringify(diagnostics)).not.toContain("SECRET_PROMPT_MARKER");

    const columns = await runInDurableObject(ledger, async (_instance, state) => (
      state.storage.sql.exec<{ name: string }>("PRAGMA table_info(provider_attempt_events)")
        .toArray().map((row) => row.name)
    ));
    expect(columns).not.toEqual(expect.arrayContaining([
      "prompt",
      "completion",
      "tool_payload",
      "credential",
      "provider_metadata",
      "invoice",
    ]));
  });

  it("registers the provider shard as authoritative restore state", async () => {
    const providerId = uniqueId("capture");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    await ledger.start(startInput(providerId));

    const registry = await env.INSTANCE_COORDINATOR.getByName("$instance-maintenance").listRegisteredObjects();
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    expect(registry.objects).toContainEqual(expect.objectContaining({
      kind: "provider_attempt_ledger",
      instanceName: providerId,
      stateClass: "authoritative",
      restoreBehavior: "restore",
      schemaVersion: "provider-attempt-ledger-v2",
    }));
  });

  it("normalizes missing, cumulative, delta and late usage evidence idempotently", async () => {
    const providerId = uniqueId("usage");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const input = startInput(providerId);
    const started = await ledger.start(input);
    await ledger.terminal({
      version: 1,
      attemptId: started.attempt.attemptId,
      status: "succeeded",
      errorClass: "none",
      endedAt: input.startedAt + 10,
    });

    await ledger.appendUsage(usageInput(started.attempt.attemptId, "usage:missing", input.startedAt + 11, {
      mode: "missing",
    }));
    const cumulative = usageInput(started.attempt.attemptId, "usage:cumulative:1", input.startedAt + 12, {
      inputNoCacheTokens: 100,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 20,
      reasoningOutputTokens: 0,
    });
    await expect(ledger.appendUsage(cumulative)).resolves.toMatchObject({
      created: true,
      effectiveDelta: { inputNoCacheTokens: 100, outputTextTokens: 20 },
    });
    await expect(ledger.appendUsage(cumulative)).resolves.toMatchObject({ created: false });
    await expect(ledger.appendUsage(usageInput(
      started.attempt.attemptId,
      "usage:cumulative:2",
      input.startedAt + 13,
      {
        inputNoCacheTokens: 120,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTextTokens: 25,
        reasoningOutputTokens: 0,
      },
    ))).resolves.toMatchObject({
      effectiveDelta: { inputNoCacheTokens: 20, outputTextTokens: 5 },
    });
    await ledger.appendUsage(usageInput(
      started.attempt.attemptId,
      "usage:delta:late",
      input.startedAt + 30,
      {
        mode: "delta",
        inputNoCacheTokens: 3,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTextTokens: 2,
        reasoningOutputTokens: 0,
      },
    ));

    const snapshot = await ledger.getFinanceSnapshot({ periodStart: input.startedAt, limit: 10 });
    expect(snapshot.capacity).toMatchObject({ calls: 1, unknownUsageAttempts: 0 });
    expect(snapshot.usage).toEqual({
      inputNoCacheTokens: 123,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 27,
      reasoningOutputTokens: 0,
    });
    expect(snapshot.attempts[0]).toMatchObject({ usageState: "reported", priceResolution: "missing" });
  });

  it("keeps full-period aggregates unknown while bounding the attempt detail page", async () => {
    const providerId = uniqueId("bounded-finance");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    const known = await ledger.start(startInput(providerId, base));
    await ledger.appendUsage(usageInput(known.attempt.attemptId, "usage:known", base + 1, {
      inputNoCacheTokens: 20,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 5,
      reasoningOutputTokens: 0,
    }));
    await ledger.start(startInput(providerId, base + 2));

    const snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 1 });
    expect(snapshot.capacity).toMatchObject({ calls: 2, unknownUsageAttempts: 1 });
    expect(snapshot.attempts).toHaveLength(1);
    expect(snapshot.usage).toEqual({
      inputNoCacheTokens: null,
      cacheReadInputTokens: null,
      cacheWriteInputTokens: null,
      outputTextTokens: null,
      reasoningOutputTokens: null,
    });
  });

  it("freezes effective-dated prices at attempt start without rewriting historical cost", async () => {
    const providerId = uniqueId("price");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    const boundary = base + 1_000;
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-day-1", base, boundary, 1_000_000));
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-day-2", boundary, null, 2_000_000));

    const firstInput = startInput(providerId, base + 100);
    const first = await ledger.start(firstInput);
    const secondInput = startInput(providerId, boundary + 100);
    const second = await ledger.start(secondInput);
    await ledger.appendUsage(usageInput(first.attempt.attemptId, "usage:first", base + 200, {
      inputNoCacheTokens: 100,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 20,
      reasoningOutputTokens: 0,
    }));
    await ledger.appendUsage(usageInput(second.attempt.attemptId, "usage:second", boundary + 200, {
      inputNoCacheTokens: 100,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 20,
      reasoningOutputTokens: 0,
    }));

    const snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    const byId = new Map(snapshot.attempts.map((attempt) => [attempt.attemptId, attempt]));
    expect(byId.get(first.attempt.attemptId)).toMatchObject({
      catalogVersionId: "catalog-day-1",
      costs: [{ currency: "USD", totalMicros: 140 }],
    });
    expect(byId.get(second.attempt.attemptId)).toMatchObject({
      catalogVersionId: "catalog-day-2",
      costs: [{ currency: "USD", totalMicros: 240 }],
    });
  });

  it("retains reversal, replacement and correction evidence while converging exactly", async () => {
    const providerId = uniqueId("correction");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-correction", base, null, 1_000_000));
    const input = startInput(providerId, base + 1);
    const started = await ledger.start(input);
    await ledger.appendUsage(usageInput(started.attempt.attemptId, "usage:priced", base + 2, {
      inputNoCacheTokens: 100,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 0,
      reasoningOutputTokens: 0,
    }));
    await ledger.appendCostEvidence(costInput(started.attempt.attemptId, "cost:reversal", -100, "reversal", "cost:auto:usage:priced", base + 3));
    await expect(runInDurableObject(ledger, (instance) => instance.appendCostEvidence({
      ...costInput(started.attempt.attemptId, "cost:bad-class", -100, "reversal", "cost:auto:usage:priced", base + 3),
      evidenceClass: "reported",
    }))).rejects.toThrow("provider_cost_evidence_invalid");
    await expect(runInDurableObject(ledger, (instance) => instance.appendCostEvidence(
      costInput(started.attempt.attemptId, "cost:late-reversal", -100, "reversal", "cost:auto:usage:priced", base + 1),
    ))).rejects.toThrow("provider_cost_supersedes_invalid");
    await ledger.appendCostEvidence(costInput(started.attempt.attemptId, "cost:replacement", 80, "replacement", "cost:reversal", base + 4));
    const correction = costInput(started.attempt.attemptId, "cost:correction", 5, "correction", "cost:replacement", base + 5);
    await ledger.appendCostEvidence(correction);
    await expect(ledger.appendCostEvidence(correction)).resolves.toMatchObject({ created: false });

    const snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.attempts[0]).toMatchObject({
      costState: "corrected",
      costs: [{
        currency: "USD",
        provisionalMicros: 100,
        correctedMicros: -15,
        totalMicros: 85,
      }],
    });
    const stored = await runInDurableObject(ledger, async (_instance, state) => (
      state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM provider_cost_evidence").one().count
    ));
    expect(stored).toBe(4);
  });

  it("imports bounded reconciliation summaries without raw invoice material", async () => {
    const providerId = uniqueId("reconcile");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const importedAt = Date.now();
    const input = {
      version: 1 as const,
      fingerprint: `sha256:${"a".repeat(64)}`,
      providerId,
      accountFingerprint: `acct_sha256:${"b".repeat(64)}`,
      periodStart: importedAt - 10_000,
      periodEnd: importedAt - 1,
      currency: "USD",
      reportedTotalMicros: 1_000,
      matchedTotalMicros: 800,
      status: "partial" as const,
      importedAt,
    };
    await expect(ledger.importReconciliation(input)).resolves.toMatchObject({
      created: true,
      reconciliation: { unmatchedVarianceMicros: 200 },
    });
    await expect(ledger.importReconciliation(input)).resolves.toMatchObject({ created: false });
    await expect(runInDurableObject(ledger, (instance) => instance.importReconciliation({
      ...input,
      rawInvoice: "SECRET_INVOICE_MARKER",
    }))).rejects.toThrow("provider_reconciliation_invalid");
    const snapshot = await ledger.getFinanceSnapshot({ periodStart: input.periodStart, limit: 10 });
    expect(snapshot.reconciliations[0]).toMatchObject({
      status: "partial",
      unmatchedVarianceMicros: 200,
    });
    expect(JSON.stringify(snapshot)).not.toContain("SECRET_INVOICE_MARKER");
  });

  it("versions reconciliation status and totals without mutating the prior import", async () => {
    const providerId = uniqueId("reconcile-revision");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const importedAt = Date.now();
    const input = {
      version: 1 as const,
      fingerprint: `sha256:${"e".repeat(64)}`,
      providerId,
      accountFingerprint: `acct_sha256:${"f".repeat(64)}`,
      periodStart: importedAt - 20_000,
      periodEnd: importedAt - 10_000,
      currency: "USD",
      reportedTotalMicros: 1_000,
      matchedTotalMicros: 700,
      status: "partial" as const,
      importedAt,
    };
    const first = await ledger.importReconciliation(input);
    const corrected = {
      ...input,
      reportedTotalMicros: 1_100,
      matchedTotalMicros: 1_100,
      status: "corrected" as const,
      importedAt: importedAt + 1,
    };
    await expect(ledger.importReconciliation(corrected)).resolves.toMatchObject({
      created: true,
      reconciliation: {
        revision: 2,
        supersedesReconciliationId: first.reconciliation.reconciliationId,
        reportedTotalMicros: 1_100,
        unmatchedVarianceMicros: 0,
      },
    });
    await expect(ledger.importReconciliation(corrected)).resolves.toMatchObject({ created: false });
    await expect(runInDurableObject(ledger, (instance) => instance.importReconciliation({
      ...corrected,
      importedAt: importedAt - 1,
    }))).rejects.toThrow("provider_reconciliation_conflict");
    const rows = await runInDurableObject(ledger, (instance) => instance.getFinanceSnapshot({ periodStart: input.periodStart, limit: 10 }).reconciliations);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.revision).sort()).toEqual([1, 2]);
  });
});

describe("provider attempt runtime", () => {
  it("issues opaque server identities and records terminal error classes", async () => {
    const providerId = uniqueId("runtime");
    const operation = operationState();
    const runtime = createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: "required",
      operation,
    });
    const run = runtime.createRun("automatic_skill");
    const handle = await run.start({
      logicalRouteId: "reasoning",
      providerId,
      model: "fake-model",
      credentialClass: "managed",
      fallbackIndex: 0,
      startedAt: operation.startedAt + 1,
    });
    await handle.recordUsage({
      inputNoCacheTokens: null,
      cacheReadInputTokens: null,
      cacheWriteInputTokens: null,
      outputTextTokens: null,
      reasoningOutputTokens: null,
      source: "ai_sdk_generate",
      observedAt: operation.startedAt + 2,
    });
    const timeout = new Error("fake timeout");
    timeout.name = "TimeoutError";
    await handle.fail(timeout, operation.startedAt + 10);

    expect(runtime.turnId).toMatch(/^turn_/);
    expect(run.runId).toMatch(/^run_/);
    expect(handle.attemptId).toMatch(/^attempt_/);
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent()).resolves.toEqual([
      expect.objectContaining({
        turnId: runtime.turnId,
        runId: run.runId,
        runKind: "automatic_skill",
        status: "timed_out",
        errorClass: "upstream_timeout",
      }),
    ]);
  });

  it("supports the explicit disabled rollback mode without touching a ledger shard", async () => {
    const runtime = createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: "disabled",
      operation: operationState(),
    });
    const handle = await runtime.createRun("main_answer").start({
      logicalRouteId: "reasoning",
      providerId: uniqueId("disabled"),
      model: "fake-model",
      credentialClass: "worker",
      fallbackIndex: 0,
    });
    expect(handle.attemptId).toBeUndefined();
    await expect(handle.succeed()).resolves.toBeUndefined();
  });

  it("classifies cancellation, protocol, status and unknown failures without raw messages", () => {
    const cancelled = new Error("secret cancellation detail");
    cancelled.name = "AbortError";
    expect(projectProviderAttemptFailure(cancelled)).toEqual({
      status: "cancelled",
      errorClass: "request_cancelled",
    });
    expect(projectProviderAttemptFailure({ status: 429, message: "secret provider body" })).toEqual({
      status: "failed",
      errorClass: "upstream_rate_limited",
    });
    expect(projectProviderAttemptFailure(new Error("secret unknown detail"))).toEqual({
      status: "failed",
      errorClass: "upstream_error",
    });
  });

  it("declares backup, deletion, export and retention policy without billing semantics", () => {
    expect(PROVIDER_ATTEMPT_DATA_POLICY).toEqual({
      backup: "authoritative_restore",
      accountDeletion: "retain_instance_operational_evidence",
      userExport: "excluded",
      retention: "no_automatic_expiry",
    });
    expect(PROVIDER_ATTEMPT_DATA_POLICY).not.toHaveProperty("cost");
    expect(PROVIDER_ATTEMPT_DATA_POLICY).not.toHaveProperty("usage");
    expect(PROVIDER_FINANCE_DATA_POLICY).toEqual({
      backup: "authoritative_restore",
      accountDeletion: "retain_instance_operational_evidence",
      userExport: "excluded",
      retention: "no_automatic_expiry",
      rawInvoice: "excluded",
      memberVisibleMoney: "unsupported",
      hardBudgetEnforcement: "unsupported",
    });
  });
});

function startInput(providerId: string, startedAt?: number): ProviderAttemptStartInputV1 {
  const operation = operationState();
  const runId = createProviderRunId();
  return {
    version: 1,
    idempotencyKey: providerAttemptIdempotencyKey(operation.fenceId, runId, 0),
    turnId: createProviderTurnId(),
    runId,
    runKind: "main_answer",
    logicalRouteId: "reasoning",
    providerId,
    offeringId: providerOfferingId("reasoning", providerId),
    model: "fake-model",
    fallbackIndex: 0,
    credentialClass: "managed",
    operation,
    startedAt: startedAt ?? operation.startedAt + 1,
  };
}

function usageInput(
  attemptId: string,
  evidenceId: string,
  observedAt: number,
  overrides: Partial<{
    mode: "cumulative" | "delta" | "missing";
    inputNoCacheTokens: number | null;
    cacheReadInputTokens: number | null;
    cacheWriteInputTokens: number | null;
    outputTextTokens: number | null;
    reasoningOutputTokens: number | null;
  }> = {},
) {
  return {
    version: 1 as const,
    evidenceId,
    attemptId,
    mode: overrides.mode ?? "cumulative",
    evidenceClass: "reported" as const,
    source: "ai_sdk_generate" as const,
    observedAt,
    inputNoCacheTokens: overrides.inputNoCacheTokens ?? null,
    cacheReadInputTokens: overrides.cacheReadInputTokens ?? null,
    cacheWriteInputTokens: overrides.cacheWriteInputTokens ?? null,
    outputTextTokens: overrides.outputTextTokens ?? null,
    reasoningOutputTokens: overrides.reasoningOutputTokens ?? null,
  };
}

function priceInput(
  providerId: string,
  catalogVersionId: string,
  effectiveFrom: number,
  effectiveTo: number | null,
  inputPriceMicros: number,
) {
  return {
    version: 1 as const,
    catalogVersionId,
    providerId,
    offeringId: providerOfferingId("reasoning", providerId),
    model: "fake-model",
    currency: "USD",
    precision: 6,
    unit: "million_tokens" as const,
    inputNoCachePriceMicros: inputPriceMicros,
    cacheReadInputPriceMicros: 0,
    cacheWriteInputPriceMicros: 0,
    outputTextPriceMicros: 2_000_000,
    reasoningOutputPriceMicros: 0,
    effectiveFrom,
    effectiveTo,
    approver: "finance-admin",
    provenance: "provider-published-price-card",
    createdAt: effectiveFrom,
  };
}

function costInput(
  attemptId: string,
  eventId: string,
  amountMicros: number,
  kind: "reversal" | "replacement" | "correction",
  supersedesEventId: string,
  observedAt: number,
) {
  return {
    version: 1 as const,
    eventId,
    attemptId,
    kind,
    evidenceClass: "corrected" as const,
    currency: "USD",
    amountMicros,
    supersedesEventId,
    sourceEvidenceId: null,
    observedAt,
  };
}

function operationState() {
  return {
    version: 1 as const,
    operationId: uniqueId("provider-turn"),
    fenceId: crypto.randomUUID(),
    kind: "provider_turn" as const,
    startedAt: Date.now(),
  };
}

function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
