import { describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_STORAGE_KEY,
  createFeedbackAuditService,
  FEEDBACK_STORAGE_KEY,
  type FeedbackAuditDependencies,
  type FeedbackAuditStore,
} from "../src/services/feedback-audit";

const NOW = "2026-07-26T14:00:00.000Z";
const PRINCIPAL_ONE = "prn_11111111-1111-4111-8111-111111111111";
const PRINCIPAL_TWO = "prn_22222222-2222-4222-8222-222222222222";

describe("feedback and audit persistence", () => {
  it("loads only exact, valid, unique records from KV", async () => {
    const store = new MemoryFeedbackAuditStore();
    const feedback = feedbackRecord("feedback-1", "bill");
    const audit = auditRecord("audit-1");
    store.values.set(FEEDBACK_STORAGE_KEY, JSON.stringify([
      feedback,
      { ...feedback, rating: "down", reason: "inaccurate" },
      { ...feedback, id: "feedback-extra", secret: "forbidden" },
      { ...feedback, id: "feedback-invalid", rating: "down", reason: "unknown" },
      feedbackRecord("feedback-2", "alice"),
    ]));
    store.values.set(ADMIN_AUDIT_STORAGE_KEY, JSON.stringify([
      audit,
      { ...audit, action: "duplicate" },
      { ...audit, id: "audit-extra", token: "forbidden" },
      { ...audit, id: "audit-invalid", at: "not-a-date" },
      auditRecord("audit-2"),
    ]));
    const service = createService(store);

    await expect(service.listFeedback()).resolves.toEqual([
      feedback,
      feedbackRecord("feedback-2", "alice"),
    ]);
    await expect(service.listAdminAudit()).resolves.toEqual([
      audit,
      auditRecord("audit-2"),
    ]);

    store.values.set(FEEDBACK_STORAGE_KEY, "not-json");
    store.values.set(ADMIN_AUDIT_STORAGE_KEY, JSON.stringify({ entries: [] }));
    await expect(service.listFeedback()).resolves.toEqual([]);
    await expect(service.listAdminAudit()).resolves.toEqual([]);
  });

  it("updates duplicate feedback in place and retains only the newest 100 entries", async () => {
    const store = new MemoryFeedbackAuditStore();
    const service = createService(store);
    const base = { label: "bill", routeId: "model", chatId: "chat" };

    await service.upsertFeedback({ ...base, messageId: "same", rating: "down", reason: "inaccurate" });
    await service.upsertFeedback({ ...base, messageId: "same", rating: "up", reason: "" });
    await expect(service.listFeedback()).resolves.toMatchObject([
      { ...base, messageId: "same", rating: "up", reason: "" },
    ]);

    for (let index = 0; index <= 100; index += 1) {
      await service.upsertFeedback({ ...base, messageId: `message-${index}`, rating: "up", reason: "" });
    }
    const records = await service.listFeedback();
    expect(records).toHaveLength(100);
    expect(records[0].messageId).toBe("message-100");
    expect(records.some((record) => record.messageId === "message-0")).toBe(false);
  });

  it("removes feedback only for the selected member", async () => {
    const store = new MemoryFeedbackAuditStore();
    const service = createService(store);
    await service.upsertFeedback({ label: "bill", routeId: "model", chatId: "chat", messageId: "one", rating: "up", reason: "" });
    await service.upsertFeedback({ label: "alice", routeId: "model", chatId: "chat", messageId: "two", rating: "down", reason: "format" });

    await service.removeFeedbackByPrincipal(PRINCIPAL_ONE, "bill", true);

    await expect(service.listFeedback()).resolves.toMatchObject([
      { label: "alice", messageId: "two" },
    ]);
  });

  it("removes only the selected principal when a retired label is reused", async () => {
    const store = new MemoryFeedbackAuditStore();
    const service = createService(store);
    const shared = { label: "reused", routeId: "model", chatId: "chat", messageId: "same", rating: "up" as const, reason: "" as const };
    await service.upsertFeedback({ ...shared, principalId: PRINCIPAL_ONE });
    await service.upsertFeedback({ ...shared, principalId: PRINCIPAL_TWO });

    await service.removeFeedbackByPrincipal(PRINCIPAL_ONE, "reused", false);

    await expect(service.listFeedback()).resolves.toEqual([
      expect.objectContaining({ principalId: PRINCIPAL_TWO, label: "reused" }),
    ]);
  });

  it("bounds audit records and targets while retaining newest-first order", async () => {
    const store = new MemoryFeedbackAuditStore();
    let nextId = 0;
    const service = createService(store, { createId: () => `audit-${nextId += 1}` });
    for (let index = 0; index <= 100; index += 1) {
      await service.appendAdminAudit(`action-${index}`, index === 100 ? "x".repeat(150) : undefined);
    }

    const records = await service.listAdminAudit();
    expect(records).toHaveLength(100);
    expect(records[0]).toMatchObject({ id: "audit-101", action: "action-100", target: "x".repeat(100) });
    expect(records.some((record) => record.id === "audit-1")).toBe(false);
  });

  it("keeps audit writes fail-open while feedback writes remain authoritative", async () => {
    const store = new MemoryFeedbackAuditStore();
    const service = createService(store);
    store.failReads = true;
    await expect(service.appendAdminAudit("config.update")).resolves.toBeUndefined();

    store.failReads = false;
    store.failWrites = true;

    await expect(service.appendAdminAudit("config.update")).resolves.toBeUndefined();
    await expect(service.upsertFeedback({
      label: "bill",
      routeId: "model",
      chatId: "chat",
      messageId: "message",
      rating: "up",
      reason: "",
    })).rejects.toThrow("write failed");
  });
});

class MemoryFeedbackAuditStore implements FeedbackAuditStore {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  async get(key: string): Promise<string | null> {
    if (this.failReads) throw new Error("read failed");
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error("write failed");
    this.values.set(key, value);
  }
}

function createService(
  store: FeedbackAuditStore,
  overrides: Partial<FeedbackAuditDependencies> = {},
) {
  return createFeedbackAuditService({
    store,
    nowIso: () => NOW,
    createId: () => "audit-id",
    ...overrides,
  });
}

function feedbackRecord(id: string, label: string) {
  return {
    id,
    label,
    rating: "up" as const,
    reason: "" as const,
    routeId: "model",
    chatId: "chat",
    messageId: id,
    at: NOW,
  };
}

function auditRecord(id: string) {
  return { id, action: "config.update", at: NOW };
}
