import {
  AIChatAgent,
  type ChatResponseResult,
  type OnChatMessageOptions,
} from "@cloudflare/ai-chat";
import { getAgentByName } from "agents";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ModelMessage,
  type StreamTextOnFinishCallback,
  type ToolSet,
  type UIMessage,
} from "ai";
import {
  MAX_AGENT_CONVERSATIONS,
  type AgentExportMessage,
  type AgentExportMessagesResult,
  type AgentExportPart,
  type AgentConversationCleanupRecord,
  type AgentConversationActivity,
  type AgentConversationBranchInput,
  type AgentConversationBranchCopyInput,
  type AgentConversationBranchCopyResult,
  type AgentConversationBranchLaunch,
  type AgentConversationBranchOperation,
  type AgentConversationBranchReservationResult,
  type AgentConversationBranchSnapshotInput,
  type AgentConversationBranchSnapshotResult,
  type AgentConversationBranchStartInput,
  type AgentConversationBranchStartResult,
  type AgentConversationInput,
  type AgentConversationMutationResult,
  type AgentConversationPatch,
  type AgentConversationSummary,
  type AgentMemoryMutationResult,
  type AgentMemoryRecord,
  type TeamAgentIdentityError,
  type TeamAgentIdentityResult,
  type TeamAgentProps,
  type TeamAgentScope,
  type TeamAgentState,
} from "../contracts/agent";
import type { ChatMessage } from "../contracts/chat";
import {
  parseDataImage,
  type ImageInputPolicy,
  type ImageValidationErrorCode,
} from "../contracts/image";
import {
  emptyTextFileValidationState,
  parseDataTextFile,
  type FileInputPolicy,
  type FileValidationErrorCode,
} from "../contracts/file";
import type { Session } from "../contracts/session";
import { createAgentToolSet } from "../services/agent-tools";
import {
  prepareTeamAgentTurn,
  fileInputPolicy,
  imageInputPolicy,
  type Env,
} from "../worker";

const MAX_PERSISTED_TOOL_TEXT_CHARS = 4_000;
const MAX_EXPORT_MESSAGE_TEXT_CHARS = 20_000;
const MAX_EXPORT_MESSAGE_PARTS = 32;
const MAX_CONVERSATION_TITLE_CHARS = 80;
const MAX_SELECTED_SKILLS = 3;
const DEFAULT_CONVERSATION_TITLE = "新对话";
const AGENT_IDENTITY_STORAGE_KEY = "chatus:agent-identity:v1";

type TeamAgentIdentity = {
  version: 1;
  userLabel: string;
  scope: TeamAgentScope;
  chatId: string;
  rootInstance: string;
};

type TeamAgentAccessContext = {
  kind: Session["kind"];
  expiresAt: number;
  sourceKey: string;
};

type ConversationRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  summary: string;
  pinned: number;
  route_id: string;
  parent_chat_id: string;
  skill_ids: string;
  message_count: number;
  deleted_at: number;
};

type PendingConversationActivity = {
  routeId?: string;
  skillIds: string[];
};

type ConversationCleanupRow = {
  chat_id: string;
  requested_at: number;
  attempts: number;
  last_attempt_at: number;
};

type ConversationBranchRow = {
  request_id: string;
  fingerprint: string;
  source_chat_id: string;
  source_message_id: string;
  source_message_count: number;
  destination_id: string;
  launch: string;
  anchor_message_id: string;
  state: string;
};

type ConversationBranchLaunchRow = {
  request_id: string;
  fingerprint: string;
  state: string;
  body_json: string;
};

export class TeamAgent extends AIChatAgent<Env, TeamAgentState, TeamAgentProps> {
  initialState: TeamAgentState = {
    version: 1,
    runtime: "cloudflare-ai-chat",
  };

  maxPersistedMessages = 200;
  messageConcurrency = "queue" as const;
  chatRecovery = true;
  private userLabel = "";
  private scope: TeamAgentScope = "root";
  private chatId = "";
  private rootInstance = "";
  private accessKind: Session["kind"] = "member";
  private sessionExpiresAt = Number.MAX_SAFE_INTEGER;
  private sourceKey = "";
  private pendingActivity?: PendingConversationActivity;
  private pendingAttachmentValidationErrors = new Map<string, AttachmentValidationErrorCode>();

  async onStart(props?: TeamAgentProps): Promise<void> {
    await super.onStart(props);
    await this.initializeIdentity(props);
    this.sql`
      CREATE TABLE IF NOT EXISTS capability_tool_trust (
        conversation_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        approved_at INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, tool_id)
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS chatus_conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        route_id TEXT NOT NULL DEFAULT '',
        parent_chat_id TEXT NOT NULL DEFAULT '',
        skill_ids TEXT NOT NULL DEFAULT '[]',
        message_count INTEGER NOT NULL DEFAULT 0,
        deleted_at INTEGER NOT NULL DEFAULT 0
      )
    `;
    this.sql`CREATE INDEX IF NOT EXISTS chatus_conversations_updated_at ON chatus_conversations(updated_at DESC)`;
    this.sql`
      CREATE TABLE IF NOT EXISTS chatus_memory (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS chatus_migrations (
        id TEXT PRIMARY KEY,
        completed_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS chatus_conversation_cleanup (
        chat_id TEXT PRIMARY KEY,
        requested_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER NOT NULL DEFAULT 0
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS chatus_conversation_branches (
        request_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        source_chat_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        source_message_count INTEGER NOT NULL,
        destination_id TEXT NOT NULL,
        launch TEXT NOT NULL,
        anchor_message_id TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS chatus_conversation_branch_launches (
        request_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        state TEXT NOT NULL,
        body_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
  }

  async ensureIdentity(props: TeamAgentProps): Promise<TeamAgentIdentityResult> {
    const provided = normalizeTeamAgentIdentity(props);
    const access = normalizeTeamAgentAccess(props);
    if (!provided || !access) return { ok: false, error: "agent_identity_unavailable" };
    const active = this.currentIdentity();
    if (active) {
      if (!sameTeamAgentIdentity(provided, active)) return { ok: false, error: "agent_identity_conflict" };
      this.applyAccessContext(access);
      return { ok: true };
    }
    try {
      await this.initializeIdentity(props);
      return { ok: true };
    } catch (error) {
      if (error instanceof Error && isTeamAgentIdentityError(error.message)) {
        return { ok: false, error: error.message };
      }
      throw error;
    }
  }

  async healthCheck(): Promise<{ ok: true; runtime: "cloudflare-ai-chat"; storage: true; version: 1 }> {
    this.sql`SELECT 1 AS ok`;
    return { ok: true, runtime: "cloudflare-ai-chat", storage: true, version: 1 };
  }

  async listConversations(): Promise<AgentConversationSummary[]> {
    this.requireRootScope();
    return this.sql<ConversationRow>`
      SELECT id, title, created_at, updated_at, summary, pinned, route_id,
        parent_chat_id, skill_ids, message_count, deleted_at
      FROM chatus_conversations
      WHERE deleted_at = 0
      ORDER BY pinned DESC, updated_at DESC
      LIMIT ${MAX_AGENT_CONVERSATIONS}
    `.map(conversationRowToSummary);
  }

  async createConversation(input: AgentConversationInput): Promise<AgentConversationMutationResult> {
    this.requireRootScope();
    const normalized = normalizeConversationInput(input);
    if (!normalized) return { ok: false, error: "conversation_not_found" };
    const existing = this.getConversationRow(normalized.id);
    if (existing && existing.deleted_at === 0) {
      return { ok: true, conversation: conversationRowToSummary(existing), created: false };
    }
    if (existing) return { ok: false, error: "conversation_deleted" };
    const activeCount = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM chatus_conversations WHERE deleted_at = 0
    `[0]?.count || 0;
    if (activeCount >= MAX_AGENT_CONVERSATIONS) {
      return { ok: false, error: "conversation_limit_reached" };
    }
    this.writeConversation(normalized, 0);
    const created = this.getConversationRow(normalized.id);
    if (!created) return { ok: false, error: "conversation_not_found" };
    return { ok: true, conversation: conversationRowToSummary(created), created: true };
  }

