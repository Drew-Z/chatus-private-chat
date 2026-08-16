import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Files, MessageSquarePlus, Pencil, Search, Settings, Share2, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { AgentConversation, SessionProjection } from "../lib/api";
import type { ConversationSkillMode } from "../../../src/contracts/agent";
import { resolveConversationAccessPermissions } from "../lib/state";
import { ConversationShareDialog } from "./ConversationShareDialog";
import { ProductBrand } from "./ProductBrand";

export type SidebarView = "history" | "files" | "settings";

export function ConversationSidebar({
  open,
  session,
  conversations,
  activeId,
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
  onOpenMemberSettings = () => undefined,
}: {
  open: boolean;
  session: SessionProjection;
  conversations: AgentConversation[];
  activeId: string;
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
  onOpenMemberSettings?: () => void;
  /** @deprecated Contextual settings now render in ConversationInspector. */
  routeId?: string;
  /** @deprecated Contextual settings now render in ConversationInspector. */
  skillMode?: ConversationSkillMode;
  /** @deprecated Contextual settings now render in ConversationInspector. */
  skillIds?: string[];
  /** @deprecated Contextual settings now render in ConversationInspector. */
  onConversationUpdated?: (conversation: AgentConversation) => void;
  /** @deprecated Contextual settings now render in ConversationInspector. */
  onRouteChange?: (routeId: string) => void;
  /** @deprecated Contextual settings now render in ConversationInspector. */
  onSkillModeChange?: (skillMode: ConversationSkillMode) => void;
  /** @deprecated Contextual settings now render in ConversationInspector. */
  onSkillChange?: (skillIds: string[]) => void;
  /** @deprecated MemberSettingsCenter owns account operations. */
  onRevokeAllSessions?: () => Promise<void>;
  /** @deprecated MemberSettingsCenter owns account operations. */
  onDeleteUserData?: () => Promise<void>;
  /** @deprecated MemberSettingsCenter owns account operations. */
  onExportUserData?: () => Promise<{ truncated: boolean }>;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [conversationToDelete, setConversationToDelete] = useState<AgentConversation | null>(null);
  const [conversationToShare, setConversationToShare] = useState<AgentConversation | null>(null);
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
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;
  const activePermissions = resolveConversationAccessPermissions(activeConversation?.accessRole);

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


  return (
    <aside ref={sidebarRef} className={`conversation-sidebar ${open ? "open" : ""}`} aria-label="会话导航">
      <div className="sidebar-brand">
        <ProductBrand meta={session.access === "member" ? "Chatus · Member" : "Chatus · Guest"} />
      </div>
      <div className="sidebar-topbar">
        <div className="sidebar-title"><strong>最近对话</strong><span>{conversations.length}</span></div>
        <button className="icon-button mobile-only" data-sidebar-initial-focus type="button" onClick={onClose} title="关闭侧栏" aria-label="关闭侧栏"><X size={18} /></button>
      </div>
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
                  <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={80} autoFocus onKeyDown={(event) => { if (event.key === "Escape") setEditingId(""); }} />
                  <button className="icon-button" type="submit" disabled={pendingId === conversation.id} title="保存名称" aria-label="保存名称"><Check size={15} /></button>
                </form>
              ) : (
                <>
                  <button className="conversation-select" type="button" aria-pressed={active} onClick={() => { onSelect(conversation); onClose(); }} disabled={busy && !active} title={busy && !active ? "请先停止当前任务" : conversation.title}>
                    <strong>{conversation.title}</strong>
                    <span>{formatConversationDate(conversation.updatedAt)} · {conversation.messageCount} 条消息{conversation.accessRole && conversation.accessRole !== "owner" ? ` · ${conversation.accessRole === "editor" ? "编辑者" : "查看者"}` : ""}</span>
                  </button>
                  <div className="conversation-actions">
                    {permissions.canRename && <button className="icon-button" type="button" disabled={busy || pendingId === conversation.id} onClick={() => { setEditingId(conversation.id); setTitleDraft(conversation.title); }} title="重命名" aria-label="重命名"><Pencil size={14} /></button>}
                    {permissions.canManageShares && conversation.resourceId && <button className="icon-button" type="button" disabled={busy || pendingId === conversation.id} onClick={() => setConversationToShare(conversation)} title="管理共享" aria-label="管理共享"><Share2 size={14} /></button>}
                    {permissions.canDelete && <button className="icon-button danger" type="button" disabled={busy || pendingId === conversation.id} onClick={() => setConversationToDelete(conversation)} title="删除会话" aria-label="删除会话"><Trash2 size={14} /></button>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="sidebar-footer-actions">
        {session.access === "member" && activePermissions.canUseWorkspace && (
          <button type="button" aria-pressed={view === "files"} onClick={() => { onViewChange("files"); onClose(); }}><Files size={16} /><span>文件</span></button>
        )}
        {(session.access === "guest" || activePermissions.canManageSettings) && (
          <button type="button" aria-pressed={view === "settings"} onClick={() => { onViewChange("settings"); onClose(); }}><SlidersHorizontal size={16} /><span>上下文</span></button>
        )}
        <button type="button" onClick={() => { onOpenMemberSettings(); onClose(); }}><Settings size={16} /><span>设置</span></button>
      </div>
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
