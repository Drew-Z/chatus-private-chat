import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { ProviderStreamShape } from "../contracts/provider";
import type { ProviderAttemptCredentialClass } from "../contracts/provider-attempt";
import { isTerminalProviderFailure } from "./provider-router";
import {
  acquireFirstAvailableLease,
  uniqueProviderLeaseCandidates,
  type ProviderLease,
} from "./provider-lease";
import {
  createProviderFirstVisibleDeadline,
  raceWithAbort,
  type ProviderFirstVisibleDeadline,
} from "./provider-first-visible-deadline";
import {
  ProviderAttemptLedgerError,
  type ProviderAttemptHandle,
  type ProviderAttemptRun,
} from "./provider-attempt-runtime";

export type FallbackModelCandidate = {
  routeId: string;
  providerId: string;
  model: LanguageModelV3;
  modelName?: string;
  credentialClass?: ProviderAttemptCredentialClass;
  usedUserKey: boolean;
  settings?: Pick<LanguageModelV3CallOptions, "temperature" | "maxOutputTokens">;
  acquireLease?: (waitMs: number, signal?: AbortSignal) => Promise<ProviderCandidateLease | null>;
};

export type ProviderCandidateLease = Pick<ProviderLease, "release">;

export type ProviderAttemptEvent = {
  routeId: string;
  providerId: string;
  fallback: boolean;
  startedAt: number;
  error?: unknown;
  status?: number;
  protocolError: boolean;
  visibleOutputStarted: boolean;
  firstVisibleLatencyMs?: number;
  streamShape?: ProviderStreamShape;
};

export type FallbackLanguageModelCallbacks = {
  onSuccess?: (event: ProviderAttemptEvent) => void | Promise<void>;
  onFailure?: (event: ProviderAttemptEvent) => void | Promise<void>;
};

export type FallbackLanguageModelAttemptOptions = {
  createRun: () => ProviderAttemptRun;
};

export function createFallbackLanguageModel(
  candidates: FallbackModelCandidate[],
  callbacks: FallbackLanguageModelCallbacks = {},
  attempts?: FallbackLanguageModelAttemptOptions,
): LanguageModelV3 {
  if (!candidates.length) throw new Error("At least one provider candidate is required.");
  const primary = candidates[0].model;

  return {
    specificationVersion: "v3",
    provider: "chatus.provider-router",
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const attemptRun = attempts?.createRun();
      let lastError: unknown;
      const remaining = [...candidates];
      let attemptIndex = 0;
      while (remaining.length) {
        const selected = await acquireNextCandidate(remaining, options.abortSignal);
        if (!selected) throw providerBusyError();
        const { candidate, lease } = selected;
        remaining.splice(remaining.indexOf(candidate), 1);
        const startedAt = Date.now();
        const fallback = isFallbackAttempt(candidates, candidate, attemptIndex);
        let attempt: ProviderAttemptHandle | undefined;
        try {
          attempt = await startProviderAttempt(attemptRun, candidate, candidates.indexOf(candidate), startedAt);
          const result = await candidate.model.doGenerate({ ...options, ...candidate.settings });
          await attempt?.succeed();
          await notify(callbacks.onSuccess, attemptEvent(candidate, fallback, startedAt, false));
          return result;
        } catch (error) {
          if (error instanceof ProviderAttemptLedgerError) throw error;
          await attempt?.fail(error);
          lastError = error;
          await notify(callbacks.onFailure, attemptEvent(candidate, fallback, startedAt, false, error));
          if (!canFallback(error, candidate.usedUserKey, options) || !remaining.length) throw error;
        } finally {
          await releaseLease(lease);
        }
        attemptIndex += 1;
      }
      throw lastError;
    },
    async doStream(options): Promise<LanguageModelV3StreamResult> {
      const attemptRun = attempts?.createRun();
      let lastError: unknown;
      const remaining = [...candidates];
      let attemptIndex = 0;
      while (remaining.length) {
        const selected = await acquireNextCandidate(remaining, options.abortSignal);
        if (!selected) throw providerBusyError();
        const { candidate, lease } = selected;
        remaining.splice(remaining.indexOf(candidate), 1);
        const startedAt = Date.now();
        const fallback = isFallbackAttempt(candidates, candidate, attemptIndex);
        let handedOff = false;
        const deadline = createProviderFirstVisibleDeadline(options.abortSignal);
        let attempt: ProviderAttemptHandle | undefined;
        try {
          attempt = await startProviderAttempt(attemptRun, candidate, candidates.indexOf(candidate), startedAt);
          const result = await raceWithAbort(
            candidate.model.doStream({
              ...options,
              ...candidate.settings,
              abortSignal: deadline.signal,
            }),
            deadline.signal,
          );
          const primed = await primeProviderStream(result.stream, deadline);
          if (!primed.ok) {
            lastError = primed.error;
            await attempt?.fail(primed.error);
            await notify(callbacks.onFailure, attemptEvent(candidate, fallback, startedAt, false, primed.error));
            if (canFallback(primed.error, candidate.usedUserKey, options) && remaining.length) {
              attemptIndex += 1;
              continue;
            }
            throw primed.error;
          }
          handedOff = true;
          return {
            ...result,
            stream: monitorCommittedStream({
              candidate,
              fallback,
              startedAt,
              buffered: primed.buffered,
              firstTextDeltaAt: primed.firstTextDeltaAt,
              reader: primed.reader,
              callbacks,
              attempt,
              lease,
              deadline,
            }),
          };
        } catch (error) {
          if (error instanceof ProviderAttemptLedgerError) throw error;
          if (error === lastError) throw error;
          await attempt?.fail(error);
          lastError = error;
          await notify(callbacks.onFailure, attemptEvent(candidate, fallback, startedAt, false, error));
          if (!canFallback(error, candidate.usedUserKey, options) || !remaining.length) throw error;
        } finally {
          if (!handedOff) {
            deadline.dispose();
            await releaseLease(lease);
          }
        }
        attemptIndex += 1;
      }
      throw lastError;
    },
  };
}

