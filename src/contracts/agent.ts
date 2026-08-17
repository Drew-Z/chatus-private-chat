import type { UIMessage } from "ai";
import type { SessionKind } from "./session";
import {
  decodeConversationAccessSnapshot,
  isPrincipalId,
  isResourceId,
  normalizeMemberAlias,
  type ConversationAccessRoleV1,
  type ConversationAccessSnapshotV1,
} from "./identity";
import type { WorkspaceConversationFileRef } from "./workspace-file";

export const MAX_AGENT_CONVERSATIONS = 50;
export const AGENT_MEMORY_PROPOSAL_TOOL_NAME = "chatus_update_memory";
export const CONVERSATION_AGENT_ACCESS_HEADER = "X-Chatus-Conversation-Access";
export const CONVERSATION_AGENT_ACCESS_BODY_KEY = "__chatusConversationAccess";

export type ConversationSkillMode = "automatic" | "manual";

export type AgentSkillSelectionSource = "model" | "last_success" | "admin_default";

export type AgentSkillSelectionReason =
  | "timeout"
  | "provider_busy"
  | "provider_error"
  | "empty_response"
  | "invalid_response"
  | "no_valid_skills";

export type AgentSkillSelectionMetadata = {
  mode: "automatic";
  source: AgentSkillSelectionSource;
  skills: Array<{ id: string; label: string }>;
  reason?: AgentSkillSelectionReason;
};

export type AgentMessageMetadata = {
  finishReason?: "length";
  skillSelection?: AgentSkillSelectionMetadata;
};

export type TeamAgentScope = "root" | "conversation";

export type TeamAgentProps = {
  userLabel: string;
  scope: TeamAgentScope;
  chatId?: string;
  rootInstance?: string;
  accessKind?: SessionKind;
  sessionExpiresAt?: number;
  sourceKey?: string;
};

export type TeamAgentIdentityError =
  | "agent_identity_unavailable"
  | "agent_identity_conflict"
  | "agent_identity_corrupt";

export type TeamAgentIdentityResult =
  | { ok: true }
  | { ok: false; error: TeamAgentIdentityError };

export type TeamAgentState = {
  version: 1;
  runtime: "cloudflare-ai-chat";
};

export type AgentConversationSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  summary: string;
  pinned: boolean;
  routeId?: string;
  parentChatId?: string;
  skillMode: ConversationSkillMode;
  skillIds: string[];
  workspaceFiles: WorkspaceConversationFileRef[];
  messageCount: number;
};

export type ConversationAgentAccessContextV1 = {
  version: 1;
  access: ConversationAccessSnapshotV1;
  actor: {
    label: string;
    principalId: string;
    rootInstanceName: string;
    userStateInstanceName: string;
    registryRevision: number;
    sessionExpiresAt: number;
  };
};

export type ConversationAgentAccessRevisionV1 = {
  version: 1;
  resourceId: string;
  accessRevision: number;
};

export function decodeConversationAgentAccessContext(
  value: unknown,
): ConversationAgentAccessContextV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "access", "actor"])) return undefined;
  const access = decodeConversationAccessSnapshot(value.access);
  if (!access || value.version !== 1 || !isRecord(value.actor) || !hasExactKeys(value.actor, [
    "label", "principalId", "rootInstanceName", "userStateInstanceName",
    "registryRevision", "sessionExpiresAt",
  ])) return undefined;
  const label = normalizeMemberAlias(value.actor.label);
  const rootInstanceName = boundedIdentityString(value.actor.rootInstanceName);
  const userStateInstanceName = boundedIdentityString(value.actor.userStateInstanceName);
  if (
    !label || !isPrincipalId(value.actor.principalId)
    || value.actor.principalId !== access.actorPrincipalId
    || !rootInstanceName || !userStateInstanceName
    || !isPositiveSafeInteger(value.actor.registryRevision)
    || typeof value.actor.sessionExpiresAt !== "number"
    || !Number.isSafeInteger(value.actor.sessionExpiresAt)
    || value.actor.sessionExpiresAt <= 0
  ) return undefined;
  return {
    version: 1,
    access,
    actor: {
      label,
      principalId: value.actor.principalId,
      rootInstanceName,
      userStateInstanceName,
      registryRevision: value.actor.registryRevision,
      sessionExpiresAt: value.actor.sessionExpiresAt,
    },
  };
}

export function decodeConversationAgentAccessRevision(
  value: unknown,
): ConversationAgentAccessRevisionV1 | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "resourceId", "accessRevision"])) {
    return undefined;
  }
  if (value.version !== 1 || !isResourceId(value.resourceId) || !isPositiveSafeInteger(value.accessRevision)) {
    return undefined;
  }
  return { version: 1, resourceId: value.resourceId, accessRevision: value.accessRevision };
}

function boundedIdentityString(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= 180 && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : "";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

export type AgentAccessibleConversationSummary = AgentConversationSummary & {
  resourceId: string;
  accessRole: ConversationAccessRoleV1;
  accessRevision: number;
};

export type AgentExportPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; name?: string };

export type AgentExportMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: AgentExportPart[];
};

export type AgentExportMessagesResult = {
  messages: AgentExportMessage[];
  truncated: boolean;
};

export type AgentConversationInput = Omit<
  AgentConversationSummary,
  "messageCount" | "workspaceFiles" | "skillMode"
