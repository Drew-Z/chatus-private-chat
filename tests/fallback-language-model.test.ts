import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createFallbackLanguageModel, type ProviderAttemptEvent } from "../src/services/fallback-language-model";
import {
  createProviderAttemptRuntime,
  ProviderAttemptLedgerError,
  ProviderBudgetError,
  type ProviderAttemptRun,
} from "../src/services/provider-attempt-runtime";
import { createProviderFirstVisibleDeadline } from "../src/services/provider-first-visible-deadline";

const CALL_OPTIONS = { prompt: [] } as unknown as LanguageModelV3CallOptions;

function model(args: {
  stream?: LanguageModelV3StreamPart[];
  streamSource?: ReadableStream<LanguageModelV3StreamPart>;
  onStream?: () => void;
  onStreamOptions?: (options: LanguageModelV3CallOptions) => void;
  streamError?: unknown;
  generate?: LanguageModelV3GenerateResult;
  generateSource?: PromiseLike<LanguageModelV3GenerateResult>;
  onGenerate?: () => void;
  onGenerateOptions?: (options: LanguageModelV3CallOptions) => void;
  generateError?: unknown;
}): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    async doGenerate(options) {
      if (args.generateError) throw args.generateError;
      args.onGenerateOptions?.(options);
      args.onGenerate?.();
      if (args.generateSource) return args.generateSource;
      if (!args.generate) throw new Error("missing generate fixture");
      return args.generate;
    },
    async doStream(options) {
      if (args.streamError) throw args.streamError;
      args.onStreamOptions?.(options);
      args.onStream?.();
      return { stream: args.streamSource || streamOf(args.stream || []) };
    },
  };
}

