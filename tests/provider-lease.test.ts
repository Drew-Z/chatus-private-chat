import { describe, expect, it, vi } from "vitest";
import {
  acquireFirstAvailableLease,
  uniqueProviderLeaseCandidates,
  type ProviderLease,
} from "../src/services/provider-lease";

type Candidate = { id: string };

describe("provider lease selection", () => {
  it("keeps only the first candidate for each provider during one lease selection round", () => {
    expect(uniqueProviderLeaseCandidates([
      { id: "primary-model", providerId: "shared" },
      { id: "fallback-model", providerId: "shared" },
      { id: "other-model", providerId: "backup" },
    ])).toEqual([
      { id: "primary-model", providerId: "shared" },
      { id: "other-model", providerId: "backup" },
    ]);
  });

  it("scans candidates without waiting and selects the first immediately available provider", async () => {
    const calls: Array<{ id: string; waitMs: number }> = [];
    const lease = createLease("provider-b");

    const selected = await acquireFirstAvailableLease(
      [{ id: "provider-a" }, { id: "provider-b" }],
      async (candidate, waitMs) => {
        calls.push({ id: candidate.id, waitMs });
        return candidate.id === "provider-b" ? lease : null;
      },
    );

    expect(selected).toEqual({ candidate: { id: "provider-b" }, lease });
    expect(calls).toEqual([
      { id: "provider-a", waitMs: 0 },
      { id: "provider-b", waitMs: 0 },
    ]);
  });

  it("waits for all busy candidates in parallel under one shared deadline and releases losers", async () => {
    const releases = [vi.fn(), vi.fn()];
    const waitCalls: Array<{ id: string; waitMs: number }> = [];
    const candidates = [{ id: "provider-a" }, { id: "provider-b" }];

    const selected = await acquireFirstAvailableLease(candidates, async (candidate, waitMs) => {
      if (!waitMs) return null;
      waitCalls.push({ id: candidate.id, waitMs });
      return createLease(candidate.id, releases[candidate.id === "provider-a" ? 0 : 1]);
    });

    expect(selected?.candidate).toEqual({ id: "provider-a" });
    expect(waitCalls).toEqual([
      { id: "provider-a", waitMs: 10_000 },
      { id: "provider-b", waitMs: 10_000 },
    ]);
    expect(releases[0]).not.toHaveBeenCalled();
    expect(releases[1]).toHaveBeenCalledOnce();

    await selected?.lease.release();
    expect(releases[0]).toHaveBeenCalledOnce();
  });
});

function createLease(providerId: string, release = vi.fn()): ProviderLease {
  return { providerId, requestId: crypto.randomUUID(), release };
}
