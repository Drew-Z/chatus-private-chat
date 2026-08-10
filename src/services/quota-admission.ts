import type { GuestSession, Session } from "../contracts/session";

export type QuotaUserLimits = {
  dailyMessageLimit?: number;
  minuteMessageLimit?: number;
};

export type GuestQuotaPolicy = {
  sourceDailyMessageLimit: number;
  sourceMinuteMessageLimit: number;
};

export type QuotaAccess = {
  user: QuotaUserLimits;
  publicAccess?: GuestQuotaPolicy;
};

export type QuotaUsageResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfter: number; reset: "daily" | "minute"; scope?: "session" | "source" };

export type TurnAdmission =
  | {
      ok: true;
      remaining: number;
      release: () => Promise<void>;
      refundQuota: () => Promise<void>;
    }
  | {
      ok: false;
      error: "rate_limited" | "concurrent_turn";
      retryAfter: number;
      reset?: "daily" | "minute";
      scope?: "session" | "source";
    };

export type QuotaUsage = {
  used: number;
  limit: number;
  remaining: number;
};

export type QuotaBucket = {
  consumeLimits(
    dailyLimit: number,
    minuteLimit: number,
    nowMs: number,
    legacyDayCount?: number,
  ): Promise<QuotaUsageResult>;
  getUsage(day: string, legacyDayCount?: number): Promise<number>;
  refundLimits(nowMs: number): Promise<void>;
  acquireGuestTurn(
    token: string,
    nowMs: number,
    leaseMs: number,
  ): Promise<{ ok: true } | { ok: false; retryAfter: number }>;
  releaseGuestTurn(token: string): Promise<void>;
};

export type QuotaAdmissionDependencies = {
  getBucket(label: string): QuotaBucket;
  readLegacyDayCount(label: string, day: string): Promise<number>;
  defaultDailyLimit: number;
  defaultMinuteLimit: number;
  defaultGuestPolicy: GuestQuotaPolicy;
  guestTurnLeaseMs: number;
  now(): number;
  createToken(): string;
};

export type QuotaAdmissionService = {
  consumeLimits(
    session: Session,
    user: QuotaUserLimits,
    publicAccess?: GuestQuotaPolicy,
  ): Promise<QuotaUsageResult>;
  admitTurn(session: Session, access: QuotaAccess, consumeQuota?: boolean): Promise<TurnAdmission>;
  getUsage(session: Session, user: QuotaUserLimits): Promise<QuotaUsage>;
};

export function createQuotaAdmissionService(
  dependencies: QuotaAdmissionDependencies,
): QuotaAdmissionService {
  const usageAt = async (session: Session, user: QuotaUserLimits, nowMs: number): Promise<QuotaUsage> => {
    const day = utcDay(nowMs);
    const dailyLimit = user.dailyMessageLimit || dependencies.defaultDailyLimit;
    const legacyUsed = await dependencies.readLegacyDayCount(session.label, day);
    const used = await dependencies.getBucket(session.label).getUsage(day, legacyUsed);
    return { used, limit: dailyLimit, remaining: Math.max(0, dailyLimit - used) };
  };

  const consumeAt = async (
    session: Session,
    user: QuotaUserLimits,
    publicAccess: GuestQuotaPolicy | undefined,
    nowMs: number,
  ): Promise<QuotaUsageResult> => {
    const day = utcDay(nowMs);
    const dailyLimit = user.dailyMessageLimit || dependencies.defaultDailyLimit;
    const minuteLimit = user.minuteMessageLimit || dependencies.defaultMinuteLimit;
    const legacyDayCount = await dependencies.readLegacyDayCount(session.label, day);
    const personalBucket = dependencies.getBucket(session.label);
    const personal = await personalBucket.consumeLimits(dailyLimit, minuteLimit, nowMs, legacyDayCount);
    if (!personal.ok || session.kind === "member") {
      return personal.ok ? personal : { ...personal, scope: "session" };
    }

    const policy = publicAccess || dependencies.defaultGuestPolicy;
    const source = await dependencies.getBucket(session.sourceKey).consumeLimits(
      policy.sourceDailyMessageLimit,
      policy.sourceMinuteMessageLimit,
      nowMs,
    );
    if (!source.ok) {
      await personalBucket.refundLimits(nowMs);
      return { ...source, scope: "source" };
    }
    return personal;
  };

  const refundGuestLimits = async (session: GuestSession, nowMs: number): Promise<void> => {
    await Promise.all([
      dependencies.getBucket(session.label).refundLimits(nowMs),
      dependencies.getBucket(session.sourceKey).refundLimits(nowMs),
    ]);
  };

  return {
    consumeLimits: (session, user, publicAccess) => consumeAt(
      session,
      user,
      publicAccess,
      dependencies.now(),
    ),
    getUsage: (session, user) => usageAt(session, user, dependencies.now()),
    admitTurn: async (session, access, consumeQuota = true) => {
      const nowMs = dependencies.now();
      const limits = consumeQuota
        ? await consumeAt(session, access.user, access.publicAccess, nowMs)
        : { ok: true as const, remaining: (await usageAt(session, access.user, nowMs)).remaining };
      if (!limits.ok) {
        return {
          ok: false,
          error: "rate_limited",
          retryAfter: limits.retryAfter,
          reset: limits.reset === "daily" ? "daily" : "minute",
          scope: limits.scope,
        };
      }
      let quotaRefunded = false;
      const refundQuota = async (): Promise<void> => {
        if (!consumeQuota || quotaRefunded) return;
        quotaRefunded = true;
        if (session.kind === "guest") {
          await refundGuestLimits(session, nowMs);
          return;
        }
        await dependencies.getBucket(session.label).refundLimits(nowMs);
      };
      if (session.kind === "member") {
        return {
          ok: true,
          remaining: limits.remaining,
          release: async () => undefined,
          refundQuota,
        };
      }

      const token = dependencies.createToken();
      const bucket = dependencies.getBucket(session.label);
      const lease = await bucket.acquireGuestTurn(token, nowMs, dependencies.guestTurnLeaseMs);
      if (!lease.ok) {
        if (consumeQuota) await refundGuestLimits(session, nowMs);
        return { ok: false, error: "concurrent_turn", retryAfter: lease.retryAfter };
      }

      let released = false;
      return {
        ok: true,
        remaining: limits.remaining,
        release: async () => {
          if (released) return;
          released = true;
          await bucket.releaseGuestTurn(token);
        },
        refundQuota,
      };
    },
  };
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