> & {
  skillMode?: ConversationSkillMode;
  messageCount?: number;
  workspaceFiles?: WorkspaceConversationFileRef[];
};

export type AgentConversationPatch = {
  id: string;
  expectedUpdatedAt: number;
  title?: string;
  pinned?: boolean;
  routeId?: string;
  skillMode?: ConversationSkillMode;
  skillIds?: string[];
};

export type AgentConversationMutationResult = {
  ok: boolean;
  error?:
    | "conversation_not_found"
    | "conversation_deleted"
    | "conversation_conflict"
    | "conversation_limit_reached"
    | "workspace_account_purge_in_progress";
  conversation?: AgentConversationSummary;
  current?: AgentConversationSummary;
  created?: boolean;
  deleted?: boolean;
};

export type AgentConversationCleanupRecord = {
  chatId: string;
  requestedAt: number;
  attempts: number;
  lastAttemptAt: number;
  nextAttemptAt: number;
  terminalAt: number;
  lastError: string;
};

export type AgentCleanupSummary = {
  conversation: AgentCleanupSummaryGroup;
  workspace: AgentCleanupSummaryGroup;
  account: AgentCleanupSummaryGroup;
  guest: AgentCleanupSummaryGroup;
  scheduledAt: number;
};

export type AgentCleanupSummaryGroup = {
  pending: number;
  terminal: number;
  oldestDueAt: number;
  maxAttempts: number;
};

export type AgentGuestCleanupTicket = {
  version: 1;
  markerKey: string;
  expiresAt: number;
  attempts: number;
  nextAttemptAt: number;
  terminalAt: number;
  lastError: string;
};

export type AgentConversationActivity = {
  id: string;
  messageCount: number;
  titleCandidate?: string;
  routeId?: string;
  skillMode?: ConversationSkillMode;
  skillIds?: string[];
};

export type AgentConversationBranchAction =
  | "branch"
  | "edit"
  | "resend"
  | "regenerate"
  | "continue";

export type AgentConversationBranchLaunch = "none" | "respond" | "continue";

export type AgentConversationBranchInput = {
  requestId: string;
  fingerprint: string;
  sourceId: string;
  sourceMessageId: string;
  sourceMessageCount: number;
  action: AgentConversationBranchAction;
  expectedUpdatedAt: number;
  destinationId: string;
  title: string;
  routeId?: string;
  skillMode?: ConversationSkillMode;
  skillIds?: string[];
  launch: AgentConversationBranchLaunch;
};

export type AgentConversationBranchOperation = {
  requestId: string;
  sourceId: string;
  sourceMessageId: string;
  sourceMessageCount: number;
  destinationId: string;
  launch: AgentConversationBranchLaunch;
  anchorMessageId?: string;
  state: "reserved" | "ready" | "launched" | "failed";
  conversation: AgentConversationSummary;
};

export type AgentConversationBranchReservationResult =
  | { ok: true; operation: AgentConversationBranchOperation; existing: boolean }
  | {
      ok: false;
      error:
        | "conversation_not_found"
        | "conversation_deleted"
        | "conversation_conflict"
        | "conversation_limit_reached"
        | "branch_request_conflict"
        | "branch_failed";
      current?: AgentConversationSummary;
    };

export type AgentConversationBranchSnapshotInput = {
  sourceMessageId: string;
  sourceMessageCount: number;
  action: AgentConversationBranchAction;
  editedText?: string;
  replacementMessageId: string;
};

export type AgentConversationBranchSnapshotResult =
  | {
      ok: true;
      messages: UIMessage[];
      launch: AgentConversationBranchLaunch;
      anchorMessageId?: string;
    }
  | {
      ok: false;
      error:
        | "conversation_busy"
        | "conversation_conflict"
        | "message_not_found"
        | "branch_action_not_allowed"
        | "edited_text_required";
    };

export type AgentConversationBranchCopyInput = AgentConversationBranchSnapshotInput & {
  requestId: string;
  fingerprint: string;
  destinationId: string;
  destinationInstance: string;
  body: Record<string, unknown>;
};

export type AgentConversationBranchCopyResult =
  | {
      ok: true;
      launch: AgentConversationBranchLaunch;
      anchorMessageId?: string;
      messageCount: number;
    }
  | {
      ok: false;
      error:
        | "conversation_busy"
        | "conversation_conflict"
        | "message_not_found"
        | "branch_action_not_allowed"
        | "edited_text_required"
        | "branch_request_conflict"
        | "branch_copy_conflict";
    };

export type AgentConversationBranchStartInput = {
  requestId: string;
  fingerprint: string;
  messages: UIMessage[];
  launch: AgentConversationBranchLaunch;
  body: Record<string, unknown>;
  anchorMessageId?: string;
};

export type AgentConversationBranchStartResult =
  | { ok: true; started: boolean; state: "ready" | "scheduled" | "already_started" }
  | {
      ok: false;
      error: "branch_request_conflict" | "conversation_busy" | "branch_copy_conflict";
    };

export type AgentMemoryRecord = {
  memory: string;
  revision: string;
  updatedAt: number;
};

export type AgentMemoryMutationResult = {
  ok: boolean;
  error?: "memory_conflict";
  record?: AgentMemoryRecord;
  current?: AgentMemoryRecord;
};

export type LegacyConversationImport = {
  conversation: AgentConversationInput;
  messages: UIMessage[];
};
