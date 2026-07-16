import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { isTerminalProviderFailure } from "./provider-router";

export type FallbackModelCandidate = {
  routeId: string;
  model: LanguageModelV3;
  usedUserKey: boolean;
  settings?: Pick<LanguageModelV3CallOptions, "temperature" | "maxOutputTokens">;
};

export type ProviderAttemptEvent = {
  routeId: string;
  fallback: boolean;
  startedAt: number;
  error?: unknown;
  status?: number;
  protocolError: boolean;
  visibleOutputStarted: boolean;
};

export type FallbackLanguageModelCallbacks = {
  onSuccess?: (event: ProviderAttemptEvent) => void | Promise<void>;
  onFailure?: (event: ProviderAttemptEvent) => void | Promise<void>;
};

export function createFallbackLanguageModel(
  candidates: FallbackModelCandidate[],
  callbacks: FallbackLanguageModelCallbacks = {},
): LanguageModelV3 {
  if (!candidates.length) throw new Error("At least one provider candidate is required.");
  const primary = candidates[0].model;

  return {
    specificationVersion: "v3",
    provider: "chatus.provider-router",
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      let lastError: unknown;
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const startedAt = Date.now();
        try {
          const result = await candidate.model.doGenerate({ ...options, ...candidate.settings });
          await notify(callbacks.onSuccess, attemptEvent(candidate, index, startedAt, false));
          return result;
        } catch (error) {
          lastError = error;
          await notify(callbacks.onFailure, attemptEvent(candidate, index, startedAt, false, error));
          if (!canFallback(error, candidate.usedUserKey, options) || index === candidates.length - 1) throw error;
        }
      }
      throw lastError;
    },
    async doStream(options): Promise<LanguageModelV3StreamResult> {
      let lastError: unknown;
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const startedAt = Date.now();
        try {
          const result = await candidate.model.doStream({ ...options, ...candidate.settings });
          const primed = await primeProviderStream(result.stream);
          if (!primed.ok) {
            lastError = primed.error;
            await notify(callbacks.onFailure, attemptEvent(candidate, index, startedAt, false, primed.error));
            if (canFallback(primed.error, candidate.usedUserKey, options) && index < candidates.length - 1) continue;
            throw primed.error;
          }
          return {
            ...result,
            stream: monitorCommittedStream({
              candidate,
              candidateIndex: index,
              startedAt,
              buffered: primed.buffered,
              reader: primed.reader,
              callbacks,
            }),
          };
        } catch (error) {
          if (error === lastError) throw error;
          lastError = error;
          await notify(callbacks.onFailure, attemptEvent(candidate, index, startedAt, false, error));
          if (!canFallback(error, candidate.usedUserKey, options) || index === candidates.length - 1) throw error;
        }
      }
      throw lastError;
    },
  };
}

async function primeProviderStream(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<
  | {
      ok: true;
      buffered: LanguageModelV3StreamPart[];
      reader: ReadableStreamDefaultReader<LanguageModelV3StreamPart>;
    }
  | { ok: false; error: unknown }
> {
  const reader = stream.getReader();
  const buffered: LanguageModelV3StreamPart[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: providerProtocolError("Provider stream ended before visible output.") };
      }
      const part = next.value;
      if (part.type === "error") {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: part.error };
      }
      if (part.type === "finish") {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: providerProtocolError("Provider returned no visible output.") };
      }
      buffered.push(part);
      if (isVisibleStreamPart(part)) return { ok: true, buffered, reader };
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    return { ok: false, error };
  }
}

function monitorCommittedStream(args: {
  candidate: FallbackModelCandidate;
  candidateIndex: number;
  startedAt: number;
  buffered: LanguageModelV3StreamPart[];
  reader: ReadableStreamDefaultReader<LanguageModelV3StreamPart>;
  callbacks: FallbackLanguageModelCallbacks;
}): ReadableStream<LanguageModelV3StreamPart> {
  let bufferIndex = 0;
  let settled = false;

  const settleSuccess = async () => {
    if (settled) return;
    settled = true;
    await notify(args.callbacks.onSuccess, attemptEvent(
      args.candidate,
      args.candidateIndex,
      args.startedAt,
      true,
    ));
  };
  const settleFailure = async (error: unknown) => {
    if (settled) return;
    settled = true;
    await notify(args.callbacks.onFailure, attemptEvent(
      args.candidate,
      args.candidateIndex,
      args.startedAt,
      true,
      error,
    ));
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        const next = bufferIndex < args.buffered.length
          ? { done: false as const, value: args.buffered[bufferIndex++] }
          : await args.reader.read();
        if (next.done) {
          await settleFailure(providerProtocolError("Provider stream ended without a finish event."));
          controller.close();
          return;
        }
        if (next.value.type === "error") await settleFailure(next.value.error);
        if (next.value.type === "finish") await settleSuccess();
        controller.enqueue(next.value);
      } catch (error) {
        await settleFailure(error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await args.reader.cancel(reason).catch(() => undefined);
    },
  });
}

function isVisibleStreamPart(part: LanguageModelV3StreamPart): boolean {
  if (part.type === "text-delta" || part.type === "reasoning-delta") return Boolean(part.delta);
  return part.type !== "stream-start"
    && part.type !== "response-metadata"
    && part.type !== "raw"
    && part.type !== "text-start"
    && part.type !== "text-end"
    && part.type !== "reasoning-start"
    && part.type !== "reasoning-end"
    && part.type !== "finish"
    && part.type !== "error";
}

function canFallback(error: unknown, usedUserKey: boolean, options: LanguageModelV3CallOptions): boolean {
  if (options.abortSignal?.aborted) return false;
  const status = providerErrorStatus(error);
  return status === undefined || !isTerminalProviderFailure(status, usedUserKey);
}

function attemptEvent(
  candidate: FallbackModelCandidate,
  candidateIndex: number,
  startedAt: number,
  visibleOutputStarted: boolean,
  error?: unknown,
): ProviderAttemptEvent {
  return {
    routeId: candidate.routeId,
    fallback: candidateIndex > 0,
    startedAt,
    error,
    status: providerErrorStatus(error),
    protocolError: error instanceof Error && error.name === "ProviderProtocolError",
    visibleOutputStarted,
  };
}

function providerErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { statusCode?: unknown; status?: unknown };
  if (typeof value.statusCode === "number") return value.statusCode;
  return typeof value.status === "number" ? value.status : undefined;
}

async function notify(
  callback: ((event: ProviderAttemptEvent) => void | Promise<void>) | undefined,
  event: ProviderAttemptEvent,
): Promise<void> {
  if (!callback) return;
  try {
    await callback(event);
  } catch {
    // Telemetry must never change the model outcome.
  }
}

function providerProtocolError(message: string): Error {
  const error = new Error(message);
  error.name = "ProviderProtocolError";
  return error;
}
