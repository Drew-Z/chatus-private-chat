export const FEEDBACK_STORAGE_KEY = "feedback:recent";
export const ADMIN_AUDIT_STORAGE_KEY = "config:admin_audit";

const MAX_RECORDS = 100;

export type FeedbackRating = "up" | "down";
export type FeedbackReason = "" | "inaccurate" | "misunderstood" | "verbose" | "format" | "other";

export type FeedbackRecord = {
  id: string;
  label: string;
  rating: FeedbackRating;
  reason?: FeedbackReason;
  routeId: string;
  chatId: string;
  messageId: string;
  at: string;
};

export type FeedbackRecordInput = Omit<FeedbackRecord, "id" | "at">;

export type AdminAuditRecord = {
  id: string;
  action: string;
  target?: string;
  at: string;
};

export type FeedbackAuditStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

export type FeedbackAuditDependencies = {
  store: FeedbackAuditStore;
  nowIso(): string;
  createId(): string;
};

export type FeedbackAuditService = {
  listFeedback(): Promise<FeedbackRecord[]>;
  upsertFeedback(input: FeedbackRecordInput): Promise<FeedbackRecord>;
  removeFeedbackByLabel(label: string): Promise<void>;
  listAdminAudit(): Promise<AdminAuditRecord[]>;
  appendAdminAudit(action: string, target?: string): Promise<void>;
};

export function createFeedbackAuditService(
  dependencies: FeedbackAuditDependencies,
): FeedbackAuditService {
  const listFeedback = () => loadRecordList(
    dependencies.store,
    FEEDBACK_STORAGE_KEY,
    normalizeFeedbackRecord,
  );
  const listAdminAudit = () => loadRecordList(
    dependencies.store,
    ADMIN_AUDIT_STORAGE_KEY,
    normalizeAdminAuditRecord,
  );

  return {
    listFeedback,
    upsertFeedback: async (input) => {
      const record = normalizeFeedbackRecord({
        ...input,
        id: `${input.label}:${input.chatId}:${input.messageId}`,
        at: dependencies.nowIso(),
      });
      if (!record) throw new TypeError("Invalid feedback record");
      const records = await listFeedback();
      const next = [record, ...records.filter((item) => item.id !== record.id)].slice(0, MAX_RECORDS);
      await dependencies.store.put(FEEDBACK_STORAGE_KEY, JSON.stringify(next));
      return record;
    },
    removeFeedbackByLabel: async (label) => {
      const records = await listFeedback();
      await dependencies.store.put(
        FEEDBACK_STORAGE_KEY,
        JSON.stringify(records.filter((item) => item.label !== label)),
      );
    },
    listAdminAudit,
    appendAdminAudit: async (action, target) => {
      try {
        const record = normalizeAdminAuditRecord({
          id: dependencies.createId().slice(0, 100),
          action: action.slice(0, 100),
          ...(target ? { target: target.slice(0, 100) } : {}),
          at: dependencies.nowIso(),
        });
        if (!record) return;
        const records = await listAdminAudit();
        const next = [record, ...records.filter((item) => item.id !== record.id)].slice(0, MAX_RECORDS);
        await dependencies.store.put(ADMIN_AUDIT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Audit persistence must not block the requested admin operation.
      }
    },
  };
}

async function loadRecordList<T extends { id: string }>(
  store: FeedbackAuditStore,
  key: string,
  normalize: (value: unknown) => T | null,
): Promise<T[]> {
  const raw = await store.get(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const records: T[] = [];
    const ids = new Set<string>();
    for (const value of parsed) {
      const record = normalize(value);
      if (!record || ids.has(record.id)) continue;
      records.push(record);
      ids.add(record.id);
      if (records.length >= MAX_RECORDS) break;
    }
    return records;
  } catch {
    return [];
  }
}

function normalizeFeedbackRecord(value: unknown): FeedbackRecord | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["id", "label", "rating", "reason", "routeId", "chatId", "messageId", "at"])
    || !isBoundedText(value.id, 512)
    || !isBoundedText(value.label, 160)
    || (value.rating !== "up" && value.rating !== "down")
    || !isBoundedText(value.routeId, 100)
    || !isBoundedText(value.chatId, 100)
    || !isBoundedText(value.messageId, 100)
    || !isIsoDate(value.at)
  ) return null;
  if (value.rating === "up" && value.reason !== undefined && value.reason !== "") return null;
  if (value.rating === "down" && !isDownFeedbackReason(value.reason)) return null;
  return {
    id: value.id,
    label: value.label,
    rating: value.rating,
    ...(value.reason !== undefined ? { reason: value.reason as FeedbackReason } : {}),
    routeId: value.routeId,
    chatId: value.chatId,
    messageId: value.messageId,
    at: value.at,
  };
}

function normalizeAdminAuditRecord(value: unknown): AdminAuditRecord | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["id", "action", "target", "at"])
    || !isBoundedText(value.id, 100)
    || !isBoundedText(value.action, 100)
    || (value.target !== undefined && !isBoundedText(value.target, 100))
    || !isIsoDate(value.at)
  ) return null;
  return {
    id: value.id,
    action: value.action,
    ...(value.target !== undefined ? { target: value.target } : {}),
    at: value.at,
  };
}

export function isDownFeedbackReason(value: unknown): value is Exclude<FeedbackReason, ""> {
  return value === "inaccurate"
    || value === "misunderstood"
    || value === "verbose"
    || value === "format"
    || value === "other";
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedText(value: unknown, maxChars: number): value is string {
  return typeof value === "string" && value.length <= maxChars && Boolean(value.trim());
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
