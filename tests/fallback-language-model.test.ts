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
  type ProviderAttemptRun,
} from "../src/services/provider-attempt-runtime";

const CALL_OPTIONS = { prompt: [] } as unknown as LanguageModelV3CallOptions;

function model(args: {
  stream?: LanguageModelV3StreamPart[];
  streamSource?: ReadableStream<LanguageModelV3StreamPart>;
  onStream?: () => void;
  onStreamOptions?: (options: LanguageModelV3CallOptions) => void;
  streamError?: unknown;
  generate?: LanguageModelV3GenerateResult;
  generateError?: unknown;
}): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    async doGenerate() {
      if (args.generateError) throw args.generateError;
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
