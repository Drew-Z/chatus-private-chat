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
  type AgentMessageMetadata,
  type AgentSkillSelectionMetadata,
  type ConversationSkillMode,
  type TeamAgentIdentityError,
  type TeamAgentIdentityResult,
  type TeamAgentProps,
  type TeamAgentScope,
  type TeamAgentState,
} from "../contracts/agent";
import {
  projectAgentStreamError,
  serializeAgentErrorEnvelope,
} from "../contracts/agent-error";
import type { ChatMessage } from "../contracts/chat";
import {
  parseDataImage,
  type ImageInputPolicy,
  type ImageValidationErrorCode,
} from "../contracts/image";
import {
  emptyTextFileValidationState,
  formatAttachedFileContext,
  parseDataTextFile,
  type FileInputPolicy,
  type FileValidationErrorCode,
} from "../contracts/file";
import {
  DOCUMENT_INGEST_LEASE_MS,
  MAX_WORKSPACE_FILES_PER_CONVERSATION,
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_MEMBER_BYTES,
  MAX_WORKSPACE_LIST_LIMIT,
  type WorkspaceAccountPurgeReservation,
  type WorkspaceAccountPurgeReservationResult,
  type WorkspaceConversationFileRef,
  type WorkspaceDeleteReservationResult,
  type WorkspaceFileListResult,
  type WorkspaceFileProjection,
  type WorkspaceFileVersionProjection,
  type WorkspaceFileVersionListResult,
  type WorkspaceMutationResult,
  type WorkspacePendingOperation,
  type WorkspaceResolvedFileVersion,
  type WorkspaceUploadReservation,
  type WorkspaceUploadReservationInput,
  type WorkspaceUploadReservationResult,
  type DocumentIngestArtifact,
  type DocumentIngestBeginResult,
  type DocumentIngestMessage,
  type DocumentIngestRetryResult,
  type DocumentIngestStatus,
  normalizeWorkspaceChecksum,
  normalizeWorkspaceEntityId,
  normalizeWorkspaceMediaType,
  normalizeWorkspaceOperationId,
  normalizeWorkspacePath,
  normalizeWorkspaceSearchQuery,
  workspaceExtractedObjectKey,
} from "../contracts/workspace-file";
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
  skill_mode: string;
  skill_ids: string;
  message_count: number;
  deleted_at: number;
};

