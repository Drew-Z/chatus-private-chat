import type { UIMessage } from "ai";

export const MAX_AGENT_CONVERSATIONS = 50;

export type TeamAgentScope = "root" | "conversation";

export type TeamAgentProps = {
  userLabel: string;
  scope: TeamAgentScope;
  chatId?: string;
  rootInstance?: string;
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
  skillIds: string[];
  messageCount: number;
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

export type AgentConversationInput = Omit<AgentConversationSummary, "messageCount"> & {
  messageCount?: number;
};

export type AgentConversationPatch = {
  id: string;
  expectedUpdatedAt: number;
  title?: string;
  routeId?: string;
  skillIds?: string[];
};

export type AgentConversationMutationResult = {
  ok: boolean;
  error?: "conversation_not_found" | "conversation_deleted" | "conversation_conflict" | "conversation_limit_reached";
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
};

export type AgentConversationActivity = {
  id: string;
  messageCount: number;
  titleCandidate?: string;
  routeId?: string;
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
