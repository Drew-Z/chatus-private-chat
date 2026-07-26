import { describe, expect, it, vi } from "vitest";
import type { Session } from "../src/contracts/session";
import {
  createQuotaAdmissionService,
  type QuotaAdmissionDependencies,
  type QuotaBucket,
} from "../src/services/quota-admission";

const NOW = Date.UTC(2026, 6, 26, 8, 30, 0);
const DAY = "2026-07-26";
const MEMBER: Session = {
  id: "member-session",
  label: "bill",
  kind: "member",
  createdAt: NOW,
  lastSeen: NOW,
  expiresAt: NOW + 60_000,
};
const GUEST: Session = {
  id: "guest-session",
  label: "guest-a",
  kind: "guest",
  createdAt: NOW,
  lastSeen: NOW,
  expiresAt: NOW + 60_000,
  sourceKey: "guest-source:a",
};

describe("quota admission service", () => {
  it("charges a member's personal bucket with the legacy day count", async () => {
    const personal = createBucket();
    const harness = createHarness({ bill: personal }, 4);

    const result = await harness.service.consumeLimits(MEMBER, {
      dailyMessageLimit: 8,
      minuteMessageLimit: 2,
    });

    expect(result).toEqual({ ok: true, remaining: 7 });
    expect(personal.consumeLimits).toHaveBeenCalledWith(8, 2, NOW, 4);
    expect(harness.getBucket).toHaveBeenCalledTimes(1);
  });

  it("maps personal rejection to the session scope and preserves zero-value default fallback", async () => {
    const personal = createBucket({
      consumeLimits: vi.fn(async () => ({ ok: false as const, retryAfter: 31, reset: "daily" as const })),
    });
    const harness = createHarness({ bill: personal }, 4);

    const result = await harness.service.admitTurn(MEMBER, {
      user: { dailyMessageLimit: 0, minuteMessageLimit: 0 },
    });

    expect(result).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfter: 31,
      reset: "daily",
      scope: "session",
    });
    expect(personal.consumeLimits).toHaveBeenCalledWith(50, 7, NOW, 4);
    expect(personal.acquireGuestTurn).not.toHaveBeenCalled();
    expect(harness.getBucket).toHaveBeenCalledTimes(1);
  });

  it("refunds the personal bucket when the guest source bucket rejects admission", async () => {
    const personal = createBucket();
    const source = createBucket({
      consumeLimits: vi.fn(async () => ({ ok: false as const, retryAfter: 17, reset: "minute" as const })),
    });
    const harness = createHarness({ "guest-a": personal, "guest-source:a": source });

    const result = await harness.service.consumeLimits(GUEST, {}, {
      sourceDailyMessageLimit: 20,
      sourceMinuteMessageLimit: 3,
    });

    expect(result).toEqual({
      ok: false,
      retryAfter: 17,
      reset: "minute",
      scope: "source",
    });
    expect(personal.refundLimits).toHaveBeenCalledWith(NOW);
    expect(source.refundLimits).not.toHaveBeenCalled();
  });

  it("refunds both guest buckets when the active-turn lease is occupied", async () => {
    const personal = createBucket({
      acquireGuestTurn: vi.fn(async () => ({ ok: false as const, retryAfter: 23 })),
    });
    const source = createBucket();
    const harness = createHarness({ "guest-a": personal, "guest-source:a": source });

    const result = await harness.service.admitTurn(GUEST, { user: {} });

    expect(result).toEqual({ ok: false, error: "concurrent_turn", retryAfter: 23 });
    expect(personal.refundLimits).toHaveBeenCalledWith(NOW);
    expect(source.refundLimits).toHaveBeenCalledWith(NOW);
  });

  it("does not consume or refund quota for a continuation that loses the guest lease", async () => {
    const personal = createBucket({
      getUsage: vi.fn(async () => 3),
      acquireGuestTurn: vi.fn(async () => ({ ok: false as const, retryAfter: 9 })),
    });
    const source = createBucket();
    const harness = createHarness({ "guest-a": personal, "guest-source:a": source }, 2);

    const result = await harness.service.admitTurn(GUEST, { user: { dailyMessageLimit: 10 } }, false);

    expect(result).toEqual({ ok: false, error: "concurrent_turn", retryAfter: 9 });
    expect(personal.getUsage).toHaveBeenCalledWith(DAY, 2);
    expect(personal.consumeLimits).not.toHaveBeenCalled();
    expect(source.consumeLimits).not.toHaveBeenCalled();
    expect(personal.refundLimits).not.toHaveBeenCalled();
    expect(source.refundLimits).not.toHaveBeenCalled();
  });

  it("releases a successful guest turn at most once", async () => {
    const personal = createBucket();
    const source = createBucket();
    const harness = createHarness({ "guest-a": personal, "guest-source:a": source });

    const result = await harness.service.admitTurn(GUEST, { user: {} });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected successful admission");
    await result.release();
    await result.release();
    expect(personal.acquireGuestTurn).toHaveBeenCalledWith("turn-token", NOW, 600_000);
    expect(personal.releaseGuestTurn).toHaveBeenCalledTimes(1);
    expect(personal.releaseGuestTurn).toHaveBeenCalledWith("turn-token");
  });

  it("charges both guest buckets with the configured source policy", async () => {
    const personal = createBucket({
      consumeLimits: vi.fn(async () => ({ ok: true as const, remaining: 4 })),
    });
    const source = createBucket();
    const harness = createHarness({ "guest-a": personal, "guest-source:a": source });

    const result = await harness.service.consumeLimits(
      GUEST,
      { dailyMessageLimit: 5, minuteMessageLimit: 2 },
      { sourceDailyMessageLimit: 40, sourceMinuteMessageLimit: 6 },
    );

    expect(result).toEqual({ ok: true, remaining: 4 });
    expect(personal.consumeLimits).toHaveBeenCalledWith(5, 2, NOW, 0);
    expect(source.consumeLimits).toHaveBeenCalledWith(40, 6, NOW);
  });

  it("uses the default source policy when a guest policy is not supplied", async () => {
    const personal = createBucket();
    const source = createBucket();
    const harness = createHarness({ "guest-a": personal, "guest-source:a": source });

    await harness.service.consumeLimits(GUEST, {});

    expect(source.consumeLimits).toHaveBeenCalledWith(200, 30, NOW);
  });
});

