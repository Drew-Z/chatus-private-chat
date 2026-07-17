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
  type AgentConversationCleanupRecord,
  type AgentConversationActivity,
  type AgentConversationInput,
  type AgentConversationMutationResult,
  type AgentConversationPatch,
  type AgentConversationSummary,
  type AgentMemoryMutationResult,
  type AgentMemoryRecord,
  type TeamAgentProps,
  type TeamAgentScope,
  type TeamAgentState,
} from "../contracts/agent";
import type { ChatMessage } from "../contracts/chat";
import type { Session } from "../contracts/session";
import { createAgentToolSet } from "../services/agent-tools";
import {
  prepareTeamAgentTurn,
  type Env,
} from "../worker";

const MAX_PERSISTED_TOOL_TEXT_CHARS = 4_000;
const MAX_CONVERSATION_TITLE_CHARS = 80;
const MAX_SELECTED_SKILLS = 3;
const DEFAULT_CONVERSATION_TITLE = "新对话";

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
  private pendingActivity?: PendingConversationActivity;

  async onStart(props?: TeamAgentProps): Promise<void> {
    await super.onStart(props);
    this.userLabel = normalizeUserLabel(props?.userLabel);
    this.scope = props?.scope === "conversation" ? "conversation" : "root";
    this.chatId = normalizeConversationId(props?.chatId);
    this.rootInstance = boundedString(props?.rootInstance, 120) || "";
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
    this.sql`DELETE FROM chatus_memory`;
    this.sql`DELETE FROM chatus_migrations`;
    this.sql`DELETE FROM capability_tool_trust`;
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
    const normalized = messages
      .filter((message) => message && typeof message.id === "string" && Array.isArray(message.parts))
      .slice(-this.maxPersistedMessages)
      .map((message) => this.sanitizeMessageForPersistence(message));
    if (normalized.length) await this.persistMessages(normalized);
    return { imported: normalized.length > 0, messageCount: normalized.length };
  }

  async syncLegacyMessages(messages: UIMessage[]): Promise<{ synced: boolean; messageCount: number }> {
    this.requireConversationScope();
    await this.waitUntilStable();
    const normalized = messages
      .filter((message) => message && typeof message.id === "string" && Array.isArray(message.parts))
      .slice(-this.maxPersistedMessages)
      .map((message) => this.sanitizeMessageForPersistence(message));
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

  async clearConversation(): Promise<void> {
    this.requireConversationScope();
    this.clearPersistedChatState();
  }

  async getConversationMessageCount(): Promise<number> {
    this.requireConversationScope();
    await this.waitUntilStable();
    return this.messages.length;
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions,
  ): Promise<Response> {
    if (!this.userLabel || this.scope !== "conversation" || !this.chatId || !this.rootInstance) {
      return jsonError("agent_identity_unavailable", "Agent identity is unavailable.", 401);
    }

    const body = isRecord(options?.body) ? options.body : {};
    const now = Date.now();
    const session: Session = {
      id: this.name,
      label: this.userLabel,
      createdAt: now,
      lastSeen: now,
    };
    let longTermMemory = "";
    try {
      const root = await this.getRootAgent();
      longTermMemory = (await root.getMemory()).memory;
    } catch {
      // Conversation execution remains available if the optional memory read is temporarily unavailable.
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
      return jsonError(prepared.error, prepared.message, prepared.status, prepared.routeId);
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
    });
    let messages: ModelMessage[] = prepared.messages;
    if (options?.continuation && prepared.toolDefinitions.length) {
      try {
        messages = [
          ...prepared.systemMessages,
          ...(await convertToModelMessages(this.messages, { tools })),
        ];
      } catch {
        await prepared.closeTools();
        return jsonError("agent_context_invalid", "工具续接上下文无法恢复。", 409);
      }
    }

    let finalized = false;
    const finalize = async () => {
      if (finalized) return;
      finalized = true;
      await prepared.closeTools();
    };

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
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Remaining": String(prepared.remaining),
      },
      onError: () => "模型线路暂时不可用，请稍后重试。",
    });
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
    const props: TeamAgentProps = { userLabel: this.userLabel, scope: "root" };
    return getAgentByName(this.env.TEAM_AGENT, this.rootInstance, { props });
  }

  private getConversationRow(id: string): ConversationRow | undefined {
    return this.sql<ConversationRow>`
      SELECT id, title, created_at, updated_at, summary, pinned, route_id,
        parent_chat_id, skill_ids, message_count, deleted_at
      FROM chatus_conversations WHERE id = ${id} LIMIT 1
    `[0];
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
    return {
      ...message,
      metadata: undefined,
      parts: message.parts.map((part) => {
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

function toLegacyMessages(messages: UIMessage[]): ChatMessage[] {
  const output: ChatMessage[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user";
    const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) {
        parts.push({ type: "text", text: part.text });
      }
      if (
        part.type === "file" &&
        typeof part.mediaType === "string" &&
        part.mediaType.startsWith("image/") &&
        typeof part.url === "string" &&
        part.url.startsWith("data:image/")
      ) {
        parts.push({ type: "image_url", image_url: { url: part.url } });
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

async function contentFingerprint(value: string): Promise<string> {
  if (!value) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonError(error: string, message: string, status: number, routeId?: string): Response {
  return new Response(JSON.stringify({ error, message, ...(routeId ? { routeId } : {}) }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
