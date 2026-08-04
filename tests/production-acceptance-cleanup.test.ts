import { describe, expect, it, vi } from "vitest";
import {
  isProductionAcceptanceLabel,
  retryTemporaryMemberDeletion,
  runProductionAcceptanceCleanup,
} from "../scripts/production-acceptance-cleanup.mjs";

describe("production acceptance member cleanup", () => {
  it("retries a transient 503 after the injected wait", async () => {
    const statuses = [503, 200];
    const run = vi.fn(async () => statuses.shift() ?? 500);
    const wait = vi.fn(async () => undefined);

    await expect(retryTemporaryMemberDeletion(run, { wait })).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(5_000);
  });

  it("accepts an initial 401 only for cleanup of an already-revoked session", async () => {
    const run = vi.fn(async () => 401);

    await expect(retryTemporaryMemberDeletion(run, { allowUnauthorized: true })).resolves.toBeUndefined();
    await expect(retryTemporaryMemberDeletion(run)).rejects.toThrow(
      "temporary member deletion failed: HTTP 401",
    );
  });

  it("accepts 401 after a 503 because the persisted deletion may have revoked the session", async () => {
    const statuses = [503, 401];
    const run = vi.fn(async () => statuses.shift() ?? 500);
    const wait = vi.fn(async () => undefined);

    await expect(retryTemporaryMemberDeletion(run, { wait })).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it("fails immediately for non-503 statuses and bounds exhausted retries", async () => {
    const wait = vi.fn(async () => undefined);
    const nonRetryable = vi.fn(async () => 429);

    await expect(retryTemporaryMemberDeletion(nonRetryable, { wait })).rejects.toThrow(
      "temporary member deletion failed: HTTP 429",
    );
    expect(nonRetryable).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();

    const unavailable = vi.fn(async () => 503);
    await expect(retryTemporaryMemberDeletion(unavailable, { wait, attempts: 4 })).rejects.toThrow(
      "temporary member deletion failed: HTTP 503",
    );
    expect(unavailable).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it("keeps the default retry window aligned with persisted cleanup attempts", async () => {
    const unavailable = vi.fn(async () => 503);
    const wait = vi.fn(async () => undefined);

    await expect(retryTemporaryMemberDeletion(unavailable, { wait })).rejects.toThrow(
      "temporary member deletion failed: HTTP 503",
    );
    expect(unavailable).toHaveBeenCalledTimes(8);
    expect(wait).toHaveBeenCalledTimes(7);
  });
});

describe("production acceptance cleanup orchestration", () => {
  it("runs every cleanup step sequentially and reports fixed operation names only", async () => {
    const firstMember = {};
    const secondMember = {};
    const events: string[] = [];

    const cleanup = runProductionAcceptanceCleanup({
      members: [firstMember, secondMember],
      purgeMember: async (member) => {
        events.push(member === firstMember ? "purge:first" : "purge:second");
        if (member === firstMember) throw new Error("private member and response body");
      },
      restoreAccess: async () => {
        events.push("restore");
        throw new Error("private access configuration");
      },
      logoutAdmin: async () => {
        events.push("logout");
      },
      verifyRelease: async () => {
        events.push("verify");
      },
    });

    await expect(cleanup).rejects.toThrow(
      "production acceptance cleanup failed: member purge, access restoration",
    );
    await cleanup.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("private");
      expect(message).not.toContain("response body");
    });
    expect(events).toEqual(["purge:first", "purge:second", "restore", "logout", "verify"]);
  });
});

describe("production acceptance label classification", () => {
  it("matches only exact generated labels", () => {
    expect(isProductionAcceptanceLabel("codex-accept-0123456789abcdef01234567-a")).toBe(true);
    expect(isProductionAcceptanceLabel("codex-accept-fedcba9876543210fedcba98-b")).toBe(true);

    expect(isProductionAcceptanceLabel("codex-accept-0123456789abcdef01234567-c")).toBe(false);
    expect(isProductionAcceptanceLabel("codex-accept-0123456789ABCDEF01234567-a")).toBe(false);
    expect(isProductionAcceptanceLabel("codex-accept-0123456789abcdef0123456-a")).toBe(false);
    expect(isProductionAcceptanceLabel("codex-accept-0123456789abcdef01234567-a-team")).toBe(false);
    expect(isProductionAcceptanceLabel("team-codex-accept-0123456789abcdef01234567-a")).toBe(false);
  });
});