describe("fallback language model", () => {
  it.each(["generate", "stream"] as const)(
    "runs the %s pre-attempt guard after capacity and before ledger or Provider I/O",
    async (operation) => {
      const primary = model({
        generate: generateResult("must not generate"),
        stream: successfulStream("must not stream"),
      });
      const backup = model({
        generate: generateResult("must not generate fallback"),
        stream: successfulStream("must not stream fallback"),
      });
      const primaryGenerate = vi.spyOn(primary, "doGenerate");
      const primaryStream = vi.spyOn(primary, "doStream");
      const backupGenerate = vi.spyOn(backup, "doGenerate");
      const backupStream = vi.spyOn(backup, "doStream");
      const primaryRelease = vi.fn(async () => undefined);
      const primaryAcquire = vi.fn(async () => ({ release: primaryRelease }));
      const backupAcquire = vi.fn(async () => ({ release: vi.fn(async () => undefined) }));
      const revoked = new Error("attempt authorization changed");
      const beforeAttempt = vi.fn(async () => { throw revoked; });
      const run = {
        turnId: `turn_${crypto.randomUUID()}`,
        runId: `run_${crypto.randomUUID()}`,
        runKind: "auxiliary_vision",
        start: vi.fn(async () => { throw new Error("ledger must not start"); }),
      } satisfies ProviderAttemptRun;
      const router = createFallbackLanguageModel([
        {
          routeId: "primary",
          providerId: "primary",
          usedUserKey: false,
          model: primary,
          acquireLease: primaryAcquire,
        },
        {
          routeId: "backup",
          providerId: "backup",
          usedUserKey: false,
          model: backup,
          acquireLease: backupAcquire,
        },
      ], {}, { createRun: () => run, beforeAttempt });

      const result = operation === "generate"
        ? router.doGenerate(CALL_OPTIONS)
        : router.doStream(CALL_OPTIONS);
      await expect(result).rejects.toBe(revoked);
      expect(primaryAcquire).toHaveBeenCalledOnce();
      expect(primaryRelease).toHaveBeenCalledOnce();
      expect(backupAcquire).not.toHaveBeenCalled();
      expect(beforeAttempt).toHaveBeenCalledOnce();
      expect(beforeAttempt.mock.calls[0][0]).toMatchObject({ routeId: "primary", providerId: "primary" });
      expect(run.start).not.toHaveBeenCalled();
      expect(primaryGenerate).not.toHaveBeenCalled();
      expect(primaryStream).not.toHaveBeenCalled();
      expect(backupGenerate).not.toHaveBeenCalled();
      expect(backupStream).not.toHaveBeenCalled();
    },
  );

  it.each(["generate", "stream"] as const)(
    "cancels a pending %s pre-attempt guard without ledger, Provider, or fallback I/O",
    async (operation) => {
      const primary = model({
        generate: generateResult("must not generate"),
        stream: successfulStream("must not stream"),
      });
      const backup = model({
        generate: generateResult("must not generate fallback"),
        stream: successfulStream("must not stream fallback"),
      });
      const primaryGenerate = vi.spyOn(primary, "doGenerate");
      const primaryStream = vi.spyOn(primary, "doStream");
      const backupGenerate = vi.spyOn(backup, "doGenerate");
      const backupStream = vi.spyOn(backup, "doStream");
      const primaryRelease = vi.fn(async () => undefined);
      const primaryAcquire = vi.fn(async () => ({ release: primaryRelease }));
      const backupAcquire = vi.fn(async () => ({ release: vi.fn(async () => undefined) }));
      let markGuardStarted!: () => void;
      const guardStarted = new Promise<void>((resolve) => { markGuardStarted = resolve; });
      const beforeAttempt = vi.fn(() => {
        markGuardStarted();
        return new Promise<void>(() => undefined);
      });
      const run = {
        turnId: `turn_${crypto.randomUUID()}`,
        runId: `run_${crypto.randomUUID()}`,
        runKind: "auxiliary_vision",
        start: vi.fn(async () => { throw new Error("ledger must not start"); }),
      } satisfies ProviderAttemptRun;
      const controller = new AbortController();
      const router = createFallbackLanguageModel([
        {
          routeId: "primary",
          providerId: "primary",
          usedUserKey: false,
          model: primary,
          acquireLease: primaryAcquire,
        },
        {
          routeId: "backup",
          providerId: "backup",
          usedUserKey: false,
          model: backup,
          acquireLease: backupAcquire,
        },
      ], {}, { createRun: () => run, beforeAttempt });

      const options = { ...CALL_OPTIONS, abortSignal: controller.signal };
      const result = operation === "generate"
        ? router.doGenerate(options)
        : router.doStream(options);
      await guardStarted;
      controller.abort(new DOMException("cancelled by user", "AbortError"));

      await expect(result).rejects.toMatchObject({ name: "AbortError" });
      expect(primaryAcquire).toHaveBeenCalledOnce();
      expect(primaryRelease).toHaveBeenCalledOnce();
      expect(backupAcquire).not.toHaveBeenCalled();
      expect(beforeAttempt).toHaveBeenCalledOnce();
      expect(run.start).not.toHaveBeenCalled();
      expect(primaryGenerate).not.toHaveBeenCalled();
      expect(primaryStream).not.toHaveBeenCalled();
      expect(backupGenerate).not.toHaveBeenCalled();
      expect(backupStream).not.toHaveBeenCalled();
    },
  );

  it("fails closed before Provider execution when required ledger start is unavailable", async () => {
    const primary = model({ stream: successfulStream("must not run") });
    const backup = model({ stream: successfulStream("must not run either") });
    const primarySpy = vi.spyOn(primary, "doStream");
    const backupSpy = vi.spyOn(backup, "doStream");
    const run = {
      turnId: `turn_${crypto.randomUUID()}`,
      runId: `run_${crypto.randomUUID()}`,
      runKind: "main_answer",
      start: vi.fn().mockRejectedValue(new ProviderAttemptLedgerError()),
    } satisfies ProviderAttemptRun;
    const router = createFallbackLanguageModel([
      { routeId: "primary", providerId: "primary", usedUserKey: false, model: primary },
      { routeId: "backup", providerId: "backup", usedUserKey: false, model: backup },
    ], {}, { createRun: () => run });

    await expect(router.doStream(CALL_OPTIONS)).rejects.toBeInstanceOf(ProviderAttemptLedgerError);
    expect(run.start).toHaveBeenCalledOnce();
    expect(primarySpy).not.toHaveBeenCalled();
    expect(backupSpy).not.toHaveBeenCalled();
  });

  it("does not bypass a hard budget denial through Provider fallback", async () => {
    const primary = model({ stream: successfulStream("must not run") });
    const backup = model({ stream: successfulStream("must not run either") });
    const primarySpy = vi.spyOn(primary, "doStream");
    const backupSpy = vi.spyOn(backup, "doStream");
    const run = {
      turnId: `turn_${crypto.randomUUID()}`,
      runId: `run_${crypto.randomUUID()}`,
      runKind: "main_answer",
      start: vi.fn().mockRejectedValue(new ProviderBudgetError("provider_budget_exceeded")),
    } satisfies ProviderAttemptRun;
    const router = createFallbackLanguageModel([
      { routeId: "primary", providerId: "primary", usedUserKey: false, model: primary },
      { routeId: "backup", providerId: "backup", usedUserKey: false, model: backup },
    ], {}, { createRun: () => run });

    await expect(router.doStream(CALL_OPTIONS)).rejects.toMatchObject({ code: "provider_budget_exceeded" });
    expect(run.start).toHaveBeenCalledOnce();
    expect(primarySpy).not.toHaveBeenCalled();
    expect(backupSpy).not.toHaveBeenCalled();
  });

  it("waits for failed primary settlement before reserving the fallback", async () => {
    const primary = model({ generateError: { statusCode: 503 } });
    const backup = model({ generate: generateResult("fallback after settlement") });
    const backupSpy = vi.spyOn(backup, "doGenerate");
    let markSettlementStarted!: () => void;
    let finishSettlement!: () => void;
    const settlementStarted = new Promise<void>((resolve) => { markSettlementStarted = resolve; });
    const settlementFinished = new Promise<void>((resolve) => { finishSettlement = resolve; });
    const primaryHandle = {
      attemptId: `attempt_${crypto.randomUUID()}`,
      recordUsage: vi.fn(async () => undefined),
      succeed: vi.fn(async () => undefined),
      fail: vi.fn(async () => {
        markSettlementStarted();
        await settlementFinished;
      }),
      cancel: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
    };
    const fallbackHandle = {
      attemptId: `attempt_${crypto.randomUUID()}`,
      recordUsage: vi.fn(async () => undefined),
      succeed: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
    };
    const run = {
      turnId: `turn_${crypto.randomUUID()}`,
      runId: `run_${crypto.randomUUID()}`,
      runKind: "main_answer",
      start: vi.fn()
        .mockResolvedValueOnce(primaryHandle)
        .mockImplementationOnce(async () => {
          expect(primaryHandle.fail).toHaveBeenCalledOnce();
          return fallbackHandle;
        }),
    } satisfies ProviderAttemptRun;
    const router = createFallbackLanguageModel([
      { routeId: "primary", providerId: "primary", usedUserKey: false, model: primary },
      { routeId: "backup", providerId: "backup", usedUserKey: false, model: backup },
    ], {}, { createRun: () => run });

    const result = router.doGenerate(CALL_OPTIONS);
    await settlementStarted;
    expect(run.start).toHaveBeenCalledTimes(1);
    expect(backupSpy).not.toHaveBeenCalled();

    finishSettlement();
    await expect(result).resolves.toMatchObject({
      content: [{ type: "text", text: "fallback after settlement" }],
    });
    expect(run.start).toHaveBeenCalledTimes(2);
    expect(backupSpy).toHaveBeenCalledOnce();
    expect(fallbackHandle.succeed).toHaveBeenCalledOnce();
  });

  it("does not reserve a fallback when failed primary settlement cannot persist", async () => {
    const primary = model({ generateError: { statusCode: 503 } });
    const backup = model({ generate: generateResult("must not run") });
    const backupSpy = vi.spyOn(backup, "doGenerate");
    const run = {
      turnId: `turn_${crypto.randomUUID()}`,
      runId: `run_${crypto.randomUUID()}`,
      runKind: "main_answer",
      start: vi.fn().mockResolvedValue({
        attemptId: `attempt_${crypto.randomUUID()}`,
        recordUsage: vi.fn(async () => undefined),
        succeed: vi.fn(async () => undefined),
        fail: vi.fn(async () => { throw new ProviderAttemptLedgerError(); }),
        cancel: vi.fn(async () => undefined),
        timeout: vi.fn(async () => undefined),
      }),
    } satisfies ProviderAttemptRun;
    const router = createFallbackLanguageModel([
      { routeId: "primary", providerId: "primary", usedUserKey: false, model: primary },
      { routeId: "backup", providerId: "backup", usedUserKey: false, model: backup },
    ], {}, { createRun: () => run });

    await expect(router.doGenerate(CALL_OPTIONS)).rejects.toBeInstanceOf(ProviderAttemptLedgerError);
    expect(run.start).toHaveBeenCalledOnce();
    expect(backupSpy).not.toHaveBeenCalled();
  });

  it("falls back when a route fails before visible output and discards its metadata", async () => {
    const success: ProviderAttemptEvent[] = [];
    const failure: ProviderAttemptEvent[] = [];
    const primaryError = { statusCode: 503, message: "unavailable" };
    const primaryProviderId = `primary-${crypto.randomUUID()}`;
    const backupProviderId = `backup-${crypto.randomUUID()}`;
    const attempts = attemptRuntime();
    const router = createFallbackLanguageModel([
      {
        routeId: "primary",
        providerId: primaryProviderId,
        modelName: "primary-model",
        credentialClass: "managed",
        usedUserKey: false,
        model: model({ stream: [{ type: "stream-start", warnings: [] }, { type: "error", error: primaryError }] }),
      },
      {
        routeId: "backup",
        providerId: backupProviderId,
        modelName: "backup-model",
        credentialClass: "worker",
        usedUserKey: false,
        model: model({ stream: successfulStream("ok") }),
      },
    ], {
      onSuccess: (event) => success.push(event),
      onFailure: (event) => failure.push(event),
    }, { createRun: () => attempts.createRun("main_answer") });

    const result = await router.doStream(CALL_OPTIONS);
    const parts = await readStream(result.stream);

    expect(parts.filter((part) => part.type === "stream-start")).toHaveLength(1);
    expect(parts).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "ok" }));
    expect(failure).toEqual([expect.objectContaining({ routeId: "primary", fallback: false, status: 503, visibleOutputStarted: false })]);
    expect(success).toEqual([expect.objectContaining({
      routeId: "backup",
      fallback: true,
      visibleOutputStarted: true,
      streamShape: "single_chunk",
    })]);
    const [primaryAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName(primaryProviderId).listRecent();
    const [backupAttempt] = await env.PROVIDER_ATTEMPT_LEDGER.getByName(backupProviderId).listRecent();
    expect(primaryAttempt).toMatchObject({
      turnId: attempts.turnId,
      runKind: "main_answer",
      status: "failed",
      errorClass: "upstream_unavailable",
      fallbackIndex: 0,
    });
    expect(backupAttempt).toMatchObject({
      turnId: attempts.turnId,
      runId: primaryAttempt.runId,
      runKind: "main_answer",
      status: "succeeded",
      fallbackIndex: 1,
    });
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(backupProviderId).getFinanceSnapshot({
      periodStart: backupAttempt.startedAt,
      limit: 10,
    })).resolves.toMatchObject({
      capacity: { calls: 1, unknownUsageAttempts: 0 },
      usage: {
        inputNoCacheTokens: 1,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTextTokens: 1,
        reasoningOutputTokens: 0,
      },
    });
  });

  it("forwards the first delta before a later delta is released and records progressive evidence", async () => {
    let controller!: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
    const source = new ReadableStream<LanguageModelV3StreamPart>({
      start(value) {
        controller = value;
      },
    });
    const success: ProviderAttemptEvent[] = [];
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    let signalStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => {
      signalStreamStarted = resolve;
    });
    const router = createFallbackLanguageModel([{
      routeId: "progressive",
      providerId: "provider-progressive",
      usedUserKey: false,
      model: model({ streamSource: source, onStream: signalStreamStarted }),
    }], { onSuccess: (event) => success.push(event) });

    const resultPromise = router.doStream(CALL_OPTIONS);
    await streamStarted;
    controller.enqueue({ type: "stream-start", warnings: [] });
    controller.enqueue({ type: "text-start", id: "text-1" });
    now.mockReturnValue(1_250);
    controller.enqueue({ type: "text-delta", id: "text-1", delta: "first" });

    const result = await resultPromise;
    const reader = result.stream.getReader();
    await expect(reader.read()).resolves.toMatchObject({ value: { type: "stream-start" } });
    await expect(reader.read()).resolves.toMatchObject({ value: { type: "text-start" } });
    await expect(reader.read()).resolves.toMatchObject({ value: { type: "text-delta", delta: "first" } });
    expect(success).toEqual([]);

    now.mockReturnValue(1_500);
    controller.enqueue({ type: "text-delta", id: "text-1", delta: " second" });
    controller.enqueue({ type: "text-end", id: "text-1" });
    controller.enqueue(finishPart());
    controller.close();
    const remaining = await readReader(reader);

    expect(remaining).toContainEqual(expect.objectContaining({ type: "text-delta", delta: " second" }));
    expect(success).toEqual([expect.objectContaining({
      firstVisibleLatencyMs: 250,
      streamShape: "progressive",
      visibleOutputStarted: true,
    })]);
  });

  it("releases a committed stream lease on cancellation without recording shape evidence", async () => {
    let controller!: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
    const source = new ReadableStream<LanguageModelV3StreamPart>({
      start(value) {
        controller = value;
      },
    });
    const release = vi.fn();
    const success: ProviderAttemptEvent[] = [];
    const failure: ProviderAttemptEvent[] = [];
    const providerId = `provider-cancelled-${crypto.randomUUID()}`;
    const attempts = attemptRuntime();
    const router = createFallbackLanguageModel([{
      routeId: "cancelled",
      providerId,
      modelName: "cancelled-model",
      credentialClass: "worker",
      usedUserKey: false,
      model: model({ streamSource: source }),
      acquireLease: async () => ({ release }),
    }], {
      onSuccess: (event) => success.push(event),
      onFailure: (event) => failure.push(event),
    }, { createRun: () => attempts.createRun("main_answer") });

    const resultPromise = router.doStream(CALL_OPTIONS);
    controller.enqueue({ type: "text-delta", id: "text-1", delta: "partial" });
    const result = await resultPromise;
    const reader = result.stream.getReader();
    await expect(reader.read()).resolves.toMatchObject({ value: { type: "text-delta", delta: "partial" } });
    await reader.cancel("test cancellation");

    expect(release).toHaveBeenCalledOnce();
    expect(success).toEqual([]);
    expect(failure).toEqual([]);
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent()).resolves.toEqual([
      expect.objectContaining({
        turnId: attempts.turnId,
        status: "cancelled",
        errorClass: "request_cancelled",
      }),
    ]);
  });

  it("cancels a committed stream when the parent request aborts after visible output", async () => {
    let controller!: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
    const cancel = vi.fn();
    const source = new ReadableStream<LanguageModelV3StreamPart>({
      start(value) {
        controller = value;
      },
      cancel,
    });
    const release = vi.fn();
    const success: ProviderAttemptEvent[] = [];
    const failure: ProviderAttemptEvent[] = [];
    const providerId = `provider-aborted-${crypto.randomUUID()}`;
    const attempts = attemptRuntime();
    const request = new AbortController();
    const router = createFallbackLanguageModel([{
      routeId: "aborted",
      providerId,
      modelName: "aborted-model",
      credentialClass: "worker",
      usedUserKey: false,
      model: model({ streamSource: source }),
      acquireLease: async () => ({ release }),
    }], {
      onSuccess: (event) => success.push(event),
      onFailure: (event) => failure.push(event),
    }, { createRun: () => attempts.createRun("main_answer") });

    const resultPromise = router.doStream({ ...CALL_OPTIONS, abortSignal: request.signal });
    controller.enqueue({ type: "text-delta", id: "text-1", delta: "partial" });
    const result = await resultPromise;
    const reader = result.stream.getReader();
    await expect(reader.read()).resolves.toMatchObject({ value: { type: "text-delta", delta: "partial" } });
    request.abort(new DOMException("cancelled by user", "AbortError"));

    await expect(reader.read()).resolves.toMatchObject({ done: true });
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(success).toEqual([]);
    expect(failure).toEqual([]);
    await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(providerId).listRecent()).resolves.toEqual([
      expect.objectContaining({
        turnId: attempts.turnId,
        status: "cancelled",
        errorClass: "request_cancelled",
      }),
    ]);
  });

  it("never switches routes after visible output has started", async () => {
    const backup = model({ stream: successfulStream("backup") });
    const backupSpy = vi.spyOn(backup, "doStream");
    const failure: ProviderAttemptEvent[] = [];
    const router = createFallbackLanguageModel([
      {
        routeId: "primary",
        providerId: "primary-provider",
        usedUserKey: false,
        model: model({ stream: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "partial" },
          { type: "error", error: { statusCode: 503 } },
        ] }),
      },
      { routeId: "backup", providerId: "backup-provider", usedUserKey: false, model: backup },
    ], { onFailure: (event) => failure.push(event) });

    const result = await router.doStream(CALL_OPTIONS);
    const parts = await readStream(result.stream);

    expect(parts).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "partial" }));
    expect(parts).toContainEqual(expect.objectContaining({ type: "error" }));
    expect(backupSpy).not.toHaveBeenCalled();
    expect(failure).toEqual([expect.objectContaining({ routeId: "primary", visibleOutputStarted: true })]);
  });

  it("aborts a provider with no visible output at sixty seconds and falls back", async () => {
    vi.useFakeTimers();
    try {
      let upstreamSignal: AbortSignal | undefined;
      const cancel = vi.fn();
      const release = vi.fn();
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const stalled = new ReadableStream<LanguageModelV3StreamPart>({ cancel });
      const backup = model({ stream: successfulStream("deadline fallback") });
      const backupSpy = vi.spyOn(backup, "doStream");
      const failures: ProviderAttemptEvent[] = [];
      const primaryProviderId = `deadline-primary-${crypto.randomUUID()}`;
      const backupProviderId = `deadline-backup-${crypto.randomUUID()}`;
      const attempts = attemptRuntime();
      const router = createFallbackLanguageModel([
        {
          routeId: "primary",
          providerId: primaryProviderId,
          modelName: "deadline-primary-model",
          credentialClass: "managed",
          usedUserKey: false,
          model: model({
            streamSource: stalled,
            onStream: markStarted,
            onStreamOptions: (options) => { upstreamSignal = options.abortSignal; },
          }),
          acquireLease: async () => ({ release }),
        },
        {
          routeId: "backup",
          providerId: backupProviderId,
          modelName: "deadline-backup-model",
          credentialClass: "worker",
          usedUserKey: false,
          model: backup,
        },
      ], { onFailure: (event) => failures.push(event) }, {
        createRun: () => attempts.createRun("main_answer"),
      });

      const resultPromise = router.doStream(CALL_OPTIONS);
      await started;
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await resultPromise;
      const parts = await readStream(result.stream);

      expect(parts).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "deadline fallback" }));
      expect(upstreamSignal?.aborted).toBe(true);
      expect((upstreamSignal?.reason as Error)?.name).toBe("TimeoutError");
      expect(cancel).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      expect(backupSpy).toHaveBeenCalledOnce();
      expect(failures).toEqual([
        expect.objectContaining({ routeId: "primary", visibleOutputStarted: false }),
      ]);
      await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(primaryProviderId).listRecent()).resolves.toEqual([
        expect.objectContaining({ status: "timed_out", errorClass: "upstream_timeout" }),
      ]);
      await expect(env.PROVIDER_ATTEMPT_LEDGER.getByName(backupProviderId).listRecent()).resolves.toEqual([
        expect.objectContaining({ status: "succeeded" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds three stalled fallback candidates to one ninety-second run", async () => {
    vi.useFakeTimers();
    try {
      const calls = [vi.fn(), vi.fn(), vi.fn()];
      const signals: Array<AbortSignal | undefined> = [];
      const router = createFallbackLanguageModel(calls.map((onStream, index) => ({
        routeId: `route-${index + 1}`,
        providerId: `provider-${index + 1}`,
        usedUserKey: false,
        model: model({
          streamSource: new ReadableStream<LanguageModelV3StreamPart>(),
          onStream,
          onStreamOptions: (options) => { signals[index] = options.abortSignal; },
        }),
      })));

      const result = router.doStream(CALL_OPTIONS);
      const rejection = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls[0]).toHaveBeenCalledOnce();
      expect(calls[1]).toHaveBeenCalledOnce();
      expect(calls[2]).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(true);
      expect(calls[2]).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a capacity lease that resolves only after the run deadline", async () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn(async () => undefined);
      const provider = model({ generate: generateResult("must not run") });
      const providerSpy = vi.spyOn(provider, "doGenerate");
      const router = createFallbackLanguageModel([{
        routeId: "late-capacity",
        providerId: "late-capacity-provider",
        usedUserKey: false,
        model: provider,
        acquireLease: async () => new Promise((resolve) => {
          setTimeout(() => resolve({ release }), 91_000);
        }),
      }]);

      const result = router.doGenerate(CALL_OPTIONS);
      const rejection = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(90_000);
      await rejection;
      expect(providerSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(release).toHaveBeenCalledOnce();
      expect(providerSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the run deadline to generate and rejects a late result", async () => {
    vi.useFakeTimers();
    try {
      let resolveGenerate!: (value: LanguageModelV3GenerateResult) => void;
      const lateGenerate = new Promise<LanguageModelV3GenerateResult>((resolve) => {
        resolveGenerate = resolve;
      });
      let upstreamSignal: AbortSignal | undefined;
      const provider = model({
        generateSource: lateGenerate,
        onGenerateOptions: (options) => { upstreamSignal = options.abortSignal; },
      });
      const backup = model({ generate: generateResult("must not run") });
      const backupSpy = vi.spyOn(backup, "doGenerate");
      const router = createFallbackLanguageModel([
        { routeId: "primary", providerId: "primary", usedUserKey: false, model: provider },
        { routeId: "backup", providerId: "backup", usedUserKey: false, model: backup },
      ]);

      const result = router.doGenerate(CALL_OPTIONS);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(upstreamSignal?.aborted).toBe(true);
      expect(backupSpy).toHaveBeenCalledOnce();
      await expect(result).resolves.toMatchObject({ content: [{ type: "text", text: "must not run" }] });

      resolveGenerate(generateResult("late"));
      await Promise.resolve();
      expect(backupSpy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds stalled generate fallbacks to the same ninety-second run", async () => {
    vi.useFakeTimers();
    try {
      const calls = [vi.fn(), vi.fn(), vi.fn()];
      const router = createFallbackLanguageModel(calls.map((onGenerate, index) => ({
        routeId: `generate-route-${index + 1}`,
        providerId: `generate-provider-${index + 1}`,
        usedUserKey: false,
        model: model({
          generateSource: new Promise<LanguageModelV3GenerateResult>(() => undefined),
          onGenerate,
        }),
      })));

      const result = router.doGenerate(CALL_OPTIONS);
      const rejection = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls[0]).toHaveBeenCalledOnce();
      expect(calls[1]).toHaveBeenCalledOnce();
      expect(calls[2]).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
      expect(calls[2]).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes planning time from a transferred initial run deadline", async () => {
    vi.useFakeTimers();
    try {
      const initialRunDeadline = createProviderFirstVisibleDeadline(undefined, { timeoutMs: 90_000 });
      await vi.advanceTimersByTimeAsync(30_000);
      const primaryCall = vi.fn();
      const backup = model({ stream: successfulStream("must not run") });
      const backupSpy = vi.spyOn(backup, "doStream");
      const router = createFallbackLanguageModel([
        {
          routeId: "planned-primary",
          providerId: "planned-primary-provider",
          usedUserKey: false,
          model: model({
            streamSource: new ReadableStream<LanguageModelV3StreamPart>(),
            onStream: primaryCall,
          }),
        },
        { routeId: "planned-backup", providerId: "planned-backup-provider", usedUserKey: false, model: backup },
      ], {}, {
        createRun: () => ({
          turnId: `turn_${crypto.randomUUID()}`,
          runId: `run_${crypto.randomUUID()}`,
          runKind: "main_answer",
          start: vi.fn().mockResolvedValue(undefined),
        } as unknown as ProviderAttemptRun),
        initialRunDeadline,
      });

      const result = router.doStream(CALL_OPTIONS);
      const rejection = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;
      expect(primaryCall).toHaveBeenCalledOnce();
      expect(backupSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits secret-free run progress with monotonic attempt ordinals", async () => {
    const progress: Array<{
      phase: string;
      attempt: number;
      candidateCount: number;
      startedAt: number;
      deadlineAt: number;
    }> = [];
    const router = createFallbackLanguageModel([
      {
        routeId: "secret-primary-route",
        providerId: "secret-primary-provider",
        usedUserKey: false,
        model: model({ streamError: { statusCode: 503, message: "secret-upstream-body" } }),
      },
      {
        routeId: "secret-backup-route",
        providerId: "secret-backup-provider",
        usedUserKey: false,
        model: model({ stream: successfulStream("ok") }),
      },
    ], {}, {
      createRun: () => ({
        turnId: `turn_${crypto.randomUUID()}`,
        runId: `run_${crypto.randomUUID()}`,
        runKind: "main_answer",
        start: vi.fn().mockResolvedValue(undefined),
      } as unknown as ProviderAttemptRun),
      onProgress: (event) => progress.push(event),
    });

    const result = await router.doStream(CALL_OPTIONS);
    await readStream(result.stream);

    expect(progress.map(({ phase, attempt, candidateCount }) => ({ phase, attempt, candidateCount }))).toEqual([
      { phase: "waiting_capacity", attempt: 0, candidateCount: 2 },
      { phase: "attempting", attempt: 1, candidateCount: 2 },
      { phase: "waiting_capacity", attempt: 0, candidateCount: 2 },
      { phase: "fallback", attempt: 2, candidateCount: 2 },
    ]);
    expect(JSON.stringify(progress)).not.toContain("secret-");
    expect(progress.every((event) => event.deadlineAt - event.startedAt === 90_000)).toBe(true);
  });

  it("does not fall back when the parent request cancels before visible output", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const release = vi.fn();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const primary = model({
      streamSource: new ReadableStream<LanguageModelV3StreamPart>(),
      onStream: markStarted,
      onStreamOptions: (options) => { upstreamSignal = options.abortSignal; },
    });
    const backup = model({ stream: successfulStream("must not run") });
    const backupSpy = vi.spyOn(backup, "doStream");
    const controller = new AbortController();
    const router = createFallbackLanguageModel([
      {
        routeId: "primary",
        providerId: "primary-provider",
        usedUserKey: false,
        model: primary,
        acquireLease: async () => ({ release }),
      },
      { routeId: "backup", providerId: "backup-provider", usedUserKey: false, model: backup },
    ]);

    const resultPromise = router.doStream({ ...CALL_OPTIONS, abortSignal: controller.signal });
    await started;
    controller.abort(new DOMException("cancelled by user", "AbortError"));

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(backupSpy).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("clears the first-visible deadline after commitment without ending a long stream", async () => {
    vi.useFakeTimers();
    try {
      let controller!: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
      let upstreamSignal: AbortSignal | undefined;
      const source = new ReadableStream<LanguageModelV3StreamPart>({
        start(value) { controller = value; },
      });
      const router = createFallbackLanguageModel([{
        routeId: "long-stream",
        providerId: "long-provider",
        usedUserKey: false,
        model: model({
          streamSource: source,
          onStreamOptions: (options) => { upstreamSignal = options.abortSignal; },
        }),
      }]);

      const resultPromise = router.doStream(CALL_OPTIONS);
      controller.enqueue({ type: "text-delta", id: "text-1", delta: "first" });
      const result = await resultPromise;
      const reader = result.stream.getReader();
      await expect(reader.read()).resolves.toMatchObject({ value: { type: "text-delta", delta: "first" } });

      await vi.advanceTimersByTimeAsync(120_000);
      expect(upstreamSignal?.aborted).toBe(false);
      controller.enqueue({ type: "text-delta", id: "text-1", delta: " later" });
      controller.enqueue(finishPart());
      controller.close();
      await expect(readReader(reader)).resolves.toContainEqual(
        expect.objectContaining({ type: "text-delta", delta: " later" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries generation on retryable failures but stops on terminal client failures", async () => {
    const generated = generateResult("backup result");
    const backup = model({ generate: generated });
    const backupSpy = vi.spyOn(backup, "doGenerate");
    const retrying = createFallbackLanguageModel([
      { routeId: "primary", providerId: "primary-provider", usedUserKey: false, model: model({ generateError: { statusCode: 503 } }) },
      { routeId: "backup", providerId: "backup-provider", usedUserKey: false, model: backup },
    ]);
    await expect(retrying.doGenerate(CALL_OPTIONS)).resolves.toBe(generated);
    expect(backupSpy).toHaveBeenCalledOnce();

    const terminalBackup = model({ generate: generated });
    const terminalSpy = vi.spyOn(terminalBackup, "doGenerate");
    const terminal = createFallbackLanguageModel([
      { routeId: "primary", providerId: "primary-provider", usedUserKey: false, model: model({ generateError: { statusCode: 400 } }) },
      { routeId: "backup", providerId: "backup-provider", usedUserKey: false, model: terminalBackup },
    ]);
    await expect(terminal.doGenerate(CALL_OPTIONS)).rejects.toMatchObject({ statusCode: 400 });
    expect(terminalSpy).not.toHaveBeenCalled();
  });

  it("retries a different logical model on the same provider after a pre-output failure", async () => {
    const primaryRelease = vi.fn();
    const fallbackRelease = vi.fn();
    const fallback = model({ generate: generateResult("same-provider fallback") });
    const fallbackSpy = vi.spyOn(fallback, "doGenerate");
    const router = createFallbackLanguageModel([
      {
        routeId: "primary",
        providerId: "shared-provider",
        usedUserKey: false,
        model: model({ generateError: { statusCode: 503 } }),
        acquireLease: async () => ({ release: primaryRelease }),
      },
      {
        routeId: "fallback",
        providerId: "shared-provider",
        usedUserKey: false,
        model: fallback,
        acquireLease: async () => ({ release: fallbackRelease }),
      },
    ]);

    await expect(router.doGenerate(CALL_OPTIONS)).resolves.toMatchObject({
      content: [{ type: "text", text: "same-provider fallback" }],
    });
    expect(fallbackSpy).toHaveBeenCalledOnce();
    expect(primaryRelease).toHaveBeenCalledOnce();
    expect(fallbackRelease).toHaveBeenCalledOnce();
  });

  it("releases every losing lease when busy providers become available together", async () => {
    const releases = [vi.fn(), vi.fn()];
    const router = createFallbackLanguageModel([
      {
        routeId: "main",
        providerId: "provider-a",
        usedUserKey: false,
        model: model({ generate: generateResult("a") }),
        acquireLease: async (waitMs) => waitMs ? { release: releases[0] } : null,
      },
      {
        routeId: "main",
        providerId: "provider-b",
        usedUserKey: false,
        model: model({ generate: generateResult("b") }),
        acquireLease: async (waitMs) => waitMs ? { release: releases[1] } : null,
      },
    ]);

    await expect(router.doGenerate(CALL_OPTIONS)).resolves.toMatchObject({
      content: [{ type: "text", text: "a" }],
    });
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(releases[1]).toHaveBeenCalledOnce();
  });

  it("marks a lower-priority provider selected because the preferred provider is busy as fallback", async () => {
    const success: ProviderAttemptEvent[] = [];
    const router = createFallbackLanguageModel([
      {
        routeId: "main",
        providerId: "preferred-provider",
        usedUserKey: false,
        model: model({ generate: generateResult("preferred") }),
        acquireLease: async () => null,
      },
      {
        routeId: "main",
        providerId: "available-provider",
        usedUserKey: false,
        model: model({ generate: generateResult("available") }),
      },
    ], { onSuccess: (event) => success.push(event) });

    await expect(router.doGenerate(CALL_OPTIONS)).resolves.toMatchObject({
      content: [{ type: "text", text: "available" }],
    });
    expect(success).toEqual([
      expect.objectContaining({ providerId: "available-provider", fallback: true }),
    ]);
  });
});

function attemptRuntime() {
  return createProviderAttemptRuntime({
    ledger: env.PROVIDER_ATTEMPT_LEDGER,
    mode: "required",
    operation: {
      version: 1,
      operationId: `fallback-test-${crypto.randomUUID()}`,
      fenceId: crypto.randomUUID(),
      kind: "provider_turn",
      startedAt: Date.now(),
    },
  });
}

function streamOf(parts: LanguageModelV3StreamPart[]): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function successfulStream(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    finishPart(),
  ];
}

function finishPart(): LanguageModelV3StreamPart {
  return {
    type: "finish",
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    finishReason: { unified: "stop", raw: "stop" },
  };
}

function generateResult(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

async function readStream(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const reader = stream.getReader();
  return readReader(reader);
}

async function readReader(reader: ReadableStreamDefaultReader<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const output: LanguageModelV3StreamPart[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return output;
    output.push(next.value);
  }
}
