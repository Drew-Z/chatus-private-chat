import { useMemo, useState } from "react";
import { Check, MessageSquarePlus, Pencil, Search, Settings2, Trash2, X } from "lucide-react";
import type { AgentConversation, SessionProjection } from "../lib/api";

export function ConversationSidebar({
  open,
  session,
  conversations,
  activeId,
  routeId,
  skillIds,
  busy,
  loading,
  onClose,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onRouteChange,
  onSkillChange,
}: {
  open: boolean;
  session: SessionProjection;
  conversations: AgentConversation[];
  activeId: string;
  routeId: string;
  skillIds: string[];
  busy: boolean;
  loading: boolean;
  onClose: () => void;
  onSelect: (conversation: AgentConversation) => void;
  onCreate: () => Promise<void>;
  onRename: (conversation: AgentConversation, title: string) => Promise<void>;
  onDelete: (conversation: AgentConversation) => Promise<void>;
  onRouteChange: (routeId: string) => void;
  onSkillChange: (skillIds: string[]) => void;
}) {
  const [view, setView] = useState<"history" | "settings">("history");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingId, setPendingId] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(normalized))
      : conversations;
  }, [conversations, query]);

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

  const remove = async (conversation: AgentConversation) => {
    if (!window.confirm(`删除“${conversation.title}”？此操作会清空该会话记录。`)) return;
    setPendingId(conversation.id);
    try {
      await onDelete(conversation);
    } catch {
      // The workspace owns the visible error and refresh behavior.
    } finally {
      setPendingId("");
    }
  };

  return (
    <aside className={`conversation-sidebar ${open ? "open" : ""}`} aria-label="会话与设置">
      <div className="sidebar-topbar">
        <div className="sidebar-tabs" role="tablist" aria-label="侧栏视图">
          <button type="button" role="tab" aria-selected={view === "history"} onClick={() => setView("history")}>对话</button>
          <button type="button" role="tab" aria-selected={view === "settings"} onClick={() => setView("settings")}>设置</button>
        </div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} title="关闭侧栏" aria-label="关闭侧栏"><X size={18} /></button>
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
                        onClick={() => { onSelect(conversation); onClose(); }}
                        disabled={busy && !active}
                        title={busy && !active ? "请先停止当前任务" : conversation.title}
                      >
                        <strong>{conversation.title}</strong>
                        <span>{formatConversationDate(conversation.updatedAt)} · {conversation.messageCount} 条消息</span>
                      </button>
                      <div className="conversation-actions">
                        <button
                          className="icon-button"
                          type="button"
                          disabled={busy || pendingId === conversation.id}
                          onClick={() => { setEditingId(conversation.id); setTitleDraft(conversation.title); }}
                          title="重命名"
                          aria-label="重命名"
                        ><Pencil size={14} /></button>
                        <button
                          className="icon-button danger"
                          type="button"
                          disabled={busy || pendingId === conversation.id}
                          onClick={() => void remove(conversation)}
                          title="删除会话"
                          aria-label="删除会话"
                        ><Trash2 size={14} /></button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="settings-view">
          <section className="settings-section">
            <div className="settings-heading"><Settings2 size={16} /><strong>模型线路</strong></div>
            <select value={routeId} onChange={(event) => onRouteChange(event.target.value)} disabled={busy || session.routes.length === 0}>
              {session.routes.length === 0
                ? <option value="">尚未配置可用线路</option>
                : session.routes.map((route) => <option value={route.id} key={route.id}>{route.label} · {route.model}</option>)}
            </select>
            <small>{session.routes.length === 0
              ? "请联系管理员配置模型线路"
              : routeStatusText(session.routes.find((route) => route.id === routeId)?.healthStatus)}</small>
          </section>
          <section className="settings-section">
            <div className="settings-heading"><strong>Skills</strong><span>{skillIds.length}/3</span></div>
            <div className="skill-list">
              {session.skills.length === 0 && <div className="sidebar-empty">未分配 Skill</div>}
              {session.skills.map((skill) => (
                <label className="skill-option" key={skill.id}>
                  <input
                    type="checkbox"
                    checked={skillIds.includes(skill.id)}
                    disabled={busy || (!skillIds.includes(skill.id) && skillIds.length >= 3)}
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
          <section className="usage-summary">
            <span>今日剩余</span>
            <strong>{session.usage.remaining}</strong>
            <small>已使用 {session.usage.used} / {session.usage.limit}</small>
          </section>
        </div>
      )}
    </aside>
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