  async reserveConversationBranch(
    input: AgentConversationBranchInput,
  ): Promise<AgentConversationBranchReservationResult> {
    this.requireRootScope();
    const normalized = normalizeConversationBranchInput(input);
    if (!normalized) return { ok: false, error: "branch_request_conflict" };

    const existing = this.getConversationBranchRow(normalized.requestId);
    if (existing) {
      if (existing.fingerprint !== normalized.fingerprint) {
        return { ok: false, error: "branch_request_conflict" };
      }
      const operation = this.conversationBranchOperation(existing);
      if (!operation) return { ok: false, error: "branch_failed" };
      if (operation.state === "failed") return { ok: false, error: "branch_failed" };
      return { ok: true, operation, existing: true };
    }

    const source = this.getConversationRow(normalized.sourceId);
    if (!source) return { ok: false, error: "conversation_not_found" };
    if (source.deleted_at !== 0) return { ok: false, error: "conversation_deleted" };
    if (source.updated_at !== normalized.expectedUpdatedAt) {
      return { ok: false, error: "conversation_conflict", current: conversationRowToSummary(source) };
    }
    if (this.getConversationRow(normalized.destinationId)) {
      return { ok: false, error: "branch_request_conflict" };
    }
    const activeCount = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM chatus_conversations WHERE deleted_at = 0
    `[0]?.count || 0;
    if (activeCount >= MAX_AGENT_CONVERSATIONS) {
      return { ok: false, error: "conversation_limit_reached" };
    }

    const now = monotonicNow(source.updated_at);
    this.sql`
      INSERT INTO chatus_conversation_branches(
        request_id, fingerprint, source_chat_id, source_message_id, source_message_count, destination_id,
        launch, anchor_message_id, state, created_at, updated_at
      ) VALUES (
        ${normalized.requestId}, ${normalized.fingerprint}, ${normalized.sourceId},
        ${normalized.sourceMessageId}, ${normalized.sourceMessageCount}, ${normalized.destinationId}, ${normalized.launch},
        '', 'reserved', ${now}, ${now}
      )
    `;
    this.writeConversation({
      id: normalized.destinationId,
      title: normalized.title,
      createdAt: now,
      updatedAt: now,
      summary: "",
      pinned: false,
      routeId: normalized.routeId,
      parentChatId: normalized.sourceId,
      skillIds: normalized.skillIds || [],
      messageCount: 0,
    }, 0);
    const created = this.getConversationBranchRow(normalized.requestId);
    const operation = created ? this.conversationBranchOperation(created) : undefined;
    return operation
      ? { ok: true, operation, existing: false }
      : { ok: false, error: "branch_failed" };
  }

  async markConversationBranchState(
    requestIdValue: string,
    fingerprintValue: string,
    stateValue: "ready" | "launched" | "failed",
    anchorMessageIdValue?: string,
  ): Promise<AgentConversationBranchReservationResult> {
    this.requireRootScope();
    const requestId = normalizeBranchRequestId(requestIdValue);
    const fingerprint = normalizeBranchFingerprint(fingerprintValue);
    const state = normalizeBranchState(stateValue);
    if (!requestId || !fingerprint || !state) return { ok: false, error: "branch_request_conflict" };
    const current = this.getConversationBranchRow(requestId);
    if (!current || current.fingerprint !== fingerprint) return { ok: false, error: "branch_request_conflict" };
    const anchorMessageId = normalizeBranchMessageId(anchorMessageIdValue) || current.anchor_message_id;
    this.sql`
      UPDATE chatus_conversation_branches
      SET state = ${state}, anchor_message_id = ${anchorMessageId}, updated_at = ${Date.now()}
      WHERE request_id = ${requestId} AND fingerprint = ${fingerprint}
    `;
    const updated = this.getConversationBranchRow(requestId);
    const operation = updated ? this.conversationBranchOperation(updated) : undefined;
    return operation
      ? { ok: true, operation, existing: true }
      : { ok: false, error: "branch_failed" };
  }

  async importLegacyConversation(
    input: AgentConversationInput,
  ): Promise<{ imported: boolean; state: "active" | "deleted" | "invalid" }> {
    this.requireRootScope();
    const normalized = normalizeConversationInput(input);
    if (!normalized) return { imported: false, state: "invalid" };
    const existing = this.getConversationRow(normalized.id);
    if (existing) {
      return { imported: false, state: existing.deleted_at === 0 ? "active" : "deleted" };
    }
    this.writeConversation(normalized, 0);
    return { imported: true, state: "active" };
  }

  async syncLegacyConversationMetadata(input: AgentConversationInput, messageCount: number): Promise<void> {
    this.requireRootScope();
    const normalized = normalizeConversationInput({ ...input, messageCount });
    if (!normalized) return;
    const current = this.getConversationRow(normalized.id);
    if (!current || current.deleted_at !== 0 || normalized.updatedAt <= current.updated_at) return;
    this.writeConversation(normalized, 0);
  }

  async updateConversation(patch: AgentConversationPatch): Promise<AgentConversationMutationResult> {
    this.requireRootScope();
    const id = normalizeConversationId(patch.id);
    const current = id ? this.getConversationRow(id) : undefined;
    if (!current || current.deleted_at !== 0) return { ok: false, error: "conversation_not_found" };
    if (patch.expectedUpdatedAt > 0 && patch.expectedUpdatedAt !== current.updated_at) {
      return { ok: false, error: "conversation_conflict", current: conversationRowToSummary(current) };
    }

    const title = patch.title === undefined
      ? current.title
      : normalizeTitle(patch.title) || current.title;
    const routeId = patch.routeId === undefined
      ? current.route_id
      : boundedString(patch.routeId, 80) || "";
    const skillIds = patch.skillIds === undefined
      ? parseSkillIds(current.skill_ids)
      : normalizeSkillIds(patch.skillIds);
    const updatedAt = monotonicNow(current.updated_at);
    this.sql`
      UPDATE chatus_conversations
      SET title = ${title}, route_id = ${routeId}, skill_ids = ${JSON.stringify(skillIds)}, updated_at = ${updatedAt}
      WHERE id = ${id} AND deleted_at = 0
    `;
    const updated = this.getConversationRow(id);
    if (!updated) return { ok: false, error: "conversation_not_found" };
    return { ok: true, conversation: conversationRowToSummary(updated) };
  }

  async recordConversationActivity(activity: AgentConversationActivity): Promise<void> {
    this.requireRootScope();
    const id = normalizeConversationId(activity.id);
    if (!id) return;
    let current = this.getConversationRow(id);
    if (!current) {
      const created = await this.createConversation({
        id,
        title: normalizeTitle(activity.titleCandidate) || DEFAULT_CONVERSATION_TITLE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        summary: "",
        pinned: false,
        routeId: activity.routeId,
        skillIds: normalizeSkillIds(activity.skillIds),
      });
      if (!created.ok) return;
      current = this.getConversationRow(id);
    }
    if (!current || current.deleted_at !== 0) return;
    const candidate = normalizeTitle(activity.titleCandidate);
    const title = isDefaultConversationTitle(current.title) && candidate ? candidate : current.title;
    const routeId = boundedString(activity.routeId, 80) || current.route_id;
    const skillIds = activity.skillIds === undefined
      ? parseSkillIds(current.skill_ids)
      : normalizeSkillIds(activity.skillIds);
    this.sql`
      UPDATE chatus_conversations
      SET title = ${title}, route_id = ${routeId}, skill_ids = ${JSON.stringify(skillIds)},
        message_count = ${Math.max(0, Math.floor(activity.messageCount))}, updated_at = ${monotonicNow(current.updated_at)}
      WHERE id = ${id} AND deleted_at = 0
    `;
  }

  async deleteConversation(idValue: string, expectedUpdatedAt: number): Promise<AgentConversationMutationResult> {
    this.requireRootScope();
    const id = normalizeConversationId(idValue);
    const current = id ? this.getConversationRow(id) : undefined;
    if (!current) return { ok: false, error: "conversation_not_found" };
    if (current.deleted_at !== 0) return { ok: false, error: "conversation_deleted" };
    if (expectedUpdatedAt > 0 && expectedUpdatedAt !== current.updated_at) {
      return { ok: false, error: "conversation_conflict", current: conversationRowToSummary(current) };
    }
    const deletedAt = monotonicNow(current.updated_at);
    this.sql`
      UPDATE chatus_conversations SET deleted_at = ${deletedAt}, updated_at = ${deletedAt}
      WHERE id = ${id}
    `;
    this.queueConversationCleanupRecord(id, deletedAt);
    return { ok: true, conversation: { ...conversationRowToSummary(current), updatedAt: deletedAt }, deleted: true };
  }

  async listPendingConversationCleanups(limitValue = 3): Promise<AgentConversationCleanupRecord[]> {
    this.requireRootScope();
    const limit = Math.max(1, Math.min(10, Math.floor(limitValue) || 3));
    return this.sql<ConversationCleanupRow>`
      SELECT chat_id, requested_at, attempts, last_attempt_at
      FROM chatus_conversation_cleanup
      ORDER BY last_attempt_at ASC, requested_at ASC
      LIMIT ${limit}
    `.map((row) => ({
      chatId: row.chat_id,
      requestedAt: row.requested_at,
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at,
    }));
  }

  async recordConversationCleanupFailure(idValue: string): Promise<void> {
    this.requireRootScope();
    const id = normalizeConversationId(idValue);
    if (!id) return;
    this.sql`
      UPDATE chatus_conversation_cleanup
      SET attempts = attempts + 1, last_attempt_at = ${Date.now()}
      WHERE chat_id = ${id}
    `;
  }

  async completeConversationCleanup(idValue: string): Promise<void> {
    this.requireRootScope();
    const id = normalizeConversationId(idValue);
    if (!id) return;
    this.sql`DELETE FROM chatus_conversation_cleanup WHERE chat_id = ${id}`;
  }

  async getAllConversationIds(): Promise<string[]> {
    this.requireRootScope();
    return this.sql<{ id: string }>`SELECT id FROM chatus_conversations`.map((row) => row.id);
  }

  async purgeRootData(): Promise<{ conversationIds: string[] }> {
    this.requireRootScope();
    const conversationIds = await this.getAllConversationIds();
    this.clearPersistedChatState();
    this.sql`DELETE FROM chatus_conversations`;
    this.sql`DELETE FROM chatus_conversation_cleanup`;
    this.sql`DELETE FROM chatus_conversation_branches`;
    this.sql`DELETE FROM chatus_memory`;
    this.sql`DELETE FROM chatus_migrations`;
    this.sql`DELETE FROM capability_tool_trust`;
    await this.ctx.storage.delete(AGENT_IDENTITY_STORAGE_KEY);
    return { conversationIds };
  }

  async getMemory(): Promise<AgentMemoryRecord> {
    this.requireRootScope();
    const row = this.sql<{ content: string; updated_at: number }>`
      SELECT content, updated_at FROM chatus_memory WHERE singleton = 1 LIMIT 1
    `[0];
    const memory = row?.content || "";
    return {
      memory,
      revision: await contentFingerprint(memory),
      updatedAt: row?.updated_at || 0,
    };
  }

  async putMemory(memoryValue: string, expectedRevision?: string): Promise<AgentMemoryMutationResult> {
    this.requireRootScope();
    const current = await this.getMemory();
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      return { ok: false, error: "memory_conflict", current };
    }
    const maxChars = positiveNumber(this.env.MAX_MEMORY_CHARS, 4_000);
    const memory = typeof memoryValue === "string" ? memoryValue.trim().slice(0, maxChars) : "";
    const updatedAt = monotonicNow(current.updatedAt);
    this.sql`
      INSERT INTO chatus_memory(singleton, content, updated_at)
      VALUES (1, ${memory}, ${updatedAt})
      ON CONFLICT(singleton) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `;
    return { ok: true, record: { memory, revision: await contentFingerprint(memory), updatedAt } };
  }

  async importLegacyMemory(memoryValue: string): Promise<{ imported: boolean }> {
    this.requireRootScope();
    const existing = this.sql<{ present: number }>`SELECT 1 AS present FROM chatus_memory WHERE singleton = 1 LIMIT 1`;
    if (existing.length) return { imported: false };
    const maxChars = positiveNumber(this.env.MAX_MEMORY_CHARS, 4_000);
    const memory = typeof memoryValue === "string" ? memoryValue.trim().slice(0, maxChars) : "";
    this.sql`INSERT INTO chatus_memory(singleton, content, updated_at) VALUES (1, ${memory}, ${Date.now()})`;
    return { imported: true };
  }

  async hasMigration(idValue: string): Promise<boolean> {
    this.requireRootScope();
    const id = boundedString(idValue, 120);
    if (!id) return false;
    return this.sql<{ present: number }>`
      SELECT 1 AS present FROM chatus_migrations WHERE id = ${id} LIMIT 1
    `.length > 0;
  }

  async completeMigration(idValue: string): Promise<void> {
    this.requireRootScope();
    const id = boundedString(idValue, 120);
    if (!id) return;
    this.sql`
      INSERT INTO chatus_migrations(id, completed_at) VALUES (${id}, ${Date.now()})
      ON CONFLICT(id) DO UPDATE SET completed_at = excluded.completed_at
    `;
  }

  async importLegacyMessages(messages: UIMessage[]): Promise<{ imported: boolean; messageCount: number }> {
    this.requireConversationScope();
    await this.waitUntilStable();
    if (this.messages.length) return { imported: false, messageCount: this.messages.length };
    const normalized = this.sanitizeImportedMessages(messages);
    if (normalized.length) await this.persistMessages(normalized);
    return { imported: normalized.length > 0, messageCount: normalized.length };
  }

  async syncLegacyMessages(messages: UIMessage[]): Promise<{ synced: boolean; messageCount: number }> {
    this.requireConversationScope();
    await this.waitUntilStable();
    const normalized = this.sanitizeImportedMessages(messages);
    if (this.messages.length > normalized.length) {
      return { synced: false, messageCount: this.messages.length };
    }
    for (let index = 0; index < this.messages.length; index += 1) {
      if (!sameUiMessage(this.messages[index], normalized[index])) {
        return { synced: false, messageCount: this.messages.length };
      }
    }
    if (normalized.length > this.messages.length) await this.persistMessages(normalized);
    return { synced: true, messageCount: normalized.length };
  }

  async copyConversationBranchTo(
    input: AgentConversationBranchCopyInput,
  ): Promise<AgentConversationBranchCopyResult> {
    this.requireConversationScope();
    const destinationId = normalizeConversationId(input.destinationId);
    const destinationInstance = boundedString(input.destinationInstance, 120);
    const requestId = normalizeBranchRequestId(input.requestId);
    const fingerprint = normalizeBranchFingerprint(input.fingerprint);
    if (!destinationId || !destinationInstance || !requestId || !fingerprint || destinationId === this.chatId) {
      return { ok: false, error: "branch_request_conflict" };
    }
    const snapshot = await this.buildConversationBranchSnapshot(input);
    if (!snapshot.ok) return snapshot;
    const props: TeamAgentProps = {
      userLabel: this.userLabel,
      scope: "conversation",
      chatId: destinationId,
      rootInstance: this.rootInstance,
      accessKind: this.accessKind,
      sessionExpiresAt: this.sessionExpiresAt,
      ...(this.accessKind === "guest" ? { sourceKey: this.sourceKey } : {}),
    };
    const destination = await getAgentByName(this.env.TEAM_AGENT, destinationInstance, { props });
    const identity = await destination.ensureIdentity(props);
    if (!identity.ok) return { ok: false, error: "branch_request_conflict" };
    const started = await destination.startConversationBranch({
      requestId,
      fingerprint,
      messages: snapshot.messages,
      launch: snapshot.launch,
      body: normalizeBranchBody(input.body),
      ...(snapshot.anchorMessageId ? { anchorMessageId: snapshot.anchorMessageId } : {}),
    });
    if (!started.ok) return { ok: false, error: started.error };
    return {
      ok: true,
      launch: snapshot.launch,
      ...(snapshot.anchorMessageId ? { anchorMessageId: snapshot.anchorMessageId } : {}),
      messageCount: snapshot.messages.length,
    };
  }

  private async buildConversationBranchSnapshot(
    input: AgentConversationBranchSnapshotInput,
  ): Promise<AgentConversationBranchSnapshotResult> {
    this.requireConversationScope();
    const normalized = normalizeConversationBranchSnapshotInput(input);
    if (!normalized) return { ok: false, error: "branch_action_not_allowed" };
    if (!(await this.waitUntilStable()) || this.hasPendingInteraction()) {
      return { ok: false, error: "conversation_busy" };
    }
    if (this.messages.length !== normalized.sourceMessageCount) {
      return { ok: false, error: "conversation_conflict" };
    }
    const sourceIndex = this.messages.findIndex((message) => message.id === normalized.sourceMessageId);
    if (sourceIndex < 0) return { ok: false, error: "message_not_found" };
    const source = this.messages[sourceIndex];
    const messages = this.messages.map((message) => this.sanitizeMessageForPersistence(message));

    if (normalized.action === "branch") {
      if (source.role === "system") return { ok: false, error: "branch_action_not_allowed" };
      return {
        ok: true,
        messages: messages.slice(0, sourceIndex + 1),
        launch: "none",
      };
    }
    if (normalized.action === "edit") {
      if (source.role !== "user") return { ok: false, error: "branch_action_not_allowed" };
      if (!normalized.editedText) return { ok: false, error: "edited_text_required" };
      const attachments = source.parts.filter((part) => part.type === "file");
      return {
        ok: true,
        messages: [
          ...messages.slice(0, sourceIndex),
          {
            id: normalized.replacementMessageId,
            role: "user",
            parts: [{ type: "text", text: normalized.editedText }, ...attachments],
          },
        ],
        launch: "respond",
        anchorMessageId: normalized.replacementMessageId,
      };
    }
    if (normalized.action === "resend") {
      if (source.role !== "user") return { ok: false, error: "branch_action_not_allowed" };
      return {
        ok: true,
        messages: messages.slice(0, sourceIndex + 1),
        launch: "respond",
        anchorMessageId: source.id,
      };
    }
    if (normalized.action === "regenerate") {
      if (source.role !== "assistant") return { ok: false, error: "branch_action_not_allowed" };
      const userIndex = findPreviousUserMessageIndex(messages, sourceIndex);
      if (userIndex < 0) return { ok: false, error: "branch_action_not_allowed" };
      return {
        ok: true,
        messages: messages.slice(0, userIndex + 1),
        launch: "respond",
        anchorMessageId: messages[userIndex].id,
      };
    }
    if (source.role !== "assistant") return { ok: false, error: "branch_action_not_allowed" };
    return {
      ok: true,
      messages: messages.slice(0, sourceIndex + 1),
      launch: "continue",
      anchorMessageId: source.id,
    };
  }

  async startConversationBranch(
    input: AgentConversationBranchStartInput,
  ): Promise<AgentConversationBranchStartResult> {
    this.requireConversationScope();
    const normalized = normalizeConversationBranchStartInput(input);
    if (!normalized) return { ok: false, error: "branch_request_conflict" };
    const existing = this.getConversationBranchLaunchRow(normalized.requestId);
    if (existing) {
      if (existing.fingerprint !== normalized.fingerprint) return { ok: false, error: "branch_request_conflict" };
      return { ok: true, started: false, state: existing.state === "ready" ? "ready" : "already_started" };
    }
    if (!(await this.waitUntilStable()) || this.hasPendingInteraction()) {
      return { ok: false, error: "conversation_busy" };
    }
    const messages = normalized.messages.map((message) => this.sanitizeMessageForPersistence(message));
    if (!sameUiMessageList(this.messages, messages)) {
      if (this.messages.length) return { ok: false, error: "branch_copy_conflict" };
      await this.persistMessages(messages);
    }
    const now = Date.now();
    this.sql`
      INSERT INTO chatus_conversation_branch_launches(
        request_id, fingerprint, state, body_json, created_at, updated_at
      ) VALUES (
        ${normalized.requestId}, ${normalized.fingerprint},
        ${normalized.launch === "none" ? "ready" : "scheduled"},
        ${JSON.stringify(normalized.body)}, ${now}, ${now}
      )
    `;
    if (normalized.launch === "none") return { ok: true, started: false, state: "ready" };
    this.ctx.waitUntil(this.runConversationBranch(normalized.requestId, normalized.launch));
    return { ok: true, started: true, state: "scheduled" };
  }

  async clearConversation(): Promise<void> {
    this.requireConversationScope();
    this.clearPersistedChatState();
    await this.ctx.storage.delete(AGENT_IDENTITY_STORAGE_KEY);
  }

  async getConversationMessageCount(): Promise<number> {
    this.requireConversationScope();
    await this.waitUntilStable();
    return this.messages.length;
  }

  async exportMessages(maxBytes = 512_000): Promise<AgentExportMessagesResult> {
    this.requireConversationScope();
    await this.waitUntilStable();
    const byteLimit = Number.isFinite(maxBytes)
      ? Math.max(32_768, Math.min(Math.floor(maxBytes), 1_000_000))
      : 512_000;
    const source = this.messages.slice(-this.maxPersistedMessages);
    const messages: AgentExportMessage[] = [];
    let bytes = 2;
    let truncated = false;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const exported = exportMessage(source[index]);
      truncated ||= exported.truncated;
      const messageBytes = new TextEncoder().encode(JSON.stringify(exported.message)).byteLength;
      const separatorBytes = messages.length ? 1 : 0;
      if (bytes + separatorBytes + messageBytes > byteLimit) {
        truncated = true;
        break;
      }
      messages.unshift(exported.message);
      bytes += separatorBytes + messageBytes;
    }
    if (messages.length < source.length) truncated = true;
    return { messages, truncated };
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions,
  ): Promise<Response> {
    if (!this.userLabel || this.scope !== "conversation" || !this.chatId || !this.rootInstance) {
      return chatErrorResponse("agent_identity_unavailable", "Agent identity is unavailable.", 401);
    }

    const attachmentRejection = this.takePendingAttachmentValidationError();
    if (attachmentRejection) {
      const rejectedIds = new Set(attachmentRejection.messageIds);
      await this.persistMessages(
        this.messages.filter((message) => !rejectedIds.has(message.id)),
        [],
        { _deleteStaleRows: true },
      );
      return chatErrorResponse(
        attachmentRejection.error,
        attachmentValidationMessage(attachmentRejection.error),
        attachmentValidationStatus(attachmentRejection.error),
      );
    }

    const requestedBody = isRecord(options?.body) ? options.body : {};
    const body = Object.keys(requestedBody).length ? requestedBody : this.getPendingBranchBody();
    const now = Date.now();
    const session: Session = this.accessKind === "guest"
      ? {
          id: this.name,
          label: this.userLabel,
          kind: "guest",
          createdAt: now,
          lastSeen: now,
          expiresAt: this.sessionExpiresAt,
          sourceKey: this.sourceKey,
        }
      : {
          id: this.name,
          label: this.userLabel,
          kind: "member",
          createdAt: now,
          lastSeen: now,
          expiresAt: this.sessionExpiresAt,
        };
    let longTermMemory = "";
    let memoryRecord: AgentMemoryRecord | undefined;
    if (this.accessKind === "member") {
      try {
        const root = await this.getRootAgent();
        memoryRecord = await root.getMemory();
        longTermMemory = memoryRecord.memory;
      } catch {
        // Conversation execution remains available if the optional memory read is temporarily unavailable.
      }
    }
    const prepared = await prepareTeamAgentTurn(this.env, session, {
      messages: toLegacyMessages(this.messages),
      continuation: options?.continuation === true,
      routeId: boundedString(body.routeId, 80),
      skillIds: stringArray(body.skillIds, MAX_SELECTED_SKILLS, 80),
      userApiKey: boundedString(body.userApiKey, 8_192),
      sessionSummary: boundedString(body.sessionSummary, 1_200),
      temperature: finiteNumber(body.temperature),
      longTermMemory,
    });

    if (!prepared.ok) {
      return chatErrorResponse(prepared.error, prepared.message, prepared.status, prepared.routeId);
    }
    this.pendingActivity = { routeId: prepared.routeId, skillIds: prepared.skillIds };

    const tools = createAgentToolSet({
      definitions: prepared.toolDefinitions,
      conversationId: this.chatId,
      runTool: prepared.runTool,
      approvals: {
        isTrusted: (targetConversationId, toolId) => this.isToolTrusted(targetConversationId, toolId),
        markTrusted: (targetConversationId, toolId) => this.markToolTrusted(targetConversationId, toolId),
      },
      ...(prepared.memoryToolEnabled && memoryRecord
        ? {
            memory: {
              revision: memoryRecord.revision,
              maxChars: positiveNumber(this.env.MAX_MEMORY_CHARS, 4_000),
              update: async (memory: string, expectedRevision: string) => {
                const root = await this.getRootAgent();
                return root.putMemory(memory, expectedRevision);
              },
            },
          }
        : {}),
    });
    let messages: ModelMessage[] = prepared.messages;
    if (options?.continuation && Object.keys(tools).length) {
      try {
        messages = [
          ...prepared.systemMessages,
          ...(await convertToModelMessages(this.messages, { tools })),
        ];
      } catch {
        await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
        return chatErrorResponse("agent_context_invalid", "工具续接上下文无法恢复。", 409);
      }
    }

    let finalized = false;
    const finalize = async () => {
      if (finalized) return;
      finalized = true;
      await Promise.allSettled([prepared.closeTools(), prepared.releaseTurn()]);
    };

    try {
      const result = streamText({
        model: prepared.model,
        messages,
        tools,
        stopWhen: stepCountIs(prepared.maxToolSteps),
        maxRetries: 0,
        allowSystemInMessages: true,
        abortSignal: options?.abortSignal,
        onFinish: async (event) => {
          await finalize();
          await onFinish(event);
        },
        onAbort: finalize,
        onError: async () => {
          await finalize();
          await prepared.recordStreamFailure();
        },
      });

      return result.toUIMessageStreamResponse({
        originalMessages: this.messages,
        messageMetadata: ({ part }) => part.type === "finish" && part.finishReason === "length"
          ? { finishReason: "length" as const }
          : undefined,
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Remaining": String(prepared.remaining),
        },
        onError: () => "模型线路暂时不可用，请稍后重试。",
      });
    } catch (error) {
      await finalize();
      throw error;
    }
  }

  protected async onChatResponse(_result: ChatResponseResult): Promise<void> {
    if (this.scope !== "conversation" || !this.chatId || !this.rootInstance) return;
    const activity = this.pendingActivity;
    this.pendingActivity = undefined;
    try {
      const root = await this.getRootAgent();
      await root.recordConversationActivity({
        id: this.chatId,
        messageCount: this.messages.length,
        titleCandidate: deriveConversationTitle(this.messages),
        routeId: activity?.routeId,
        skillIds: activity?.skillIds,
      });
    } catch {
      // The transcript is authoritative; the root index can be repaired on the next request.
    }
  }

  private async getRootAgent() {
    const props: TeamAgentProps = {
      userLabel: this.userLabel,
      scope: "root",
      accessKind: this.accessKind,
      sessionExpiresAt: this.sessionExpiresAt,
      ...(this.accessKind === "guest" ? { sourceKey: this.sourceKey } : {}),
    };
    const root = await getAgentByName(this.env.TEAM_AGENT, this.rootInstance, { props });
    const identity = await root.ensureIdentity(props);
    if (!identity.ok) throw new Error(identity.error);
    return root;
  }

  private getConversationRow(id: string): ConversationRow | undefined {
    return this.sql<ConversationRow>`
      SELECT id, title, created_at, updated_at, summary, pinned, route_id,
        parent_chat_id, skill_ids, message_count, deleted_at
      FROM chatus_conversations WHERE id = ${id} LIMIT 1
    `[0];
  }

  private getConversationBranchRow(requestId: string): ConversationBranchRow | undefined {
    return this.sql<ConversationBranchRow>`
      SELECT request_id, fingerprint, source_chat_id, source_message_id, source_message_count, destination_id,
        launch, anchor_message_id, state
      FROM chatus_conversation_branches
      WHERE request_id = ${requestId}
      LIMIT 1
    `[0];
  }

  private conversationBranchOperation(row: ConversationBranchRow): AgentConversationBranchOperation | undefined {
    const launch = normalizeBranchLaunch(row.launch);
    const state = normalizeConversationBranchOperationState(row.state);
    const conversation = this.getConversationRow(row.destination_id);
    if (!launch || !state || !conversation || conversation.deleted_at !== 0) return undefined;
    return {
      requestId: row.request_id,
      sourceId: row.source_chat_id,
      sourceMessageId: row.source_message_id,
      sourceMessageCount: Math.max(0, Math.floor(row.source_message_count)),
      destinationId: row.destination_id,
      launch,
      ...(normalizeBranchMessageId(row.anchor_message_id) ? { anchorMessageId: row.anchor_message_id } : {}),
      state,
      conversation: conversationRowToSummary(conversation),
    };
  }

  private getConversationBranchLaunchRow(requestId: string): ConversationBranchLaunchRow | undefined {
    return this.sql<ConversationBranchLaunchRow>`
      SELECT request_id, fingerprint, state, body_json
      FROM chatus_conversation_branch_launches
      WHERE request_id = ${requestId}
      LIMIT 1
    `[0];
  }

  private getPendingBranchBody(): Record<string, unknown> {
    const row = this.sql<ConversationBranchLaunchRow>`
      SELECT request_id, fingerprint, state, body_json
      FROM chatus_conversation_branch_launches
      WHERE state = 'scheduled' OR state = 'running'
      ORDER BY updated_at DESC
      LIMIT 1
    `[0];
    if (!row) return {};
    try {
      return normalizeBranchBody(JSON.parse(row.body_json));
    } catch {
      return {};
    }
  }

  private async runConversationBranch(
    requestId: string,
    launch: Exclude<AgentConversationBranchLaunch, "none">,
  ): Promise<void> {
    const row = this.getConversationBranchLaunchRow(requestId);
    if (!row || row.state !== "scheduled") return;
    this.sql`
      UPDATE chatus_conversation_branch_launches
      SET state = 'running', updated_at = ${Date.now()}
      WHERE request_id = ${requestId} AND state = 'scheduled'
    `;
    const body = this.getPendingBranchBody();
    try {
      const result = launch === "continue"
        ? await this.continueLastTurn(body)
        : await this.saveMessages((messages) => [...messages]);
      this.sql`
        UPDATE chatus_conversation_branch_launches
        SET state = ${result.status === "completed" ? "completed" : "failed"}, updated_at = ${Date.now()}
        WHERE request_id = ${requestId}
      `;
    } catch {
      this.sql`
        UPDATE chatus_conversation_branch_launches
        SET state = 'failed', updated_at = ${Date.now()}
        WHERE request_id = ${requestId}
      `;
    }
  }

  private writeConversation(input: AgentConversationInput, deletedAt: number): void {
    this.sql`
      INSERT INTO chatus_conversations(
        id, title, created_at, updated_at, summary, pinned, route_id,
        parent_chat_id, skill_ids, message_count, deleted_at
      ) VALUES (
        ${input.id}, ${input.title}, ${input.createdAt}, ${input.updatedAt}, ${input.summary},
        ${input.pinned ? 1 : 0}, ${input.routeId || ""}, ${input.parentChatId || ""},
        ${JSON.stringify(normalizeSkillIds(input.skillIds))}, ${Math.max(0, Math.floor(input.messageCount || 0))}, ${deletedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        summary = excluded.summary,
        pinned = excluded.pinned,
        route_id = excluded.route_id,
        parent_chat_id = excluded.parent_chat_id,
        skill_ids = excluded.skill_ids,
        message_count = excluded.message_count,
        deleted_at = excluded.deleted_at
    `;
  }

  private queueConversationCleanupRecord(id: string, requestedAt: number): void {
    this.sql`
      INSERT INTO chatus_conversation_cleanup(chat_id, requested_at, attempts, last_attempt_at)
      VALUES (${id}, ${requestedAt}, 0, 0)
      ON CONFLICT(chat_id) DO UPDATE SET requested_at = MIN(requested_at, excluded.requested_at)
    `;
  }

  private clearPersistedChatState(): void {
    // AIChat persistMessages([]) reconciles with the current transcript, so deletion must use the SDK tables directly.
    this.resetTurnState();
    this.sql`DELETE FROM cf_ai_chat_agent_messages`;
    this.sql`DELETE FROM cf_ai_chat_stream_chunks`;
    this.sql`DELETE FROM cf_ai_chat_stream_metadata`;
    this.sql`DELETE FROM cf_ai_chat_request_context`;
    this.sql`DELETE FROM cf_ai_chat_agent_tool_milestones`;
    this.sql`DELETE FROM cf_ai_chat_agent_tool_runs`;
    this.sql`DELETE FROM capability_tool_trust`;
    this.sql`DELETE FROM chatus_conversation_branch_launches`;
    this.messages = [];
    this.pendingActivity = undefined;
  }

  private requireRootScope(): void {
    if (this.scope !== "root" || !this.userLabel) throw new Error("root_agent_scope_required");
  }

  private requireConversationScope(): void {
    if (this.scope !== "conversation" || !this.userLabel || !this.chatId) {
      throw new Error("conversation_agent_scope_required");
    }
  }

  private async initializeIdentity(props?: TeamAgentProps): Promise<void> {
    const storedValue = await this.ctx.storage.get<unknown>(AGENT_IDENTITY_STORAGE_KEY);
    const stored = storedValue === undefined ? undefined : normalizeStoredTeamAgentIdentity(storedValue);
    if (storedValue !== undefined && !stored) throw new Error("agent_identity_corrupt");

    const provided = props === undefined ? undefined : normalizeTeamAgentIdentity(props);
    const access = props === undefined ? undefined : normalizeTeamAgentAccess(props);
    if (props !== undefined && (!provided || !access)) throw new Error("agent_identity_unavailable");

    const active = this.currentIdentity();
    const existing = stored || active;
    if (provided && existing && !sameTeamAgentIdentity(provided, existing)) {
      throw new Error("agent_identity_conflict");
    }

    const identity = existing || provided;
    if (!identity) {
      this.userLabel = "";
      this.scope = "root";
      this.chatId = "";
      this.rootInstance = "";
      return;
    }
    if (!stored) await this.ctx.storage.put(AGENT_IDENTITY_STORAGE_KEY, identity);
    this.userLabel = identity.userLabel;
    this.scope = identity.scope;
    this.chatId = identity.chatId;
    this.rootInstance = identity.rootInstance;
    if (access) this.applyAccessContext(access);
    else if (identity.userLabel.startsWith("guest-")) this.applyAccessContext({ kind: "guest", expiresAt: 0, sourceKey: "" });
  }

  private applyAccessContext(access: TeamAgentAccessContext): void {
    this.accessKind = access.kind;
    this.sessionExpiresAt = access.expiresAt;
    this.sourceKey = access.sourceKey;
  }

  private currentIdentity(): TeamAgentIdentity | undefined {
    return normalizeTeamAgentIdentity({
      userLabel: this.userLabel,
      scope: this.scope,
      chatId: this.chatId,
      rootInstance: this.rootInstance,
    });
  }

  private isToolTrusted(conversationId: string, toolId: string): boolean {
    const rows = this.sql<{ trusted: number }>`
      SELECT 1 AS trusted
      FROM capability_tool_trust
      WHERE conversation_id = ${conversationId} AND tool_id = ${toolId}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  private markToolTrusted(conversationId: string, toolId: string): void {
    this.sql`
      INSERT INTO capability_tool_trust (conversation_id, tool_id, approved_at)
      VALUES (${conversationId}, ${toolId}, ${Date.now()})
      ON CONFLICT(conversation_id, tool_id)
      DO UPDATE SET approved_at = excluded.approved_at
    `;
  }

  protected sanitizeMessageForPersistence(message: UIMessage): UIMessage {
    const imageResult: SanitizedUserImageParts = message.role === "user"
      ? sanitizeUserImageParts(
          message.parts,
          imageInputPolicy(this.env),
          fileInputPolicy(this.env),
          this.accessKind === "member",
        )
      : { parts: message.parts };
    if (imageResult.error) this.pendingAttachmentValidationErrors.set(message.id, imageResult.error);
    return {
      ...message,
      metadata: normalizeAgentMessageMetadata(message.metadata),
      parts: imageResult.parts.map((part) => {
        if ("output" in part && typeof part.output === "string" && part.output.length > MAX_PERSISTED_TOOL_TEXT_CHARS) {
          return { ...part, output: `${part.output.slice(0, MAX_PERSISTED_TOOL_TEXT_CHARS)}\n[truncated]` };
        }
        if ("input" in part && typeof part.input === "string" && part.input.length > MAX_PERSISTED_TOOL_TEXT_CHARS) {
          return { ...part, input: `${part.input.slice(0, MAX_PERSISTED_TOOL_TEXT_CHARS)}\n[truncated]` };
        }
        return part;
      }),
    };
  }

  private sanitizeImportedMessages(messages: UIMessage[]): UIMessage[] {
    const normalized = messages
      .filter((message) => message && typeof message.id === "string" && Array.isArray(message.parts))
      .slice(-this.maxPersistedMessages)
      .map((message) => this.sanitizeMessageForPersistence(message));
    const rejectedIds = new Set(normalized
      .map((message) => message.id)
      .filter((id) => this.pendingAttachmentValidationErrors.has(id)));
    for (const id of rejectedIds) this.pendingAttachmentValidationErrors.delete(id);
    return normalized.filter((message) => !rejectedIds.has(message.id));
  }

  private takePendingAttachmentValidationError(): {
    messageIds: string[];
    error: AttachmentValidationErrorCode;
  } | null {
    const messageIds: string[] = [];
    let firstError: AttachmentValidationErrorCode | undefined;
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index];
      const error = this.pendingAttachmentValidationErrors.get(message.id);
      if (!error) continue;
      firstError ||= error;
      messageIds.push(message.id);
    }
    this.pendingAttachmentValidationErrors.clear();
    return firstError ? { messageIds, error: firstError } : null;
  }
}

type SanitizedUserImageParts = {
  parts: UIMessage["parts"];
  error?: AttachmentValidationErrorCode;
};

type AttachmentValidationErrorCode = ImageValidationErrorCode | FileValidationErrorCode;

export function sanitizeUserImageParts(
  parts: UIMessage["parts"],
  policy: ImageInputPolicy,
  filePolicy?: FileInputPolicy,
  fileInputEnabled = false,
): SanitizedUserImageParts {
  const fileParts = parts.filter((part) => part.type === "file");
  const reject = (error: AttachmentValidationErrorCode): SanitizedUserImageParts => ({
    parts: parts.filter((part) => part.type !== "file"),
    error,
  });

  const normalizedFiles: UIMessage["parts"] = [];
  let imageCount = 0;
  let totalImageBytes = 0;
  let textFileState = emptyTextFileValidationState();
  for (const part of fileParts) {
    const imageLike = isImageFilePart(part);
    if (imageLike) {
      if (imageCount >= policy.maxImages) return reject("too_many_images");
      const parsed = parseDataImage(part.url, part.mediaType);
      if (!parsed.ok) return reject(parsed.error);
      if (!policy.acceptedMediaTypes.includes(parsed.image.mediaType)) {
        return reject("invalid_image_type");
      }
      if (parsed.image.decodedBytes > policy.maxImageBytes) return reject("image_too_large");
      if (totalImageBytes + parsed.image.decodedBytes > policy.maxTotalImageBytes) {
        return reject("images_too_large");
      }
      imageCount += 1;
      totalImageBytes += parsed.image.decodedBytes;
      const filename = typeof part.filename === "string" ? boundedString(part.filename, 200) : "";
      normalizedFiles.push({
        ...part,
        mediaType: parsed.image.mediaType,
        url: `data:${parsed.image.mediaType};base64,${parsed.image.data}`,
        ...(filename ? { filename } : {}),
      });
      continue;
    }
    if (!filePolicy || !fileInputEnabled) return reject("file_not_supported");
    const parsedFile = parseDataTextFile(part.url, part.mediaType, part.filename, filePolicy, textFileState);
    if (!parsedFile.ok) return reject(parsedFile.error);
    textFileState = parsedFile.state;
    normalizedFiles.push({ type: "text", text: parsedFile.file.contextText });
  }

  let fileIndex = 0;
  return {
    parts: parts.map((part) => part.type === "file" ? normalizedFiles[fileIndex++] : part),
  };
}

function isImageFilePart(part: UIMessage["parts"][number]): boolean {
  if (part.type !== "file") return false;
  return (typeof part.mediaType === "string" && part.mediaType.trim().toLowerCase().startsWith("image/"))
    || (typeof part.url === "string" && /^data:image\//i.test(part.url));
}

function attachmentValidationMessage(error: AttachmentValidationErrorCode): string {
  if (error === "invalid_image_type") return "图片格式不受支持。";
  if (error === "invalid_image_data") return "图片数据无效。";
  if (error === "image_too_large") return "单张图片超过大小限制。";
  if (error === "too_many_images") return "图片数量超过限制。";
  if (error === "images_too_large") return "图片总大小超过限制。";
  if (error === "file_not_supported") return "当前会话不支持文件上传。";
  if (error === "invalid_file_type") return "文件格式不受支持。";
  if (error === "invalid_file_data") return "文件内容无法按 UTF-8 文本读取。";
  if (error === "file_too_large") return "单个文件超过大小限制。";
  if (error === "too_many_files") return "文件数量超过限制。";
  if (error === "files_too_large") return "文件总大小超过限制。";
  return "文件文本内容超过限制。";
}

function attachmentValidationStatus(error: AttachmentValidationErrorCode): 400 | 413 {
  return error === "image_too_large"
    || error === "images_too_large"
    || error === "file_too_large"
    || error === "files_too_large"
    || error === "file_text_too_large"
    ? 413
    : 400;
}

function normalizeConversationInput(input: AgentConversationInput): AgentConversationInput | null {
  const id = normalizeConversationId(input.id);
  if (!id) return null;
  const createdAt = finiteTimestamp(input.createdAt, Date.now());
  const updatedAt = Math.max(createdAt, finiteTimestamp(input.updatedAt, createdAt));
  return {
    id,
    title: normalizeTitle(input.title) || DEFAULT_CONVERSATION_TITLE,
    createdAt,
    updatedAt,
    summary: typeof input.summary === "string" ? input.summary.trim().slice(0, 1_200) : "",
    pinned: input.pinned === true,
    routeId: boundedString(input.routeId, 80),
    parentChatId: normalizeConversationId(input.parentChatId) || undefined,
    skillIds: normalizeSkillIds(input.skillIds),
    messageCount: Math.max(0, Math.floor(input.messageCount || 0)),
  };
}

function normalizeConversationBranchInput(
  input: AgentConversationBranchInput,
): AgentConversationBranchInput | null {
  const requestId = normalizeBranchRequestId(input.requestId);
  const fingerprint = normalizeBranchFingerprint(input.fingerprint);
  const sourceId = normalizeConversationId(input.sourceId);
  const sourceMessageId = normalizeBranchMessageId(input.sourceMessageId);
  const destinationId = normalizeConversationId(input.destinationId);
  const action = normalizeBranchAction(input.action);
  const launch = normalizeBranchLaunch(input.launch);
  const expectedLaunch = action === "branch" ? "none" : action === "continue" ? "continue" : "respond";
  const expectedUpdatedAt = finiteTimestamp(input.expectedUpdatedAt, 0);
  const sourceMessageCount = Number.isSafeInteger(input.sourceMessageCount) && input.sourceMessageCount > 0
    ? input.sourceMessageCount
    : 0;
  if (
    !requestId
    || !fingerprint
    || !sourceId
    || !sourceMessageId
    || !destinationId
    || sourceId === destinationId
    || !action
    || launch !== expectedLaunch
    || !expectedUpdatedAt
    || !sourceMessageCount
  ) return null;
  return {
    requestId,
    fingerprint,
    sourceId,
    sourceMessageId,
    sourceMessageCount,
    action,
    expectedUpdatedAt,
    destinationId,
    title: normalizeTitle(input.title) || DEFAULT_CONVERSATION_TITLE,
    routeId: boundedString(input.routeId, 80),
    skillIds: normalizeSkillIds(input.skillIds),
    launch,
  };
}

function normalizeConversationBranchSnapshotInput(
  input: AgentConversationBranchSnapshotInput,
): AgentConversationBranchSnapshotInput | null {
  const sourceMessageId = normalizeBranchMessageId(input.sourceMessageId);
  const replacementMessageId = normalizeBranchMessageId(input.replacementMessageId);
  const action = normalizeBranchAction(input.action);
  const sourceMessageCount = Number.isSafeInteger(input.sourceMessageCount) && input.sourceMessageCount > 0
    ? input.sourceMessageCount
    : 0;
  const editedText = typeof input.editedText === "string" && input.editedText.trim()
    ? input.editedText.slice(0, MAX_EXPORT_MESSAGE_TEXT_CHARS)
    : undefined;
  if (!sourceMessageId || !replacementMessageId || !action || !sourceMessageCount) return null;
  if (action === "edit" && !editedText) return null;
  return {
    sourceMessageId,
    sourceMessageCount,
    replacementMessageId,
    action,
    ...(editedText ? { editedText } : {}),
  };
}

function normalizeConversationBranchStartInput(
  input: AgentConversationBranchStartInput,
): AgentConversationBranchStartInput | null {
  const requestId = normalizeBranchRequestId(input.requestId);
  const fingerprint = normalizeBranchFingerprint(input.fingerprint);
  const launch = normalizeBranchLaunch(input.launch);
  const anchorMessageId = normalizeBranchMessageId(input.anchorMessageId);
  if (!requestId || !fingerprint || !launch || !Array.isArray(input.messages) || !input.messages.length) return null;
  if (input.messages.length > 200 || input.messages.some((message) => (
    !message
    || !normalizeBranchMessageId(message.id)
    || (message.role !== "user" && message.role !== "assistant" && message.role !== "system")
    || !Array.isArray(message.parts)
  ))) return null;
  const last = input.messages[input.messages.length - 1];
  if (launch === "respond" && (!anchorMessageId || last.id !== anchorMessageId || last.role !== "user")) return null;
  if (launch === "continue" && (!anchorMessageId || last.id !== anchorMessageId || last.role !== "assistant")) return null;
  return {
    requestId,
    fingerprint,
    messages: input.messages,
    launch,
    body: normalizeBranchBody(input.body),
    ...(anchorMessageId ? { anchorMessageId } : {}),
  };
}

function normalizeBranchRequestId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : "";
}

function normalizeBranchFingerprint(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : "";
}

function normalizeBranchMessageId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) return "";
  return normalized;
}

