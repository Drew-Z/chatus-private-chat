import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, RotateCw, WifiOff } from "lucide-react";
import {
  ApiError,
  createAgentConversationBranch,
  createAgentConversation,
  deleteAgentConversation,
  deleteUserData,
  exportUserData,
  listAgentConversations,
  revokeAllSessions,
  submitFeedback,
  updateAgentConversation,
  type AgentConversationBranchAction,
  type AgentConversation,
  type SessionProjection,
} from "../lib/api";
import { friendlyAgentError } from "../lib/agent-errors";
import {
  conversationAgentClientName,
  findRetrySourceMessageId,
  hasVisibleAssistantTextAfterLatestUser,
  resolvePendingDraftAction,
  restoreRejectedDraft,
} from "../lib/state";
import {
  addDraftAttachmentFiles,
  readDraftAttachment,
  releaseAttachmentPreviews,
  restoreRejectedAttachments,
  toAttachmentFileParts,
  type DraftAttachment,
} from "../lib/image-input";
import { ConversationSidebar } from "./ConversationSidebar";
import { MemoryPanel } from "./MemoryPanel";
import { MessageComposer } from "./MessageComposer";
import { MessageView, type MessageAction } from "./MessageView";
import { WorkspaceHeader, type ConnectionState } from "./WorkspaceHeader";
import type { UIMessage } from "ai";

