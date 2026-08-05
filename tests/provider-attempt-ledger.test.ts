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
      schemaVersion: "provider-attempt-ledger-v1",
    }));
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
  });
});

function startInput(providerId: string): ProviderAttemptStartInputV1 {
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
    startedAt: operation.startedAt + 1,
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
