import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  Download,
  LogOut,
  Menu,
  RefreshCw,
  SendHorizontal,
  Square,
  WifiOff,
} from "lucide-react";
import {
  ApiError,
  createAgentConversation,
  deleteAgentConversation,
  listAgentConversations,
  updateAgentConversation,
  type AgentConversation,
  type SessionProjection,
} from "../lib/api";
import { resolvePendingDraftAction, restoreRejectedDraft } from "../lib/state";
import { ConversationSidebar } from "./ConversationSidebar";
import { MemoryPanel } from "./MemoryPanel";
import { MessageView } from "./MessageView";

export function ChatWorkspace({
  session,
  onLogout,
}: {
  session: SessionProjection;
  onLogout: () => Promise<void>;
}) {
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [routeId, setRouteId] = useState(session.defaultRoute);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
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
    if (busy) return;
    clearUserDrafts(session.user);
    await onLogout();
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
      <header className="workspace-header">
        <div className="header-leading">
          <button className="icon-button mobile-only" type="button" onClick={() => setSidebarOpen(true)} title="打开会话" aria-label="打开会话"><Menu size={19} /></button>
          <div className="brand-lockup compact">
            <div className="brand-mark small">C</div>
            <div><strong>Chatus</strong><span>{session.displayName}</span></div>
          </div>
        </div>
        <div className="header-actions">
          <button id="installAppButton" className="icon-button" type="button" hidden title="安装应用" aria-label="安装应用"><Download size={18} /></button>
          <button className="icon-text-button quiet-button" type="button" onClick={() => setMemoryOpen(true)}><Brain size={17} /><span>记忆</span></button>
          <button
            className="icon-button"
            type="button"
            onClick={() => void handleLogout()}
            disabled={busy}
            title={busy ? "请先停止当前任务" : "退出登录"}
            aria-label="退出登录"
          ><LogOut size={18} /></button>
        </div>
      </header>

      <div className="workspace-layout">
        <ConversationSidebar
          open={sidebarOpen}
          session={session}
          conversations={conversations}
          activeId={activeId}
          routeId={routeId}
          skillIds={skillIds}
          busy={busy}
          loading={loading}
          onClose={() => setSidebarOpen(false)}
          onSelect={(conversation) => setActiveId(conversation.id)}
          onCreate={createConversation}
          onRename={renameConversation}
          onDelete={removeConversation}
          onRouteChange={(nextRouteId) => { setRouteId(nextRouteId); void persistSettings({ routeId: nextRouteId }); }}
          onSkillChange={(nextSkillIds) => { setSkillIds(nextSkillIds); void persistSettings({ skillIds: nextSkillIds }); }}
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
              onBusyChange={setBusy}
              onConversationChanged={handleConversationChanged}
            />
          ) : (
            <div className="chat-loading">
              <strong>无法打开会话</strong>
              <button className="primary-button" type="button" onClick={() => void createConversation()}>新建对话</button>
            </div>
          )}
        </section>
      </div>
      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </main>
  );
}

