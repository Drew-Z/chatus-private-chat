import type { ResolvedProviderRoute } from "../contracts/provider";
import type { ProviderCoordinator } from "../provider-coordinator";

const PROVIDER_LEASE_TTL_MS = 15 * 60 * 1_000;
const PROVIDER_WAIT_DEADLINE_MS = 10_000;

type ProviderCoordinatorEnv = {
  PROVIDER_COORDINATOR: DurableObjectNamespace<ProviderCoordinator>;
};

export type ProviderLeaseCandidate = Pick<
  ResolvedProviderRoute,
  "providerId" | "concurrency" | "maxConcurrent" | "queueTimeoutMs"
>;

export type ProviderLease = {
  providerId: string;
  requestId: string;
  release: () => Promise<void>;
};

export type ProviderLeaseLike = Pick<ProviderLease, "release">;

export type ProviderLeaseAcquirer<T, L extends ProviderLeaseLike> = (
  candidate: T,
  waitMs: number,
  signal?: AbortSignal,
) => Promise<L | null>;

export async function acquireProviderLease(
  env: ProviderCoordinatorEnv,
  candidate: ProviderLeaseCandidate,
  waitMs: number,
  signal?: AbortSignal,
): Promise<ProviderLease | null> {
  if (candidate.concurrency === "unlimited") return noopLease(candidate.providerId);
  if (signal?.aborted) throw abortError(signal.reason);

  const requestId = crypto.randomUUID();
  const coordinator = env.PROVIDER_COORDINATOR.getByName(candidate.providerId);
  let released = false;
  const cancel = () => {
    void coordinator.cancel({ requestId }).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await coordinator.acquire({
      requestId,
      capacity: candidate.maxConcurrent,
      waitMs: Math.min(Math.max(0, waitMs), candidate.queueTimeoutMs),
      leaseTtlMs: PROVIDER_LEASE_TTL_MS,
    });
    if (signal?.aborted) {
      if (result.ok) await coordinator.release({ token: result.token, requestId }).catch(() => undefined);
      throw abortError(signal.reason);
    }
    if (!result.ok) return null;
    return {
      providerId: candidate.providerId,
      requestId,
      release: async () => {
        if (released) return;
        released = true;
        await coordinator.release({ token: result.token, requestId }).catch(() => undefined);
      },
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function acquireFirstAvailableProvider<T extends ProviderLeaseCandidate>(
  env: ProviderCoordinatorEnv,
  candidates: T[],
  signal?: AbortSignal,
): Promise<{ candidate: T; lease: ProviderLease } | null> {
  return acquireFirstAvailableLease(
    uniqueProviderLeaseCandidates(candidates),
    (candidate, waitMs, attemptSignal) => acquireProviderLease(env, candidate, waitMs, attemptSignal),
    signal,
  );
}

export function uniqueProviderLeaseCandidates<T extends Pick<ProviderLeaseCandidate, "providerId">>(
  candidates: readonly T[],
): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.providerId)) return false;
    seen.add(candidate.providerId);
    return true;
  });
}

export async function acquireFirstAvailableLease<T, L extends ProviderLeaseLike>(
  candidates: T[],
  acquire: ProviderLeaseAcquirer<T, L>,
  signal?: AbortSignal,
): Promise<{ candidate: T; lease: L } | null> {
  const busy: T[] = [];
  for (const candidate of candidates) {
    const lease = await acquire(candidate, 0, signal);
    if (lease) return { candidate, lease };
    busy.push(candidate);
  }
  if (!busy.length) return null;

  const controllers = busy.map(() => new AbortController());
  const abortAll = () => controllers.forEach((controller) => controller.abort(signal?.reason));
  let winner: { candidate: T; lease: L; index: number } | undefined;
  signal?.addEventListener("abort", abortAll, { once: true });
  try {
    const attempts = busy.map(async (candidate, index) => {
      const combined = combineSignals(signal, controllers[index].signal);
      const lease = await acquire(candidate, PROVIDER_WAIT_DEADLINE_MS, combined);
      if (!lease) throw providerBusyError();
      return { candidate, lease, index };
    });
    const selectedWinner = await Promise.any(attempts);
    winner = selectedWinner;
    controllers.forEach((controller, index) => {
      if (index !== selectedWinner.index) controller.abort("provider_candidate_lost");
    });
    const settled = await Promise.allSettled(attempts);
    await Promise.all(settled.map(async (result) => {
      if (result.status === "fulfilled" && result.value.index !== selectedWinner.index) {
        await result.value.lease.release();
      }
    }));
    if (signal?.aborted) throw abortError(signal.reason);
    return { candidate: selectedWinner.candidate, lease: selectedWinner.lease };
  } catch {
    if (winner) await winner.lease.release().catch(() => undefined);
    if (signal?.aborted) throw abortError(signal.reason);
    return null;
  } finally {
    signal?.removeEventListener("abort", abortAll);
  }
}

function noopLease(providerId: string): ProviderLease {
  return { providerId, requestId: "", release: async () => undefined };
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" ? reason : "The request was cancelled.");
  error.name = "AbortError";
  return error;
}

function combineSignals(first?: AbortSignal, second?: AbortSignal): AbortSignal | undefined {
  const signals = [first, second].filter((value): value is AbortSignal => Boolean(value));
  return signals.length ? AbortSignal.any(signals) : undefined;
}

function providerBusyError(): Error {
  const error = new Error("The provider is busy.");
  error.name = "ProviderBusyError";
  return error;
}
