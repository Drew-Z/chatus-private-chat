import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { ProviderStreamShape } from "../contracts/provider";
import type { ProviderAttemptCredentialClass } from "../contracts/provider-attempt";
import {
  PROVIDER_TURN_RUN_DEADLINE_MS,
  type ProviderTurnProgressPhase,
} from "../contracts/provider-turn-progress";
import { isTerminalProviderFailure } from "./provider-router";
import {
  acquireFirstAvailableLease,
  uniqueProviderLeaseCandidates,
  type ProviderLease,
} from "./provider-lease";
import {
  createProviderFirstVisibleDeadline,
  PROVIDER_FIRST_VISIBLE_DEADLINE_MS,
  raceWithAbort,
  type ProviderFirstVisibleDeadline,
} from "./provider-first-visible-deadline";
import {
  isProviderAttemptBlockingError,
  type ProviderAttemptHandle,
  type ProviderAttemptRun,
} from "./provider-attempt-runtime";
import { normalizeLanguageModelV3Usage } from "./provider-usage";

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
  initialRunDeadline?: ProviderFirstVisibleDeadline;
  onProgress?: (event: ProviderRunProgressEvent) => void;
};

export type ProviderRunProgressEvent = {
  phase: ProviderTurnProgressPhase;
  attempt: number;
  candidateCount: number;
  startedAt: number;
  deadlineAt: number;
};

