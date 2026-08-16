import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import {
  ApiError,
  createAgentConversationBranch,
  createAgentConversation,
  deleteAgentConversation,
  deleteUserData,
  discoverMemberMcpOAuthTools,
  exportUserData,
  fetchModelAvailability,
  fetchMcpOAuthConnections,
  listAgentConversations,
  revokeMcpOAuthConnection,
  revokeAllSessions,
  startMcpOAuthConnection,
  submitFeedback,
  updateAgentConversation,
  type AgentConversationBranchAction,
  type AgentConversation,
  type MemberModelAvailability,
  type SessionProjection,
} from "../lib/api";
import type { ConversationSkillMode } from "../../../src/contracts/agent";
import { isConversationAccessRefreshError, resolveAgentError } from "../lib/agent-errors";
import {
  conversationAgentClientName,
  findRetrySourceMessageId,
  hasPendingToolApprovalAfterLatestUser,
  isActiveTurnPhase,
  isPendingToolApprovalPart,
  resolveMessageActionAvailability,
  resolveConversationAccessPermissions,
  resolvePendingDraftAction,
  resolveTurnPhase,
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
import {
  ConversationInspector,
  type ConversationSettingsSaveState,
  type InspectorSection,
} from "./ConversationInspector";
import { MemberSettingsCenter } from "./MemberSettingsCenter";
import { MemoryPanel } from "./MemoryPanel";
import { MessageComposer } from "./MessageComposer";
import { MessageView, type MessageAction } from "./MessageView";
import { WorkspaceHeader, type ConnectionState } from "./WorkspaceHeader";
import { McpConnectionsDialog, type McpConnectionNotice } from "./McpConnectionsDialog";
import { MemberLogoutNotice } from "./MemberLogoutNotice";
import { AgentErrorBanner } from "./AgentErrorBanner";
import type { UIMessage } from "ai";
import type { McpOAuthCallbackResult } from "../lib/mcp-oauth";
import type { ProviderTurnProgressV1 } from "../../../src/contracts/provider-turn-progress";
import {
  decodeProviderTurnProgressMessage,
  providerTurnProgressText,
  selectNewestProviderTurnProgress,
} from "../lib/provider-turn-progress";
import {
  readDeviceBoolean,
  writeDeviceBoolean,
  getDeviceStorage,
  type ThemePreference,
} from "../lib/device-preferences";

type LogoutState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

export function ChatWorkspace({
  session,
  mcpOAuthResult,
  onMcpOAuthResultConsumed,
  onMemberLogin,
  themePreference,
  onThemePreferenceChange,
  onLogout,
}: {
  session: SessionProjection;
  mcpOAuthResult: McpOAuthCallbackResult | null;
  onMcpOAuthResultConsumed: () => void;
  onMemberLogin: () => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => boolean;
  onLogout: () => Promise<void>;
}) {
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [routeId, setRouteId] = useState(session.defaultRoute);
  const [skillMode, setSkillMode] = useState<ConversationSkillMode>(session.access === "member" ? "automatic" : "manual");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [logoutState, setLogoutState] = useState<LogoutState>({ status: "idle" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<"history" | "files" | "settings">("history");
  const [inspectorOpen, setInspectorOpen] = useState(() => (
    window.matchMedia("(min-width: 781px)").matches
      && readDeviceBoolean(getDeviceStorage(), session.user, "conversation-inspector-open")
  ));
  const [inspectorSection, setInspectorSection] = useState<InspectorSection>("model");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSave, setSettingsSave] = useState<{ conversationId: string; state: ConversationSettingsSaveState }>({ conversationId: "", state: "idle" });
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [mcpConnectionsOpen, setMcpConnectionsOpen] = useState(false);
  const [mcpConnections, setMcpConnections] = useState(session.mcpConnections);
  const [mcpBusyServerId, setMcpBusyServerId] = useState("");
  const [mcpConnectionNotice, setMcpConnectionNotice] = useState<McpConnectionNotice | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [modelAvailability, setModelAvailability] = useState<MemberModelAvailability | null>(null);
  const [modelAvailabilityRefreshing, setModelAvailabilityRefreshing] = useState(false);
  const bootstrapped = useRef(false);
  const logoutInFlight = useRef(false);
  const mcpRefresh = useRef<Promise<void> | null>(null);
  const conversationSnapshots = useRef(new Map<string, AgentConversation>());
  const conversationRefreshGeneration = useRef(0);
  const modelAvailabilityGeneration = useRef(0);
  const settingsQueues = useRef(new Map<string, Promise<void>>());
  const modelAvailabilityRefreshAt = useRef(0);
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;
  const activePermissions = resolveConversationAccessPermissions(activeConversation?.accessRole);
  const logoutPending = logoutState.status === "pending";
  const accountActionBusy = accountBusy || logoutPending;
  const accountOperationBusy = accountActionBusy || Boolean(mcpBusyServerId);

  const refreshModelAvailability = useCallback(async (force = false): Promise<void> => {
    if (session.access !== "member") return;
    const now = Date.now();
    if (!force && now - modelAvailabilityRefreshAt.current < 60_000) return;
    modelAvailabilityRefreshAt.current = now;
    const generation = ++modelAvailabilityGeneration.current;
    setModelAvailabilityRefreshing(true);
    try {
      const next = await fetchModelAvailability();
      if (generation === modelAvailabilityGeneration.current) setModelAvailability(next);
    } catch {
      // Availability is advisory. Keep the last projection and never block chat.
    } finally {
      if (generation === modelAvailabilityGeneration.current) setModelAvailabilityRefreshing(false);
    }
  }, [session.access]);

  useEffect(() => {
    void refreshModelAvailability(true);
  }, [refreshModelAvailability, session.user]);

  const refreshMcpConnections = useCallback((): Promise<void> => {
    if (session.access !== "member") return Promise.resolve();
    if (mcpRefresh.current) return mcpRefresh.current;
    setMcpBusyServerId("__refresh__");
    const task = fetchMcpOAuthConnections()
      .then((result) => setMcpConnections(result.connections))
      .catch((error) => {
        setMcpConnectionNotice({ kind: "error", text: errorMessage(error, "MCP 连接状态刷新失败。") });
      })
      .finally(() => {
        if (mcpRefresh.current !== task) return;
        mcpRefresh.current = null;
        setMcpBusyServerId("");
      });
    mcpRefresh.current = task;
    return task;
  }, [session.access]);

  useEffect(() => {
    if (!mcpOAuthResult) return;
    setMcpConnectionsOpen(true);
    setMcpConnectionNotice(mcpOAuthResult === "connected"
      ? { kind: "success", text: "MCP 已连接。" }
      : mcpOAuthResult === "review_required"
        ? { kind: "warning", text: "MCP 配置已变化，需要重新授权或管理员重审。" }
        : { kind: "error", text: "MCP 授权未完成，请重试。" });
    onMcpOAuthResultConsumed();
    void refreshMcpConnections();
  }, [mcpOAuthResult, onMcpOAuthResultConsumed, refreshMcpConnections]);

  async function connectMcp(serverId: string) {
    if (busy || accountActionBusy || mcpBusyServerId) return;
    setMcpBusyServerId(serverId);
    setMcpConnectionNotice(null);
    try {
      const result = await startMcpOAuthConnection(serverId);
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMcpConnectionNotice({ kind: "error", text: errorMessage(error, "MCP 授权无法启动。") });
    } finally {
      setMcpBusyServerId("");
    }
  }

  async function discoverMcpTools(serverId: string) {
    if (busy || accountActionBusy || mcpBusyServerId) return;
    setMcpBusyServerId(serverId);
    setMcpConnectionNotice(null);
    try {
      const candidate = await discoverMemberMcpOAuthTools(serverId);
      setMcpConnectionNotice({
        kind: "success",
        text: `已生成发现候选：${candidate.tools} 个工具，${candidate.rejected} 个被拒绝。`,
      });
    } catch (error) {
      setMcpConnectionNotice({ kind: "error", text: errorMessage(error, "MCP 工具发现失败。") });
    } finally {
      setMcpBusyServerId("");
    }
  }

  async function revokeMcpConnection(serverId: string) {
    if (busy || accountActionBusy || mcpBusyServerId) return;
    setMcpBusyServerId(serverId);
    setMcpConnectionNotice(null);
    try {
      await revokeMcpOAuthConnection(serverId);
      const result = await fetchMcpOAuthConnections();
      setMcpConnections(result.connections);
      setMcpConnectionNotice({ kind: "success", text: "MCP 授权已撤销。" });
    } catch (error) {
      setMcpConnectionNotice({ kind: "error", text: errorMessage(error, "MCP 授权撤销失败。") });
    } finally {
      setMcpBusyServerId("");
    }
  }

  const refreshConversations = useCallback(async (preferredId?: string) => {
    const generation = ++conversationRefreshGeneration.current;
    const next = await listAgentConversations();
    if (generation !== conversationRefreshGeneration.current) return null;
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
      const created = await createAgentConversation({ routeId: session.defaultRoute });
      conversationRefreshGeneration.current += 1;
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
        if (next && !next.length) await createConversation();
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
    setSkillMode(session.access === "guest" ? "manual" : activeConversation.skillMode);
    setSkillIds(activeConversation.skillIds.filter((id) => allowedSkills.has(id)).slice(0, 3));
    localStorage.setItem(activeConversationKey(session.user), activeConversation.id);
  }, [activeConversation, session.access, session.defaultRoute, session.routes, session.skills, session.user]);

  useEffect(() => {
    if (sidebarView === "files" && !activePermissions.canUseWorkspace) setSidebarView("history");
  }, [activePermissions.canUseWorkspace, sidebarView]);

  const updateConversationInList = useCallback((updated: AgentConversation) => {
    conversationRefreshGeneration.current += 1;
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
    if (busy || accountOperationBusy || !resolveConversationAccessPermissions(source.accessRole).canBranch) {
      throw new Error("当前共享角色不允许创建分支。");
    }
    setWorkspaceError("");
    let branchSource = conversationSnapshots.current.get(source.id) || source;
    const branchInput = {
      requestId: `branch-${crypto.randomUUID()}`,
      action,
      sourceMessageId,
      ...(editedText === undefined ? {} : { editedText }),
    };
    let result: Awaited<ReturnType<typeof createAgentConversationBranch>>;
    try {
      result = await createAgentConversationBranch(branchSource, branchInput);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "conversation_conflict") throw error;
      const refreshed = await refreshConversations(source.id);
      const latestSource = refreshed?.find((conversation) => conversation.id === source.id);
      if (!latestSource || latestSource.updatedAt <= branchSource.updatedAt) throw error;
      branchSource = latestSource;
      result = await createAgentConversationBranch(branchSource, branchInput);
    }
    updateConversationInList(branchSource);
    updateConversationInList(result.conversation);
    setActiveId(result.conversation.id);
    setSidebarOpen(false);
  }, [accountOperationBusy, busy, refreshConversations, updateConversationInList]);

  const refreshAfterAccessChange = useCallback(async (conversationId: string) => {
    await refreshConversations(conversationId).catch((error) => {
      setWorkspaceError(errorMessage(error, "共享状态已更新，但会话列表刷新失败。"));
    });
  }, [refreshConversations]);
  const handleConversationAccessInvalidated = useCallback((conversationId: string) => {
    void refreshAfterAccessChange(conversationId);
  }, [refreshAfterAccessChange]);

  const recoverConversationAccess = useCallback(async (error: unknown, conversationId: string): Promise<boolean> => {
    if (!(error instanceof ApiError) || (
      error.code !== "conversation_not_found"
      && error.code !== "conversation_access_revision_conflict"
    )) return false;
    await refreshAfterAccessChange(conversationId);
    return true;
  }, [refreshAfterAccessChange]);

  const renameConversation = async (conversation: AgentConversation, title: string) => {
    if (!resolveConversationAccessPermissions(conversation.accessRole).canRename) {
      throw new Error("当前共享角色不允许重命名。");
    }
    setWorkspaceError("");
    try {
      await settingsQueues.current.get(conversation.id);
      const current = conversationSnapshots.current.get(conversation.id) || conversation;
      updateConversationInList(await updateAgentConversation(current, { title }));
    } catch (error) {
      setWorkspaceError(errorMessage(error, "重命名失败，请刷新后重试。"));
      if (!(await recoverConversationAccess(error, conversation.id)) && error instanceof ApiError && error.code === "conversation_conflict") {
        await refreshConversations(conversation.id);
      }
      throw error;
    }
  };

  const removeConversation = async (conversation: AgentConversation) => {
    if (!resolveConversationAccessPermissions(conversation.accessRole).canDelete) {
      throw new Error("当前共享角色不允许删除会话。");
    }
    setWorkspaceError("");
    try {
      await settingsQueues.current.get(conversation.id);
      const current = conversationSnapshots.current.get(conversation.id) || conversation;
      const remaining = await deleteAgentConversation(current);
      conversationRefreshGeneration.current += 1;
      conversationSnapshots.current = new Map(remaining.map((item) => [item.id, item]));
      setConversations(remaining);
      if (activeId === conversation.id) {
        if (remaining[0]) setActiveId(remaining[0].id);
        else await createConversation();
      }
      localStorage.removeItem(conversationDraftKey(session.user, conversation.id));
    } catch (error) {
      setWorkspaceError(errorMessage(error, "删除失败，请刷新后重试。"));
      if (!(await recoverConversationAccess(error, conversation.id)) && error instanceof ApiError && error.code === "conversation_conflict") {
        await refreshConversations(conversation.id);
      }
      throw error;
    }
  };

  const persistSettings = (patch: {
    routeId?: string;
    skillMode?: ConversationSkillMode;
    skillIds?: string[];
  }): Promise<void> => {
    const conversationId = activeConversation?.id;
    if (!conversationId || !activePermissions.canManageSettings) return Promise.resolve();
    setWorkspaceError("");
    setSettingsSave({ conversationId, state: "saving" });
    const previous = settingsQueues.current.get(conversationId) || Promise.resolve();
    let task: Promise<void>;
    task = previous.then(async () => {
      const current = conversationSnapshots.current.get(conversationId);
      if (!current) return;
      try {
        updateConversationInList(await updateAgentConversation(current, patch));
        if (settingsQueues.current.get(conversationId) === task) {
          setSettingsSave({ conversationId, state: "saved" });
        }
      } catch (error) {
        setWorkspaceError(errorMessage(error, "会话设置保存失败，请重试。"));
        if (settingsQueues.current.get(conversationId) === task) {
          setSettingsSave({ conversationId, state: "error" });
        }
        if (!(await recoverConversationAccess(error, conversationId))) {
          await refreshConversations(conversationId).catch(() => undefined);
        }
      }
    }).finally(() => {
      if (settingsQueues.current.get(conversationId) === task) settingsQueues.current.delete(conversationId);
    });
    settingsQueues.current.set(conversationId, task);
    return task;
  };

  const handleLogout = async () => {
    if (busy || accountOperationBusy || logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLogoutState({ status: "pending" });
    try {
      await onLogout();
    } catch (error) {
      logoutInFlight.current = false;
      setLogoutState({ status: "error", message: errorMessage(error, "退出登录失败，请重试。") });
      return;
    }
    clearUserDrafts(session.user);
  };

  const openInspector = (section: InspectorSection) => {
    setInspectorSection(section);
    setInspectorOpen(true);
    setSidebarView(section === "files" ? "files" : "settings");
    setSidebarOpen(false);
    writeDeviceBoolean(getDeviceStorage(), session.user, "conversation-inspector-open", true);
    if (section === "model") void refreshModelAvailability();
  };
  const closeInspector = () => {
    setInspectorOpen(false);
    setSidebarView("history");
    writeDeviceBoolean(getDeviceStorage(), session.user, "conversation-inspector-open", false);
  };
  const openRouteSettings = () => openInspector("model");
  const parentConversation = activeConversation?.parentChatId
    ? conversations.find((conversation) => conversation.id === activeConversation.parentChatId) || null
    : null;
  const parentMissing = Boolean(activeConversation?.parentChatId && !parentConversation);
  const returnToParentConversation = () => {
    if (!parentConversation || busy || accountOperationBusy) return;
    setActiveId(parentConversation.id);
    setSidebarOpen(false);
  };

  const handleRevokeAllSessions = async () => {
    if (busy || accountOperationBusy) throw new Error("请等待当前任务或账号操作完成。");
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
    if (busy || accountOperationBusy) throw new Error("请等待当前任务或账号操作完成。");
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
    if (busy || accountOperationBusy) throw new Error("请等待当前任务或账号操作完成。");
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
    void refreshModelAvailability(true);
    void refreshConversations(activeId).catch((error) => {
      setWorkspaceError(errorMessage(error, "会话已完成，但列表暂时无法刷新。"));
    });
  }, [activeId, refreshConversations, refreshModelAvailability]);

  const handleRefresh = useCallback(() => {
    setWorkspaceError("");
    void refreshConversations(activeId).catch((error) => {
      setWorkspaceError(errorMessage(error, "暂时无法读取会话，请重试。"));
    });
  }, [activeId, refreshConversations]);

  return (
    <main className="workspace-shell">
      <div className={`workspace-layout ${inspectorOpen ? "inspector-open" : ""}`}>
        <ConversationSidebar
          open={sidebarOpen}
          session={session}
          conversations={conversations}
          activeId={activeId}
          view={sidebarView}
          busy={busy || accountOperationBusy}
          loading={loading}
          onClose={() => setSidebarOpen(false)}
          onViewChange={(view) => {
            if (view === "history") {
              setSidebarView("history");
              return;
            }
            openInspector(view === "files" ? "files" : "model");
          }}
          onSelect={(conversation) => setActiveId(conversation.id)}
          onCreate={createConversation}
          onRename={renameConversation}
          onDelete={removeConversation}
          onAccessChanged={(conversation, accessRevision) => {
            updateConversationInList({ ...conversation, accessRevision });
            void refreshAfterAccessChange(conversation.id);
          }}
          onOpenMemberSettings={() => { setSettingsOpen(true); setSidebarOpen(false); }}
        />
        {sidebarOpen && <button className="sidebar-scrim mobile-only" type="button" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" />}

        <div className="workspace-main">
          <WorkspaceHeader
            session={session}
            conversation={activeConversation}
            routeId={routeId}
            connectionState={connectionState}
            modelAvailability={modelAvailability}
            modelAvailabilityRefreshing={modelAvailabilityRefreshing}
            busy={busy}
            accountBusy={accountOperationBusy}
            logoutPending={logoutPending}
            parentConversation={parentConversation}
            parentMissing={parentMissing}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenRouteSettings={openRouteSettings}
            onReturnToParent={returnToParentConversation}
            onMemberLogin={onMemberLogin}
            onLogout={handleLogout}
          />
          <section className="chat-panel" aria-label="对话">
            {logoutState.status === "error" && (
              <MemberLogoutNotice message={logoutState.message} onRetry={handleLogout} />
            )}
            {workspaceError && (
              <div className="workspace-error" role="alert">
                <span>{workspaceError}</span>
                <button className="icon-button" type="button" onClick={handleRefresh} disabled={accountOperationBusy} title="重新读取" aria-label="重新读取"><RefreshCw size={16} /></button>
              </div>
            )}
            {loading ? (
              <div className="chat-loading">正在恢复会话...</div>
            ) : activeConversation ? (
              <ConversationChat
                key={`${activeConversation.resourceId || activeConversation.id}:${activeConversation.accessRevision || 0}`}
                session={session}
                conversation={activeConversation}
                routeId={routeId}
                skillMode={skillMode}
                skillIds={skillIds}
                blocked={accountOperationBusy}
                onBusyChange={setBusy}
                onConnectionStateChange={setConnectionState}
                onConversationChanged={handleConversationChanged}
                onAccessInvalidated={handleConversationAccessInvalidated}
                onBranch={handleBranch}
              />
            ) : (
              <div className="chat-loading">
                <strong>无法打开会话</strong>
                <button className="primary-button" type="button" onClick={() => void createConversation()} disabled={accountOperationBusy}>新建对话</button>
              </div>
            )}
          </section>
        </div>
        <ConversationInspector
          open={inspectorOpen}
          section={inspectorSection}
          session={session}
          conversation={activeConversation}
          routeId={routeId}
          modelAvailability={modelAvailability}
          modelAvailabilityRefreshing={modelAvailabilityRefreshing}
          skillMode={skillMode}
          skillIds={skillIds}
          saveState={settingsSave.conversationId === activeConversation?.id ? settingsSave.state : "idle"}
          busy={busy || accountOperationBusy}
          onClose={closeInspector}
          onSectionChange={setInspectorSection}
          onConversationUpdated={updateConversationInList}
          onAccessChanged={(conversation, accessRevision) => {
            updateConversationInList({ ...conversation, accessRevision });
            void refreshAfterAccessChange(conversation.id);
          }}
          onRouteChange={(nextRouteId) => { setRouteId(nextRouteId); void persistSettings({ routeId: nextRouteId }); }}
          onSkillModeChange={(nextSkillMode) => { setSkillMode(nextSkillMode); void persistSettings({ skillMode: nextSkillMode }); }}
          onSkillChange={(nextSkillIds) => { setSkillIds(nextSkillIds); void persistSettings({ skillIds: nextSkillIds }); }}
          onRetrySave={() => { void persistSettings({ routeId, skillMode, skillIds }); }}
        />
      </div>
      {session.capabilities.memory && <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />}
      {session.access === "member" && mcpConnectionsOpen && (
        <McpConnectionsDialog
          connections={mcpConnections}
          busyServerId={busy || accountActionBusy ? "__blocked__" : mcpBusyServerId}
          notice={mcpConnectionNotice}
          onClose={() => { if (!mcpBusyServerId) setMcpConnectionsOpen(false); }}
          onRefresh={refreshMcpConnections}
          onConnect={connectMcp}
          onDiscover={discoverMcpTools}
          onRevoke={revokeMcpConnection}
        />
      )}
      <MemberSettingsCenter
        open={settingsOpen}
        nestedOpen={memoryOpen || mcpConnectionsOpen}
        session={session}
        themePreference={themePreference}
        connectedMcpCount={mcpConnections.filter((item) => item.connected).length}
        busy={accountOperationBusy}
        onClose={() => setSettingsOpen(false)}
        onThemePreferenceChange={onThemePreferenceChange}
        onOpenMemory={() => setMemoryOpen(true)}
        onOpenMcpConnections={() => {
          setMcpConnectionsOpen(true);
          setMcpConnectionNotice(null);
          void refreshMcpConnections();
        }}
        onExportUserData={handleUserDataExport}
        onRevokeAllSessions={handleRevokeAllSessions}
        onDeleteUserData={handleDeleteUserData}
      />
    </main>
  );
}

function ConversationChat({
  session,
  conversation,
  routeId,
  skillMode,
  skillIds,
  blocked,
  onBusyChange,
  onConnectionStateChange,
  onConversationChanged,
  onAccessInvalidated,
  onBranch,
}: {
  session: SessionProjection;
  conversation: AgentConversation;
  routeId: string;
  skillMode: ConversationSkillMode;
  skillIds: string[];
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onConversationChanged: () => void;
  onAccessInvalidated: (conversationId: string) => void;
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
  const [providerProgress, setProviderProgress] = useState<ProviderTurnProgressV1 | null>(null);
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const [messageActionError, setMessageActionError] = useState("");
  const [retryBusy, setRetryBusy] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [lastSubmittedText, setLastSubmittedText] = useState("");
  const [lastSubmittedAttachments, setLastSubmittedAttachments] = useState<DraftAttachment[]>([]);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const followTranscriptRef = useRef(true);
  const wasBusy = useRef(false);
  const submissionGeneration = useRef(0);
  const draftGeneration = useRef(0);
  const attachmentsRef = useRef(attachments);
  const pendingSubmissionRef = useRef(pendingSubmission);
  const lastSubmittedAttachmentsRef = useRef(lastSubmittedAttachments);
  const localTurnStartedAtRef = useRef(0);
  attachmentsRef.current = attachments;
  pendingSubmissionRef.current = pendingSubmission;
  lastSubmittedAttachmentsRef.current = lastSubmittedAttachments;
  const permissions = resolveConversationAccessPermissions(conversation.accessRole);
  const sharedConversation = Boolean(conversation.accessRole && conversation.accessRole !== "owner");
  const agent = useAgent({
    agent: "TeamAgent",
    name: conversationAgentClientName(conversation.resourceId || session.agent.instance, conversation.id),
    basePath: session.agent.basePath,
    query: {
      chatId: conversation.id,
      ...(conversation.resourceId ? { resourceId: conversation.resourceId } : {}),
    },
    queryDeps: [conversation.id, conversation.resourceId],
    defaultCallTimeout: 30_000,
  });
  const chat = useAgentChat({
    agent,
    credentials: "include",
    resume: true,
    cancelOnClientAbort: false,
    body: () => ({
      routeId,
      skillMode,
      skillIds,
      chatId: conversation.id,
      ...(conversation.resourceId ? { resourceId: conversation.resourceId } : {}),
    }),
  });
  const turnPhase = resolveTurnPhase({
    status: chat.status,
    isStreaming: chat.isStreaming,
    isRecovering: chat.isRecovering,
    hasError: Boolean(chat.error),
    stopped: stopRequested,
    messages: chat.messages,
  });
  const busy = isActiveTurnPhase(turnPhase);
  const waitingFirstOutput = turnPhase === "submitted" || turnPhase === "waiting-first-output";
  const waitingFirstOutputRef = useRef(waitingFirstOutput);
  waitingFirstOutputRef.current = waitingFirstOutput;
  const interactionBlocked = busy || blocked;
  const selectedRoute = session.routes.find((route) => route.id === routeId);
  const routeAvailable = sharedConversation || Boolean(selectedRoute);
  const imagesSupported = permissions.canUseWorkspace && session.capabilities.imageInput && selectedRoute?.supportsImages === true;
  const filesSupported = permissions.canUseWorkspace && session.capabilities.fileInput;
  const connectionState: ConnectionState = agent.connectionError ? "error" : agent.identified ? "ready" : "connecting";
  const latestMessageId = chat.messages.at(-1)?.id;
  const retrySourceMessageId = findRetrySourceMessageId(chat.messages);
  const retryAvailability = resolveMessageActionAvailability({
    phase: turnPhase,
    role: "user",
    isLatestMessage: Boolean(retrySourceMessageId || lastSubmittedText || lastSubmittedAttachments.length),
    online,
    blocked,
    routeAvailable,
    messageActionsEnabled: session.capabilities.messageActions,
    feedbackEnabled: false,
    hasText: false,
    canContinue: false,
    toolApprovalPending: false,
    accessRole: conversation.accessRole,
  }).retry;
  const errorPresentation = chat.error ? resolveAgentError(chat.error.message, online) : null;

  useEffect(() => {
    if (chat.error && isConversationAccessRefreshError(chat.error.message)) {
      onAccessInvalidated(conversation.id);
    }
  }, [chat.error, conversation.id, onAccessInvalidated]);

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
    const onMessage = (event: MessageEvent<unknown>) => {
      const next = decodeProviderTurnProgressMessage(event.data);
      if (!next || (!waitingFirstOutputRef.current && localTurnStartedAtRef.current === 0)) return;
      setProviderProgress((current) => selectNewestProviderTurnProgress(
        current,
        next,
        localTurnStartedAtRef.current,
      ));
    };
    agent.addEventListener("message", onMessage);
    return () => agent.removeEventListener("message", onMessage);
  }, [agent, conversation.id]);

  useEffect(() => {
    if (!waitingFirstOutput || connectionState !== "ready") {
      setProviderProgress(null);
      setProgressNow(Date.now());
      if (!waitingFirstOutput) localTurnStartedAtRef.current = 0;
      return;
    }
    setProgressNow(Date.now());
    if (!providerProgress) return;
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [connectionState, providerProgress, waitingFirstOutput]);

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
    followTranscriptRef.current = true;
  }, [conversation.id]);

  useEffect(() => {
    if (!followTranscriptRef.current) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end", behavior }));
  }, [chat.messages, chat.isRecovering]);

  const trackTranscriptScroll = () => {
    const container = messageListRef.current;
    if (!container) return;
    followTranscriptRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
  };

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
      || !permissions.canSend
      || !online
      || !routeAvailable
    ) return;
    const submittedDraft = input;
    const submittedAttachments = attachments;
    const submittedDraftGeneration = draftGeneration.current;
    const submissionId = submissionGeneration.current + 1;
    submissionGeneration.current = submissionId;
    localTurnStartedAtRef.current = Date.now();
    setProviderProgress(null);
    setProgressNow(localTurnStartedAtRef.current);
    setStopRequested(false);
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
    if (!chat.error || retryAvailability !== "enabled" || retryBusy) return;
    const sourceMessageId = retrySourceMessageId;
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

  const stop = () => {
    if (!permissions.canSend) return;
    setStopRequested(true);
    localTurnStartedAtRef.current = 0;
    setProviderProgress(null);
    chat.stop();
  };

  return (
    <div className="conversation-chat" data-turn-phase={turnPhase}>
      {!online && <div className="offline-banner" role="status"><WifiOff size={16} /><span>当前离线。已保留草稿，恢复网络后可以继续发送。</span></div>}
      {!routeAvailable && <div className="configuration-banner" role="status">当前没有可用模型线路，请联系管理员完成配置。</div>}
      {messageActionError && <div className="workspace-error" role="alert"><span>{messageActionError}</span><button className="icon-button" type="button" onClick={() => setMessageActionError("")} title="关闭提示" aria-label="关闭提示">×</button></div>}
      <div ref={messageListRef} className="message-list" aria-live="polite" onScroll={trackTranscriptScroll}>
        <div className="message-column">
          {chat.messages.length === 0 && (
            <div className="empty-state">
              <strong>{routeAvailable ? "开始一个具体任务" : "暂时无法开始任务"}</strong>
              <span>{routeAvailable ? "可以直接描述目标、已有材料和期望结果。" : "管理员配置可用模型线路后即可发送消息。"}</span>
            </div>
          )}
          {chat.messages.map((message) => {
            const canContinue = message.role === "assistant" && isTruncatedMessage(message);
            const availability = resolveMessageActionAvailability({
              phase: turnPhase,
              role: message.role,
              isLatestMessage: message.id === latestMessageId,
              online,
              blocked,
              routeAvailable,
              messageActionsEnabled: session.capabilities.messageActions,
              feedbackEnabled: session.capabilities.feedback,
              hasText: message.parts.some((part) => part.type === "text" && Boolean(part.text.trim())),
              canContinue,
              toolApprovalPending: message.parts.some((part) => isPendingToolApprovalPart(part)),
              accessRole: conversation.accessRole,
            });
            return (
              <MessageView
                key={message.id}
                message={message}
                onApprove={chat.addToolApprovalResponse}
                onAction={session.capabilities.messageActions && permissions.canBranch
                  ? (action, editedText) => handleMessageAction(message, action, editedText)
                  : undefined}
                onFeedback={session.capabilities.feedback && permissions.canSubmitFeedback
                  ? (rating) => handleFeedback(message, rating)
                  : undefined}
                availability={availability}
              />
            );
          })}
          {waitingFirstOutput && (
            <div className="thinking-row" role="status" aria-live="polite">
              <span className="thinking-indicator" aria-hidden="true" />
              <span>{providerProgress
                ? providerTurnProgressText(providerProgress, progressNow)
                : turnPhase === "submitted" ? "正在准备响应" : "正在等待首字输出"}</span>
            </div>
          )}
          {turnPhase === "streaming" && <div className="stream-note">正在生成响应...</div>}
          {turnPhase === "recovering" && <div className="stream-note">正在恢复中断的任务...</div>}
          <div ref={endRef} />
        </div>
      </div>
      {chat.error && errorPresentation && (
        <AgentErrorBanner
          presentation={errorPresentation}
          retryAvailability={retryAvailability}
          retryBusy={retryBusy}
          onRetry={() => void retryFailedTurn()}
          onReconnect={() => window.location.reload()}
        />
      )}
      {permissions.canSend ? <MessageComposer
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
        onStop={stop}
        busy={busy}
        blocked={blocked}
        online={online}
        routeAvailable={routeAvailable}
        agentReady={agent.identified}
        placeholder={!online ? "等待网络恢复" : routeAvailable ? "输入消息" : "等待管理员配置线路"}
        statusText={turnPhase === "recovering"
          ? "正在恢复任务"
          : turnPhase === "tool-running"
            ? hasPendingToolApprovalAfterLatestUser(chat.messages) ? "等待工具确认" : "Agent 正在调用工具"
            : chat.isServerStreaming ? "Agent 正在继续处理" : ""}
      /> : <div className="conversation-read-only" role="status">查看者权限：可以阅读这段对话，但不能发送消息或修改内容。</div>}
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
