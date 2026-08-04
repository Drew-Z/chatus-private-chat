export const PROVIDER_FIRST_VISIBLE_DEADLINE_MS = 60_000;

export type ProviderFirstVisibleDeadline = {
  signal: AbortSignal;
  commit: () => void;
  dispose: () => void;
};

export function createProviderFirstVisibleDeadline(
  parentSignal?: AbortSignal,
): ProviderFirstVisibleDeadline {
  const controller = new AbortController();
  let committed = false;
  let disposed = false;
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason || abortError());
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(timeoutError());
  }, PROVIDER_FIRST_VISIBLE_DEADLINE_MS);

  return {
    signal: controller.signal,
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