function ConversationChat({
  session,
  conversation,
  routeId,
  skillIds,
  onBusyChange,
  onConversationChanged,
}: {
  session: SessionProjection;
  conversation: AgentConversation;
  routeId: string;
  skillIds: string[];
  onBusyChange: (busy: boolean) => void;
  onConversationChanged: () => void;
}) {
  const online = useOnlineStatus();
  const [input, setInput] = useState(() => localStorage.getItem(conversationDraftKey(session.user, conversation.id)) || "");
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [settledSubmission, setSettledSubmission] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const wasBusy = useRef(false);
  const submissionGeneration = useRef(0);
  const agent = useAgent({
    agent: "TeamAgent",
    name: session.agent.instance,
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
  const selectedRoute = session.routes.find((route) => route.id === routeId);
  const routeAvailable = Boolean(selectedRoute);

  useEffect(() => {
    onBusyChange(busy);
    if (wasBusy.current && !busy) onConversationChanged();
    wasBusy.current = busy;
    return () => onBusyChange(false);
  }, [busy, onBusyChange, onConversationChanged]);

  useEffect(() => {
    const key = conversationDraftKey(session.user, conversation.id);
    const value = input || pendingDraft || "";
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }, [conversation.id, input, pendingDraft, session.user]);

  useEffect(() => {
    if (!pendingDraft) return;
    const action = resolvePendingDraftAction(
      chat.status,
      Boolean(chat.error),
      settledSubmission === submissionGeneration.current,
    );
    if (action === "restore") {
      setInput((current) => restoreRejectedDraft(current, pendingDraft));
      setPendingDraft(null);
      return;
    }
    if (action === "clear") setPendingDraft(null);
  }, [chat.error, chat.status, pendingDraft, settledSubmission]);

  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end", behavior }));
  }, [chat.messages, chat.isRecovering]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || !online || !routeAvailable) return;
    const submittedDraft = input;
    const submissionId = submissionGeneration.current + 1;
    submissionGeneration.current = submissionId;
    chat.clearError();
    setPendingDraft(submittedDraft);
    setInput("");
    try {
      await chat.sendMessage({ text });
    } catch {
      setInput((current) => restoreRejectedDraft(current, submittedDraft));
      setPendingDraft(null);
    } finally {
      setSettledSubmission(submissionId);
    }
  };

  return (
    <div className="conversation-chat">
      <div className="chat-toolbar">
        <div className="chat-title">
          <h1>{conversation.title}</h1>
          <span>{selectedRoute?.label || "未选择线路"}{skillIds.length ? ` · ${skillIds.length} 个 Skill` : ""}</span>
        </div>
        <div className={`connection ${agent.connectionError ? "error" : agent.identified ? "ready" : "connecting"}`}>
          <span className="connection-dot" />
          {agent.connectionError ? "连接异常" : agent.identified ? "已连接" : "连接中"}
        </div>
      </div>

      {!online && <div className="offline-banner" role="status"><WifiOff size={16} /><span>当前离线。已保留草稿，恢复网络后可以继续发送。</span></div>}
      {!routeAvailable && <div className="configuration-banner" role="status">当前没有可用模型线路，请联系管理员完成配置。</div>}
      <div className="message-list" aria-live="polite">
        <div className="message-column">
          {chat.messages.length === 0 && (
            <div className="empty-state">
              <strong>{routeAvailable ? "开始一个具体任务" : "暂时无法开始任务"}</strong>
              <span>{routeAvailable ? "可以直接描述目标、已有材料和期望结果。" : "管理员配置可用模型线路后即可发送消息。"}</span>
            </div>
          )}
          {chat.messages.map((message) => (
            <MessageView key={message.id} message={message} onApprove={chat.addToolApprovalResponse} />
          ))}
          {chat.isRecovering && <div className="stream-note">正在恢复中断的任务...</div>}
          <div ref={endRef} />
        </div>
      </div>
      {chat.error && (
        <div className="error-banner" role="alert">
          <span>{friendlyAgentError(chat.error.message, online)}</span>
          <button className="icon-button" type="button" onClick={() => window.location.reload()} title="重新连接" aria-label="重新连接"><RefreshCw size={16} /></button>
        </div>
      )}
      <form className="composer" onSubmit={send}>
        <div className="composer-box">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={!online ? "等待网络恢复" : routeAvailable ? "输入消息" : "等待管理员配置线路"}
            rows={2}
            disabled={busy || !online || !routeAvailable}
            aria-label="消息"
          />
          {busy ? (
            <button className="composer-action stop" type="button" onClick={() => chat.stop()} title="停止生成" aria-label="停止生成"><Square size={17} /></button>
          ) : (
            <button className="composer-action" type="submit" disabled={!input.trim() || !online || !agent.identified || !routeAvailable} title="发送" aria-label="发送"><SendHorizontal size={18} /></button>
          )}
        </div>
        {(chat.isRecovering || chat.isServerStreaming) && <span className="composer-status">{chat.isRecovering ? "正在恢复任务" : "Agent 正在继续处理"}</span>}
      </form>
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

function friendlyAgentError(message: string, online: boolean): string {
  if (!online) return "网络已断开，草稿仍保存在当前设备。";
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes("rate") || normalized.includes("额度")) return "当前额度已用完，请稍后再试或联系管理员调整额度。";
  if (normalized.includes("timeout") || normalized.includes("超时")) return "模型线路响应超时，可以稍后重试或切换线路。";
  if (normalized.includes("key") || normalized.includes("认证")) return "当前线路凭据不可用，请切换线路或联系管理员。";
  return message || "本轮任务暂时失败，可以重新连接后继续。";
}
