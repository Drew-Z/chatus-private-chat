import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { ProviderAttemptLedger } from "../src/provider-attempt-ledger";
import {
  PROVIDER_ATTEMPT_DATA_POLICY,
  createProviderRunId,
  createProviderTurnId,
  providerAttemptIdempotencyKey,
  providerOfferingId,
  type ProviderAttemptStartInputV1,
} from "../src/contracts/provider-attempt";
import {
  PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS,
  PROVIDER_FINANCE_DATA_POLICY,
} from "../src/contracts/provider-finance";
import {
  ProviderAttemptLedgerError,
  ProviderBudgetError,
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
      schemaVersion: "provider-attempt-ledger-v3",
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

  it("upgrades an existing provider ledger registration from schema v2 to v3", async () => {
    const providerId = uniqueId("capture-upgrade");
    const coordinator = env.INSTANCE_COORDINATOR.getByName("$instance-maintenance");
    await expect(coordinator.registerObject({
      version: 1,
      kind: "provider_attempt_ledger",
      instanceName: providerId,
      rootInstanceName: "",
      schemaVersion: "provider-attempt-ledger-v2",
      stateClass: "authoritative",
      restoreBehavior: "restore",
      registeredAt: Date.now(),
    })).resolves.toMatchObject({ ok: true });

    await env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).start(startInput(providerId));
    const registry = await coordinator.listRegisteredObjects();
    expect(registry).toMatchObject({
      ok: true,
      objects: expect.arrayContaining([
        expect.objectContaining({ instanceName: providerId, schemaVersion: "provider-attempt-ledger-v3" }),
      ]),
    });
  });

  it("requires a shadow first policy before a versioned hard promotion", async () => {
    const providerId = uniqueId("budget-policy-transition");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    const hard = budgetPolicyInput(providerId, "budget-policy-transition", base);
    await expect(runInDurableObject(ledger, (instance) => instance.addBudgetPolicy(hard)))
      .rejects.toThrow("provider_budget_policy_transition");

    const promoted = await addHardBudgetPolicy(ledger, hard);
    const snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(promoted).toMatchObject({ mode: "hard", expectedPreviousVersion: 1 });
    expect(snapshot.budgetPolicies).toEqual([
      expect.objectContaining({ policyVersion: 2, mode: "hard" }),
      expect.objectContaining({ policyVersion: 1, mode: "shadow" }),
    ]);
  });

  it("atomically denies concurrent hard reservations before creating another attempt", async () => {
    const providerId = uniqueId("budget-concurrent");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-budget-concurrent", base, null, 1_000_000));
    await addHardBudgetPolicy(ledger, budgetPolicyInput(providerId, "budget-concurrent", base, {
      limitMicros: 100,
      maxAttemptReserveMicros: 100,
    }));

    const outcomes = await Promise.allSettled([
      ledger.start(startInput(providerId, base + 10)),
      ledger.start(startInput(providerId, base + 11)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("provider_budget_exceeded") }),
    });

    const snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.capacity.calls).toBe(1);
    expect(snapshot.budgetBalances).toEqual([
      expect.objectContaining({
        policyId: "budget-concurrent",
        mode: "hard",
        limitMicros: 100,
        reservedMicros: 100,
        availableMicros: 0,
        denialCount: 1,
        pendingSettlementCount: 1,
      }),
    ]);
  });

  it("denies unknown price in hard mode without an attempt and excludes BYOK from the balance", async () => {
    const providerId = uniqueId("budget-price-byok");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    await addHardBudgetPolicy(ledger, budgetPolicyInput(providerId, "budget-price-byok", base));
    await expect(runInDurableObject(ledger, (instance) => instance.start(startInput(providerId, base + 10))))
      .rejects.toThrow("provider_budget_policy_unknown");

    await ledger.addPriceCatalog(priceInput(providerId, "catalog-budget-byok", base, null, 1_000_000));
    const byok = startInput(providerId, base + 11);
    byok.credentialClass = "user";
    await expect(ledger.start(byok)).resolves.toMatchObject({
      created: true,
      budgetDecision: {
        status: "excluded",
        reason: "byok_excluded",
        reservationId: null,
      },
    });
    const snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.capacity.calls).toBe(1);
    expect(snapshot.budgetBalances[0]).toMatchObject({
      reservedMicros: 0,
      settledMicros: 0,
      heldMicros: 0,
      denialCount: 1,
    });
    expect(snapshot.budgetReservations).toEqual([]);
  });

  it("settles exact known cost, releases the remainder, and follows corrections", async () => {
    const providerId = uniqueId("budget-settle");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-budget-settle", base, null, 1_000_000));
    await addHardBudgetPolicy(ledger, budgetPolicyInput(providerId, "budget-settle", base, {
      limitMicros: 1_000,
      maxAttemptReserveMicros: 500,
    }));
    const start = startInput(providerId, base + 10);
    const started = await ledger.start(start);
    await expect(ledger.start({ ...start, startedAt: base + 20 })).resolves.toMatchObject({
      created: false,
      attempt: { attemptId: started.attempt.attemptId },
      budgetDecision: { reservationId: started.budgetDecision?.reservationId },
    });
    const usage = usageInput(started.attempt.attemptId, "usage:budget:settle", base + 11, {
      inputNoCacheTokens: 100,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 0,
      reasoningOutputTokens: 0,
    });
    await expect(ledger.appendUsage(usage)).resolves.toMatchObject({ created: true });
    await expect(ledger.appendUsage(usage)).resolves.toMatchObject({ created: false });
    const terminal = {
      version: 1,
      attemptId: started.attempt.attemptId,
      status: "succeeded" as const,
      errorClass: "none" as const,
      endedAt: base + 12,
    };
    await expect(ledger.terminal(terminal)).resolves.toMatchObject({ updated: true });
    await expect(ledger.terminal({ ...terminal, endedAt: base + 21 })).resolves.toMatchObject({ updated: false });
    let snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.budgetBalances[0]).toMatchObject({
      settledMicros: 100,
      reservedMicros: 0,
      heldMicros: 0,
      availableMicros: 900,
    });
    expect(snapshot.budgetReservations[0]).toMatchObject({
      status: "settled",
      settledMicros: 100,
      releasedMicros: 400,
    });

    await ledger.appendCostEvidence(costInput(
      started.attempt.attemptId,
      "cost:budget:reversal",
      -100,
      "reversal",
      "cost:auto:usage:budget:settle",
      base + 13,
    ));
    await ledger.appendCostEvidence(costInput(
      started.attempt.attemptId,
      "cost:budget:replacement",
      80,
      "replacement",
      "cost:budget:reversal",
      base + 14,
    ));
    snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.budgetBalances[0]).toMatchObject({ settledMicros: 80, availableMicros: 920 });
    expect(snapshot.budgetReservations[0]).toMatchObject({
      status: "reconciled",
      settledMicros: 80,
      releasedMicros: 420,
    });
  });

  it("settles known billable failure, cancellation, and timeout to exact balances", async () => {
    const providerId = uniqueId("budget-terminal-balances");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-budget-terminal-balances", base, null, 1_000_000));
    await addHardBudgetPolicy(ledger, budgetPolicyInput(providerId, "budget-terminal-balances", base, {
      limitMicros: 300,
      maxAttemptReserveMicros: 100,
    }));
    const terminalCases = [
      { status: "failed", errorClass: "upstream_error", inputTokens: 10 },
      { status: "cancelled", errorClass: "request_cancelled", inputTokens: 20 },
      { status: "timed_out", errorClass: "upstream_timeout", inputTokens: 30 },
    ] as const;

    for (const [index, terminalCase] of terminalCases.entries()) {
      const started = await ledger.start(startInput(providerId, base + 10 + index));
      await ledger.appendUsage(usageInput(
        started.attempt.attemptId,
        `usage:budget:terminal:${index}`,
        base + 20 + index,
        {
          inputNoCacheTokens: terminalCase.inputTokens,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTextTokens: 0,
          reasoningOutputTokens: 0,
        },
      ));
      await ledger.terminal({
        version: 1,
        attemptId: started.attempt.attemptId,
        status: terminalCase.status,
        errorClass: terminalCase.errorClass,
        endedAt: base + 30 + index,
      });
    }

    const snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.budgetBalances[0]).toMatchObject({
      settledMicros: 60,
      reservedMicros: 0,
      heldMicros: 0,
      availableMicros: 240,
      pendingSettlementCount: 0,
    });
    expect(snapshot.budgetReservations.map((reservation) => ({
      status: reservation.status,
      settledMicros: reservation.settledMicros,
      releasedMicros: reservation.releasedMicros,
    }))).toEqual(expect.arrayContaining([
      { status: "settled", settledMicros: 10, releasedMicros: 90 },
      { status: "settled", settledMicros: 20, releasedMicros: 80 },
      { status: "settled", settledMicros: 30, releasedMicros: 70 },
    ]));
  });

  it("retains unknown cost, promotes it for review after 72 hours, and releases only by audited action", async () => {
    const providerId = uniqueId("budget-hold");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() - PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS - 10_000;
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-budget-hold", base, null, 1_000_000));
    await addHardBudgetPolicy(ledger, budgetPolicyInput(providerId, "budget-hold", base, {
      periodEnd: Date.now() + 60_000,
    }));
    const started = await ledger.start(startInput(providerId, base + 10));
    await ledger.terminal({
      version: 1,
      attemptId: started.attempt.attemptId,
      status: "failed",
      errorClass: "upstream_unavailable",
      endedAt: base + 20,
    });

    let snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    const held = snapshot.budgetReservations[0];
    expect(held).toMatchObject({ status: "review_required", heldMicros: 500 });
    expect(snapshot.budgetBalances[0]).toMatchObject({
      heldMicros: 500,
      availableMicros: 500,
      reviewRequiredCount: 1,
    });

    const action = {
      version: 1 as const,
      idempotencyKey: `provider-budget-action:v1:${crypto.randomUUID()}`,
      providerId,
      reservationId: held.reservationId,
      action: "release" as const,
      amountMicros: 0,
      reason: "operator verified non-billable failure",
      at: Date.now(),
    };
    await expect(ledger.reconcileBudgetReservation(action)).resolves.toMatchObject({ updated: true });
    await expect(ledger.reconcileBudgetReservation(action)).resolves.toMatchObject({ updated: false });
    snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.budgetReservations[0]).toMatchObject({
      status: "operator_released",
      settledMicros: 0,
      heldMicros: 0,
      releasedMicros: 500,
    });
    expect(snapshot.budgetBalances[0]).toMatchObject({ heldMicros: 0, availableMicros: 1_000 });
  });

  it("rolls hard policy back to soft without dropping existing holds", async () => {
    const providerId = uniqueId("budget-soft-rollback");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-budget-soft-rollback", base, null, 1_000_000));
    const hard = await addHardBudgetPolicy(ledger, budgetPolicyInput(providerId, "budget-soft-rollback", base, {
      limitMicros: 500,
      maxAttemptReserveMicros: 500,
    }));
    const reserved = await ledger.start(startInput(providerId, base + 10));
    await ledger.terminal({
      version: 1,
      attemptId: reserved.attempt.attemptId,
      status: "failed",
      errorClass: "upstream_unavailable",
      endedAt: base + 11,
    });

    await ledger.addBudgetPolicy({
      ...hard,
      idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
      mode: "soft",
      createdAt: base + 12,
      expectedPreviousVersion: 2,
    });
    const softAttempt = await ledger.start(startInput(providerId, base + 13));
    expect(softAttempt.budgetDecision).toMatchObject({
      status: "would_deny",
      reason: "insufficient_balance",
      reservationId: null,
    });
    let snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.budgetReservations).toHaveLength(1);
    expect(snapshot.budgetReservations[0]).toMatchObject({ status: "held", heldMicros: 500 });
    expect(snapshot.budgetBalances[0]).toMatchObject({ mode: "soft", heldMicros: 500, availableMicros: 0 });

    await ledger.appendUsage(usageInput(reserved.attempt.attemptId, "usage:budget:soft-rollback", base + 14, {
      inputNoCacheTokens: 100,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 0,
      reasoningOutputTokens: 0,
    }));
    snapshot = await ledger.getFinanceSnapshot({ periodStart: base, limit: 10 });
    expect(snapshot.budgetReservations[0]).toMatchObject({ status: "reconciled", settledMicros: 100, heldMicros: 0 });
    expect(snapshot.budgetBalances[0]).toMatchObject({ mode: "soft", settledMicros: 100, availableMicros: 400 });
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

  it("preserves stable budget denial instead of projecting it as a ledger outage", async () => {
    const providerId = uniqueId("runtime-budget");
    const ledger = env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId);
    const base = Date.now() + 1_000;
    await ledger.addPriceCatalog(priceInput(providerId, "catalog-runtime-budget", base, null, 1_000_000));
    await addHardBudgetPolicy(ledger, budgetPolicyInput(providerId, "runtime-budget", base, {
      limitMicros: 100,
      maxAttemptReserveMicros: 100,
    }));
    const operation = operationState(base);
    const runtime = createProviderAttemptRuntime({
      ledger: env.PROVIDER_ATTEMPT_LEDGER,
      mode: "required",
      operation,
    });
    const route = {
      logicalRouteId: "reasoning",
      providerId,
      model: "fake-model",
      credentialClass: "managed" as const,
      fallbackIndex: 0,
      startedAt: base + 1,
    };
    await runtime.createRun("main_answer").start(route);
    const denied = runtime.createRun("automatic_skill").start({ ...route, startedAt: base + 2 });
    await expect(denied).rejects.toBeInstanceOf(ProviderBudgetError);
    await expect(denied).rejects.toMatchObject({ code: "provider_budget_exceeded" });
  });

  it("preserves successful Provider output on terminal availability failure but not on consistency failure", async () => {
    const attemptId = `attempt_${crypto.randomUUID()}`;
    const terminal = vi.fn().mockRejectedValue(new Error("temporary storage outage"));
    const stub = {
      start: vi.fn().mockResolvedValue({ created: true, attempt: { attemptId } }),
      terminal,
      appendUsage: vi.fn(),
    };
    const namespace = {
      getByName: vi.fn().mockReturnValue(stub),
    } as unknown as DurableObjectNamespace<ProviderAttemptLedger>;
    const runtime = createProviderAttemptRuntime({
      ledger: namespace,
      mode: "required",
      operation: operationState(),
    });
    const handle = await runtime.createRun("main_answer").start({
      logicalRouteId: "reasoning",
      providerId: "provider-a",
      model: "fake-model",
      credentialClass: "managed",
      fallbackIndex: 0,
    });

    await expect(handle.succeed()).resolves.toBeUndefined();
    expect(terminal).toHaveBeenCalledTimes(2);

    const conflictTerminal = vi.fn().mockRejectedValue(new Error("provider_attempt_conflict"));
    const conflictHandle = await createProviderAttemptRuntime({
      ledger: {
        getByName: vi.fn().mockReturnValue({
          start: vi.fn().mockResolvedValue({
            created: true,
            attempt: { attemptId: `attempt_${crypto.randomUUID()}` },
          }),
          terminal: conflictTerminal,
          appendUsage: vi.fn(),
        }),
      } as unknown as DurableObjectNamespace<ProviderAttemptLedger>,
      mode: "required",
      operation: operationState(),
    }).createRun("main_answer").start({
      logicalRouteId: "reasoning",
      providerId: "provider-a",
      model: "fake-model",
      credentialClass: "managed",
      fallbackIndex: 0,
    });
    await expect(conflictHandle.succeed()).rejects.toBeInstanceOf(ProviderAttemptLedgerError);
    expect(conflictTerminal).toHaveBeenCalledTimes(2);
  });

  it("keeps failure settlement fail-closed when the terminal ledger is unavailable", async () => {
    const attemptId = `attempt_${crypto.randomUUID()}`;
    const terminal = vi.fn().mockRejectedValue(new Error("temporary storage outage"));
    const namespace = {
      getByName: vi.fn().mockReturnValue({
        start: vi.fn().mockResolvedValue({ created: true, attempt: { attemptId } }),
        terminal,
      }),
    } as unknown as DurableObjectNamespace<ProviderAttemptLedger>;
    const handle = await createProviderAttemptRuntime({
      ledger: namespace,
      mode: "required",
      operation: operationState(),
    }).createRun("main_answer").start({
      logicalRouteId: "reasoning",
      providerId: "provider-a",
      model: "fake-model",
      credentialClass: "managed",
      fallbackIndex: 0,
    });

    await expect(handle.fail(new Error("provider failed"))).rejects.toBeInstanceOf(ProviderAttemptLedgerError);
    expect(terminal).toHaveBeenCalledTimes(2);
  });

  it("schedules successful terminal retry without changing the preserved response", async () => {
    const attemptId = `attempt_${crypto.randomUUID()}`;
    const terminal = vi.fn()
      .mockRejectedValueOnce(new Error("temporary storage outage"))
      .mockRejectedValueOnce(new Error("temporary storage outage"))
      .mockRejectedValueOnce(new Error("temporary storage outage"))
      .mockRejectedValueOnce(new Error("temporary storage outage"))
      .mockResolvedValueOnce({ updated: true });
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const namespace = {
      getByName: vi.fn().mockReturnValue({
        start: vi.fn().mockResolvedValue({ created: true, attempt: { attemptId } }),
        terminal,
        appendUsage: vi.fn(),
      }),
    } as unknown as DurableObjectNamespace<ProviderAttemptLedger>;
    const handle = await createProviderAttemptRuntime({
      ledger: namespace,
      mode: "required",
      operation: operationState(),
      waitUntil,
    }).createRun("main_answer").start({
      logicalRouteId: "reasoning",
      providerId: "provider-a",
      model: "fake-model",
      credentialClass: "managed",
      fallbackIndex: 0,
    });

    await expect(handle.succeed()).resolves.toBeUndefined();
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(terminal).toHaveBeenCalledTimes(5);
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
      hardBudgetEnforcement: "instance_provider_v1",
    });
  });
});