function normalizeBranchAction(
  value: unknown,
): AgentConversationBranchInput["action"] | undefined {
  return value === "branch"
    || value === "edit"
    || value === "resend"
    || value === "regenerate"
    || value === "continue"
    ? value
    : undefined;
}

function normalizeBranchLaunch(value: unknown): AgentConversationBranchLaunch | undefined {
  return value === "none" || value === "respond" || value === "continue" ? value : undefined;
}

function normalizeBranchState(value: unknown): "ready" | "launched" | "failed" | undefined {
  return value === "ready" || value === "launched" || value === "failed" ? value : undefined;
}

function normalizeConversationBranchOperationState(
  value: unknown,
): AgentConversationBranchOperation["state"] | undefined {
  return value === "reserved" || value === "ready" || value === "launched" || value === "failed"
    ? value
    : undefined;
}

function normalizeBranchBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const routeId = boundedString(value.routeId, 80);
  const skillIds = normalizeSkillIds(value.skillIds);
  return {
    ...(routeId ? { routeId } : {}),
    skillIds,
  };
}

function normalizeAgentMessageMetadata(value: unknown): { finishReason: "length" } | undefined {
  return isRecord(value) && value.finishReason === "length" ? { finishReason: "length" } : undefined;
}

function findPreviousUserMessageIndex(messages: UIMessage[], beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function conversationRowToSummary(row: ConversationRow): AgentConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: row.summary,
    pinned: row.pinned === 1,
    routeId: row.route_id || undefined,
    parentChatId: row.parent_chat_id || undefined,
    skillIds: parseSkillIds(row.skill_ids),
    messageCount: Math.max(0, row.message_count),
  };
}

