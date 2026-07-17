export function restoreRejectedDraft(currentInput: string, submittedDraft: string): string {
  return currentInput || submittedDraft;
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
