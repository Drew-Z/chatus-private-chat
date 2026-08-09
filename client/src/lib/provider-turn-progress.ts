import {
  decodeProviderTurnProgressV1,
  type ProviderTurnProgressV1,
} from "../../../src/contracts/provider-turn-progress";

export function decodeProviderTurnProgressMessage(data: unknown): ProviderTurnProgressV1 | undefined {
  if (typeof data !== "string") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  return decodeProviderTurnProgressV1(value);
}

export function selectNewestProviderTurnProgress(
  current: ProviderTurnProgressV1 | null,
  next: ProviderTurnProgressV1,
  localTurnStartedAt: number,
): ProviderTurnProgressV1 | null {
  if (localTurnStartedAt > 0 && next.startedAt < localTurnStartedAt) return current;
  if (!current) return next;
  if (next.requestId === current.requestId) {
    return next.startedAt >= current.startedAt && next.sequence > current.sequence ? next : current;
  }
  return next.startedAt > current.startedAt ? next : current;
}

export function providerTurnProgressText(progress: ProviderTurnProgressV1, now: number): string {
  const remainingSeconds = Math.min(90, Math.max(0, Math.ceil((progress.deadlineAt - now) / 1_000)));
  const suffix = `最多还需 ${remainingSeconds}s`;
  if (progress.phase === "planning") return `正在规划可用线路 · ${suffix}`;
  if (progress.phase === "waiting_capacity") return `正在等待可用线路 · ${suffix}`;
  if (progress.phase === "fallback") {
    return `正在尝试备用线路 ${progress.attempt}/${progress.candidateCount} · ${suffix}`;
  }
  return `正在尝试可用线路 ${progress.attempt}/${progress.candidateCount} · ${suffix}`;
}