function createBucket(overrides: Partial<QuotaBucket> = {}) {
  const bucket = {
    consumeLimits: vi.fn(async () => ({ ok: true as const, remaining: 7 })),
    getUsage: vi.fn(async () => 0),
    refundLimits: vi.fn(async () => undefined),
    acquireGuestTurn: vi.fn(async () => ({ ok: true as const })),
    releaseGuestTurn: vi.fn(async () => undefined),
  } satisfies QuotaBucket;
  Object.assign(bucket, overrides);
  return bucket;
}

function createHarness(buckets: Record<string, QuotaBucket>, legacyDayCount = 0) {
  const getBucket = vi.fn((label: string) => {
    const bucket = buckets[label];
    if (!bucket) throw new Error(`missing quota bucket: ${label}`);
    return bucket;
  });
  const dependencies: QuotaAdmissionDependencies = {
    getBucket,
    readLegacyDayCount: vi.fn(async () => legacyDayCount),
    defaultDailyLimit: 50,
    defaultMinuteLimit: 7,
    defaultGuestPolicy: {
      sourceDailyMessageLimit: 200,
      sourceMinuteMessageLimit: 30,
    },
    guestTurnLeaseMs: 600_000,
    now: () => NOW,
    createToken: () => "turn-token",
  };
  return { service: createQuotaAdmissionService(dependencies), getBucket };
}