export function createFallbackLanguageModel(
  candidates: FallbackModelCandidate[],
  callbacks: FallbackLanguageModelCallbacks = {},
  attempts?: FallbackLanguageModelAttemptOptions,
): LanguageModelV3 {
  if (!candidates.length) throw new Error("At least one provider candidate is required.");
  const primary = candidates[0].model;
  let transferredRunDeadline = attempts?.initialRunDeadline;
  const takeRunDeadline = (parentSignal?: AbortSignal) => {
    const transferred = transferredRunDeadline;
    transferredRunDeadline = undefined;
    return transferred || createProviderFirstVisibleDeadline(parentSignal, {
      timeoutMs: PROVIDER_TURN_RUN_DEADLINE_MS,
    });
  };

  return {
    specificationVersion: "v3",
    provider: "chatus.provider-router",
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const runDeadline = takeRunDeadline(options.abortSignal);
      const attemptRun = attempts?.createRun();
      let lastError: unknown;
      const remaining = [...candidates];
      let attemptIndex = 0;
      try {
        while (remaining.length) {
          throwIfAborted(runDeadline.signal);
          emitProgress(attempts?.onProgress, runDeadline, "waiting_capacity", 0, candidates.length);
          const selected = await acquireNextCandidateWithinDeadline(remaining, runDeadline.signal);
          if (!selected) throw providerBusyError();
          const { candidate, lease } = selected;
          remaining.splice(remaining.indexOf(candidate), 1);
          const startedAt = Date.now();
          const fallback = isFallbackAttempt(candidates, candidate, attemptIndex);
          const attemptOrdinal = attemptIndex + 1;
          const attemptDeadline = createAttemptDeadline(runDeadline);
          let attempt: ProviderAttemptHandle | undefined;
          let terminalStarted = false;
          let providerCalled = false;
          try {
            throwIfAborted(runDeadline.signal);
            emitProgress(
              attempts?.onProgress,
              runDeadline,
              attemptOrdinal > 1 ? "fallback" : "attempting",
              attemptOrdinal,
              candidates.length,
            );
            attempt = await startProviderAttemptWithinDeadline(
              attemptRun,
              candidate,
              candidates.indexOf(candidate),
              startedAt,
              runDeadline.signal,
            );
            throwIfAborted(runDeadline.signal);
            providerCalled = true;
            const result = await raceWithAbort(candidate.model.doGenerate({
              ...options,
              ...candidate.settings,
              abortSignal: attemptDeadline.signal,
            }), attemptDeadline.signal);
            attemptDeadline.commit();
            runDeadline.commit();
            await raceWithAbort(captureAttemptUsage(attempt, result.usage, "ai_sdk_generate"), runDeadline.signal);
            terminalStarted = true;
            await raceWithAbort(attempt?.succeed() || Promise.resolve(), runDeadline.signal);
            await notifyWithinDeadline(
              callbacks.onSuccess,
              attemptEvent(candidate, fallback, startedAt, false),
              runDeadline.signal,
            );
            return result;
          } catch (error) {
            if (isProviderAttemptBlockingError(error)) throw error;
            let effectiveError = error;
            if (attempt && !terminalStarted) {
              terminalStarted = true;
              try {
                await settleAttemptWithinDeadline(attempt, error, runDeadline);
              } catch (settlementError) {
                if (isProviderAttemptBlockingError(settlementError)) throw settlementError;
                effectiveError = settlementError;
              }
            }
            lastError = effectiveError;
            if (providerCalled || attempt) {
              try {
                await notifyWithinDeadline(
                  callbacks.onFailure,
                  attemptEvent(candidate, fallback, startedAt, false, effectiveError),
                  runDeadline.signal,
                );
              } catch (progressError) {
                effectiveError = progressError;
                lastError = progressError;
              }
            }
            if (!canFallback(effectiveError, candidate.usedUserKey, options, runDeadline.signal) || !remaining.length) {
              throw effectiveError;
            }
          } finally {
            attemptDeadline.dispose();
            await releaseLeaseWithinDeadline(lease, runDeadline.signal);
          }
          attemptIndex += 1;
        }
        throw lastError;
      } finally {
        runDeadline.dispose();
      }
    },
    async doStream(options): Promise<LanguageModelV3StreamResult> {
      const runDeadline = takeRunDeadline(options.abortSignal);
      const attemptRun = attempts?.createRun();
      let lastError: unknown;
      const remaining = [...candidates];
      let attemptIndex = 0;
      let streamHandedOff = false;
      try {
        while (remaining.length) {
          throwIfAborted(runDeadline.signal);
          emitProgress(attempts?.onProgress, runDeadline, "waiting_capacity", 0, candidates.length);
          const selected = await acquireNextCandidateWithinDeadline(remaining, runDeadline.signal);
          if (!selected) throw providerBusyError();
          const { candidate, lease } = selected;
          remaining.splice(remaining.indexOf(candidate), 1);
          const startedAt = Date.now();
          const fallback = isFallbackAttempt(candidates, candidate, attemptIndex);
          const attemptOrdinal = attemptIndex + 1;
          const attemptDeadline = createAttemptDeadline(runDeadline);
          let attemptHandedOff = false;
          let attempt: ProviderAttemptHandle | undefined;
          let terminalStarted = false;
          let providerCalled = false;
          try {
            throwIfAborted(runDeadline.signal);
            emitProgress(
              attempts?.onProgress,
              runDeadline,
              attemptOrdinal > 1 ? "fallback" : "attempting",
              attemptOrdinal,
              candidates.length,
            );
            attempt = await startProviderAttemptWithinDeadline(
              attemptRun,
              candidate,
              candidates.indexOf(candidate),
              startedAt,
              runDeadline.signal,
            );
            throwIfAborted(runDeadline.signal);
            providerCalled = true;
            const result = await streamResultWithinDeadline(candidate.model.doStream({
              ...options,
              ...candidate.settings,
              abortSignal: attemptDeadline.signal,
            }), attemptDeadline.signal);
            const primed = await primeProviderStream(result.stream, attemptDeadline, runDeadline);
            if (!primed.ok) throw primed.error;
            attemptHandedOff = true;
            streamHandedOff = true;
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
                deadlines: [attemptDeadline, runDeadline],
              }),
            };
          } catch (error) {
            if (isProviderAttemptBlockingError(error)) throw error;
            let effectiveError = error;
            if (attempt && !terminalStarted) {
              terminalStarted = true;
              try {
                await settleAttemptWithinDeadline(attempt, error, runDeadline);
              } catch (settlementError) {
                if (isProviderAttemptBlockingError(settlementError)) throw settlementError;
                effectiveError = settlementError;
              }
            }
            lastError = effectiveError;
            if (providerCalled || attempt) {
              try {
                await notifyWithinDeadline(
                  callbacks.onFailure,
                  attemptEvent(candidate, fallback, startedAt, false, effectiveError),
                  runDeadline.signal,
                );
              } catch (progressError) {
                effectiveError = progressError;
                lastError = progressError;
              }
            }
            if (!canFallback(effectiveError, candidate.usedUserKey, options, runDeadline.signal) || !remaining.length) {
              throw effectiveError;
            }
          } finally {
            if (!attemptHandedOff) {
              attemptDeadline.dispose();
              await releaseLeaseWithinDeadline(lease, runDeadline.signal);
            }
          }
          attemptIndex += 1;
        }
        throw lastError;
      } finally {
        if (!streamHandedOff) runDeadline.dispose();
      }
    },
  };
}

