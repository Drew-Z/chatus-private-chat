export function restoreRejectedDraft(currentInput: string, submittedDraft: string): string {
  return currentInput || submittedDraft;
}

export type ComposerQuotaState =
  | { status: "unknown" }
  | { status: "available"; used: number; limit: number; remaining: number }
  | { status: "exhausted"; used: number; limit: number; remaining: 0 };

export function resolveComposerQuota(
  usage: { used: number; limit: number; remaining: number } | null | undefined,
): ComposerQuotaState {
  if (!usage
    || !Number.isSafeInteger(usage.used)
    || !Number.isSafeInteger(usage.limit)
    || !Number.isSafeInteger(usage.remaining)
    || usage.used < 0
    || usage.limit <= 0
    || usage.remaining < 0
    || usage.remaining > usage.limit) {
    return { status: "unknown" };
  }
  if (usage.remaining === 0) {
    return { status: "exhausted", used: usage.used, limit: usage.limit, remaining: 0 };
  }
  return { status: "available", ...usage };
}

export function conversationAgentClientName(rootInstance: string, chatId: string): string {
  return JSON.stringify([rootInstance, chatId]);
}

export function orderConversationRail<T extends {
  id: string;
  pinned: boolean;
  updatedAt: number;
}>(conversations: readonly T[]): T[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((left, right) => {
      if (left.conversation.pinned !== right.conversation.pinned) {
        return left.conversation.pinned ? -1 : 1;
      }
      if (left.conversation.updatedAt !== right.conversation.updatedAt) {
        return right.conversation.updatedAt - left.conversation.updatedAt;
      }
      return left.index - right.index;
    })
    .map(({ conversation }) => conversation);
}

export type ConversationAccessPermissions = {
  canSend: boolean;
  canRename: boolean;
  canManageSettings: boolean;
  canBranch: boolean;
  canDelete: boolean;
  canManageShares: boolean;
  canUseWorkspace: boolean;
  canUseConversationTools: boolean;
  canSubmitFeedback: boolean;
};

export function resolveConversationAccessPermissions(
  role: ConversationAccessRoleV1 | undefined,
): ConversationAccessPermissions {
  if (!role || role === "owner") {
    return {
      canSend: true,
      canRename: true,
      canManageSettings: true,
      canBranch: true,
      canDelete: true,
      canManageShares: true,
      canUseWorkspace: true,
      canUseConversationTools: true,
      canSubmitFeedback: true,
    };
  }
  if (role === "editor") {
    return {
      canSend: true,
      canRename: true,
      canManageSettings: false,
      canBranch: false,
      canDelete: false,
      canManageShares: false,
      canUseWorkspace: false,
      canUseConversationTools: false,
      canSubmitFeedback: false,
    };
  }
  return {
    canSend: false,
    canRename: false,
    canManageSettings: false,
    canBranch: false,
    canDelete: false,
    canManageShares: false,
    canUseWorkspace: false,
    canUseConversationTools: false,
    canSubmitFeedback: false,
  };
}

export function resolveLoadedMemoryDraft(
  currentDraft: string,
  serverMemory: string,
  preserveDraft: boolean,
): string {
  return preserveDraft ? currentDraft : serverMemory;
}

export function resolvePendingDraftAction(
  status: string,
  hasError: boolean,
  requestSettled: boolean,
): "keep" | "restore" | "clear" {
  if (status === "error" || hasError) return "restore";
  if (requestSettled && status === "ready") return "clear";
  return "keep";
}

export function findRetrySourceMessageId(
  messages: ReadonlyArray<{ id: string; role: string }>,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index].id;
  }
  return undefined;
}

type TurnMessagePart = {
  type: string;
  text?: string;
  state?: string;
};

type TurnMessage = {
  role: string;
  parts?: ReadonlyArray<TurnMessagePart>;
};

export type TurnPhase =
  | "idle"
  | "submitted"
  | "waiting-first-output"
  | "streaming"
  | "tool-running"
  | "recovering"
  | "completed"
  | "stopped"
  | "failed";

export type MessageActionState = "hidden" | "enabled" | "disabled";

export type MessageActionAvailability = {
  copy: MessageActionState;
  edit: MessageActionState;
  resend: MessageActionState;
  regenerate: MessageActionState;
  continue: MessageActionState;
  branch: MessageActionState;
  feedback: MessageActionState;
  approveTool: MessageActionState;
  retry: MessageActionState;
};

