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