function startInput(providerId: string, startedAt?: number): ProviderAttemptStartInputV1 {
  const operation = operationState(startedAt === undefined ? undefined : Math.max(0, startedAt - 1));
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

function operationState(startedAt = Date.now()) {
  return {
    version: 1 as const,
    operationId: uniqueId("provider-turn"),
    fenceId: crypto.randomUUID(),
    kind: "provider_turn" as const,
    startedAt,
  };
}

function budgetPolicyInput(
  providerId: string,
  policyId: string,
  periodStart: number,
  overrides: Partial<{
    mode: "disabled" | "shadow" | "soft" | "hard";
    periodEnd: number;
    limitMicros: number;
    maxAttemptReserveMicros: number;
    expectedPreviousVersion: number;
  }> = {},
) {
  return {
    version: 1 as const,
    policyId,
    idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
    providerId,
    currency: "USD",
    mode: overrides.mode ?? "hard",
    periodStart,
    periodEnd: overrides.periodEnd ?? periodStart + 24 * 60 * 60 * 1_000,
    limitMicros: overrides.limitMicros ?? 1_000,
    maxAttemptReserveMicros: overrides.maxAttemptReserveMicros ?? 500,
    holdReviewAfterMs: PROVIDER_BUDGET_HOLD_REVIEW_AFTER_MS,
    allowUnknownPrice: false as const,
    approver: "finance-admin",
    createdAt: periodStart,
    expectedPreviousVersion: overrides.expectedPreviousVersion ?? 0,
  };
}

async function addHardBudgetPolicy(
  ledger: DurableObjectStub<ProviderAttemptLedger>,
  input: ReturnType<typeof budgetPolicyInput>,
): Promise<ReturnType<typeof budgetPolicyInput>> {
  await ledger.addBudgetPolicy({
    ...input,
    mode: "shadow",
    expectedPreviousVersion: 0,
  });
  const hard = {
    ...input,
    idempotencyKey: `provider-budget-policy:v1:${crypto.randomUUID()}`,
    mode: "hard" as const,
    createdAt: input.createdAt + 1,
    expectedPreviousVersion: 1,
  };
  await ledger.addBudgetPolicy(hard);
  return hard;
}

function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