export function resolveTurnPhase({
  status,
  isStreaming,
  isRecovering,
  hasError,
  stopped,
  messages,
}: {
  status: string;
  isStreaming: boolean;
  isRecovering: boolean;
  hasError: boolean;
  stopped: boolean;
  messages: ReadonlyArray<TurnMessage>;
}): TurnPhase {
  const active = status === "submitted" || status === "streaming" || isStreaming;
  if (isRecovering) return "recovering";
  if (hasError || status === "error") return stopped && !active ? "stopped" : "failed";
  if (hasActiveToolAfterLatestUser(messages)) return "tool-running";
  if (status === "submitted") return "submitted";
  if (active && !hasVisibleAssistantOutputAfterLatestUser(messages)) return "waiting-first-output";
  if (active) return "streaming";
  if (stopped) return "stopped";
  return messages.some((message) => message.role === "user") ? "completed" : "idle";
}

export function isActiveTurnPhase(phase: TurnPhase): boolean {
  return phase === "submitted"
    || phase === "waiting-first-output"
    || phase === "streaming"
    || phase === "tool-running"
    || phase === "recovering";
}

export function resolveMessageActionAvailability({
  phase,
  role,
  isLatestMessage,
  online,
  blocked,
  routeAvailable,
  messageActionsEnabled,
  feedbackEnabled,
  hasText,
  canContinue,
  toolApprovalPending,
  accessRole,
}: {
  phase: TurnPhase;
  role: string;
  isLatestMessage: boolean;
  online: boolean;
  blocked: boolean;
  routeAvailable: boolean;
  messageActionsEnabled: boolean;
  feedbackEnabled: boolean;
  hasText: boolean;
  canContinue: boolean;
  toolApprovalPending: boolean;
  accessRole?: ConversationAccessRoleV1;
}): MessageActionAvailability {
  const permissions = resolveConversationAccessPermissions(accessRole);
  const stable = phase === "idle" || phase === "completed" || phase === "stopped" || phase === "failed";
  const interactionReady = online && !blocked && stable;
  const generationReady = interactionReady && routeAvailable;
  const userActionsVisible = messageActionsEnabled && permissions.canBranch && role === "user";
  const assistantActionsVisible = messageActionsEnabled && permissions.canBranch && role === "assistant";
  const feedbackVisible = feedbackEnabled && permissions.canSubmitFeedback && role === "assistant";
  const retryVisible = messageActionsEnabled && permissions.canBranch && phase === "failed" && isLatestMessage;

  return {
    copy: actionState(hasText, hasText),
    edit: actionState(userActionsVisible, generationReady),
    resend: actionState(userActionsVisible, generationReady),
    regenerate: actionState(assistantActionsVisible, generationReady),
    continue: actionState(assistantActionsVisible && canContinue, generationReady),
    branch: actionState(userActionsVisible || assistantActionsVisible, interactionReady),
    feedback: actionState(feedbackVisible, generationReady),
    approveTool: actionState(
      permissions.canUseConversationTools && toolApprovalPending,
      online && !blocked && phase === "tool-running",
    ),
    retry: actionState(retryVisible, generationReady),
  };
}

export function hasVisibleAssistantOutputAfterLatestUser(messages: ReadonlyArray<TurnMessage>): boolean {
  return assistantMessagesAfterLatestUser(messages).some((message) => (
    message.parts?.some(isVisibleAssistantPart)
  ));
}

export function hasPendingToolApprovalAfterLatestUser(messages: ReadonlyArray<TurnMessage>): boolean {
  return assistantMessagesAfterLatestUser(messages).some((message) => (
    message.parts?.some(isPendingToolApprovalPart)
  ));
}

export function isPendingToolApprovalPart(part: TurnMessagePart): boolean {
  return isToolPart(part) && part.state === "approval-requested";
}

function actionState(visible: boolean, enabled: boolean): MessageActionState {
  if (!visible) return "hidden";
  return enabled ? "enabled" : "disabled";
}

function assistantMessagesAfterLatestUser(messages: ReadonlyArray<TurnMessage>): ReadonlyArray<TurnMessage> {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return [];
  return messages.slice(latestUserIndex + 1).filter((message) => message.role === "assistant");
}

function hasActiveToolAfterLatestUser(messages: ReadonlyArray<TurnMessage>): boolean {
  return assistantMessagesAfterLatestUser(messages).some((message) => (
    message.parts?.some((part) => isToolPart(part) && (
      part.state === "input-streaming"
      || part.state === "input-available"
      || part.state === "approval-requested"
      || part.state === "approval-responded"
    ))
  ));
}

function isVisibleAssistantPart(part: TurnMessagePart): boolean {
  if (part.type === "text" || part.type === "reasoning") return Boolean(part.text?.trim());
  return part.type === "file"
    || part.type === "source-url"
    || part.type === "source-document"
    || isToolPart(part);
}

function isToolPart(part: TurnMessagePart): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}
import type { ConversationAccessRoleV1 } from "../../../src/contracts/identity";