async function primeProviderStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  deadline: ProviderFirstVisibleDeadline,
): Promise<
  | {
      ok: true;
      buffered: LanguageModelV3StreamPart[];
      firstTextDeltaAt?: number;
      reader: ReadableStreamDefaultReader<LanguageModelV3StreamPart>;
    }
  | { ok: false; error: unknown }
> {
  const reader = stream.getReader();
  const buffered: LanguageModelV3StreamPart[] = [];
  try {
    while (true) {
      const next = await raceWithAbort(reader.read(), deadline.signal);
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
      if (isVisibleStreamPart(part)) {
        deadline.commit();
        return {
          ok: true,
          buffered,
          reader,
          ...(isVisibleTextDelta(part) ? { firstTextDeltaAt: Date.now() } : {}),
        };
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    return { ok: false, error };
  }
}

function monitorCommittedStream(args: {
  candidate: FallbackModelCandidate;
  fallback: boolean;
  startedAt: number;
  buffered: LanguageModelV3StreamPart[];
  firstTextDeltaAt?: number;
  reader: ReadableStreamDefaultReader<LanguageModelV3StreamPart>;
  callbacks: FallbackLanguageModelCallbacks;
  attempt?: ProviderAttemptHandle;
  lease: ProviderCandidateLease;
  deadline: ProviderFirstVisibleDeadline;
}): ReadableStream<LanguageModelV3StreamPart> {
  let bufferIndex = 0;
  let settled = false;
  let cancellationRequested = false;
  let firstTextDeltaAt = args.firstTextDeltaAt;
  let visibleTextDeltaCount = 0;

  const settleSuccess = async () => {
    if (settled) return;
    settled = true;
    try {
      await args.attempt?.succeed();
      await notify(args.callbacks.onSuccess, attemptEvent(
        args.candidate,
        args.fallback,
        args.startedAt,
        true,
        undefined,
        streamEvidence(args.startedAt, firstTextDeltaAt, visibleTextDeltaCount),
      ));
    } finally {
      args.deadline.dispose();
      await releaseLease(args.lease);
    }
  };
  const settleFailure = async (error: unknown) => {
    if (settled) return;
    settled = true;
    try {
      await args.attempt?.fail(error);
      await notify(args.callbacks.onFailure, attemptEvent(
        args.candidate,
        args.fallback,
        args.startedAt,
        true,
        error,
      ));
    } finally {
      args.deadline.dispose();
      await releaseLease(args.lease);
    }
  };
  const settleCancelled = async () => {
    if (settled) return;
    settled = true;
    try {
      await args.attempt?.cancel();
    } finally {
      args.deadline.dispose();
      await releaseLease(args.lease);
    }
  };

  return new ReadableStream({
    async pull(controller) {
      try {
        const next = bufferIndex < args.buffered.length
          ? { done: false as const, value: args.buffered[bufferIndex++] }
          : await args.reader.read();
        if (next.done) {
          if (cancellationRequested) {
            await settleCancelled();
            return;
          }
          await settleFailure(providerProtocolError("Provider stream ended without a finish event."));
          controller.close();
          return;
        }
        if (next.value.type === "error") await settleFailure(next.value.error);
        if (next.value.type === "finish") await settleSuccess();
        if (isVisibleTextDelta(next.value)) {
          firstTextDeltaAt ??= Date.now();
          visibleTextDeltaCount += 1;
        }
        controller.enqueue(next.value);
      } catch (error) {
        if (cancellationRequested) {
          await settleCancelled();
          return;
        }
        await settleFailure(error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      cancellationRequested = true;
      await args.reader.cancel(reason).catch(() => undefined);
      await settleCancelled();
    },
  });
}

function isVisibleStreamPart(part: LanguageModelV3StreamPart): boolean {
  if (isVisibleTextDelta(part)) return true;
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

function isVisibleTextDelta(part: LanguageModelV3StreamPart): boolean {
  return (part.type === "text-delta" || part.type === "reasoning-delta") && Boolean(part.delta);
}

function canFallback(error: unknown, usedUserKey: boolean, options: LanguageModelV3CallOptions): boolean {
  if (error instanceof ProviderAttemptLedgerError) return false;
  if (options.abortSignal?.aborted) return false;
  const status = providerErrorStatus(error);
  return status === undefined || !isTerminalProviderFailure(status, usedUserKey);
}

async function startProviderAttempt(
  run: ProviderAttemptRun | undefined,
  candidate: FallbackModelCandidate,
  fallbackIndex: number,
  startedAt: number,
): Promise<ProviderAttemptHandle | undefined> {
  if (!run) return undefined;
  return run.start({
    logicalRouteId: candidate.routeId,
    providerId: candidate.providerId,
    model: candidate.modelName || candidate.model.modelId,
    credentialClass: candidate.credentialClass || (candidate.usedUserKey ? "user" : "worker"),
    fallbackIndex,
    startedAt,
  });
}

function attemptEvent(
  candidate: FallbackModelCandidate,
  fallback: boolean,
  startedAt: number,
  visibleOutputStarted: boolean,
  error?: unknown,
  evidence?: Pick<ProviderAttemptEvent, "firstVisibleLatencyMs" | "streamShape">,
): ProviderAttemptEvent {
  return {
    routeId: candidate.routeId,
    providerId: candidate.providerId,
    fallback,
    startedAt,
    error,
    status: providerErrorStatus(error),
    protocolError: error instanceof Error && error.name === "ProviderProtocolError",
    visibleOutputStarted,
    ...evidence,
  };
}

function streamEvidence(
  startedAt: number,
  firstTextDeltaAt: number | undefined,
  visibleTextDeltaCount: number,
): Pick<ProviderAttemptEvent, "firstVisibleLatencyMs" | "streamShape"> {
  if (firstTextDeltaAt === undefined || visibleTextDeltaCount < 1) return {};
  return {
    firstVisibleLatencyMs: Math.max(0, firstTextDeltaAt - startedAt),
    streamShape: visibleTextDeltaCount > 1 ? "progressive" : "single_chunk",
  };
}

function isFallbackAttempt(
  candidates: FallbackModelCandidate[],
  candidate: FallbackModelCandidate,
  attemptIndex: number,
): boolean {
  return attemptIndex > 0 || candidates.indexOf(candidate) > 0;
}

async function acquireNextCandidate(
  candidates: FallbackModelCandidate[],
  signal?: AbortSignal,
): Promise<{ candidate: FallbackModelCandidate; lease: ProviderCandidateLease } | null> {
  return acquireFirstAvailableLease(
    uniqueProviderLeaseCandidates(candidates),
    (candidate, waitMs, attemptSignal) => acquireLease(candidate, waitMs, attemptSignal),
    signal,
  );
}

async function acquireLease(
  candidate: FallbackModelCandidate,
  waitMs: number,
  signal?: AbortSignal,
): Promise<ProviderCandidateLease | null> {
  return candidate.acquireLease ? candidate.acquireLease(waitMs, signal) : { release: async () => undefined };
}

async function releaseLease(lease: ProviderCandidateLease): Promise<void> {
  try {
    await lease.release();
  } catch {
    // Lease expiry remains the final recovery boundary.
  }
}

function providerBusyError(): Error {
  const error = new Error("All providers for this model are busy. Please retry shortly.");
  error.name = "ProviderBusyError";
  return error;
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
