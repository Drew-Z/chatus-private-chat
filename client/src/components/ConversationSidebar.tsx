import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, LogOut, MessageSquarePlus, Pencil, Plug, Search, Settings2, Share2, Sparkles, Trash2, Wrench, X } from "lucide-react";
import type { AgentConversation, SessionProjection } from "../lib/api";
import type { ConversationSkillMode } from "../../../src/contracts/agent";
import { resolveConversationAccessPermissions } from "../lib/state";
import { FileWorkspacePanel } from "./FileWorkspacePanel";
import { ConversationShareDialog } from "./ConversationShareDialog";

export type SidebarView = "history" | "files" | "settings";

export function ConversationSidebar({
  open,
  session,
  conversations,
  activeId,
  routeId,
  skillMode,
  skillIds,
  view,
  busy,
  loading,
  onClose,
  onViewChange,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onAccessChanged,
  onConversationUpdated,
  onRouteChange,
  onSkillModeChange,
  onSkillChange,
  onRevokeAllSessions,
  onDeleteUserData,
  onExportUserData,
}: {
  open: boolean;
  session: SessionProjection;
  conversations: AgentConversation[];
  activeId: string;
  routeId: string;
  skillMode: ConversationSkillMode;
  skillIds: string[];
  view: SidebarView;
  busy: boolean;
  loading: boolean;
  onClose: () => void;
  onViewChange: (view: SidebarView) => void;
  onSelect: (conversation: AgentConversation) => void;
  onCreate: () => Promise<void>;
  onRename: (conversation: AgentConversation, title: string) => Promise<void>;
  onDelete: (conversation: AgentConversation) => Promise<void>;
  onAccessChanged: (conversation: AgentConversation, accessRevision: number) => void;
  onConversationUpdated: (conversation: AgentConversation) => void;
  onRouteChange: (routeId: string) => void;
  onSkillModeChange: (skillMode: ConversationSkillMode) => void;
  onSkillChange: (skillIds: string[]) => void;
  onRevokeAllSessions: () => Promise<void>;
  onDeleteUserData: () => Promise<void>;
  onExportUserData: () => Promise<{ truncated: boolean }>;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [accountDialog, setAccountDialog] = useState<"sessions" | "delete" | null>(null);
  const [conversationToDelete, setConversationToDelete] = useState<AgentConversation | null>(null);
  const [conversationToShare, setConversationToShare] = useState<AgentConversation | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const previousSidebarFocusRef = useRef<HTMLElement | null>(null);
  const sidebarWasOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(normalized))
      : conversations;
  }, [conversations, query]);
  const routeSupportsTools = session.routes.find((route) => route.id === routeId)?.supportsTools === true;
  const selectedToolIds = useMemo(
    () => new Set(routeSupportsTools
      ? session.skills.filter((skill) => skillIds.includes(skill.id)).flatMap((skill) => skill.toolIds)
      : []),
    [routeSupportsTools, session.skills, skillIds],
  );
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;
  const activePermissions = resolveConversationAccessPermissions(activeConversation?.accessRole);

  useEffect(() => {
    if (view !== "history" && !activePermissions.canManageSettings) onViewChange("history");
  }, [activePermissions.canManageSettings, onViewChange, view]);

  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 780px)").matches) {
      if (sidebarWasOpenRef.current) {
        sidebarWasOpenRef.current = false;
        const previousFocus = previousSidebarFocusRef.current;
        previousSidebarFocusRef.current = null;
        previousFocus?.focus();
      }
      return;
    }
    if (!sidebarWasOpenRef.current) {
      sidebarWasOpenRef.current = true;
      previousSidebarFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    // Let the opening click and visibility transition settle before moving focus.
    const focusTimer = window.setTimeout(() => {
      if (document.activeElement !== previousSidebarFocusRef.current && document.activeElement !== document.body) return;
      sidebarRef.current?.querySelector<HTMLElement>("[data-sidebar-initial-focus]")?.focus();
    }, 100);
    const handleKeyDown = (event: KeyboardEvent) => {
      const sidebar = sidebarRef.current;
      if (!sidebar || sidebar.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...sidebar.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
      )].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => () => {
    if (sidebarWasOpenRef.current) previousSidebarFocusRef.current?.focus();
  }, []);

  const rename = async (conversation: AgentConversation) => {
    const title = titleDraft.trim();
    if (!title || title === conversation.title) {
      setEditingId("");
      return;
    }
    setPendingId(conversation.id);
    try {
      await onRename(conversation, title);
      setEditingId("");
    } catch {
      // The workspace owns the visible error; keep the editor open for retry.
    } finally {
      setPendingId("");
    }
  };

  const confirmRemove = async (conversation: AgentConversation) => {
    setPendingId(conversation.id);
    try {
      await onDelete(conversation);
      setConversationToDelete(null);
    } catch {
      // The workspace owns the visible error and refresh behavior.
    } finally {
      setPendingId("");
    }
  };

  const exportData = async () => {
    if (busy || loading || accountBusy) return;
    setAccountBusy(true);
    setAccountMessage("");
    setAccountError("");
    try {
      const result = await onExportUserData();
      setAccountMessage(result.truncated ? "导出已下载；较早内容因文件大小限制已省略。" : "导出已开始下载。");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "数据导出失败，请稍后重试。");
    } finally {
      setAccountBusy(false);
    }
  };

  const confirmAccountAction = async () => {
    if (!accountDialog || accountBusy) return;
    setAccountBusy(true);
    setAccountError("");
    try {
      if (accountDialog === "sessions") await onRevokeAllSessions();
      else await onDeleteUserData();
      setAccountDialog(null);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "操作失败，请稍后重试。");
    } finally {
      setAccountBusy(false);
    }
  };

  return (
    <aside ref={sidebarRef} className={`conversation-sidebar ${open ? "open" : ""}`} aria-label="会话与设置">
      <div className="sidebar-topbar">
        <div className="sidebar-tabs" role="group" aria-label="侧栏视图">
          <button type="button" aria-pressed={view === "history"} onClick={() => onViewChange("history")}>对话</button>
          {session.access === "member" && activePermissions.canUseWorkspace && <button type="button" aria-pressed={view === "files"} onClick={() => onViewChange("files")}>文件</button>}
          {activePermissions.canManageSettings && <button type="button" aria-pressed={view === "settings"} onClick={() => onViewChange("settings")}>设置</button>}
        </div>
        <button className="icon-button mobile-only" data-sidebar-initial-focus type="button" onClick={onClose} title="关闭侧栏" aria-label="关闭侧栏"><X size={18} /></button>
      </div>

      {view === "history" ? (
        <>
          <button className="new-conversation" type="button" onClick={() => void onCreate()} disabled={busy || loading}>
            <MessageSquarePlus size={17} /><span>新对话</span>
          </button>
          <label className="conversation-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">搜索会话</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话" />
          </label>
          <div className="conversation-list" aria-busy={loading}>
            {loading && <div className="sidebar-empty">正在读取会话...</div>}
            {!loading && visible.length === 0 && <div className="sidebar-empty">{query ? "没有匹配的对话" : "还没有对话"}</div>}
            {visible.map((conversation) => {
              const active = conversation.id === activeId;
              const editing = conversation.id === editingId;
              const permissions = resolveConversationAccessPermissions(conversation.accessRole);
              return (
                <div className={`conversation-row ${active ? "active" : ""}`} key={conversation.id}>
                  {editing ? (
                    <form onSubmit={(event) => { event.preventDefault(); void rename(conversation); }}>
                      <input
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        maxLength={80}
                        autoFocus
                        onKeyDown={(event) => { if (event.key === "Escape") setEditingId(""); }}
                      />
                      <button className="icon-button" type="submit" disabled={pendingId === conversation.id} title="保存名称" aria-label="保存名称"><Check size={15} /></button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="conversation-select"
                        type="button"
                        aria-pressed={active}
                        onClick={() => { onSelect(conversation); onClose(); }}
                        disabled={busy && !active}
                        title={busy && !active ? "请先停止当前任务" : conversation.title}
                      >
                        <strong>{conversation.title}</strong>
                        <span>{formatConversationDate(conversation.updatedAt)} · {conversation.messageCount} 条消息{conversation.accessRole && conversation.accessRole !== "owner" ? ` · ${conversation.accessRole === "editor" ? "编辑者" : "查看者"}` : ""}</span>
                      </button>
                      <div className="conversation-actions">
                        {permissions.canRename && <button
                          className="icon-button"
                          type="button"
                          disabled={busy || pendingId === conversation.id}
                          onClick={() => { setEditingId(conversation.id); setTitleDraft(conversation.title); }}
                          title="重命名"
                          aria-label="重命名"
                        ><Pencil size={14} /></button>}
                        {permissions.canManageShares && conversation.resourceId && <button
                          className="icon-button"
                          type="button"
                          disabled={busy || pendingId === conversation.id}
                          onClick={() => setConversationToShare(conversation)}
                          title="管理共享"
                          aria-label="管理共享"
                        ><Share2 size={14} /></button>}
                        {permissions.canDelete && <button
                          className="icon-button danger"
                          type="button"
                          disabled={busy || pendingId === conversation.id}
                          onClick={() => setConversationToDelete(conversation)}
                          title="删除会话"
                          aria-label="删除会话"
                        ><Trash2 size={14} /></button>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : view === "files" && session.access === "member" && activePermissions.canUseWorkspace ? (
        <FileWorkspacePanel
          conversation={conversations.find((conversation) => conversation.id === activeId) || null}
          busy={busy}
          onConversationUpdated={onConversationUpdated}
        />
      ) : (
        <div className="settings-view">
          <section className="settings-section">
            <div className="settings-heading"><Settings2 size={16} /><strong>模型线路</strong></div>
            {session.access === "guest" || !activePermissions.canManageSettings ? (
              <div className="fixed-route-label">
                {session.routes.find((route) => route.id === routeId)
                  ? `${session.routes.find((route) => route.id === routeId)?.label} · ${session.routes.find((route) => route.id === routeId)?.model}`
                  : "尚未配置可用线路"}
              </div>
            ) : (
              <select value={routeId} onChange={(event) => onRouteChange(event.target.value)} disabled={busy || session.routes.length === 0}>
                {session.routes.length === 0
                  ? <option value="">尚未配置可用线路</option>
                  : session.routes.map((route) => <option value={route.id} key={route.id}>{route.label} · {route.model}</option>)}
              </select>
            )}
            <small>{session.routes.length === 0
              ? "请联系管理员配置模型线路"
              : routeStatusText(session.routes.find((route) => route.id === routeId)?.healthStatus)}</small>
          </section>
          {session.access === "member" && activePermissions.canManageSettings && (
            <>
              <section className="settings-section">
                <div className="settings-heading"><Sparkles size={16} /><strong>Skills</strong><span>{skillIds.length}/3</span></div>
                <div className="skill-mode-control" role="group" aria-label="Skill 模式">
                  <button
                    type="button"
                    aria-pressed={skillMode === "automatic"}
                    disabled={busy}
                    onClick={() => onSkillModeChange("automatic")}
                  >自动</button>
                  <button
                    type="button"
                    aria-pressed={skillMode === "manual"}
                    disabled={busy}
                    onClick={() => onSkillModeChange("manual")}
                  >手动</button>
                </div>
                <div className="skill-list">
                  {session.skills.length === 0 && <div className="sidebar-empty">未分配 Skill</div>}
                  {session.skills.map((skill) => (
                    <label className="skill-option" key={skill.id}>
                      <input
                        type="checkbox"
                        checked={skillIds.includes(skill.id)}
                        disabled={skillMode === "automatic" || busy || (!skillIds.includes(skill.id) && skillIds.length >= 3)}
                        onChange={() => onSkillChange(
                          skillIds.includes(skill.id)
                            ? skillIds.filter((id) => id !== skill.id)
                            : [...skillIds, skill.id],
                        )}
                      />
                      <span><strong>{skill.label}</strong><small>{skill.description || "已分配能力"}</small></span>
                    </label>
                  ))}
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-heading"><strong>工具</strong><span>{session.tools.length}</span></div>
                <div className="tool-list">
                  {session.tools.length === 0 && <div className="sidebar-empty">未分配工具</div>}
                  {session.tools.map((tool) => {
                    const active = selectedToolIds.has(tool.id);
                    return (
                      <div className={`tool-row ${active ? "active" : ""}`} key={tool.id}>
                        <span className="tool-source" title={tool.source === "mcp" ? "MCP 工具" : "内置工具"}>
                          {tool.source === "mcp" ? <Plug size={15} aria-hidden="true" /> : <Wrench size={15} aria-hidden="true" />}
                        </span>
                        <span className="tool-copy">
                          <strong>{tool.label}</strong>
                          <small>{tool.description || toolSourceText(tool.source)} · {confirmationText(tool.confirmation)}</small>
                        </span>
                        <span className="tool-state">{active ? "已启用" : routeSupportsTools ? "未启用" : "线路不支持"}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
          <section className="usage-summary">
            <span>今日剩余</span>
            <strong>{session.usage.remaining}</strong>
            <small>已使用 {session.usage.used} / {session.usage.limit}</small>
          </section>
          {session.capabilities.accountData && <section className="settings-section account-section" aria-labelledby="account-data-title">
            <div className="settings-heading" id="account-data-title"><strong>账号与数据</strong></div>
            <p className="account-description">导出个人数据，或管理其他设备的登录状态。数据清理不会撤销访问权限。</p>
            <div className="account-actions">
              <button className="quiet-button icon-text-button" type="button" onClick={() => void exportData()} disabled={busy || loading || accountBusy}>
                <Download size={15} />
                <span>导出我的数据</span>
              </button>
              <button className="quiet-button icon-text-button" type="button" onClick={() => { setAccountError(""); setAccountDialog("sessions"); }} disabled={busy || loading || accountBusy}>
                <LogOut size={15} />
                <span>注销所有设备</span>
              </button>
              <button className="quiet-button danger icon-text-button" type="button" onClick={() => { setAccountError(""); setAccountDialog("delete"); }} disabled={busy || loading || accountBusy}>
                <Trash2 size={15} />
                <span>清空我的数据</span>
              </button>
            </div>
            {accountMessage && <p className="account-status" role="status">{accountMessage}</p>}
            {accountError && <p className="account-status error" role="alert">{accountError}</p>}
          </section>}
        </div>
      )}
      {accountDialog && (
        <AccountActionDialog
          kind={accountDialog}
          busy={accountBusy}
          error={accountError}
          onClose={() => { if (!accountBusy) { setAccountDialog(null); setAccountError(""); } }}
          onConfirm={() => void confirmAccountAction()}
        />
      )}
      {conversationToDelete && (
        <ConversationDeleteDialog
          conversation={conversationToDelete}
          busy={pendingId === conversationToDelete.id}
          onClose={() => { if (pendingId !== conversationToDelete.id) setConversationToDelete(null); }}
          onConfirm={() => void confirmRemove(conversationToDelete)}
        />
      )}
      {conversationToShare && (
        <ConversationShareDialog
          conversation={conversationToShare}
          onClose={() => setConversationToShare(null)}
          onAccessChanged={(accessRevision) => {
            onAccessChanged(conversationToShare, accessRevision);
            setConversationToShare((current) => current ? { ...current, accessRevision } : current);
          }}
        />
      )}
    </aside>
  );
}

function AccountActionDialog({
  kind,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  kind: "sessions" | "delete";
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  const deleting = kind === "delete";
  return (
    <dialog
      ref={dialogRef}
      className="account-action-dialog"
      aria-labelledby="account-action-dialog-title"
      aria-describedby="account-action-dialog-description"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div className="account-action-dialog-content">
        <header>
          <div><strong id="account-action-dialog-title">{deleting ? "清空我的数据" : "注销所有设备"}</strong></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭" title="关闭"><X size={18} /></button>
        </header>
        <div className="account-action-dialog-body">
          <p id="account-action-dialog-description">
            {deleting
              ? "聊天记录、长期记忆、用量和反馈将永久删除，所有设备会退出登录；访问权限仍保留，之后可重新登录。"
              : "所有设备的登录会话会立即注销，聊天记录、长期记忆和访问权限不会改变。"}
          </p>
          {error && <p className="account-status error" role="alert">{error}</p>}
          <div className="account-dialog-actions">
            <button className="quiet-button" data-dialog-initial-focus type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className={deleting ? "danger-button icon-text-button" : "primary-button icon-text-button"} type="button" onClick={onConfirm} disabled={busy}>
              {deleting ? <Trash2 size={15} /> : <LogOut size={15} />}
              <span>{busy ? "处理中..." : deleting ? "确认清空" : "确认注销"}</span>
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function ConversationDeleteDialog({
  conversation,
  busy,
  onClose,
  onConfirm,
}: {
  conversation: AgentConversation;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="conversation-delete-dialog"
      aria-labelledby="conversation-delete-title"
      aria-describedby="conversation-delete-description"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div className="conversation-delete-dialog-content">
        <header>
          <div><Trash2 size={17} aria-hidden="true" /><strong id="conversation-delete-title">删除这段对话？</strong></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭" title="关闭"><X size={18} /></button>
        </header>
        <div className="conversation-delete-dialog-body">
          <p id="conversation-delete-description">“{conversation.title}”的聊天记录会被清空，且无法恢复。账号、其他对话和长期记忆不会受到影响。</p>
          <div className="conversation-delete-actions">
            <button className="quiet-button" data-dialog-initial-focus type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="danger-button icon-text-button" type="button" onClick={onConfirm} disabled={busy}>
              <Trash2 size={15} />
              <span>{busy ? "删除中..." : "确认删除"}</span>
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function formatConversationDate(value: number): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function routeStatusText(status: SessionProjection["routes"][number]["healthStatus"]): string {
  if (status === "healthy") return "最近真实任务运行正常";
  if (status === "unhealthy") return "最近真实任务出现异常，可切换其他线路";
  return "尚无近期真实任务记录";
}

function toolSourceText(source: SessionProjection["tools"][number]["source"]): string {
  return source === "mcp" ? "MCP 工具" : "内置工具";
}

function confirmationText(confirmation: SessionProjection["tools"][number]["confirmation"]): string {
  if (confirmation === "always") return "每次确认";
  if (confirmation === "first-per-conversation") return "首次确认";
  return "无需确认";
}
