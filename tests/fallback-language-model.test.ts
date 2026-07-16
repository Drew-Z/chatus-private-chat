import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { createFallbackLanguageModel, type ProviderAttemptEvent } from "../src/services/fallback-language-model";

const CALL_OPTIONS = { prompt: [] } as unknown as LanguageModelV3CallOptions;

function model(args: {
  stream?: LanguageModelV3StreamPart[];
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
    async doStream() {
      if (args.streamError) throw args.streamError;
      return { stream: streamOf(args.stream || []) };
    },
  };
}

describe("fallback language model", () => {
  it("falls back when a route fails before visible output and discards its metadata", async () => {
    const success: ProviderAttemptEvent[] = [];
    const failure: ProviderAttemptEvent[] = [];
    const primaryError = { statusCode: 503, message: "unavailable" };
    const router = createFallbackLanguageModel([
      {
        routeId: "primary",
        usedUserKey: false,
        model: model({ stream: [{ type: "stream-start", warnings: [] }, { type: "error", error: primaryError }] }),
      },
      {
        routeId: "backup",
        usedUserKey: false,
        model: model({ stream: successfulStream("ok") }),
      },
    ], {
      onSuccess: (event) => success.push(event),
      onFailure: (event) => failure.push(event),
    });

    const result = await router.doStream(CALL_OPTIONS);
    const parts = await readStream(result.stream);

    expect(parts.filter((part) => part.type === "stream-start")).toHaveLength(1);
    expect(parts).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "ok" }));
    expect(failure).toEqual([expect.objectContaining({ routeId: "primary", fallback: false, status: 503, visibleOutputStarted: false })]);
    expect(success).toEqual([expect.objectContaining({ routeId: "backup", fallback: true, visibleOutputStarted: true })]);
  });

  it("never switches routes after visible output has started", async () => {
    const backup = model({ stream: successfulStream("backup") });
    const backupSpy = vi.spyOn(backup, "doStream");
    const failure: ProviderAttemptEvent[] = [];
    const router = createFallbackLanguageModel([
      {
        routeId: "primary",
        usedUserKey: false,
        model: model({ stream: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "partial" },
          { type: "error", error: { statusCode: 503 } },
        ] }),
      },
      { routeId: "backup", usedUserKey: false, model: backup },
    ], { onFailure: (event) => failure.push(event) });

    const result = await router.doStream(CALL_OPTIONS);
    const parts = await readStream(result.stream);

    expect(parts).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "partial" }));
    expect(parts).toContainEqual(expect.objectContaining({ type: "error" }));
    expect(backupSpy).not.toHaveBeenCalled();
    expect(failure).toEqual([expect.objectContaining({ routeId: "primary", visibleOutputStarted: true })]);
  });

  it("retries generation on retryable failures but stops on terminal client failures", async () => {
    const generated = generateResult("backup result");
    const backup = model({ generate: generated });
    const backupSpy = vi.spyOn(backup, "doGenerate");
    const retrying = createFallbackLanguageModel([
      { routeId: "primary", usedUserKey: false, model: model({ generateError: { statusCode: 503 } }) },
      { routeId: "backup", usedUserKey: false, model: backup },
    ]);
    await expect(retrying.doGenerate(CALL_OPTIONS)).resolves.toBe(generated);
    expect(backupSpy).toHaveBeenCalledOnce();

    const terminalBackup = model({ generate: generated });
    const terminalSpy = vi.spyOn(terminalBackup, "doGenerate");
    const terminal = createFallbackLanguageModel([
      { routeId: "primary", usedUserKey: false, model: model({ generateError: { statusCode: 400 } }) },
      { routeId: "backup", usedUserKey: false, model: terminalBackup },
    ]);
    await expect(terminal.doGenerate(CALL_OPTIONS)).rejects.toMatchObject({ statusCode: 400 });
    expect(terminalSpy).not.toHaveBeenCalled();
  });
});

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
    {
      type: "finish",
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      finishReason: { unified: "stop", raw: "stop" },
    },
  ];
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
  const output: LanguageModelV3StreamPart[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return output;
    output.push(next.value);
  }
}