export function ChatWorkspace({
  session,
  onMemberLogin,
  onLogout,
}: {
  session: SessionProjection;
  onMemberLogin: () => void;
  onLogout: () => Promise<void>;
}) {
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [routeId, setRouteId] = useState(session.defaultRoute);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<"history" | "settings">("history");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const bootstrapped = useRef(false);
  const conversationSnapshots = useRef(new Map<string, AgentConversation>());
  const settingsQueues = useRef(new Map<string, Promise<void>>());
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;

  const refreshConversations = useCallback(async (preferredId?: string) => {
    const next = await listAgentConversations();
    conversationSnapshots.current = new Map(next.map((conversation) => [conversation.id, conversation]));
    setConversations(next);
    setActiveId((current) => {
      const candidate = preferredId || current || localStorage.getItem(activeConversationKey(session.user)) || "";
      return next.some((conversation) => conversation.id === candidate) ? candidate : next[0]?.id || "";
    });
    return next;
  }, [session.user]);

  const createConversation = useCallback(async () => {
    setWorkspaceError("");
    try {
      const created = await createAgentConversation({ routeId: session.defaultRoute, skillIds: [] });
      conversationSnapshots.current.set(created.id, created);
      setConversations((current) => [created, ...current.filter((conversation) => conversation.id !== created.id)]);
      setActiveId(created.id);
      setSidebarOpen(false);
    } catch (error) {
      setWorkspaceError(errorMessage(error, "新建会话失败，请稍后重试。"));
    }
  }, [session.defaultRoute]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      try {
        const next = await refreshConversations();
        if (!next.length) await createConversation();
      } catch (error) {
        setWorkspaceError(errorMessage(error, "暂时无法读取会话，请重试。"));
      } finally {
        setLoading(false);
      }
    })();
  }, [createConversation, refreshConversations]);

  useEffect(() => {
    if (!activeConversation) return;
    const allowedRoutes = new Set(session.routes.map((route) => route.id));
    const allowedSkills = new Set(session.skills.map((skill) => skill.id));
    setRouteId(activeConversation.routeId && allowedRoutes.has(activeConversation.routeId)
      ? activeConversation.routeId
      : session.defaultRoute);
    setSkillIds(activeConversation.skillIds.filter((id) => allowedSkills.has(id)).slice(0, 3));
    localStorage.setItem(activeConversationKey(session.user), activeConversation.id);
  }, [activeConversation, session.defaultRoute, session.routes, session.skills, session.user]);

  const updateConversationInList = useCallback((updated: AgentConversation) => {
    conversationSnapshots.current.set(updated.id, updated);
    setConversations((current) => {
      const exists = current.some((conversation) => conversation.id === updated.id);
      return (exists
        ? current.map((conversation) => conversation.id === updated.id ? updated : conversation)
        : [updated, ...current]
      ).sort((left, right) => right.updatedAt - left.updatedAt);
    });
  }, []);

  const handleBranch = useCallback(async (
    source: AgentConversation,
    action: AgentConversationBranchAction,
    sourceMessageId: string,
    editedText?: string,
  ) => {
    if (busy || accountBusy) throw new Error("请先停止当前任务。");
    setWorkspaceError("");
    const currentSource = conversationSnapshots.current.get(source.id) || source;
    const result = await createAgentConversationBranch(currentSource, {
      requestId: `branch-${crypto.randomUUID()}`,
      action,
      sourceMessageId,
      ...(editedText === undefined ? {} : { editedText }),
    });
    updateConversationInList(result.conversation);
    setActiveId(result.conversation.id);
    setSidebarOpen(false);
  }, [accountBusy, busy, updateConversationInList]);

  const renameConversation = async (conversation: AgentConversation, title: string) => {
    setWorkspaceError("");
    try {
      await settingsQueues.current.get(conversation.id);
      const current = conversationSnapshots.current.get(conversation.id) || conversation;
      updateConversationInList(await updateAgentConversation(current, { title }));
    } catch (error) {
      setWorkspaceError(errorMessage(error, "重命名失败，请刷新后重试。"));
      if (error instanceof ApiError && error.code === "conversation_conflict") await refreshConversations(conversation.id);
      throw error;
    }
  };

  const removeConversation = async (conversation: AgentConversation) => {
    setWorkspaceError("");
    try {
      await settingsQueues.current.get(conversation.id);
      const current = conversationSnapshots.current.get(conversation.id) || conversation;
      const remaining = await deleteAgentConversation(current);
      conversationSnapshots.current = new Map(remaining.map((item) => [item.id, item]));
      setConversations(remaining);
      if (activeId === conversation.id) {
        if (remaining[0]) setActiveId(remaining[0].id);
        else await createConversation();
      }
      localStorage.removeItem(conversationDraftKey(session.user, conversation.id));
    } catch (error) {
      setWorkspaceError(errorMessage(error, "删除失败，请刷新后重试。"));
      if (error instanceof ApiError && error.code === "conversation_conflict") await refreshConversations(conversation.id);
      throw error;
    }
  };

  const persistSettings = (patch: { routeId?: string; skillIds?: string[] }): Promise<void> => {
    const conversationId = activeConversation?.id;
    if (!conversationId) return Promise.resolve();
    setWorkspaceError("");
    const previous = settingsQueues.current.get(conversationId) || Promise.resolve();
    let task: Promise<void>;
    task = previous.then(async () => {
      const current = conversationSnapshots.current.get(conversationId);
      if (!current) return;
      try {
        updateConversationInList(await updateAgentConversation(current, patch));
      } catch (error) {
        setWorkspaceError(errorMessage(error, "会话设置保存失败，请重试。"));
        await refreshConversations(conversationId).catch(() => undefined);
      }
    }).finally(() => {
      if (settingsQueues.current.get(conversationId) === task) settingsQueues.current.delete(conversationId);
    });
    settingsQueues.current.set(conversationId, task);
    return task;
  };

  const handleLogout = async () => {
    if (busy || accountBusy) return;
    clearUserDrafts(session.user);
    await onLogout();
  };

  const openRouteSettings = () => {
    setSidebarView("settings");
    setSidebarOpen(true);
  };

  const handleRevokeAllSessions = async () => {
    if (busy || accountBusy) throw new Error("请等待当前任务或账号操作完成。");
    setAccountBusy(true);
    try {
      await revokeAllSessions();
      clearUserDrafts(session.user);
      await onLogout();
    } finally {
      setAccountBusy(false);
    }
  };

  const handleDeleteUserData = async () => {
    if (busy || accountBusy) throw new Error("请等待当前任务或账号操作完成。");
    setAccountBusy(true);
    try {
      await deleteUserData();
      clearUserDrafts(session.user);
      await onLogout();
    } finally {
      setAccountBusy(false);
    }
  };

  const handleUserDataExport = async () => {
    if (busy || accountBusy) throw new Error("请等待当前任务或账号操作完成。");
    setAccountBusy(true);
    try {
      const result = await exportUserData();
      const href = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `chatus-user-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
      return { truncated: result.truncated };
    } finally {
      setAccountBusy(false);
    }
  };

  const handleConversationChanged = useCallback(() => {
    void refreshConversations(activeId).catch((error) => {
      setWorkspaceError(errorMessage(error, "会话已完成，但列表暂时无法刷新。"));
    });
  }, [activeId, refreshConversations]);

  const handleRefresh = useCallback(() => {
    setWorkspaceError("");
    void refreshConversations(activeId).catch((error) => {
      setWorkspaceError(errorMessage(error, "暂时无法读取会话，请重试。"));
    });
  }, [activeId, refreshConversations]);

  return (
    <main className="workspace-shell">
      <WorkspaceHeader
        session={session}
        conversation={activeConversation}
        routeId={routeId}
        connectionState={connectionState}
        busy={busy}
        accountBusy={accountBusy}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenRouteSettings={openRouteSettings}
        onOpenMemory={() => setMemoryOpen(true)}
        onMemberLogin={onMemberLogin}
        onLogout={handleLogout}
      />

      <div className="workspace-layout">
        <ConversationSidebar
          open={sidebarOpen}
          session={session}
          conversations={conversations}
          activeId={activeId}
          routeId={routeId}
          skillIds={skillIds}
          view={sidebarView}
          busy={busy || accountBusy}
          loading={loading}
          onClose={() => setSidebarOpen(false)}
          onViewChange={setSidebarView}
          onSelect={(conversation) => setActiveId(conversation.id)}
          onCreate={createConversation}
          onRename={renameConversation}
          onDelete={removeConversation}
          onRouteChange={(nextRouteId) => { setRouteId(nextRouteId); void persistSettings({ routeId: nextRouteId }); }}
          onSkillChange={(nextSkillIds) => { setSkillIds(nextSkillIds); void persistSettings({ skillIds: nextSkillIds }); }}
          onRevokeAllSessions={handleRevokeAllSessions}
          onDeleteUserData={handleDeleteUserData}
          onExportUserData={handleUserDataExport}
        />
        {sidebarOpen && <button className="sidebar-scrim mobile-only" type="button" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" />}

        <section className="chat-panel" aria-label="对话">
          {workspaceError && (
            <div className="workspace-error" role="alert">
              <span>{workspaceError}</span>
              <button className="icon-button" type="button" onClick={handleRefresh} title="重新读取" aria-label="重新读取"><RefreshCw size={16} /></button>
            </div>
          )}
          {loading ? (
            <div className="chat-loading">正在恢复会话...</div>
          ) : activeConversation ? (
            <ConversationChat
              key={activeConversation.id}
              session={session}
              conversation={activeConversation}
              routeId={routeId}
              skillIds={skillIds}
              blocked={accountBusy}
              onBusyChange={setBusy}
              onConnectionStateChange={setConnectionState}
              onConversationChanged={handleConversationChanged}
              onBranch={handleBranch}
            />
          ) : (
            <div className="chat-loading">
              <strong>无法打开会话</strong>
              <button className="primary-button" type="button" onClick={() => void createConversation()}>新建对话</button>
            </div>
          )}
        </section>
      </div>
      {session.capabilities.memory && <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />}
    </main>
  );
}

function ConversationChat({
  session,
  conversation,
  routeId,
  skillIds,
  blocked,
  onBusyChange,
  onConnectionStateChange,
  onConversationChanged,
  onBranch,
}: {
  session: SessionProjection;
  conversation: AgentConversation;
  routeId: string;
  skillIds: string[];
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onConversationChanged: () => void;
  onBranch: (
    source: AgentConversation,
    action: AgentConversationBranchAction,
    sourceMessageId: string,
    editedText?: string,
  ) => Promise<void>;
}) {
  const online = useOnlineStatus();
  const [input, setInput] = useState(() => localStorage.getItem(conversationDraftKey(session.user, conversation.id)) || "");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [pendingSubmission, setPendingSubmission] = useState<{
    text: string;
    attachments: DraftAttachment[];
    draftGeneration: number;
  } | null>(null);
  const [settledSubmission, setSettledSubmission] = useState(0);
  const [waitingElapsed, setWaitingElapsed] = useState(0);
  const [messageActionError, setMessageActionError] = useState("");
  const [retryBusy, setRetryBusy] = useState(false);
  const [lastSubmittedText, setLastSubmittedText] = useState("");
  const [lastSubmittedAttachments, setLastSubmittedAttachments] = useState<DraftAttachment[]>([]);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const wasBusy = useRef(false);
  const submissionGeneration = useRef(0);
  const draftGeneration = useRef(0);
  const attachmentsRef = useRef(attachments);
  const pendingSubmissionRef = useRef(pendingSubmission);
  const lastSubmittedAttachmentsRef = useRef(lastSubmittedAttachments);
  attachmentsRef.current = attachments;
  pendingSubmissionRef.current = pendingSubmission;
  lastSubmittedAttachmentsRef.current = lastSubmittedAttachments;
  const agent = useAgent({
    agent: "TeamAgent",
    name: conversationAgentClientName(session.agent.instance, conversation.id),
    basePath: session.agent.basePath,
    query: { chatId: conversation.id },
    queryDeps: [conversation.id],
    defaultCallTimeout: 30_000,
  });
  const chat = useAgentChat({
    agent,
    credentials: "include",
    resume: true,
    cancelOnClientAbort: false,
    body: () => ({ routeId, skillIds, chatId: conversation.id }),
  });
  const busy = chat.status === "submitted" || chat.status === "streaming" || chat.isStreaming || chat.isRecovering;
  const waitingFirstOutput = busy && !chat.isRecovering && !hasVisibleAssistantTextAfterLatestUser(chat.messages);
  const interactionBlocked = busy || blocked;
  const selectedRoute = session.routes.find((route) => route.id === routeId);
  const routeAvailable = Boolean(selectedRoute);
  const imagesSupported = session.capabilities.imageInput && selectedRoute?.supportsImages === true;
  const filesSupported = session.capabilities.fileInput;
  const connectionState: ConnectionState = agent.connectionError ? "error" : agent.identified ? "ready" : "connecting";

  useEffect(() => {
    onBusyChange(busy);
    if (wasBusy.current && !busy) onConversationChanged();
    wasBusy.current = busy;
    return () => onBusyChange(false);
  }, [busy, onBusyChange, onConversationChanged]);

  useEffect(() => {
    onConnectionStateChange(connectionState);
    return () => onConnectionStateChange("connecting");
  }, [connectionState, onConnectionStateChange]);

  useEffect(() => {
    if (!waitingFirstOutput) {
    setWaitingElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setWaitingElapsed(Math.max(0, Math.floor((Date.now() - started) / 1_000)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [waitingFirstOutput]);

  useEffect(() => {
    const key = conversationDraftKey(session.user, conversation.id);
    const value = input || pendingSubmission?.text || "";
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }, [conversation.id, input, pendingSubmission, session.user]);

  useEffect(() => {
    if (!pendingSubmission) return;
    const action = resolvePendingDraftAction(
      chat.status,
      Boolean(chat.error),
      settledSubmission === submissionGeneration.current,
    );
    if (action === "restore") {
      if (draftGeneration.current === pendingSubmission.draftGeneration) {
        setInput(pendingSubmission.text);
        setAttachments(pendingSubmission.attachments);
        setLastSubmittedText(pendingSubmission.text);
        setLastSubmittedAttachments(pendingSubmission.attachments);
      } else {
        releaseAttachmentPreviews(pendingSubmission.attachments);
        setLastSubmittedText("");
        setLastSubmittedAttachments([]);
      }
      setPendingSubmission(null);
      return;
    }
    if (action === "clear") {
      releaseAttachmentPreviews(pendingSubmission.attachments);
      setLastSubmittedText("");
      setLastSubmittedAttachments([]);
      setPendingSubmission(null);
    }
  }, [chat.error, chat.status, pendingSubmission, settledSubmission]);

  useEffect(() => () => {
    releaseAttachmentPreviews([
      ...attachmentsRef.current,
      ...(pendingSubmissionRef.current?.attachments || []),
      ...lastSubmittedAttachmentsRef.current,
    ]);
  }, []);

  useEffect(() => {
    const container = messageListRef.current;
    const nearBottom = !container
      || container.scrollHeight - container.scrollTop - container.clientHeight < 140;
    if (!nearBottom && !chat.isRecovering) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end", behavior }));
  }, [chat.messages, chat.isRecovering]);

  const finishAttachmentRead = (attachment: DraftAttachment) => {
    void readDraftAttachment(attachment, session.fileInput).then((updated) => {
      setAttachments((current) => current.map((item) => item.id === updated.id ? updated : item));
    });
  };

  const addAttachments = (files: File[]) => {
    if ((!imagesSupported && !filesSupported) || interactionBlocked || !online || !routeAvailable || !agent.identified) return;
    draftGeneration.current += 1;
    const existingIds = new Set(attachmentsRef.current.map((attachment) => attachment.id));
    const next = addDraftAttachmentFiles(
      attachmentsRef.current,
      files,
      session.imageInput,
      session.fileInput,
      { imagesSupported, filesSupported },
    );
    setAttachments(next);
    for (const attachment of next) {
      if (!existingIds.has(attachment.id) && attachment.status === "reading") finishAttachmentRead(attachment);
    }
  };

  const removeAttachment = (id: string) => {
    if (!attachmentsRef.current.some((attachment) => attachment.id === id)) return;
    draftGeneration.current += 1;
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed) releaseAttachmentPreviews([removed]);
      return current.filter((attachment) => attachment.id !== id);
    });
  };

  const retryAttachment = (id: string) => {
    const attachment = attachmentsRef.current.find((item) => item.id === id);
    if (!attachment || attachment.error !== "read_failed") return;
    draftGeneration.current += 1;
    const reading = { ...attachment, status: "reading" as const, error: undefined, dataUrl: undefined, text: undefined };
    setAttachments((current) => current.map((item) => item.id === id ? reading : item));
    finishAttachmentRead(reading);
  };

  const send = async () => {
    const text = input.trim();
    const fileParts = toAttachmentFileParts(attachments);
    const unsupportedAttachments = attachments.some((attachment) => (
      (attachment.kind === "image" && !imagesSupported) ||
      (attachment.kind === "file" && !filesSupported)
    ));
    if (
      (!text && !fileParts.length)
      || attachments.some((attachment) => attachment.status !== "ready")
      || unsupportedAttachments
      || interactionBlocked
      || !online
      || !routeAvailable
    ) return;
    const submittedDraft = input;
    const submittedAttachments = attachments;
    const submittedDraftGeneration = draftGeneration.current;
    const submissionId = submissionGeneration.current + 1;
    submissionGeneration.current = submissionId;
    chat.clearError();
    setLastSubmittedText("");
    setLastSubmittedAttachments([]);
    setPendingSubmission({
      text: submittedDraft,
      attachments: submittedAttachments,
      draftGeneration: submittedDraftGeneration,
    });
    setInput("");
    setAttachments([]);
    try {
      await chat.sendMessage(text ? { text, files: fileParts } : { files: fileParts });
    } catch {
      if (draftGeneration.current === submittedDraftGeneration) {
        setLastSubmittedText(submittedDraft);
        setLastSubmittedAttachments(submittedAttachments);
        setInput(submittedDraft);
        setAttachments(submittedAttachments);
      } else {
        releaseAttachmentPreviews(submittedAttachments);
        setLastSubmittedText("");
        setLastSubmittedAttachments([]);
      }
      setPendingSubmission(null);
    } finally {
      setSettledSubmission(submissionId);
    }
  };

  const retryFailedTurn = async () => {
    if (!session.capabilities.messageActions || !chat.error || retryBusy || busy || blocked || !online) return;
    const sourceMessageId = findRetrySourceMessageId(chat.messages);
    if (!sourceMessageId) {
      if (lastSubmittedText || lastSubmittedAttachments.length) {
        chat.clearError();
        setInput((current) => restoreRejectedDraft(current, lastSubmittedText));
        setAttachments((current) => restoreRejectedAttachments(current, lastSubmittedAttachments));
        setLastSubmittedText("");
        setLastSubmittedAttachments([]);
      }
      return;
    }
    setRetryBusy(true);
    setMessageActionError("");
    chat.clearError();
    try {
      await onBranch(conversation, "resend", sourceMessageId);
    } catch (error) {
      setMessageActionError(error instanceof ApiError ? error.message : "重试失败，请稍后再试。");
    } finally {
      setRetryBusy(false);
    }
  };

  const handleMessageAction = async (message: UIMessage, action: MessageAction, editedText?: string) => {
    setMessageActionError("");
    try {
      await onBranch(conversation, action, message.id, editedText);
    } catch (error) {
      const messageText = error instanceof ApiError ? error.message : "消息操作失败，请稍后重试。";
      setMessageActionError(messageText);
      throw error;
    }
  };

  const handleFeedback = async (message: UIMessage, rating: "up" | "down") => {
    setMessageActionError("");
    try {
      await submitFeedback({
        rating,
        routeId,
        chatId: conversation.id,
        messageId: message.id,
        ...(rating === "down" ? { reason: "other" } : {}),
      });
    } catch (error) {
      setMessageActionError(error instanceof ApiError ? error.message : "反馈提交失败，请稍后重试。");
      throw error;
    }
  };

  return (
    <div className="conversation-chat">
      {!online && <div className="offline-banner" role="status"><WifiOff size={16} /><span>当前离线。已保留草稿，恢复网络后可以继续发送。</span></div>}
      {!routeAvailable && <div className="configuration-banner" role="status">当前没有可用模型线路，请联系管理员完成配置。</div>}
      {messageActionError && <div className="workspace-error" role="alert"><span>{messageActionError}</span><button className="icon-button" type="button" onClick={() => setMessageActionError("")} title="关闭提示" aria-label="关闭提示">×</button></div>}
      <div ref={messageListRef} className="message-list" aria-live="polite">
        <div className="message-column">
          {chat.messages.length === 0 && (
            <div className="empty-state">
              <strong>{routeAvailable ? "开始一个具体任务" : "暂时无法开始任务"}</strong>
              <span>{routeAvailable ? "可以直接描述目标、已有材料和期望结果。" : "管理员配置可用模型线路后即可发送消息。"}</span>
            </div>
          )}
          {chat.messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              onApprove={chat.addToolApprovalResponse}
              onAction={session.capabilities.messageActions
                ? (action, editedText) => handleMessageAction(message, action, editedText)
                : undefined}
              onFeedback={session.capabilities.feedback && routeAvailable
                ? (rating) => handleFeedback(message, rating)
                : undefined}
              canContinue={session.capabilities.messageActions && message.role === "assistant" && isTruncatedMessage(message)}
              disabled={interactionBlocked || !online}
              generationDisabled={!routeAvailable}
            />
          ))}
          {waitingFirstOutput && (
            <div className="thinking-row" role="status" aria-live="polite">
              <span className="thinking-indicator" aria-hidden="true" />
              <span>{waitingElapsed >= 3 ? `正在等待首字输出 · ${waitingElapsed}s` : "正在准备响应"}</span>
            </div>
          )}
          {busy && !waitingFirstOutput && !chat.isRecovering && <div className="stream-note">正在生成响应...</div>}
          {chat.isRecovering && <div className="stream-note">正在恢复中断的任务...</div>}
          <div ref={endRef} />
        </div>
      </div>
      {chat.error && (
        <div className="error-banner" role="alert">
          <span>{friendlyAgentError(chat.error.message, online)}</span>
          <div className="error-actions">
            {session.capabilities.messageActions && <button className="quiet-button icon-text-button" type="button" onClick={() => void retryFailedTurn()} disabled={retryBusy || busy || !online} title="重试这一轮" aria-label="重试这一轮"><RotateCw size={15} /><span>{retryBusy ? "重试中..." : "重试"}</span></button>}
            <button className="icon-button" type="button" onClick={() => window.location.reload()} title="重新连接" aria-label="重新连接"><RefreshCw size={16} /></button>
          </div>
        </div>
      )}
      <MessageComposer
        value={input}
        attachments={attachments}
        imagePolicy={session.imageInput}
        filePolicy={session.fileInput}
        imagesSupported={imagesSupported}
        filesSupported={filesSupported}
        onChange={(value) => {
          draftGeneration.current += 1;
          setInput(value);
        }}
        onAddAttachments={addAttachments}
        onRemoveAttachment={removeAttachment}
        onRetryAttachment={retryAttachment}
        onSubmit={() => void send()}
        onStop={() => chat.stop()}
        busy={busy}
        blocked={blocked}
        online={online}
        routeAvailable={routeAvailable}
        agentReady={agent.identified}
        placeholder={!online ? "等待网络恢复" : routeAvailable ? "输入消息" : "等待管理员配置线路"}
        statusText={chat.isRecovering ? "正在恢复任务" : chat.isServerStreaming ? "Agent 正在继续处理" : ""}
      />
    </div>
  );
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function isTruncatedMessage(message: UIMessage): boolean {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const value = metadata as Record<string, unknown>;
  return value.truncated === true || value.finishReason === "length" || value.finish_reason === "length";
}

function activeConversationKey(user: string): string {
  return `chatus:react:${user}:active-chat`;
}

function conversationDraftKey(user: string, chatId: string): string {
  return `chatus:react:${user}:draft:${chatId}`;
}

function clearUserDrafts(user: string): void {
  const prefix = `chatus:react:${user}:draft:`;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