async function primeProviderStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
  attemptDeadline: ProviderFirstVisibleDeadline,
  runDeadline: ProviderFirstVisibleDeadline,
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
      const next = await raceWithAbort(reader.read(), attemptDeadline.signal);
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
        attemptDeadline.commit();
        runDeadline.commit();
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
  deadlines: ProviderFirstVisibleDeadline[];
}): ReadableStream<LanguageModelV3StreamPart> {
  let bufferIndex = 0;
  let settled = false;
  let cancellationRequested = false;
  let firstTextDeltaAt = args.firstTextDeltaAt;
  let visibleTextDeltaCount = 0;

  const settleSuccess = async (usage: LanguageModelV3StreamPart & { type: "finish" }) => {
    if (settled) return;
    settled = true;
    try {
      await captureAttemptUsage(args.attempt, usage.usage, "ai_sdk_stream_finish");
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
      args.deadlines.forEach((deadline) => deadline.dispose());
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
      args.deadlines.forEach((deadline) => deadline.dispose());
      await releaseLease(args.lease);
    }
  };
  const settleCancelled = async () => {
    if (settled) return;
    settled = true;
    try {
      await args.attempt?.cancel();
    } finally {
      args.deadlines.forEach((deadline) => deadline.dispose());
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
        if (next.value.type === "finish") await settleSuccess(next.value);
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

function createAttemptDeadline(runDeadline: ProviderFirstVisibleDeadline): ProviderFirstVisibleDeadline {
  return createProviderFirstVisibleDeadline(runDeadline.signal, {
    deadlineAt: Math.min(runDeadline.deadlineAt, Date.now() + PROVIDER_FIRST_VISIBLE_DEADLINE_MS),
  });
}

function emitProgress(
  callback: ((event: ProviderRunProgressEvent) => void) | undefined,
  deadline: ProviderFirstVisibleDeadline,
  phase: ProviderTurnProgressPhase,
  attempt: number,
  candidateCount: number,
): void {
  if (!callback) return;
  try {
    callback({
      phase,
      attempt,
      candidateCount,
      startedAt: deadline.startedAt,
      deadlineAt: deadline.deadlineAt,
    });
  } catch {
    // Ephemeral progress must never change Provider routing.
  }
}

async function acquireNextCandidateWithinDeadline(
  candidates: FallbackModelCandidate[],
  signal: AbortSignal,
): Promise<{ candidate: FallbackModelCandidate; lease: ProviderCandidateLease } | null> {
  const pending = acquireNextCandidate(candidates, signal);
  try {
    return await raceWithAbort(pending, signal);
  } catch (error) {
    if (signal.aborted) {
      void pending.then(async (selected) => {
        if (selected) await releaseLease(selected.lease);
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function startProviderAttemptWithinDeadline(
  run: ProviderAttemptRun | undefined,
  candidate: FallbackModelCandidate,
  fallbackIndex: number,
  startedAt: number,
  signal: AbortSignal,
): Promise<ProviderAttemptHandle | undefined> {
  const pending = startProviderAttempt(run, candidate, fallbackIndex, startedAt);
  try {
    return await raceWithAbort(pending, signal);
  } catch (error) {
    if (signal.aborted) {
      const reason = signal.reason || error;
      void pending.then(async (attempt) => {
        if (attempt) await settleAttempt(attempt, reason, Date.now());
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function streamResultWithinDeadline(
  pendingValue: PromiseLike<LanguageModelV3StreamResult>,
  signal: AbortSignal,
): Promise<LanguageModelV3StreamResult> {
  const pending = Promise.resolve(pendingValue);
  try {
    return await raceWithAbort(pending, signal);
  } catch (error) {
    if (signal.aborted) {
      void pending.then(async (result) => {
        await result.stream.cancel(signal.reason).catch(() => undefined);
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function settleAttemptWithinDeadline(
  attempt: ProviderAttemptHandle,
  error: unknown,
  deadline: ProviderFirstVisibleDeadline,
): Promise<void> {
  const pending = settleAttempt(attempt, error, Math.min(Date.now(), deadline.deadlineAt));
  await raceWithAbort(pending, deadline.signal);
}

function settleAttempt(
  attempt: ProviderAttemptHandle,
  error: unknown,
  endedAt: number,
): Promise<void> {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") return attempt.timeout(endedAt);
  if (name === "AbortError") return attempt.cancel(endedAt);
  return attempt.fail(error, endedAt);
}

async function notifyWithinDeadline(
  callback: ((event: ProviderAttemptEvent) => void | Promise<void>) | undefined,
  event: ProviderAttemptEvent,
  signal: AbortSignal,
): Promise<void> {
  await raceWithAbort(notify(callback, event), signal);
}

async function releaseLeaseWithinDeadline(
  lease: ProviderCandidateLease,
  signal: AbortSignal,
): Promise<void> {
  const pending = releaseLease(lease);
  if (signal.aborted) {
    void pending.catch(() => undefined);
    return;
  }
  try {
    await raceWithAbort(pending, signal);
  } catch {
    void pending.catch(() => undefined);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason) throw signal.reason;
  const error = new Error("The provider request was cancelled.");
  error.name = "AbortError";
  throw error;
}

function canFallback(
  error: unknown,
  usedUserKey: boolean,
  options: LanguageModelV3CallOptions,
  runSignal: AbortSignal,
): boolean {
  if (isProviderAttemptBlockingError(error)) return false;
  if (options.abortSignal?.aborted || runSignal.aborted) return false;
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

async function captureAttemptUsage(
  attempt: ProviderAttemptHandle | undefined,
  usage: LanguageModelV3GenerateResult["usage"],
  source: "ai_sdk_generate" | "ai_sdk_stream_finish",
): Promise<void> {
  if (!attempt) return;
  try {
    await attempt.recordUsage({
      ...normalizeLanguageModelV3Usage(usage),
      source,
    });
  } catch {
    // Finance evidence retries independently and must not change the model outcome.
  }
}

function providerProtocolError(message: string): Error {
  const error = new Error(message);
  error.name = "ProviderProtocolError";
  return error;
}