type PendingConversationActivity = {
  routeId?: string;
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

type WorkspaceFileRow = {
  id: string;
  path: string;
  path_key: string;
  name: string;
  current_version_id: string;
  pinned: number;
  state: string;
  generation: number;
  created_at: number;
  updated_at: number;
  deleted_at: number;
};

type WorkspaceFileVersionRow = {
  id: string;
  file_id: string;
  object_key: string;
  size: number;
  media_type: string;
  checksum: string;
  state: string;
  generation: number;
  error: string;
  ingest_status: string;
  ingest_generation: number;
  ingest_attempts: number;
  ingest_error: string;
  extracted_object_key: string;
  extracted_checksum: string;
  extracted_bytes: number;
  extracted_chars: number;
  created_at: number;
  updated_at: number;
};

type WorkspaceFileOperationRow = {
  id: string;
  kind: string;
  file_id: string;
  version_id: string;
  generation: number;
  state: string;
  fingerprint: string;
  object_keys_json: string;
  size: number;
  checksum: string;
  attempts: number;
  last_error: string;
  created_at: number;
  updated_at: number;
};

type WorkspaceConversationRefRow = {
  conversation_id: string;
  file_id: string;
  version_id: string;
  path: string;
  name: string;
  size: number;
  media_type: string;
  checksum: string;
  object_key: string;
  generation: number;
  ingest_status: string;
  ingest_generation: number;
  ingest_attempts: number;
  ingest_error: string;
  extracted_object_key: string;
  extracted_checksum: string;
  extracted_bytes: number;
  extracted_chars: number;
};

type WorkspaceCursor = { pinned: number; updatedAt: number; id: string };

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
    this.applySchemaMigrations();
  }

  private applySchemaMigrations(): void {
    this.ctx.storage.transactionSync(() => {
      this.sql`
        CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
          id INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        )
      `;
      const version = this.sql<{ version: number }>`
        SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations
      `[0]?.version || 0;
      if (version < 1) {
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
        this.sql`INSERT INTO _sql_schema_migrations(id, applied_at) VALUES (1, ${Date.now()})`;
      }
      if (version < 2) {
        this.sql`
          CREATE TABLE IF NOT EXISTS workspace_files (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            path_key TEXT NOT NULL,
            name TEXT NOT NULL,
            current_version_id TEXT NOT NULL DEFAULT '',
            pinned INTEGER NOT NULL DEFAULT 0,
            state TEXT NOT NULL,
            generation INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER NOT NULL DEFAULT 0
          )
        `;
        this.sql`
          CREATE UNIQUE INDEX IF NOT EXISTS workspace_files_active_path_key
          ON workspace_files(path_key) WHERE deleted_at = 0
        `;
        this.sql`
          CREATE INDEX IF NOT EXISTS workspace_files_list_order
          ON workspace_files(pinned DESC, updated_at DESC, id DESC)
        `;
        this.sql`
          CREATE TABLE IF NOT EXISTS workspace_file_versions (
            id TEXT PRIMARY KEY,
            file_id TEXT NOT NULL,
            object_key TEXT NOT NULL UNIQUE,
            size INTEGER NOT NULL,
            media_type TEXT NOT NULL,
            checksum TEXT NOT NULL,
            state TEXT NOT NULL,
            generation INTEGER NOT NULL,
            error TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `;
        this.sql`CREATE INDEX IF NOT EXISTS workspace_file_versions_file ON workspace_file_versions(file_id, created_at DESC)`;
        this.sql`
          CREATE TABLE IF NOT EXISTS conversation_file_refs (
            conversation_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            version_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (conversation_id, file_id)
          )
        `;
        this.sql`CREATE INDEX IF NOT EXISTS conversation_file_refs_version ON conversation_file_refs(version_id)`;
        this.sql`
          CREATE TABLE IF NOT EXISTS workspace_file_operations (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            file_id TEXT NOT NULL DEFAULT '',
            version_id TEXT NOT NULL DEFAULT '',
            generation INTEGER NOT NULL,
            state TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            object_keys_json TEXT NOT NULL DEFAULT '[]',
            size INTEGER NOT NULL DEFAULT 0,
            checksum TEXT NOT NULL DEFAULT '',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `;
        this.sql`CREATE INDEX IF NOT EXISTS workspace_file_operations_pending ON workspace_file_operations(state, updated_at)`;
        this.sql`CREATE INDEX IF NOT EXISTS workspace_file_operations_file ON workspace_file_operations(file_id, created_at DESC)`;
        this.sql`INSERT INTO _sql_schema_migrations(id, applied_at) VALUES (2, ${Date.now()})`;
      }
      if (version < 3) {
        this.sql`ALTER TABLE workspace_file_versions ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'failed'`;
        this.sql`ALTER TABLE workspace_file_versions ADD COLUMN ingest_generation INTEGER NOT NULL DEFAULT 1`;
        this.sql`ALTER TABLE workspace_file_versions ADD COLUMN ingest_attempts INTEGER NOT NULL DEFAULT 0`;
        this.sql`ALTER TABLE workspace_file_versions ADD COLUMN ingest_error TEXT NOT NULL DEFAULT 'document_ingest_migration_required'`;
        this.sql`ALTER TABLE workspace_file_versions ADD COLUMN extracted_object_key TEXT NOT NULL DEFAULT ''`;
        this.sql`ALTER TABLE workspace_file_versions ADD COLUMN extracted_checksum TEXT NOT NULL DEFAULT ''`;
        this.sql`ALTER TABLE workspace_file_versions ADD COLUMN extracted_bytes INTEGER NOT NULL DEFAULT 0`;
        this.sql`ALTER TABLE workspace_file_versions ADD COLUMN extracted_chars INTEGER NOT NULL DEFAULT 0`;
        this.sql`INSERT INTO _sql_schema_migrations(id, applied_at) VALUES (3, ${Date.now()})`;
      }
      if (version < 4) {
        const conversationColumns = this.sql<{ name: string }>`PRAGMA table_info(chatus_conversations)`;
        if (!conversationColumns.some((column) => column.name === "skill_mode")) {
          this.sql`ALTER TABLE chatus_conversations ADD COLUMN skill_mode TEXT NOT NULL DEFAULT 'manual'`;
        }
        this.sql`INSERT INTO _sql_schema_migrations(id, applied_at) VALUES (4, ${Date.now()})`;
      }
      if (version < 5) {
        this.sql`
          CREATE TABLE capability_tool_trust_v5 (
            conversation_id TEXT NOT NULL,
            tool_id TEXT NOT NULL,
            review_revision TEXT NOT NULL,
            approved_at INTEGER NOT NULL,
            PRIMARY KEY (conversation_id, tool_id, review_revision)
          )
        `;
        this.sql`
          INSERT INTO capability_tool_trust_v5 (conversation_id, tool_id, review_revision, approved_at)
          SELECT conversation_id, tool_id, '', approved_at FROM capability_tool_trust
        `;
        this.sql`DROP TABLE capability_tool_trust`;
        this.sql`ALTER TABLE capability_tool_trust_v5 RENAME TO capability_tool_trust`;
        this.sql`INSERT INTO _sql_schema_migrations(id, applied_at) VALUES (5, ${Date.now()})`;
      }
    });
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
        parent_chat_id, skill_mode, skill_ids, message_count, deleted_at
      FROM chatus_conversations
      WHERE deleted_at = 0
      ORDER BY pinned DESC, updated_at DESC
      LIMIT ${MAX_AGENT_CONVERSATIONS}
    `.map((row) => this.conversationSummary(row));
  }

  async createConversation(input: AgentConversationInput): Promise<AgentConversationMutationResult> {
    this.requireRootScope();
    const normalized = normalizeConversationInput(input);
    if (!normalized) return { ok: false, error: "conversation_not_found" };
    const existing = this.getConversationRow(normalized.id);
    if (existing && existing.deleted_at === 0) {
      return { ok: true, conversation: this.conversationSummary(existing), created: false };
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
    return { ok: true, conversation: this.conversationSummary(created), created: true };
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
      return { ok: false, error: "conversation_conflict", current: this.conversationSummary(source) };
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
    this.ctx.storage.transactionSync(() => {
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
        skillMode: normalized.skillMode,
        skillIds: normalized.skillIds || [],
        messageCount: 0,
      }, 0);
      this.sql`
        INSERT INTO conversation_file_refs(conversation_id, file_id, version_id, created_at)
        SELECT ${normalized.destinationId}, file_id, version_id, ${now}
        FROM conversation_file_refs WHERE conversation_id = ${normalized.sourceId}
      `;
    });
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
      return { ok: false, error: "conversation_conflict", current: this.conversationSummary(current) };
    }

    const title = patch.title === undefined
      ? current.title
      : normalizeTitle(patch.title) || current.title;
    const routeId = patch.routeId === undefined
      ? current.route_id
      : boundedString(patch.routeId, 80) || "";
    const skillMode = patch.skillMode === undefined
      ? normalizeSkillMode(current.skill_mode)
      : normalizeSkillMode(patch.skillMode);
    const skillIds = patch.skillIds === undefined
      ? parseSkillIds(current.skill_ids)
      : normalizeSkillIds(patch.skillIds);
    const updatedAt = monotonicNow(current.updated_at);
    this.sql`
      UPDATE chatus_conversations
      SET title = ${title}, route_id = ${routeId}, skill_mode = ${skillMode},
        skill_ids = ${JSON.stringify(skillIds)}, updated_at = ${updatedAt}
      WHERE id = ${id} AND deleted_at = 0
    `;
    const updated = this.getConversationRow(id);
    if (!updated) return { ok: false, error: "conversation_not_found" };
    return { ok: true, conversation: this.conversationSummary(updated) };
  }

  async recordAutomaticSkillSelection(idValue: string, skillIdsValue: string[]): Promise<boolean> {
    this.requireRootScope();
    const id = normalizeConversationId(idValue);
    const current = id ? this.getConversationRow(id) : undefined;
    if (!current || current.deleted_at !== 0 || normalizeSkillMode(current.skill_mode) !== "automatic") return false;
    const skillIds = normalizeSkillIds(skillIdsValue);
    this.sql`
      UPDATE chatus_conversations
      SET skill_ids = ${JSON.stringify(skillIds)}
      WHERE id = ${id} AND deleted_at = 0 AND skill_mode = 'automatic'
    `;
    return true;
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
        skillMode: activity.skillMode,
        skillIds: normalizeSkillIds(activity.skillIds),
      });
      if (!created.ok) return;
      current = this.getConversationRow(id);
    }
    if (!current || current.deleted_at !== 0) return;
    const candidate = normalizeTitle(activity.titleCandidate);
    const title = isDefaultConversationTitle(current.title) && candidate ? candidate : current.title;
    const routeId = boundedString(activity.routeId, 80) || current.route_id;
    const skillMode = activity.skillMode === undefined
      ? normalizeSkillMode(current.skill_mode)
      : normalizeSkillMode(activity.skillMode);
    const skillIds = activity.skillIds === undefined
      ? parseSkillIds(current.skill_ids)
      : normalizeSkillIds(activity.skillIds);
    this.sql`
      UPDATE chatus_conversations
      SET title = ${title}, route_id = ${routeId}, skill_mode = ${skillMode}, skill_ids = ${JSON.stringify(skillIds)},
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
      return { ok: false, error: "conversation_conflict", current: this.conversationSummary(current) };
    }
    const deletedAt = monotonicNow(current.updated_at);
    this.ctx.storage.transactionSync(() => {
      this.sql`
        UPDATE chatus_conversations SET deleted_at = ${deletedAt}, updated_at = ${deletedAt}
        WHERE id = ${id}
      `;
      this.sql`DELETE FROM conversation_file_refs WHERE conversation_id = ${id}`;
      this.queueConversationCleanupRecord(id, deletedAt);
    });
    return { ok: true, conversation: { ...this.conversationSummary(current), updatedAt: deletedAt, workspaceFiles: [] }, deleted: true };
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

  async listWorkspaceFiles(
    queryValue = "",
    cursorValue = "",
    limitValue = 30,
  ): Promise<WorkspaceFileListResult> {
    this.requireRootScope();
    const query = normalizeWorkspaceSearchQuery(queryValue);
    const cursor = decodeWorkspaceCursor(cursorValue);
    const limit = Math.max(1, Math.min(MAX_WORKSPACE_LIST_LIMIT, Math.floor(limitValue) || 30));
    const pattern = `%${escapeWorkspaceLike(query)}%`;
    const columns = `
      id, path, path_key, name, current_version_id, pinned, state,
      generation, created_at, updated_at, deleted_at
    `;
    const order = "ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT ?";
    let rows: WorkspaceFileRow[];
    if (query && cursor) {
      rows = this.ctx.storage.sql.exec<WorkspaceFileRow>(`
        SELECT ${columns} FROM workspace_files
        WHERE deleted_at = 0 AND path_key LIKE ? ESCAPE '\\'
          AND (pinned < ? OR (pinned = ? AND (updated_at < ? OR (updated_at = ? AND id < ?))))
        ${order}
      `, pattern, cursor.pinned, cursor.pinned, cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1).toArray();
    } else if (query) {
      rows = this.ctx.storage.sql.exec<WorkspaceFileRow>(`
        SELECT ${columns} FROM workspace_files
        WHERE deleted_at = 0 AND path_key LIKE ? ESCAPE '\\'
        ${order}
      `, pattern, limit + 1).toArray();
    } else if (cursor) {
      rows = this.ctx.storage.sql.exec<WorkspaceFileRow>(`
        SELECT ${columns} FROM workspace_files
        WHERE deleted_at = 0
          AND (pinned < ? OR (pinned = ? AND (updated_at < ? OR (updated_at = ? AND id < ?))))
        ${order}
      `, cursor.pinned, cursor.pinned, cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1).toArray();
    } else {
      rows = this.ctx.storage.sql.exec<WorkspaceFileRow>(`
        SELECT ${columns} FROM workspace_files
        WHERE deleted_at = 0
        ${order}
      `, limit + 1).toArray();
    }
    const visible = rows.slice(0, limit);
    const last = visible.at(-1);
    return {
      files: visible.map((row) => this.workspaceFileProjection(row)),
      ...(rows.length > limit && last
        ? { nextCursor: encodeWorkspaceCursor({ pinned: last.pinned, updatedAt: last.updated_at, id: last.id }) }
        : {}),
    };
  }

  async listWorkspaceFileVersions(fileIdValue: string): Promise<WorkspaceFileVersionListResult | undefined> {
    this.requireRootScope();
    const fileId = normalizeWorkspaceEntityId(fileIdValue);
    const file = fileId ? this.getWorkspaceFileRow(fileId) : undefined;
    if (!file || file.deleted_at !== 0) return undefined;
    const versions = this.sql<WorkspaceFileVersionRow>`
      SELECT id, file_id, object_key, size, media_type, checksum, state,
        generation, error, ingest_status, ingest_generation, ingest_attempts, ingest_error,
        extracted_object_key, extracted_checksum, extracted_bytes, extracted_chars,
        created_at, updated_at
      FROM workspace_file_versions
      WHERE file_id = ${file.id}
      ORDER BY created_at DESC, id DESC
    `.flatMap((row) => {
      const state = normalizeWorkspaceFileVersionState(row.state);
      return state
        ? [{
            id: row.id,
            fileId: row.file_id,
            size: Math.max(0, row.size),
            mediaType: normalizeWorkspaceMediaType(row.media_type),
            checksum: normalizeWorkspaceChecksum(row.checksum),
            state,
            ingestStatus: normalizeDocumentIngestStatus(row.ingest_status),
            ingestGeneration: Math.max(1, row.ingest_generation),
            ingestAttempts: Math.max(0, row.ingest_attempts),
            ...(row.ingest_error ? { ingestError: row.ingest_error } : {}),
            createdAt: row.created_at,
          }]
        : [];
    });
    return { file: this.workspaceFileProjection(file), versions };
  }

  async getWorkspaceFileVersion(
    fileIdValue: string,
    versionIdValue: string,
  ): Promise<WorkspaceResolvedFileVersion | undefined> {
    this.requireRootScope();
    const fileId = normalizeWorkspaceEntityId(fileIdValue);
    const versionId = normalizeWorkspaceEntityId(versionIdValue);
    return fileId && versionId ? this.getWorkspaceResolvedVersion(fileId, versionId) : undefined;
  }

  async reserveWorkspaceUpload(input: WorkspaceUploadReservationInput): Promise<WorkspaceUploadReservationResult> {
    this.requireRootScope();
    const operationId = normalizeWorkspaceOperationId(input.operationId);
    const pathResult = normalizeWorkspacePath(input.relativePath);
    const checksum = normalizeWorkspaceChecksum(input.checksum);
    const size = Number.isSafeInteger(input.size) && input.size > 0 && input.size <= MAX_WORKSPACE_FILE_BYTES
      ? input.size
      : 0;
    if (!operationId || !pathResult.ok || !checksum || !size) {
      return { ok: false, error: pathResult.ok ? "workspace_upload_invalid" : pathResult.error };
    }
    const mediaType = normalizeWorkspaceMediaType(input.mediaType);
    const requestedFileId = input.fileId === undefined ? "" : normalizeWorkspaceEntityId(input.fileId);
    if (input.fileId !== undefined && !requestedFileId) return { ok: false, error: "workspace_file_not_found" };
    const expectedUpdatedAt = finiteTimestamp(input.expectedUpdatedAt, 0);
    const fingerprint = await contentFingerprint(JSON.stringify({
      path: pathResult.value.path,
      checksum,
      size,
      mediaType,
      fileId: requestedFileId,
      expectedUpdatedAt,
    }));
    const ownerHash = (await contentFingerprint(`workspace-owner:${this.userLabel}`)).slice(0, 32);
    if (this.hasWorkspaceAccountPurgeLock()) {
      return { ok: false, error: "workspace_account_purge_in_progress" };
    }
    const existingOperation = this.getWorkspaceOperationRow(operationId);
    if (existingOperation) {
      if (existingOperation.kind !== "upload" || existingOperation.fingerprint !== fingerprint) {
        return { ok: false, error: "workspace_operation_conflict" };
      }
      if (existingOperation.state === "failed") {
        const current = this.getWorkspaceFileRow(existingOperation.file_id);
        return {
          ok: false,
          error: "workspace_operation_failed",
          ...(current ? { current: this.workspaceFileProjection(current) } : {}),
        };
      }
      const reservation = this.workspaceUploadReservation(existingOperation, true);
      return reservation
        ? { ok: true, reservation }
        : { ok: false, error: "workspace_operation_failed" };
    }

    let file = requestedFileId ? this.getWorkspaceFileRow(requestedFileId) : undefined;
    if (requestedFileId) {
      if (!file) return { ok: false, error: "workspace_file_not_found" };
      if (file.deleted_at !== 0) return { ok: false, error: "workspace_file_deleted" };
      if (file.state === "uploading") {
        return { ok: false, error: "workspace_file_conflict", current: this.workspaceFileProjection(file) };
      }
      if (!expectedUpdatedAt || expectedUpdatedAt !== file.updated_at) {
        return { ok: false, error: "workspace_file_conflict", current: this.workspaceFileProjection(file) };
      }
      if (file.path_key !== pathResult.value.conflictKey) {
        return { ok: false, error: "workspace_path_conflict", current: this.workspaceFileProjection(file) };
      }
    } else {
      const conflict = this.getWorkspaceFileByPathKey(pathResult.value.conflictKey);
      if (conflict) {
        return { ok: false, error: "workspace_path_conflict", current: this.workspaceFileProjection(conflict) };
      }
    }

    const now = Date.now();
    const fileId = file?.id || crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const generation = (file?.generation || 0) + 1;
    const updatedAt = file ? monotonicNow(file.updated_at) : now;
    const objectKey = `workspace/v1/${ownerHash}/${fileId}/${versionId}`;
    let reserved = false;
    let purgeLocked = false;
    let quotaExceeded = false;
    this.ctx.storage.transactionSync(() => {
      if (this.hasWorkspaceAccountPurgeLock()) {
        purgeLocked = true;
        return;
      }
      const retainedBytes = this.sql<{ bytes: number }>`
        SELECT COALESCE(SUM(size), 0) AS bytes FROM workspace_file_versions WHERE state <> 'deleting'
      `[0]?.bytes || 0;
      if (retainedBytes + size > MAX_WORKSPACE_MEMBER_BYTES) {
        quotaExceeded = true;
        return;
      }
      if (file) {
        this.sql`
          UPDATE workspace_files
          SET state = 'uploading', generation = ${generation}, updated_at = ${updatedAt}
          WHERE id = ${fileId}
            AND deleted_at = 0
            AND state <> 'uploading'
            AND path_key = ${pathResult.value.conflictKey}
            AND updated_at = ${expectedUpdatedAt}
        `;
        reserved = this.lastSqlChangeCount() === 1;
      } else {
        this.sql`
          INSERT INTO workspace_files(
            id, path, path_key, name, current_version_id, pinned, state,
            generation, created_at, updated_at, deleted_at
          ) VALUES (
            ${fileId}, ${pathResult.value.path}, ${pathResult.value.conflictKey}, ${pathResult.value.name},
            '', 0, 'uploading', ${generation}, ${now}, ${updatedAt}, 0
          )
        `;
        reserved = true;
      }
      if (!reserved) return;
      this.sql`
        INSERT INTO workspace_file_versions(
          id, file_id, object_key, size, media_type, checksum, state,
          generation, error, ingest_status, ingest_generation, ingest_attempts, ingest_error,
          extracted_object_key, extracted_checksum, extracted_bytes, extracted_chars,
          created_at, updated_at
        ) VALUES (
          ${versionId}, ${fileId}, ${objectKey}, ${size}, ${mediaType}, ${checksum},
          'pending', ${generation}, '', 'queued', 1, 0, '',
          ${workspaceExtractedObjectKey(objectKey, 1)}, '', 0, 0, ${now}, ${now}
        )
      `;
      this.sql`
        INSERT INTO workspace_file_operations(
          id, kind, file_id, version_id, generation, state, fingerprint,
          object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
        ) VALUES (
          ${operationId}, 'upload', ${fileId}, ${versionId}, ${generation}, 'pending', ${fingerprint},
          ${JSON.stringify([objectKey])}, ${size}, ${checksum}, 0, '', ${now}, ${now}
        )
      `;
    });
    if (purgeLocked) return { ok: false, error: "workspace_account_purge_in_progress" };
    if (quotaExceeded) return { ok: false, error: "workspace_member_quota_exceeded" };
    if (!reserved) {
      const current = this.getWorkspaceFileRow(fileId);
      return { ok: false, error: "workspace_file_conflict", ...(current ? { current: this.workspaceFileProjection(current) } : {}) };
    }
    file = this.getWorkspaceFileRow(fileId);
    const operation = this.getWorkspaceOperationRow(operationId);
    const reservation = operation ? this.workspaceUploadReservation(operation, false) : undefined;
    return file && reservation
      ? { ok: true, reservation }
      : { ok: false, error: "workspace_operation_failed" };
  }

  async completeWorkspaceUpload(operationIdValue: string, generationValue: number): Promise<WorkspaceMutationResult> {
    this.requireRootScope();
    const operationId = normalizeWorkspaceOperationId(operationIdValue);
    const generation = finitePositiveInteger(generationValue);
    const operation = operationId ? this.getWorkspaceOperationRow(operationId) : undefined;
    if (!operation || operation.kind !== "upload") return { ok: false, error: "workspace_file_not_found" };
    const file = this.getWorkspaceFileRow(operation.file_id);
    if (!file) return { ok: false, error: "workspace_file_not_found" };
    if (operation.state === "completed") return { ok: true, file: this.workspaceFileProjection(file) };
    if (file.deleted_at !== 0) return { ok: false, error: "workspace_file_deleted" };
    if (operation.generation !== generation || file.generation !== generation) {
      return { ok: false, error: "workspace_file_conflict", current: this.workspaceFileProjection(file) };
    }
    const version = this.getWorkspaceVersionRow(operation.version_id);
    if (!version || version.file_id !== file.id || version.generation !== generation || version.state !== "pending") {
      return { ok: false, error: "workspace_file_conflict", current: this.workspaceFileProjection(file) };
    }
    const now = monotonicNow(file.updated_at);
    this.ctx.storage.transactionSync(() => {
      this.sql`
        UPDATE workspace_file_versions SET state = 'ready', error = '', updated_at = ${now}
        WHERE id = ${version.id} AND state = 'pending' AND generation = ${generation}
      `;
      this.sql`
        UPDATE workspace_files
        SET current_version_id = ${version.id}, state = 'ready', updated_at = ${now}
        WHERE id = ${file.id} AND deleted_at = 0 AND generation = ${generation}
      `;
      this.sql`
        UPDATE workspace_file_operations SET state = 'completed', last_error = '', updated_at = ${now}
        WHERE id = ${operationId} AND generation = ${generation}
      `;
    });
    const completed = this.getWorkspaceFileRow(file.id);
    return completed
      ? { ok: true, file: this.workspaceFileProjection(completed) }
      : { ok: false, error: "workspace_file_not_found" };
  }

  async beginDocumentIngest(messageValue: DocumentIngestMessage): Promise<DocumentIngestBeginResult> {
    this.requireRootScope();
    const message = normalizeDocumentIngestMessage(messageValue);
    if (!message || message.ownerId !== this.userLabel) return { action: "ack", status: "stale" };
    const file = this.getWorkspaceFileRow(message.fileId);
    if (!file || file.deleted_at !== 0) return { action: "ack", status: "deleted" };
    const version = this.getWorkspaceVersionRow(message.versionId);
    if (!version || version.file_id !== file.id || version.state !== "ready") {
      return { action: "ack", status: "stale" };
    }
    const status = normalizeDocumentIngestStatus(version.ingest_status);
    if (status === "deleted") return { action: "ack", status };
    if (version.ingest_generation !== message.generation) return { action: "ack", status: "stale" };
    const now = Date.now();
    if (status === "extracting") {
      const retryAfterMs = version.updated_at + DOCUMENT_INGEST_LEASE_MS - now;
      if (retryAfterMs > 0) {
        return { action: "retry", retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)) };
      }
      this.sql`
        UPDATE workspace_file_versions
        SET ingest_attempts = ingest_attempts + 1, ingest_error = '', updated_at = ${now}
        WHERE id = ${version.id} AND file_id = ${file.id} AND state = 'ready'
          AND ingest_status = 'extracting' AND ingest_generation = ${message.generation}
          AND updated_at <= ${now - DOCUMENT_INGEST_LEASE_MS}
      `;
      if (this.lastSqlChangeCount() !== 1) {
        return { action: "retry", retryAfterSeconds: 1 };
      }
      const reclaimed = this.getWorkspaceVersionRow(version.id)!;
      return {
        action: "process",
        attempt: Math.max(1, reclaimed.ingest_attempts),
        sourceObjectKey: reclaimed.object_key,
        extractedObjectKey: reclaimed.extracted_object_key,
        name: file.name,
        size: Math.max(0, reclaimed.size),
        mediaType: normalizeWorkspaceMediaType(reclaimed.media_type),
        checksum: normalizeWorkspaceChecksum(reclaimed.checksum),
      };
    }
    if (status !== "queued") return { action: "ack", status };
    this.sql`
      UPDATE workspace_file_versions
      SET ingest_status = 'extracting', ingest_attempts = ingest_attempts + 1,
        ingest_error = '', updated_at = ${now}
      WHERE id = ${version.id} AND file_id = ${file.id} AND state = 'ready'
        AND ingest_status = 'queued' AND ingest_generation = ${message.generation}
    `;
    if (this.lastSqlChangeCount() !== 1) {
      const latest = this.getWorkspaceVersionRow(version.id);
      return { action: "ack", status: latest ? normalizeDocumentIngestStatus(latest.ingest_status) : "stale" };
    }
    const started = this.getWorkspaceVersionRow(version.id)!;
    return {
      action: "process",
      attempt: Math.max(1, started.ingest_attempts),
      sourceObjectKey: started.object_key,
      extractedObjectKey: started.extracted_object_key,
      name: file.name,
      size: Math.max(0, started.size),
      mediaType: normalizeWorkspaceMediaType(started.media_type),
      checksum: normalizeWorkspaceChecksum(started.checksum),
    };
  }

  async completeDocumentIngest(
    messageValue: DocumentIngestMessage,
    artifactValue: DocumentIngestArtifact,
  ): Promise<boolean> {
    this.requireRootScope();
    const message = normalizeDocumentIngestMessage(messageValue);
    const artifact = normalizeDocumentIngestArtifact(artifactValue);
    if (!message || message.ownerId !== this.userLabel || !artifact) return false;
    const file = this.getWorkspaceFileRow(message.fileId);
    const version = this.getWorkspaceVersionRow(message.versionId);
    if (
      !file
      || file.deleted_at !== 0
      || !version
      || version.file_id !== file.id
      || version.extracted_object_key !== artifact.objectKey
    ) return false;
    this.sql`
      UPDATE workspace_file_versions
      SET ingest_status = 'ready', ingest_error = '', extracted_checksum = ${artifact.checksum},
        extracted_bytes = ${artifact.bytes}, extracted_chars = ${artifact.chars}, updated_at = ${Date.now()}
      WHERE id = ${version.id} AND file_id = ${file.id} AND state = 'ready'
        AND ingest_status = 'extracting' AND ingest_generation = ${message.generation}
    `;
    return this.lastSqlChangeCount() === 1;
  }

  async recordDocumentIngestFailure(
    messageValue: DocumentIngestMessage,
    errorValue: string,
    transient: boolean,
  ): Promise<boolean> {
    this.requireRootScope();
    const message = normalizeDocumentIngestMessage(messageValue);
    if (!message || message.ownerId !== this.userLabel) return false;
    const error = boundedString(errorValue, 80) || "document_ingest_failed";
    this.sql`
      UPDATE workspace_file_versions
      SET ingest_status = ${transient ? "queued" : "failed"}, ingest_error = ${error}, updated_at = ${Date.now()}
      WHERE id = ${message.versionId} AND file_id = ${message.fileId}
        AND state = 'ready' AND ingest_status = 'extracting' AND ingest_generation = ${message.generation}
    `;
    return this.lastSqlChangeCount() === 1;
  }

  async recordDocumentIngestDlq(messageValue: DocumentIngestMessage, errorValue: string): Promise<boolean> {
    this.requireRootScope();
    const message = normalizeDocumentIngestMessage(messageValue);
    if (!message || message.ownerId !== this.userLabel) return false;
    const error = boundedString(errorValue, 80) || "document_ingest_retry_exhausted";
    this.sql`
      UPDATE workspace_file_versions
      SET ingest_status = 'failed', ingest_error = ${error}, updated_at = ${Date.now()}
      WHERE id = ${message.versionId} AND file_id = ${message.fileId}
        AND state = 'ready' AND ingest_status IN ('queued', 'extracting')
        AND ingest_generation = ${message.generation}
    `;
    return this.lastSqlChangeCount() === 1;
  }

  async retryDocumentIngest(
    fileIdValue: string,
    versionIdValue: string,
  ): Promise<DocumentIngestRetryResult> {
    this.requireRootScope();
    const fileId = normalizeWorkspaceEntityId(fileIdValue);
    const versionId = normalizeWorkspaceEntityId(versionIdValue);
    const file = fileId ? this.getWorkspaceFileRow(fileId) : undefined;
    const version = versionId ? this.getWorkspaceVersionRow(versionId) : undefined;
    if (!file || file.deleted_at !== 0 || !version || version.file_id !== file.id || file.current_version_id !== version.id) {
      return { ok: false, error: "workspace_file_not_found" };
    }
    if (normalizeDocumentIngestStatus(version.ingest_status) !== "failed") {
      return { ok: false, error: "document_ingest_not_retryable" };
    }
    const generation = Math.max(1, version.ingest_generation) + 1;
    this.sql`
      UPDATE workspace_file_versions
      SET ingest_status = 'queued', ingest_generation = ${generation}, ingest_attempts = 0,
        ingest_error = '', extracted_checksum = '', extracted_bytes = 0, extracted_chars = 0,
        extracted_object_key = ${workspaceExtractedObjectKey(version.object_key, generation)},
        updated_at = ${Date.now()}
      WHERE id = ${version.id} AND file_id = ${file.id} AND state = 'ready' AND ingest_status = 'failed'
    `;
    return this.lastSqlChangeCount() === 1
      ? { ok: true, message: { ownerId: this.userLabel, fileId: file.id, versionId: version.id, generation } }
      : { ok: false, error: "document_ingest_not_retryable" };
  }

  async recordWorkspaceOperationFailure(
    operationIdValue: string,
    generationValue: number,
    errorValue = "workspace_operation_failed",
  ): Promise<boolean> {
    this.requireRootScope();
    const operationId = normalizeWorkspaceOperationId(operationIdValue);
    const generation = finitePositiveInteger(generationValue);
    const operation = operationId ? this.getWorkspaceOperationRow(operationId) : undefined;
    if (!operation || operation.generation !== generation || operation.state === "completed") return false;
    const error = boundedString(errorValue, 80) || "workspace_operation_failed";
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql`
        UPDATE workspace_file_operations
        SET state = 'failed', attempts = attempts + 1, last_error = ${error}, updated_at = ${now}
        WHERE id = ${operationId} AND generation = ${generation}
      `;
      if (operation.kind === "upload") {
        this.sql`
          UPDATE workspace_file_versions SET state = 'failed', error = ${error}, updated_at = ${now}
          WHERE id = ${operation.version_id} AND generation = ${generation} AND state = 'pending'
        `;
        this.sql`
          UPDATE workspace_files SET state = 'failed', updated_at = ${now}
          WHERE id = ${operation.file_id} AND deleted_at = 0 AND generation = ${generation}
        `;
      }
    });
    return true;
  }

  async abandonWorkspaceUpload(operationIdValue: string, generationValue: number): Promise<void> {
    this.requireRootScope();
    const operationId = normalizeWorkspaceOperationId(operationIdValue);
    const generation = finitePositiveInteger(generationValue);
    const operation = operationId ? this.getWorkspaceOperationRow(operationId) : undefined;
    if (!operation || operation.kind !== "upload" || operation.generation !== generation) return;
    const file = this.getWorkspaceFileRow(operation.file_id);
    this.ctx.storage.transactionSync(() => {
      this.sql`DELETE FROM workspace_file_versions WHERE id = ${operation.version_id} AND generation = ${generation}`;
      this.sql`DELETE FROM workspace_file_operations WHERE id = ${operationId} AND generation = ${generation}`;
      if (file && file.deleted_at === 0 && file.generation === generation) {
        this.sql`
          UPDATE workspace_files
          SET state = ${file.current_version_id ? "ready" : "failed"}, updated_at = ${monotonicNow(file.updated_at)}
          WHERE id = ${file.id}
        `;
      }
    });
  }

  async updateWorkspaceFile(
    fileIdValue: string,
    expectedUpdatedAtValue: number,
    patch: { relativePath?: unknown; pinned?: unknown },
  ): Promise<WorkspaceMutationResult> {
    this.requireRootScope();
    if (this.hasWorkspaceAccountPurgeLock()) {
      return { ok: false, error: "workspace_account_purge_in_progress" };
    }
    const fileId = normalizeWorkspaceEntityId(fileIdValue);
    const expectedUpdatedAt = finitePositiveInteger(expectedUpdatedAtValue);
    const current = fileId ? this.getWorkspaceFileRow(fileId) : undefined;
    if (!current) return { ok: false, error: "workspace_file_not_found" };
    if (current.deleted_at !== 0) return { ok: false, error: "workspace_file_deleted" };
    if (
      (patch.relativePath === undefined && patch.pinned === undefined)
      || (patch.pinned !== undefined && typeof patch.pinned !== "boolean")
    ) {
      return { ok: false, error: "workspace_update_invalid" };
    }
    if (current.state === "uploading") {
      return { ok: false, error: "workspace_file_conflict", current: this.workspaceFileProjection(current) };
    }
    if (!expectedUpdatedAt || current.updated_at !== expectedUpdatedAt) {
      return { ok: false, error: "workspace_file_conflict", current: this.workspaceFileProjection(current) };
    }
    const pathResult = patch.relativePath === undefined ? undefined : normalizeWorkspacePath(patch.relativePath);
    if (pathResult && !pathResult.ok) return { ok: false, error: pathResult.error };
    if (pathResult) {
      const conflict = this.getWorkspaceFileByPathKey(pathResult.value.conflictKey);
      if (conflict && conflict.id !== current.id) {
        return { ok: false, error: "workspace_path_conflict", current: this.workspaceFileProjection(conflict) };
      }
    }
    const pinned = patch.pinned === undefined ? current.pinned === 1 : patch.pinned === true;
    const updatedAt = monotonicNow(current.updated_at);
    this.sql`
      UPDATE workspace_files
      SET path = ${pathResult?.value.path || current.path},
        path_key = ${pathResult?.value.conflictKey || current.path_key},
        name = ${pathResult?.value.name || current.name},
        pinned = ${pinned ? 1 : 0}, updated_at = ${updatedAt}
      WHERE id = ${current.id} AND deleted_at = 0 AND updated_at = ${expectedUpdatedAt}
    `;
    if (this.lastSqlChangeCount() !== 1) {
      const latest = this.getWorkspaceFileRow(current.id);
      return { ok: false, error: "workspace_file_conflict", ...(latest ? { current: this.workspaceFileProjection(latest) } : {}) };
    }
    const updated = this.getWorkspaceFileRow(current.id);
    return updated
      ? { ok: true, file: this.workspaceFileProjection(updated) }
      : { ok: false, error: "workspace_file_not_found" };
  }

  async reserveWorkspaceFileDelete(
    fileIdValue: string,
    expectedUpdatedAtValue: number,
    operationIdValue: string,
  ): Promise<WorkspaceDeleteReservationResult> {
    this.requireRootScope();
    const fileId = normalizeWorkspaceEntityId(fileIdValue);
    const operationId = normalizeWorkspaceOperationId(operationIdValue);
    const expectedUpdatedAt = finitePositiveInteger(expectedUpdatedAtValue);
    const fingerprint = fileId && expectedUpdatedAt
      ? await contentFingerprint(JSON.stringify({ fileId, expectedUpdatedAt }))
      : "";
    if (this.hasWorkspaceAccountPurgeLock()) {
      return { ok: false, error: "workspace_account_purge_in_progress" };
    }
    const current = fileId ? this.getWorkspaceFileRow(fileId) : undefined;
    if (!current) return { ok: false, error: "workspace_file_not_found" };
    const requestedOperation = operationId ? this.getWorkspaceOperationRow(operationId) : undefined;
    if (requestedOperation && (requestedOperation.kind !== "delete_file" || requestedOperation.file_id !== current.id)) {
      return { ok: false, error: "workspace_operation_conflict" };
    }
    const activeDelete = this.getWorkspaceDeleteOperation(current.id);
    if (current.deleted_at !== 0) {
      return {
        ok: true,
        reservation: activeDelete
          ? this.workspaceDeleteReservation(activeDelete, true)
          : {
              operationId,
              fileId: current.id,
              generation: current.generation,
              objectKeys: [],
              existing: true,
              completed: true,
            },
      };
    }
    if (current.state === "uploading") {
      return { ok: false, error: "workspace_file_conflict", current: this.workspaceFileProjection(current) };
    }
    if (!operationId) return { ok: false, error: "workspace_operation_conflict" };
    if (!expectedUpdatedAt || current.updated_at !== expectedUpdatedAt) {
      return { ok: false, error: "workspace_file_conflict", current: this.workspaceFileProjection(current) };
    }
    if (requestedOperation) return { ok: true, reservation: this.workspaceDeleteReservation(requestedOperation, true) };
    const objectKeys = this.sql<{ object_key: string; extracted_object_key: string }>`
      SELECT object_key, extracted_object_key FROM workspace_file_versions WHERE file_id = ${current.id}
    `.flatMap((row) => [row.object_key, row.extracted_object_key]).filter(Boolean);
    const generation = current.generation + 1;
    const now = monotonicNow(current.updated_at);
    let reserved = false;
    let purgeLocked = false;
    this.ctx.storage.transactionSync(() => {
      if (this.hasWorkspaceAccountPurgeLock()) {
        purgeLocked = true;
        return;
      }
      this.sql`
        UPDATE workspace_files
        SET state = 'deleting', generation = ${generation}, deleted_at = ${now}, updated_at = ${now}
        WHERE id = ${current.id}
          AND deleted_at = 0
          AND state <> 'uploading'
          AND updated_at = ${expectedUpdatedAt}
      `;
      reserved = this.lastSqlChangeCount() === 1;
      if (!reserved) return;
      this.sql`DELETE FROM conversation_file_refs WHERE file_id = ${current.id}`;
      this.sql`
        UPDATE workspace_file_versions
        SET state = 'deleting', generation = ${generation}, ingest_status = 'deleted', updated_at = ${now}
        WHERE file_id = ${current.id}
      `;
      this.sql`DELETE FROM workspace_file_operations WHERE file_id = ${current.id}`;
      if (objectKeys.length) {
        this.sql`
          INSERT INTO workspace_file_operations(
            id, kind, file_id, version_id, generation, state, fingerprint,
            object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
          ) VALUES (
            ${operationId}, 'delete_file', ${current.id}, '', ${generation}, 'pending', ${fingerprint},
            ${JSON.stringify(objectKeys)}, 0, '', 0, '', ${now}, ${now}
          )
        `;
      } else {
        this.sql`
          UPDATE workspace_files SET state = 'deleted', current_version_id = '' WHERE id = ${current.id}
        `;
      }
    });
    if (purgeLocked) return { ok: false, error: "workspace_account_purge_in_progress" };
    if (!reserved) {
      const latest = this.getWorkspaceFileRow(current.id);
      return { ok: false, error: "workspace_file_conflict", ...(latest ? { current: this.workspaceFileProjection(latest) } : {}) };
    }
    const operation = this.getWorkspaceOperationRow(operationId);
    return {
      ok: true,
      reservation: operation
        ? this.workspaceDeleteReservation(operation, false)
        : {
            operationId,
            fileId: current.id,
            generation,
            objectKeys: [],
            existing: false,
            completed: true,
          },
    };
  }

  async getWorkspaceDeleteReservation(fileIdValue: string): Promise<WorkspaceDeleteReservationResult> {
    this.requireRootScope();
    const fileId = normalizeWorkspaceEntityId(fileIdValue);
    const file = fileId ? this.getWorkspaceFileRow(fileId) : undefined;
    if (!file) return { ok: false, error: "workspace_file_not_found" };
    const operation = this.getWorkspaceDeleteOperation(file.id);
    if (!operation) {
      return {
        ok: true,
        reservation: {
          operationId: "",
          fileId: file.id,
          generation: file.generation,
          objectKeys: [],
          existing: true,
          completed: file.state === "deleted",
        },
      };
    }
    return { ok: true, reservation: this.workspaceDeleteReservation(operation, true) };
  }

  async completeWorkspaceFileDelete(operationIdValue: string, generationValue: number): Promise<boolean> {
    this.requireRootScope();
    const operationId = normalizeWorkspaceOperationId(operationIdValue);
    const generation = finitePositiveInteger(generationValue);
    const operation = operationId ? this.getWorkspaceOperationRow(operationId) : undefined;
    if (!operation || operation.kind !== "delete_file" || operation.generation !== generation) return false;
    const file = this.getWorkspaceFileRow(operation.file_id);
    if (!file || file.deleted_at === 0 || file.generation !== generation) return false;
    this.ctx.storage.transactionSync(() => {
      this.sql`DELETE FROM conversation_file_refs WHERE file_id = ${file.id}`;
      this.sql`DELETE FROM workspace_file_versions WHERE file_id = ${file.id}`;
      this.sql`DELETE FROM workspace_file_operations WHERE file_id = ${file.id}`;
      this.sql`
        UPDATE workspace_files SET state = 'deleted', current_version_id = '', updated_at = ${Date.now()}
        WHERE id = ${file.id} AND deleted_at <> 0 AND generation = ${generation}
      `;
    });
    return true;
  }

  async listPendingWorkspaceOperations(limitValue = 3): Promise<WorkspacePendingOperation[]> {
    this.requireRootScope();
    const limit = Math.max(1, Math.min(10, Math.floor(limitValue) || 3));
    return this.sql<WorkspaceFileOperationRow>`
      SELECT id, kind, file_id, version_id, generation, state, fingerprint,
        object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
      FROM workspace_file_operations
      WHERE state = 'pending' OR state = 'failed'
      ORDER BY updated_at ASC, created_at ASC
      LIMIT ${limit}
    `.flatMap((row) => {
      if (
        (row.kind !== "upload" && row.kind !== "delete_file" && row.kind !== "account_purge")
        || (row.state !== "pending" && row.state !== "failed")
      ) return [];
      return [{
        operationId: row.id,
        kind: row.kind,
        fileId: row.file_id,
        versionId: row.version_id,
        generation: row.generation,
        state: row.state,
        objectKeys: parseWorkspaceObjectKeys(row.object_keys_json),
        size: Math.max(0, row.size),
        checksum: normalizeWorkspaceChecksum(row.checksum),
        attempts: Math.max(0, row.attempts),
        updatedAt: row.updated_at,
      }];
    });
  }

  async setConversationWorkspaceFiles(
    conversationIdValue: string,
    expectedUpdatedAtValue: number,
    refsValue: Array<{ fileId: string; versionId: string }>,
  ): Promise<AgentConversationMutationResult> {
    this.requireRootScope();
    if (this.hasWorkspaceAccountPurgeLock()) {
      return { ok: false, error: "workspace_account_purge_in_progress" };
    }
    const conversationId = normalizeConversationId(conversationIdValue);
    const expectedUpdatedAt = finitePositiveInteger(expectedUpdatedAtValue);
    const current = conversationId ? this.getConversationRow(conversationId) : undefined;
    if (!current || current.deleted_at !== 0) return { ok: false, error: "conversation_not_found" };
    if (!expectedUpdatedAt || current.updated_at !== expectedUpdatedAt) {
      return { ok: false, error: "conversation_conflict", current: this.conversationSummary(current) };
    }
    if (!Array.isArray(refsValue) || refsValue.length > MAX_WORKSPACE_FILES_PER_CONVERSATION) {
      return { ok: false, error: "conversation_conflict", current: this.conversationSummary(current) };
    }
    const refs: Array<{ fileId: string; versionId: string }> = [];
    const seen = new Set<string>();
    for (const value of refsValue) {
      const fileId = normalizeWorkspaceEntityId(value?.fileId);
      const versionId = normalizeWorkspaceEntityId(value?.versionId);
      if (!fileId || !versionId || seen.has(fileId)) {
        return { ok: false, error: "conversation_conflict", current: this.conversationSummary(current) };
      }
      const resolved = this.getWorkspaceResolvedVersion(fileId, versionId);
      if (!resolved) return { ok: false, error: "conversation_conflict", current: this.conversationSummary(current) };
      seen.add(fileId);
      refs.push({ fileId, versionId });
    }
    const updatedAt = monotonicNow(current.updated_at);
    this.ctx.storage.transactionSync(() => {
      this.sql`DELETE FROM conversation_file_refs WHERE conversation_id = ${conversationId}`;
      for (const ref of refs) {
        this.sql`
          INSERT INTO conversation_file_refs(conversation_id, file_id, version_id, created_at)
          VALUES (${conversationId}, ${ref.fileId}, ${ref.versionId}, ${updatedAt})
        `;
      }
      this.sql`
        UPDATE chatus_conversations SET updated_at = ${updatedAt}
        WHERE id = ${conversationId} AND deleted_at = 0 AND updated_at = ${expectedUpdatedAt}
      `;
    });
    const updated = this.getConversationRow(conversationId);
    return updated
      ? { ok: true, conversation: this.conversationSummary(updated) }
      : { ok: false, error: "conversation_not_found" };
  }

  async resolveConversationWorkspaceFiles(conversationIdValue: string): Promise<WorkspaceResolvedFileVersion[]> {
    this.requireRootScope();
    const conversationId = normalizeConversationId(conversationIdValue);
    if (!conversationId) return [];
    return this.listConversationWorkspaceRows(conversationId).map((row) => ({
      fileId: row.file_id,
      versionId: row.version_id,
      path: row.path,
      name: row.name,
      size: row.size,
      mediaType: row.media_type,
      checksum: row.checksum,
      objectKey: row.object_key,
      generation: row.generation,
      ingestStatus: normalizeDocumentIngestStatus(row.ingest_status),
      ingestGeneration: Math.max(1, row.ingest_generation),
      ingestAttempts: Math.max(0, row.ingest_attempts),
      ingestError: row.ingest_error,
      extractedObjectKey: row.extracted_object_key,
      extractedChecksum: normalizeWorkspaceChecksum(row.extracted_checksum),
      extractedBytes: Math.max(0, row.extracted_bytes),
      extractedChars: Math.max(0, row.extracted_chars),
    }));
  }

  async beginWorkspaceAccountPurge(operationIdValue: string): Promise<WorkspaceAccountPurgeReservationResult> {
    this.requireRootScope();
    const operationId = normalizeWorkspaceOperationId(operationIdValue);
    if (!operationId) return { error: "workspace_operation_conflict" };
    const existingRequested = this.getWorkspaceOperationRow(operationId);
    if (existingRequested) {
      if (existingRequested.kind !== "account_purge") return { error: "workspace_operation_conflict" };
      return {
        operationId: existingRequested.id,
        generation: existingRequested.generation,
        objectKeys: parseWorkspaceObjectKeys(existingRequested.object_keys_json),
        existing: true,
        completed: existingRequested.state === "completed",
      };
    }
    const existing = this.sql<WorkspaceFileOperationRow>`
      SELECT id, kind, file_id, version_id, generation, state, fingerprint,
        object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
      FROM workspace_file_operations WHERE kind = 'account_purge' LIMIT 1
    `[0];
    if (existing) {
      return {
        operationId: existing.id,
        generation: existing.generation,
        objectKeys: parseWorkspaceObjectKeys(existing.object_keys_json),
        existing: true,
        completed: existing.state === "completed",
      };
    }
    const pendingUploads = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM workspace_file_operations
      WHERE kind = 'upload' AND state = 'pending'
    `[0]?.count || 0;
    if (pendingUploads > 0) return { error: "workspace_purge_pending_upload" };
    const objectKeys = this.sql<{ object_key: string; extracted_object_key: string }>`
      SELECT object_key, extracted_object_key FROM workspace_file_versions
    `.flatMap((row) => [row.object_key, row.extracted_object_key]).filter(Boolean);
    const maximum = this.sql<{ generation: number }>`
      SELECT COALESCE(MAX(generation), 0) AS generation FROM workspace_files
    `[0]?.generation || 0;
    const generation = maximum + 1;
    const now = Date.now();
    const fingerprint = `account-purge:${operationId}`;
    this.ctx.storage.transactionSync(() => {
      this.sql`
        UPDATE workspace_files SET state = 'deleting', generation = ${generation}, deleted_at = ${now}, updated_at = ${now}
        WHERE deleted_at = 0
      `;
      this.sql`DELETE FROM conversation_file_refs`;
      this.sql`
        UPDATE workspace_file_versions
        SET state = 'deleting', generation = ${generation}, ingest_status = 'deleted', updated_at = ${now}
      `;
      this.sql`DELETE FROM workspace_file_operations`;
      this.sql`
        INSERT INTO workspace_file_operations(
          id, kind, file_id, version_id, generation, state, fingerprint,
          object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
        ) VALUES (
          ${operationId}, 'account_purge', '', '', ${generation}, 'pending', ${fingerprint},
          ${JSON.stringify(objectKeys)}, 0, '', 0, '', ${now}, ${now}
        )
      `;
    });
    return { operationId, generation, objectKeys, existing: false, completed: false };
  }

  private lastSqlChangeCount(): number {
    return this.sql<{ count: number }>`SELECT changes() AS count`[0]?.count || 0;
  }

  private hasWorkspaceAccountPurgeLock(): boolean {
    return this.sql<{ present: number }>`
      SELECT 1 AS present FROM workspace_file_operations WHERE kind = 'account_purge' LIMIT 1
    `.length > 0;
  }

  async completeWorkspaceAccountPurge(operationIdValue: string, generationValue: number): Promise<boolean> {
    this.requireRootScope();
    const operationId = normalizeWorkspaceOperationId(operationIdValue);
    const generation = finitePositiveInteger(generationValue);
    const operation = operationId ? this.getWorkspaceOperationRow(operationId) : undefined;
    if (!operation) return false;
    if (operation.kind !== "account_purge" || operation.generation !== generation) return false;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql`DELETE FROM conversation_file_refs`;
      this.sql`DELETE FROM workspace_file_versions`;
      this.sql`DELETE FROM workspace_files`;
      this.sql`DELETE FROM workspace_file_operations WHERE kind <> 'account_purge'`;
      this.sql`
        UPDATE workspace_file_operations
        SET state = 'completed', last_error = '', updated_at = ${now}
        WHERE id = ${operationId} AND kind = 'account_purge' AND generation = ${generation}
      `;
    });
    return this.getWorkspaceOperationRow(operationId)?.state === "completed";
  }

  async purgeRootData(): Promise<{ conversationIds: string[] }> {
    this.requireRootScope();
    const conversationIds = await this.getAllConversationIds();
    const workspaceVersionCount = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM workspace_file_versions
    `[0]?.count || 0;
    if (workspaceVersionCount > 0) throw new Error("workspace_purge_required");
    this.ctx.storage.transactionSync(() => {
      this.clearPersistedChatState();
      this.sql`DELETE FROM conversation_file_refs`;
      this.sql`DELETE FROM workspace_file_operations WHERE kind <> 'account_purge'`;
      this.sql`DELETE FROM workspace_files`;
      this.sql`DELETE FROM chatus_conversations`;
      this.sql`DELETE FROM chatus_conversation_cleanup`;
      this.sql`DELETE FROM chatus_conversation_branches`;
      this.sql`DELETE FROM chatus_memory`;
      this.sql`DELETE FROM chatus_migrations`;
      this.sql`DELETE FROM capability_tool_trust`;
    });
    await this.ctx.storage.delete(AGENT_IDENTITY_STORAGE_KEY);
    return { conversationIds };
  }

  async releaseWorkspaceAccountPurge(operationIdValue: string, generationValue: number): Promise<boolean> {
    this.requireRootScope();
    const operationId = normalizeWorkspaceOperationId(operationIdValue);
    const generation = finitePositiveInteger(generationValue);
    if (!operationId || !generation) return false;
    this.sql`
      DELETE FROM workspace_file_operations
      WHERE id = ${operationId}
        AND kind = 'account_purge'
        AND generation = ${generation}
        AND state = 'completed'
    `;
    return this.lastSqlChangeCount() === 1;
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
      return chatErrorResponse("agent_identity_unavailable", 401);
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
    let workspaceContext = "";
    let memoryRecord: AgentMemoryRecord | undefined;
    let root: Awaited<ReturnType<TeamAgent["getRootAgent"]>>;
    let conversationSettings: AgentConversationSummary;
    try {
      root = await this.getRootAgent();
      const conversations = await root.listConversations();
      const storedConversation = conversations.find((conversation) => conversation.id === this.chatId);
      if (!storedConversation) return chatErrorResponse("conversation_not_found", 404);
      conversationSettings = storedConversation;
      if (this.accessKind === "member") {
        const [loadedMemory, workspaceFiles] = await Promise.all([
          root.getMemory(),
          root.resolveConversationWorkspaceFiles(this.chatId),
        ]);
        memoryRecord = loadedMemory;
        longTermMemory = memoryRecord.memory;
        workspaceContext = await this.loadWorkspaceContext(workspaceFiles);
      }
    } catch {
      return chatErrorResponse("workspace_context_unavailable", 503);
    }
    const prepared = await prepareTeamAgentTurn(this.env, session, {
      messages: toLegacyMessages(this.messages),
      continuation: options?.continuation === true,
      routeId: conversationSettings.routeId || boundedString(body.routeId, 80),
      skillMode: conversationSettings.skillMode,
      skillIds: conversationSettings.skillIds,
      userApiKey: boundedString(body.userApiKey, 8_192),
      sessionSummary: boundedString(body.sessionSummary, 1_200),
      temperature: finiteNumber(body.temperature),
      longTermMemory,
      workspaceContext,
      abortSignal: options?.abortSignal,
    });

    if (!prepared.ok) {
      return chatErrorResponse(prepared.error, prepared.status);
    }
    this.pendingActivity = { routeId: prepared.routeId };
    if (prepared.skillSnapshotIds) {
      await root.recordAutomaticSkillSelection(this.chatId, prepared.skillSnapshotIds).catch(() => false);
    }

    const tools = createAgentToolSet({
      definitions: prepared.toolDefinitions,
      conversationId: this.chatId,
      runTool: prepared.runTool,
      approvals: {
        isTrusted: (targetConversationId, toolId, reviewRevision) => (
          this.isToolTrusted(targetConversationId, toolId, reviewRevision)
        ),
        markTrusted: (targetConversationId, toolId, reviewRevision) => (
          this.markToolTrusted(targetConversationId, toolId, reviewRevision)
        ),
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
        return chatErrorResponse("agent_context_invalid", 409);
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
        messageMetadata: ({ part }) => part.type === "finish"
          ? {
              ...(part.finishReason === "length" ? { finishReason: "length" as const } : {}),
              ...(prepared.skillSelection ? { skillSelection: prepared.skillSelection } : {}),
            }
          : undefined,
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Remaining": String(prepared.remaining),
        },
        onError: (error) => serializeAgentErrorEnvelope(projectAgentStreamError(error)),
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

  private async loadWorkspaceContext(files: WorkspaceResolvedFileVersion[]): Promise<string> {
    if (!files.length) return "";
    if (files.length > MAX_WORKSPACE_FILES_PER_CONVERSATION) {
      throw new Error("workspace_reference_limit_exceeded");
    }
    const policy = { ...fileInputPolicy(this.env), maxFiles: MAX_WORKSPACE_FILES_PER_CONVERSATION };
    let validation = emptyTextFileValidationState();
    const context: string[] = [];
    for (const file of files) {
      if (file.ingestStatus !== "ready") {
        context.push(workspaceUnavailableContext(file, `document_ingest_${file.ingestStatus}`));
        continue;
      }
      if (
        !Number.isSafeInteger(file.ingestGeneration)
        || file.ingestGeneration < 1
        || file.extractedObjectKey !== workspaceExtractedObjectKey(file.objectKey, file.ingestGeneration)
        || !normalizeWorkspaceChecksum(file.extractedChecksum)
        || !Number.isSafeInteger(file.extractedBytes)
        || file.extractedBytes < 0
        || !Number.isSafeInteger(file.extractedChars)
        || file.extractedChars < 0
      ) {
        throw new Error("workspace_extracted_artifact_invalid");
      }
      if (file.extractedBytes > policy.maxTotalBytes || validation.totalBytes + file.extractedBytes > policy.maxTotalBytes) {
        context.push(workspaceUnavailableContext(file, "text_file_too_large"));
        continue;
      }
      const object = await this.env.WORKSPACE_FILES.get(file.extractedObjectKey);
      if (!object || object.size !== file.extractedBytes) throw new Error("workspace_object_unavailable");
      const storedChecksum = object.checksums.sha256;
      if (!storedChecksum || hexBytes(storedChecksum) !== file.extractedChecksum) {
        throw new Error("workspace_object_checksum_mismatch");
      }
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength !== file.extractedBytes || await contentFingerprintBytes(bytes) !== file.extractedChecksum) {
        throw new Error("workspace_object_checksum_mismatch");
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
      } catch {
        throw new Error("workspace_extracted_artifact_invalid");
      }
      if (text.length !== file.extractedChars) throw new Error("workspace_extracted_artifact_invalid");
      if (validation.totalChars + text.length > policy.maxExtractedChars) {
        context.push(workspaceUnavailableContext(file, "text_context_too_large"));
        continue;
      }
      validation = {
        fileCount: validation.fileCount + 1,
        totalBytes: validation.totalBytes + bytes.byteLength,
        totalChars: validation.totalChars + text.length,
      };
      context.push(formatAttachedFileContext({
        filename: file.path,
        mediaType: file.mediaType,
        bytes: bytes.byteLength,
        text,
      }));
    }
    return context.join("\n\n");
  }

  private getConversationRow(id: string): ConversationRow | undefined {
    return this.sql<ConversationRow>`
      SELECT id, title, created_at, updated_at, summary, pinned, route_id,
        parent_chat_id, skill_mode, skill_ids, message_count, deleted_at
      FROM chatus_conversations WHERE id = ${id} LIMIT 1
    `[0];
  }

  private conversationSummary(row: ConversationRow): AgentConversationSummary {
    return {
      ...conversationRowToSummary(row),
      workspaceFiles: this.listConversationWorkspaceFiles(row.id),
    };
  }

  private getWorkspaceFileRow(fileId: string): WorkspaceFileRow | undefined {
    return this.sql<WorkspaceFileRow>`
      SELECT id, path, path_key, name, current_version_id, pinned, state,
        generation, created_at, updated_at, deleted_at
      FROM workspace_files WHERE id = ${fileId} LIMIT 1
    `[0];
  }

  private getWorkspaceFileByPathKey(pathKey: string): WorkspaceFileRow | undefined {
    return this.sql<WorkspaceFileRow>`
      SELECT id, path, path_key, name, current_version_id, pinned, state,
        generation, created_at, updated_at, deleted_at
      FROM workspace_files WHERE path_key = ${pathKey} AND deleted_at = 0 LIMIT 1
    `[0];
  }

  private getWorkspaceVersionRow(versionId: string): WorkspaceFileVersionRow | undefined {
    return this.sql<WorkspaceFileVersionRow>`
      SELECT id, file_id, object_key, size, media_type, checksum, state,
        generation, error, ingest_status, ingest_generation, ingest_attempts, ingest_error,
        extracted_object_key, extracted_checksum, extracted_bytes, extracted_chars,
        created_at, updated_at
      FROM workspace_file_versions WHERE id = ${versionId} LIMIT 1
    `[0];
  }

  private getWorkspaceOperationRow(operationId: string): WorkspaceFileOperationRow | undefined {
    return this.sql<WorkspaceFileOperationRow>`
      SELECT id, kind, file_id, version_id, generation, state, fingerprint,
        object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
      FROM workspace_file_operations WHERE id = ${operationId} LIMIT 1
    `[0];
  }

  private getWorkspaceDeleteOperation(fileId: string): WorkspaceFileOperationRow | undefined {
    return this.sql<WorkspaceFileOperationRow>`
      SELECT id, kind, file_id, version_id, generation, state, fingerprint,
        object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
      FROM workspace_file_operations
      WHERE kind = 'delete_file' AND file_id = ${fileId}
      ORDER BY created_at DESC LIMIT 1
    `[0];
  }

  private workspaceFileProjection(row: WorkspaceFileRow): WorkspaceFileProjection {
    const state = normalizeWorkspaceFileState(row.state);
    const version = row.current_version_id ? this.getWorkspaceVersionRow(row.current_version_id) : undefined;
    const versionState = version ? normalizeWorkspaceFileVersionState(version.state) : undefined;
    const currentVersion: WorkspaceFileVersionProjection | undefined = version && versionState
      ? {
          id: version.id,
          fileId: version.file_id,
          size: Math.max(0, version.size),
          mediaType: normalizeWorkspaceMediaType(version.media_type),
          checksum: normalizeWorkspaceChecksum(version.checksum),
          state: versionState,
          ingestStatus: normalizeDocumentIngestStatus(version.ingest_status),
          ingestGeneration: Math.max(1, version.ingest_generation),
          ingestAttempts: Math.max(0, version.ingest_attempts),
          ...(version.ingest_error ? { ingestError: version.ingest_error } : {}),
          createdAt: version.created_at,
        }
      : undefined;
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      pinned: row.pinned === 1,
      state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(currentVersion ? { currentVersion } : {}),
      retryAvailable: state === "failed",
      ingestRetryAvailable: currentVersion?.ingestStatus === "failed",
    };
  }

  private workspaceUploadReservation(
    operation: WorkspaceFileOperationRow,
    existing: boolean,
  ): WorkspaceUploadReservation | undefined {
    if (operation.kind !== "upload") return undefined;
    const file = this.getWorkspaceFileRow(operation.file_id);
    const version = this.getWorkspaceVersionRow(operation.version_id);
    if (
      !file
      || !version
      || file.deleted_at !== 0
      || version.file_id !== file.id
      || version.generation !== operation.generation
    ) return undefined;
    return {
      operationId: operation.id,
      fileId: file.id,
      versionId: version.id,
      objectKey: version.object_key,
      generation: operation.generation,
      size: Math.max(0, version.size),
      mediaType: normalizeWorkspaceMediaType(version.media_type),
      checksum: normalizeWorkspaceChecksum(version.checksum),
      existing,
      completed: operation.state === "completed",
      file: this.workspaceFileProjection(file),
    };
  }

  private workspaceDeleteReservation(
    operation: WorkspaceFileOperationRow,
    existing: boolean,
  ): WorkspaceAccountPurgeReservation & { fileId: string } {
    return {
      operationId: operation.id,
      fileId: operation.file_id,
      generation: operation.generation,
      objectKeys: parseWorkspaceObjectKeys(operation.object_keys_json),
      existing,
      completed: operation.state === "completed",
    };
  }

  private listConversationWorkspaceRows(conversationId: string): WorkspaceConversationRefRow[] {
    return this.sql<WorkspaceConversationRefRow>`
      SELECT refs.conversation_id, refs.file_id, refs.version_id,
        files.path, files.name, versions.size, versions.media_type, versions.checksum,
        versions.object_key, versions.generation, versions.ingest_status, versions.ingest_generation,
        versions.ingest_attempts, versions.ingest_error, versions.extracted_object_key,
        versions.extracted_checksum, versions.extracted_bytes, versions.extracted_chars
      FROM conversation_file_refs AS refs
      INNER JOIN workspace_files AS files ON files.id = refs.file_id AND files.deleted_at = 0
      INNER JOIN workspace_file_versions AS versions
        ON versions.id = refs.version_id AND versions.file_id = refs.file_id AND versions.state = 'ready'
      WHERE refs.conversation_id = ${conversationId}
      ORDER BY refs.created_at ASC, refs.file_id ASC
    `;
  }

  private listConversationWorkspaceFiles(conversationId: string): WorkspaceConversationFileRef[] {
    return this.listConversationWorkspaceRows(conversationId).map((row) => ({
      fileId: row.file_id,
      versionId: row.version_id,
      path: row.path,
      name: row.name,
      size: Math.max(0, row.size),
      mediaType: normalizeWorkspaceMediaType(row.media_type),
      checksum: normalizeWorkspaceChecksum(row.checksum),
    }));
  }

  private getWorkspaceResolvedVersion(fileId: string, versionId: string): WorkspaceResolvedFileVersion | undefined {
    const row = this.sql<WorkspaceConversationRefRow>`
      SELECT '' AS conversation_id, files.id AS file_id, versions.id AS version_id,
        files.path, files.name, versions.size, versions.media_type, versions.checksum,
        versions.object_key, versions.generation, versions.ingest_status, versions.ingest_generation,
        versions.ingest_attempts, versions.ingest_error, versions.extracted_object_key,
        versions.extracted_checksum, versions.extracted_bytes, versions.extracted_chars
      FROM workspace_files AS files
      INNER JOIN workspace_file_versions AS versions ON versions.file_id = files.id
      WHERE files.id = ${fileId} AND files.deleted_at = 0
        AND versions.id = ${versionId} AND versions.state = 'ready'
      LIMIT 1
    `[0];
    return row
      ? {
          fileId: row.file_id,
          versionId: row.version_id,
          path: row.path,
          name: row.name,
          size: Math.max(0, row.size),
          mediaType: normalizeWorkspaceMediaType(row.media_type),
          checksum: normalizeWorkspaceChecksum(row.checksum),
          objectKey: row.object_key,
          generation: row.generation,
          ingestStatus: normalizeDocumentIngestStatus(row.ingest_status),
          ingestGeneration: Math.max(1, row.ingest_generation),
          ingestAttempts: Math.max(0, row.ingest_attempts),
          ingestError: row.ingest_error,
          extractedObjectKey: row.extracted_object_key,
          extractedChecksum: normalizeWorkspaceChecksum(row.extracted_checksum),
          extractedBytes: Math.max(0, row.extracted_bytes),
          extractedChars: Math.max(0, row.extracted_chars),
        }
      : undefined;
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
      conversation: this.conversationSummary(conversation),
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
        parent_chat_id, skill_mode, skill_ids, message_count, deleted_at
      ) VALUES (
        ${input.id}, ${input.title}, ${input.createdAt}, ${input.updatedAt}, ${input.summary},
        ${input.pinned ? 1 : 0}, ${input.routeId || ""}, ${input.parentChatId || ""},
        ${normalizeSkillMode(input.skillMode)}, ${JSON.stringify(normalizeSkillIds(input.skillIds))},
        ${Math.max(0, Math.floor(input.messageCount || 0))}, ${deletedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        summary = excluded.summary,
        pinned = excluded.pinned,
        route_id = excluded.route_id,
        parent_chat_id = excluded.parent_chat_id,
        skill_mode = excluded.skill_mode,
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

  private isToolTrusted(conversationId: string, toolId: string, reviewRevision: string): boolean {
    const rows = this.sql<{ trusted: number }>`
      SELECT 1 AS trusted
      FROM capability_tool_trust
      WHERE conversation_id = ${conversationId}
        AND tool_id = ${toolId}
        AND review_revision = ${reviewRevision}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  private markToolTrusted(conversationId: string, toolId: string, reviewRevision: string): void {
    this.sql`
      INSERT INTO capability_tool_trust (conversation_id, tool_id, review_revision, approved_at)
      VALUES (${conversationId}, ${toolId}, ${reviewRevision}, ${Date.now()})
      ON CONFLICT(conversation_id, tool_id, review_revision)
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
    skillMode: normalizeSkillMode(input.skillMode),
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
    skillMode: normalizeSkillMode(input.skillMode),
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
  const skillMode = normalizeSkillMode(value.skillMode);
  const skillIds = normalizeSkillIds(value.skillIds);
  return {
    ...(routeId ? { routeId } : {}),
    skillMode,
    skillIds,
  };
}

function normalizeAgentMessageMetadata(value: unknown): AgentMessageMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const finishReason = value.finishReason === "length" ? "length" as const : undefined;
  const skillSelection = normalizeAgentSkillSelectionMetadata(value.skillSelection);
  return finishReason || skillSelection
    ? { ...(finishReason ? { finishReason } : {}), ...(skillSelection ? { skillSelection } : {}) }
    : undefined;
}

function normalizeAgentSkillSelectionMetadata(value: unknown): AgentSkillSelectionMetadata | undefined {
  if (!isRecord(value) || value.mode !== "automatic") return undefined;
  const source = value.source;
  if (source !== "model" && source !== "last_success" && source !== "admin_default") return undefined;
  if (!Array.isArray(value.skills) || value.skills.length > MAX_SELECTED_SKILLS) return undefined;
  const skills = value.skills.flatMap((skill) => {
    if (!isRecord(skill)) return [];
    const id = boundedString(skill.id, 80);
    const label = boundedString(skill.label, 80);
    return id && label ? [{ id, label }] : [];
  });
  if (skills.length !== value.skills.length || new Set(skills.map(({ id }) => id)).size !== skills.length) return undefined;
  const reason = value.reason;
  if (
    reason !== undefined
    && reason !== "timeout"
    && reason !== "provider_busy"
    && reason !== "provider_error"
    && reason !== "empty_response"
    && reason !== "invalid_response"
    && reason !== "no_valid_skills"
  ) return undefined;
  return { mode: "automatic", source, skills, ...(reason ? { reason } : {}) };
}

function findPreviousUserMessageIndex(messages: UIMessage[], beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function conversationRowToSummary(row: ConversationRow): Omit<AgentConversationSummary, "workspaceFiles"> {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: row.summary,
    pinned: row.pinned === 1,
    routeId: row.route_id || undefined,
    parentChatId: row.parent_chat_id || undefined,
    skillMode: normalizeSkillMode(row.skill_mode),
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

function normalizeSkillMode(value: unknown): ConversationSkillMode {
  return value === "automatic" ? "automatic" : "manual";
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

function finitePositiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function normalizeWorkspaceFileState(value: unknown): WorkspaceFileProjection["state"] {
  return value === "uploading" || value === "ready" || value === "failed" || value === "deleting" || value === "deleted"
    ? value
    : "failed";
}

function normalizeWorkspaceFileVersionState(value: unknown): WorkspaceFileVersionProjection["state"] | undefined {
  return value === "pending" || value === "ready" || value === "failed" || value === "deleting"
    ? value
    : undefined;
}

function normalizeDocumentIngestStatus(value: unknown): DocumentIngestStatus {
  return value === "queued" || value === "extracting" || value === "ready" || value === "failed" || value === "deleted"
    ? value
    : "failed";
}

function normalizeDocumentIngestMessage(value: unknown): DocumentIngestMessage | undefined {
  if (!isRecord(value)) return undefined;
  const ownerId = typeof value.ownerId === "string" ? value.ownerId.trim() : "";
  const fileId = normalizeWorkspaceEntityId(value.fileId);
  const versionId = normalizeWorkspaceEntityId(value.versionId);
  const generation = finitePositiveInteger(value.generation);
  return ownerId && ownerId.length <= 120 && fileId && versionId && generation
    ? { ownerId, fileId, versionId, generation }
    : undefined;
}

function normalizeDocumentIngestArtifact(value: unknown): DocumentIngestArtifact | undefined {
  if (!isRecord(value)) return undefined;
  const objectKey = typeof value.objectKey === "string" && value.objectKey.length <= 1_024 ? value.objectKey : "";
  const checksum = normalizeWorkspaceChecksum(value.checksum);
  const bytes = finiteNonNegativeInteger(value.bytes);
  const chars = finiteNonNegativeInteger(value.chars);
  return objectKey && checksum && bytes !== undefined && chars !== undefined
    ? { objectKey, checksum, bytes, chars }
    : undefined;
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function escapeWorkspaceLike(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function encodeWorkspaceCursor(cursor: WorkspaceCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function decodeWorkspaceCursor(value: unknown): WorkspaceCursor | undefined {
  if (typeof value !== "string" || !value || value.length > 240 || !/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  try {
    const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (!isRecord(parsed)) return undefined;
    const pinned = parsed.pinned === 0 || parsed.pinned === 1 ? parsed.pinned : undefined;
    const updatedAt = finitePositiveInteger(parsed.updatedAt);
    const id = normalizeWorkspaceEntityId(parsed.id);
    return pinned !== undefined && updatedAt && id ? { pinned, updatedAt, id } : undefined;
  } catch {
    return undefined;
  }
}

function parseWorkspaceObjectKeys(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => (
      typeof item === "string"
      && item.length > 0
      && item.length <= 1_024
      && !/[\u0000-\u001f\u007f]/u.test(item)
    )))];
  } catch {
    return [];
  }
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

async function contentFingerprintBytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return hexBytes(digest);
}

function hexBytes(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function workspaceUnavailableContext(
  file: WorkspaceResolvedFileVersion,
  reason:
    | "document_ingest_queued"
    | "document_ingest_extracting"
    | "document_ingest_failed"
    | "document_ingest_deleted"
    | "text_file_too_large"
    | "text_context_too_large",
): string {
  const name = file.path.replace(/["<>\u0000-\u001f\u007f]/gu, "_").slice(0, 1_024);
  const mediaType = file.mediaType.replace(/["<>\u0000-\u001f\u007f]/gu, "_").slice(0, 120);
  return `<attached_file_unavailable name="${name}" mediaType="${mediaType}" reason="${reason}" />`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function chatErrorResponse(error: string, status: number): Response {
  const errorText = serializeAgentErrorEnvelope(error);
  const body = `data: ${JSON.stringify({ type: "error", errorText })}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
