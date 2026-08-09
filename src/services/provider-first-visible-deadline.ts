export const PROVIDER_FIRST_VISIBLE_DEADLINE_MS = 60_000;

export type ProviderFirstVisibleDeadline = {
  signal: AbortSignal;
  startedAt: number;
  deadlineAt: number;
  commit: () => void;
  dispose: () => void;
};

export type ProviderFirstVisibleDeadlineOptions = {
  timeoutMs?: number;
  deadlineAt?: number;
  startedAt?: number;
};

export function createProviderFirstVisibleDeadline(
  parentSignal?: AbortSignal,
  options: ProviderFirstVisibleDeadlineOptions = {},
): ProviderFirstVisibleDeadline {
  const controller = new AbortController();
  const startedAt = options.startedAt ?? Date.now();
  const deadlineAt = options.deadlineAt
    ?? startedAt + normalizeTimeoutMs(options.timeoutMs, PROVIDER_FIRST_VISIBLE_DEADLINE_MS);
  let committed = false;
  let disposed = false;
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason || abortError());
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(timeoutError());
  }, Math.max(0, deadlineAt - Date.now()));

  return {
    signal: controller.signal,
    startedAt,
    deadlineAt,
    commit: () => {
      if (disposed || committed) return;
      committed = true;
      clearTimeout(timer);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : fallback;
}

export function timeoutError(): Error {
  const error = new Error("Provider did not produce visible output before the deadline.");
  error.name = "TimeoutError";
  return error;
}

function abortError(): Error {
  const error = new Error("The provider request was cancelled.");
  error.name = "AbortError";
  return error;
}

export function raceWithAbort<T>(value: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  const promise = Promise.resolve(value);
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(signal.reason || abortError());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.reason || abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
