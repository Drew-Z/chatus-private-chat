export function restoreRejectedDraft(currentInput: string, submittedDraft: string): string {
  return currentInput || submittedDraft;
}

export function conversationAgentClientName(rootInstance: string, chatId: string): string {
  return JSON.stringify([rootInstance, chatId]);
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

export function hasVisibleAssistantTextAfterLatestUser(
  messages: ReadonlyArray<{ role: string; parts?: ReadonlyArray<{ type: string; text?: string }> }>,
): boolean {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return false;
  return messages.slice(latestUserIndex + 1).some((message) => (
    message.role === "assistant"
      && message.parts?.some((part) => part.type === "text" && Boolean(part.text?.trim()))
  ));
}