function exportMessage(message: UIMessage): { message: AgentExportMessage; truncated: boolean } {
  const parts: AgentExportPart[] = [];
  let truncated = message.parts.length > MAX_EXPORT_MESSAGE_PARTS;
  let remainingTextChars = MAX_EXPORT_MESSAGE_TEXT_CHARS;
  for (const part of message.parts.slice(0, MAX_EXPORT_MESSAGE_PARTS)) {
    if (part.type === "text" && typeof part.text === "string") {
      if (remainingTextChars <= 0) {
        truncated = true;
        continue;
      }
      const text = part.text.slice(0, remainingTextChars);
      if (text.length < part.text.length) truncated = true;
      remainingTextChars -= text.length;
      parts.push({
        type: "text",
        text: text.length < part.text.length ? `${text}\n[truncated]` : text,
      });
      continue;
    }
    if (part.type === "file" && typeof part.mediaType === "string") {
      const name = typeof part.filename === "string" ? boundedString(part.filename, 200) : "";
      parts.push({
        type: "file",
        mediaType: boundedString(part.mediaType, 120) || "application/octet-stream",
        ...(name ? { name } : {}),
      });
    }
  }
  return {
    message: {
      id: boundedString(message.id, 160) || "message",
      role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
      parts,
    },
    truncated,
  };
}

