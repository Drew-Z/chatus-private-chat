import { useEffect, useMemo, useRef, useState } from "react";
import { Files, Plug, Route, Share2, Sparkles, Wrench, X } from "lucide-react";
import type { ConversationSkillMode } from "../../../src/contracts/agent";
import type { AgentConversation, MemberModelAvailability, SessionProjection } from "../lib/api";
import { resolveConversationAccessPermissions } from "../lib/state";
import { ConversationShareDialog } from "./ConversationShareDialog";
import {
  ModelAvailabilityBadge,
  availabilityConfidenceLabel,
  availabilityPresentation,
  availabilitySpeedLabel,
} from "./ModelAvailabilityBadge";
import { FileWorkspacePanel } from "./FileWorkspacePanel";

export type InspectorSection = "model" | "skills" | "tools" | "files" | "sharing";
export type ConversationSettingsSaveState = "idle" | "saving" | "saved" | "error";

export function ConversationInspector({
  open,
  section: requestedSection,
  session,
  conversation,
  routeId,
  modelAvailability,
  modelAvailabilityRefreshing,
  skillMode,
  skillIds,
  saveState,
  busy,
  onClose,
  onSectionChange,
  onConversationUpdated,
  onAccessChanged,
  onRouteChange,
  onSkillModeChange,
  onSkillChange,
  onRetrySave,
}: {
  open: boolean;
  section: InspectorSection;
  session: SessionProjection;
  conversation: AgentConversation | null;
  routeId: string;
  modelAvailability?: MemberModelAvailability | null;
  modelAvailabilityRefreshing?: boolean;
  skillMode: ConversationSkillMode;
  skillIds: string[];
  saveState: ConversationSettingsSaveState;
  busy: boolean;
  onClose: () => void;
  onSectionChange: (section: InspectorSection) => void;
  onConversationUpdated: (conversation: AgentConversation) => void;
  onAccessChanged: (conversation: AgentConversation, accessRevision: number) => void;
  onRouteChange: (routeId: string) => void;
  onSkillModeChange: (skillMode: ConversationSkillMode) => void;
  onSkillChange: (skillIds: string[]) => void;
  onRetrySave: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  const shareOpenRef = useRef(shareOpen);
  onCloseRef.current = onClose;
  shareOpenRef.current = shareOpen;
  const permissions = resolveConversationAccessPermissions(conversation?.accessRole);
  const routeSupportsTools = session.routes.find((route) => route.id === routeId)?.supportsTools === true;
  const availabilityRoute = modelAvailability?.routes.find((route) => route.routeId === routeId);
  const selectedToolIds = useMemo(
    () => new Set(routeSupportsTools
      ? session.skills.filter((skill) => skillIds.includes(skill.id)).flatMap((skill) => skill.toolIds)
      : []),
    [routeSupportsTools, session.skills, skillIds],
  );
  const availableSections = useMemo(() => [
    "model" as const,
    ...(session.access === "member" && permissions.canManageSettings ? ["skills" as const, "tools" as const] : []),
    ...(session.access === "member" && permissions.canUseWorkspace ? ["files" as const] : []),
    ...(permissions.canManageShares && conversation?.resourceId ? ["sharing" as const] : []),
  ], [conversation?.resourceId, permissions.canManageSettings, permissions.canManageShares, permissions.canUseWorkspace, session.access]);
  const section = availableSections.includes(requestedSection) ? requestedSection : "model";

  useEffect(() => {
    if (section !== requestedSection) onSectionChange(section);
  }, [onSectionChange, requestedSection, section]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const mobile = window.matchMedia("(max-width: 780px)").matches;
    const frame = window.requestAnimationFrame(() => {
      if (mobile) closeRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shareOpenRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (!mobile || event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      )].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <aside ref={panelRef} className="conversation-inspector" aria-label="对话上下文">
      <header className="inspector-header">
        <div>
          <strong>对话上下文</strong>
          <span title={conversation?.title}>{conversation?.title || "当前对话"}</span>
        </div>
        <button ref={closeRef} className="icon-button" type="button" onClick={onClose} title="关闭对话上下文" aria-label="关闭对话上下文"><X size={18} /></button>
      </header>
      <nav className="inspector-tabs" aria-label="对话上下文分区">
        {availableSections.map((candidate) => {
          const item = inspectorNavItem(candidate);
          const Icon = item.icon;
          return (
            <button key={candidate} type="button" aria-pressed={section === candidate} onClick={() => onSectionChange(candidate)}>
              <Icon size={15} aria-hidden="true" /><span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="inspector-body">
        {section === "model" && (
          <section className="inspector-section" aria-labelledby="inspector-model-title">
            <div className="settings-heading"><div><Route size={16} /><strong id="inspector-model-title">模型与线路</strong></div></div>
            {session.access === "guest" || !permissions.canManageSettings ? (
              <div className="fixed-route-label">{selectedRouteLabel(session, routeId)}</div>
            ) : (
              <select aria-label="当前模型线路" value={routeId} onChange={(event) => onRouteChange(event.target.value)} disabled={busy || session.routes.length === 0}>
                {session.routes.length === 0
                  ? <option value="">尚未配置可用线路</option>
                  : session.routes.map((route) => <option value={route.id} key={route.id}>{route.label} · {route.model}</option>)}
              </select>
            )}
            <small>{session.routes.length === 0
              ? "请联系管理员配置模型线路"
              : availabilityRoute
                ? `${availabilityPresentation(availabilityRoute, modelAvailabilityRefreshing).description}${availabilityRoute.speed !== "unknown" ? ` · ${availabilitySpeedLabel(availabilityRoute.speed)}` : ""}`
                : modelAvailabilityRefreshing ? "正在更新最近可用性" : "暂无观测"}</small>
            {availabilityRoute?.fallbackRecentlyUsed && <small className="model-availability-fallback">最近请求已自动切换备用线路。</small>}
            {modelAvailability && session.routes.length > 0 && (
              <div className="model-availability-list" aria-label="模型可用性">
                {session.routes.map((route) => {
                  const status = modelAvailability.routes.find((candidate) => candidate.routeId === route.id);
                  return (
                    <div className="model-availability-row" key={route.id}>
                      <span>
                        <strong>{route.label}</strong>
                        <small>{route.model}</small>
                        <small>{status ? `${availabilityConfidenceLabel(status.confidence)}${status.observedAt ? ` · 最近 ${formatAvailabilityTime(status.observedAt)}` : ""}` : "暂无观测"}</small>
                      </span>
                      <ModelAvailabilityBadge route={status} compact refreshing={modelAvailabilityRefreshing} />
                    </div>
                  );
                })}
                <small className="model-availability-footnote">状态基于最近 Chatus 流量，仅作选择参考，不保证下一次请求。更新时间：{formatAvailabilityTime(modelAvailability.generatedAt)}{modelAvailabilityRefreshing ? " · 正在更新" : ""}</small>
              </div>
            )}
            <SaveState state={saveState} onRetry={onRetrySave} />
          </section>
        )}
        {section === "skills" && session.access === "member" && permissions.canManageSettings && (
          <section className="inspector-section" aria-labelledby="inspector-skills-title">
            <div className="settings-heading"><div><Sparkles size={16} /><strong id="inspector-skills-title">Skills</strong></div><span>{skillIds.length}/3</span></div>
            <div className="skill-mode-control" role="group" aria-label="Skill 模式">
              <button type="button" aria-pressed={skillMode === "automatic"} disabled={busy} onClick={() => onSkillModeChange("automatic")}>自动</button>
              <button type="button" aria-pressed={skillMode === "manual"} disabled={busy} onClick={() => onSkillModeChange("manual")}>手动</button>
            </div>
            <div className="skill-list">
              {session.skills.length === 0 && <div className="sidebar-empty">未分配 Skill</div>}
              {session.skills.map((skill) => (
                <label className="skill-option" key={skill.id}>
                  <input
                    type="checkbox"
                    checked={skillIds.includes(skill.id)}
                    disabled={skillMode === "automatic" || busy || (!skillIds.includes(skill.id) && skillIds.length >= 3)}
                    onChange={() => onSkillChange(skillIds.includes(skill.id)
                      ? skillIds.filter((id) => id !== skill.id)
                      : [...skillIds, skill.id])}
                  />
                  <span><strong>{skill.label}</strong><small>{skill.description || "已分配能力"}</small></span>
                </label>
              ))}
            </div>
            <SaveState state={saveState} onRetry={onRetrySave} />
          </section>
        )}
        {section === "tools" && session.access === "member" && permissions.canManageSettings && (
          <section className="inspector-section" aria-labelledby="inspector-tools-title">
            <div className="settings-heading"><div><Wrench size={16} /><strong id="inspector-tools-title">工具</strong></div><span>{session.tools.length}</span></div>
            <div className="tool-list">
              {session.tools.length === 0 && <div className="sidebar-empty">未分配工具</div>}
              {session.tools.map((tool) => {
                const active = selectedToolIds.has(tool.id);
                return (
                  <div className={`tool-row ${active ? "active" : ""}`} key={tool.id}>
                    <span className="tool-source" title={tool.source === "mcp" ? "MCP 工具" : "内置工具"}>
                      {tool.source === "mcp" ? <Plug size={15} aria-hidden="true" /> : <Wrench size={15} aria-hidden="true" />}
                    </span>
                    <span className="tool-copy"><strong>{tool.label}</strong><small>{tool.description || toolSourceText(tool.source)} · {confirmationText(tool.confirmation)}</small></span>
                    <span className="tool-state">{active ? "已启用" : routeSupportsTools ? "未启用" : "线路不支持"}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {section === "files" && session.access === "member" && permissions.canUseWorkspace && (
          <FileWorkspacePanel conversation={conversation} busy={busy} onConversationUpdated={onConversationUpdated} />
        )}
        {section === "sharing" && conversation && permissions.canManageShares && conversation.resourceId && (
          <section className="inspector-section" aria-labelledby="inspector-sharing-title">
            <div className="settings-heading"><div><Share2 size={16} /><strong id="inspector-sharing-title">共享</strong></div></div>
            <p className="inspector-description">管理当前对话的成员访问角色。共享写入继续使用现有版本与冲突检查。</p>
            <button className="quiet-button icon-text-button" type="button" onClick={() => setShareOpen(true)} disabled={busy}>
              <Share2 size={15} /><span>管理共享</span>
            </button>
          </section>
        )}
      </div>
      {shareOpen && conversation && (
        <ConversationShareDialog
          conversation={conversation}
          onClose={() => setShareOpen(false)}
          onAccessChanged={(accessRevision) => onAccessChanged(conversation, accessRevision)}
        />
      )}
    </aside>
  );
}

function SaveState({ state, onRetry }: { state: ConversationSettingsSaveState; onRetry: () => void }) {
  return (
    <div className={`settings-save-state ${state}`} role={state === "error" ? "alert" : "status"} aria-live="polite">
      <span>{state === "saving" ? "保存中" : state === "saved" ? "已保存" : state === "error" ? "保存失败" : "\u00a0"}</span>
      {state === "error" && <button type="button" onClick={onRetry}>重试</button>}
    </div>
  );
}

function inspectorNavItem(section: InspectorSection) {
  if (section === "skills") return { label: "Skills", icon: Sparkles };
  if (section === "tools") return { label: "工具", icon: Wrench };
  if (section === "files") return { label: "文件", icon: Files };
  if (section === "sharing") return { label: "共享", icon: Share2 };
  return { label: "模型", icon: Route };
}

function selectedRouteLabel(session: SessionProjection, routeId: string): string {
  const route = session.routes.find((candidate) => candidate.id === routeId);
  return route ? `${route.label} · ${route.model}` : "尚未配置可用线路";
}

function formatAvailabilityTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function toolSourceText(source: SessionProjection["tools"][number]["source"]): string {
  return source === "mcp" ? "MCP 工具" : "内置工具";
}

function confirmationText(confirmation: SessionProjection["tools"][number]["confirmation"]): string {
  if (confirmation === "always") return "每次确认";
  if (confirmation === "first-per-conversation") return "首次确认";
  return "无需确认";
}