function toLegacyMessages(messages: UIMessage[]): ChatMessage[] {
  const output: ChatMessage[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user";
    const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) {
        parts.push({ type: "text", text: part.text });
      }
      if (part.type === "file") {
        const parsed = parseDataImage(part.url, part.mediaType);
        if (parsed.ok) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${parsed.image.mediaType};base64,${parsed.image.data}` },
          });
        }
      }
    }
    if (!parts.length) continue;
    output.push({
      role,
      content: parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts,
    });
  }
  return output;
}

function deriveConversationTitle(messages: UIMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.slice(0, 60);
  }
  return undefined;
}

function normalizeUserLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function normalizeConversationId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) return "";
  return normalized;
}

function normalizeTeamAgentAccess(value: unknown): TeamAgentAccessContext | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.accessKind === undefined || value.accessKind === "member"
    ? "member"
    : value.accessKind === "guest" ? "guest" : undefined;
  if (!kind) return undefined;
  const expiresAt = typeof value.sessionExpiresAt === "number" && Number.isFinite(value.sessionExpiresAt)
    ? value.sessionExpiresAt
    : kind === "member" ? Number.MAX_SAFE_INTEGER : 0;
  const sourceKey = typeof value.sourceKey === "string" ? value.sourceKey : "";
  if (kind === "guest" && (expiresAt <= 0 || !/^guest-source:[0-9a-f]{64}$/.test(sourceKey))) return undefined;
  return { kind, expiresAt, sourceKey: kind === "guest" ? sourceKey : "" };
}

function normalizeTeamAgentIdentity(value: unknown): TeamAgentIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const userLabel = normalizeUserLabel(value.userLabel);
  const scope = value.scope === "root" || value.scope === "conversation" ? value.scope : undefined;
  if (!userLabel || !scope) return undefined;
  const chatId = scope === "conversation" ? normalizeConversationId(value.chatId) : "";
  const rootInstance = scope === "conversation" ? boundedString(value.rootInstance, 120) || "" : "";
  if (scope === "conversation" && (!chatId || !rootInstance)) return undefined;
  return { version: 1, userLabel, scope, chatId, rootInstance };
}

function normalizeStoredTeamAgentIdentity(value: unknown): TeamAgentIdentity | undefined {
  return isRecord(value) && value.version === 1 ? normalizeTeamAgentIdentity(value) : undefined;
}

function sameTeamAgentIdentity(left: TeamAgentIdentity, right: TeamAgentIdentity): boolean {
  return left.userLabel === right.userLabel
    && left.scope === right.scope
    && left.chatId === right.chatId
    && left.rootInstance === right.rootInstance;
}

function isTeamAgentIdentityError(
  value: string,
): value is TeamAgentIdentityError {
  return value === "agent_identity_unavailable"
    || value === "agent_identity_conflict"
    || value === "agent_identity_corrupt";
}

function normalizeTitle(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_CONVERSATION_TITLE_CHARS) : "";
}

function isDefaultConversationTitle(value: string): boolean {
  return !value.trim() || value === DEFAULT_CONVERSATION_TITLE || value === "工作对话";
}

function normalizeSkillIds(value: unknown): string[] {
  return stringArray(value, MAX_SELECTED_SKILLS, 80);
}

function parseSkillIds(value: string): string[] {
  try {
    return normalizeSkillIds(JSON.parse(value));
  } catch {
    return [];
  }
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function stringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxChars))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function monotonicNow(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function sameUiMessage(left: UIMessage | undefined, right: UIMessage | undefined): boolean {
  return Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));
}

function sameUiMessageList(left: UIMessage[], right: UIMessage[]): boolean {
  return left.length === right.length && left.every((message, index) => sameUiMessage(message, right[index]));
}

async function contentFingerprint(value: string): Promise<string> {
  if (!value) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function chatErrorResponse(error: string, message: string, status: number, routeId?: string): Response {
  const errorText = JSON.stringify({ error, message, ...(routeId ? { routeId } : {}) });
  const body = `data: ${JSON.stringify({ type: "error", errorText })}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
