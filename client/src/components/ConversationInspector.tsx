import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cable,
  Files,
  Globe2,
  Image as ImageIcon,
  ImageOff,
  Plug,
  RefreshCw,
  Route,
  Share2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { ConversationSkillMode } from "../../../src/contracts/agent";
import type { PublicCapabilityV1 } from "../../../src/contracts/capability";
import type {
  AgentConversation,
  McpOAuthConnection,
  MemberModelAvailability,
  SessionProjection,
} from "../lib/api";
import type {
  CapabilityTurnKind,
  CapabilityTurnSnapshot,
  CapabilityTurnStatus,
} from "../lib/capability-turn";
import { resolveConversationAccessPermissions } from "../lib/state";
import { ConversationShareDialog } from "./ConversationShareDialog";
import {
  ModelAvailabilityBadge,
  availabilityConfidenceLabel,
  availabilityPresentation,
  availabilitySpeedLabel,
} from "./ModelAvailabilityBadge";
import { FileWorkspacePanel } from "./FileWorkspacePanel";

export type InspectorSection = "capabilities" | "files" | "sharing";
export type ConversationSettingsSaveState = "idle" | "saving" | "saved" | "error";

export function ConversationInspector({
  open,
  section: requestedSection,
  session,
  conversation,
  routeId,
  modelAvailability,
  modelAvailabilityRefreshing,
  mcpConnections,
  capabilityTurn,
  skillMode,
  skillIds,
  saveState,
  busy,
  nestedOpen,
  onClose,
  onSectionChange,
  onConversationUpdated,
  onAccessChanged,
  onRouteChange,
  onSkillModeChange,
  onSkillChange,
  onRetrySave,
  onOpenMcpConnections,
  onRetryCapabilityTurn,
  onRemoveCapabilityImages,
}: {
  open: boolean;
  section: InspectorSection;
  session: SessionProjection;
  conversation: AgentConversation | null;
  routeId: string;
  modelAvailability?: MemberModelAvailability | null;
  modelAvailabilityRefreshing?: boolean;
  mcpConnections: McpOAuthConnection[];
  capabilityTurn: CapabilityTurnSnapshot | null;
  skillMode: ConversationSkillMode;
  skillIds: string[];
  saveState: ConversationSettingsSaveState;
  busy: boolean;
  nestedOpen: boolean;
  onClose: () => void;
  onSectionChange: (section: InspectorSection) => void;
  onConversationUpdated: (conversation: AgentConversation) => void;
  onAccessChanged: (conversation: AgentConversation, accessRevision: number) => void;
  onRouteChange: (routeId: string) => void;
  onSkillModeChange: (skillMode: ConversationSkillMode) => void;
  onSkillChange: (skillIds: string[]) => void;
  onRetrySave: () => void;
  onOpenMcpConnections: () => void;
  onRetryCapabilityTurn: () => void;
  onRemoveCapabilityImages: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const routeSelectRef = useRef<HTMLSelectElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  const nestedOpenRef = useRef(nestedOpen || shareOpen);
  onCloseRef.current = onClose;
  nestedOpenRef.current = nestedOpen || shareOpen;

  const permissions = resolveConversationAccessPermissions(conversation?.accessRole);
  const selectedRoute = session.routes.find((route) => route.id === routeId);
  const routeSupportsTools = selectedRoute?.supportsTools === true;
  const selectedImageMode = selectedRoute?.imageMode || "none";
  const availabilityRoute = modelAvailability?.routes.find((route) => route.routeId === routeId);
  const selectedToolIds = useMemo(
    () => new Set(skillMode === "manual" && routeSupportsTools
      ? session.skills.filter((skill) => skillIds.includes(skill.id)).flatMap((skill) => skill.toolIds)
      : []),
    [routeSupportsTools, session.skills, skillIds, skillMode],
  );
  const workflowCapabilities = session.availableCapabilities.filter((capability) => capability.activation === "workflow");
  const explicitTurnCapabilities = session.availableCapabilities.filter((capability) => capability.activation === "explicit_turn");
  const routeAugmentations = session.availableCapabilities.filter((capability) => capability.activation === "route_augmentation");
  const availableSections = useMemo(() => [
    "capabilities" as const,
    ...(session.access === "member" && permissions.canUseWorkspace ? ["files" as const] : []),
    ...(permissions.canManageShares && conversation?.resourceId ? ["sharing" as const] : []),
  ], [conversation?.resourceId, permissions.canManageShares, permissions.canUseWorkspace, session.access]);
  const section = availableSections.includes(requestedSection) ? requestedSection : "capabilities";
  const recoveryActions = new Set(capabilityTurn?.items.flatMap((item) => item.recovery) || []);
  const connectedMcp = mcpConnections.filter((connection) => connection.status === "connected").length;
  const attentionMcp = mcpConnections.filter((connection) => connection.status !== "connected").length;

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
      if (nestedOpenRef.current) return;
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
        {section === "capabilities" && (
          <section className="inspector-section capability-inspector" aria-labelledby="inspector-capabilities-title">
            <div className="settings-heading capability-inspector-title">
              <div><Sparkles size={16} /><strong id="inspector-capabilities-title">能力</strong></div>
            </div>

            <CapabilityTurnStatus turn={capabilityTurn} />
            {recoveryActions.size > 0 && (
              <div className="capability-recovery-actions" aria-label="能力恢复操作">
                {recoveryActions.has("retry") && <button className="quiet-button icon-text-button" type="button" onClick={onRetryCapabilityTurn} disabled={busy}><RefreshCw size={15} /><span>重试本轮</span></button>}
                {recoveryActions.has("remove_images") && <button className="quiet-button icon-text-button" type="button" onClick={onRemoveCapabilityImages} disabled={busy}><ImageOff size={15} /><span>移除图片</span></button>}
                {recoveryActions.has("switch_route") && session.access === "member" && permissions.canManageSettings && session.routes.length > 1 && (
                  <button className="quiet-button icon-text-button" type="button" onClick={() => routeSelectRef.current?.focus()} disabled={busy}><Route size={15} /><span>切换模型</span></button>
                )}
                {recoveryActions.has("connect_mcp") && session.access === "member" && (
                  <button className="quiet-button icon-text-button" type="button" onClick={onOpenMcpConnections} disabled={busy}><Cable size={15} /><span>管理连接</span></button>
                )}
              </div>
            )}

            <div className="capability-group" aria-labelledby="capability-route-title">
              <div className="capability-group-heading"><Route size={16} /><strong id="capability-route-title">模型与线路</strong></div>
              {session.access === "guest" || !permissions.canManageSettings ? (
                <div className="fixed-route-label">{selectedRouteLabel(session, routeId)}</div>
              ) : (
                <select ref={routeSelectRef} aria-label="当前模型线路" value={routeId} onChange={(event) => onRouteChange(event.target.value)} disabled={busy || session.routes.length === 0}>
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
            </div>

            {session.access === "member" && permissions.canManageSettings && (
              <div className="capability-group" aria-labelledby="capability-workflow-title">
                <div className="capability-group-heading">
                  <Sparkles size={16} />
                  <strong id="capability-workflow-title">工作流</strong>
                  <span>{skillMode === "automatic" ? `候选 ${session.skills.length} · 最多 3` : `${skillIds.length}/3`}</span>
                </div>
                <div className="skill-mode-control" role="group" aria-label="Skill 模式">
                  <button type="button" aria-pressed={skillMode === "automatic"} disabled={busy} onClick={() => onSkillModeChange("automatic")}>自动</button>
                  <button type="button" aria-pressed={skillMode === "manual"} disabled={busy} onClick={() => onSkillModeChange("manual")}>手动</button>
                </div>
                <div className="skill-list">
                  {session.skills.length === 0 && <div className="sidebar-empty">未分配工作流</div>}
                  {session.skills.map((skill) => {
                    const capability = workflowCapabilities.find((candidate) => candidate.id === skill.id);
                    return (
                      <div className="skill-capability-row" key={skill.id}>
                        <label className="skill-option">
                          <input
                            type="checkbox"
                            checked={skillMode === "manual" && skillIds.includes(skill.id)}
                            disabled={skillMode === "automatic" || busy || (!skillIds.includes(skill.id) && skillIds.length >= 3)}
                            onChange={() => onSkillChange(skillIds.includes(skill.id)
                              ? skillIds.filter((id) => id !== skill.id)
                              : [...skillIds, skill.id])}
                          />
                          <span><strong>{skill.label}</strong><small>{skill.description || "已分配工作流"}</small></span>
                        </label>
                        {capability && <CapabilityDisclosure capability={capability} />}
                      </div>
                    );
                  })}
                </div>
                <SaveState state={saveState} onRetry={onRetrySave} />
              </div>
            )}

            {session.access === "member" && permissions.canManageSettings && (
              <div className="capability-group" aria-labelledby="capability-turn-tools-title">
                <div className="capability-group-heading"><Globe2 size={16} /><strong id="capability-turn-tools-title">本轮工具</strong></div>
                {explicitTurnCapabilities.length === 0 && <div className="sidebar-empty">未分配本轮工具</div>}
                {explicitTurnCapabilities.map((capability) => (
                  <div className="public-capability-row" key={capability.id}>
                    <div className="public-capability-head">
                      <span><strong>{capability.label}</strong><small>{capability.description}</small></span>
                      <CapabilityAvailabilityBadge capability={capability} />
                    </div>
                    <CapabilityDisclosure capability={capability} />
                  </div>
                ))}
              </div>
            )}

            <div className="capability-group" aria-labelledby="capability-image-title">
              <div className="capability-group-heading"><ImageIcon size={16} /><strong id="capability-image-title">图像理解</strong></div>
              <div className={`image-mode-summary mode-${selectedImageMode}`}>
                <strong>{imageModeLabel(selectedImageMode)}</strong>
                <small>{imageModeDescription(selectedImageMode)}</small>
              </div>
              {routeAugmentations.map((capability) => (
                <div className="public-capability-row" key={capability.id}>
                  <div className="public-capability-head">
                    <span><strong>{capability.label}</strong><small>{capability.description}</small></span>
                    <CapabilityAvailabilityBadge capability={capability} />
                  </div>
                  <CapabilityDisclosure capability={capability} />
                </div>
              ))}
            </div>

            {session.access === "member" && permissions.canManageSettings && (
              <div className="capability-group" aria-labelledby="capability-tools-title">
                <div className="capability-group-heading"><Wrench size={16} /><strong id="capability-tools-title">工具与连接</strong><span>{session.tools.length}</span></div>
                <div className="tool-list">
                  {session.tools.length === 0 && <div className="sidebar-empty">未分配工具</div>}
                  {session.tools.map((tool) => {
                    const active = selectedToolIds.has(tool.id);
                    const state = !routeSupportsTools
                      ? "线路不支持"
                      : skillMode === "automatic"
                        ? "按本轮选择"
                        : active ? "已启用" : "未启用";
                    return (
                      <div className={`tool-row ${active ? "active" : ""}`} key={tool.id}>
                        <span className="tool-source" title={toolSourceText(tool.source)}>
                          {tool.source === "mcp" ? <Plug size={15} aria-hidden="true" /> : <Wrench size={15} aria-hidden="true" />}
                        </span>
                        <span className="tool-copy"><strong>{tool.label}</strong><small>{tool.description || toolSourceText(tool.source)} · {confirmationText(tool.confirmation)}</small></span>
                        <span className="tool-state">{state}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mcp-readiness" aria-label="MCP 连接就绪度">
                  <div>
                    <span><strong>{connectedMcp}</strong> 已连接</span>
                    <span><strong>{attentionMcp}</strong> 待处理</span>
                  </div>
                  {mcpConnections.map((connection) => (
                    <div className="mcp-readiness-row" key={connection.serverId}>
                      <span title={connection.label}>{connection.label}</span>
                      <small className={connection.status}>{mcpConnectionStatusLabel(connection.status)}</small>
                    </div>
                  ))}
                  <button className="quiet-button icon-text-button" type="button" onClick={onOpenMcpConnections} disabled={busy}>
                    <Cable size={15} /><span>管理 MCP 连接</span>
                  </button>
                </div>
              </div>
            )}
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

function CapabilityTurnStatus({ turn }: { turn: CapabilityTurnSnapshot | null }) {
  return (
    <div className="capability-turn-status" aria-live="polite" aria-atomic="true">
      <div className="capability-group-heading"><Activity size={16} /><strong>本轮状态</strong></div>
      {!turn?.items.length ? (
        <small>当前没有正在执行或待恢复的能力。</small>
      ) : (
        <div className="capability-turn-list">
          {turn.items.map((item) => (
            <div className={`capability-turn-row status-${item.status}`} key={item.kind}>
              <span>{capabilityTurnKindLabel(item.kind)}</span>
              <strong>{capabilityTurnStatusLabel(item.status)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CapabilityDisclosure({ capability }: { capability: PublicCapabilityV1 }) {
  return (
    <dl className="capability-disclosure">
      <div><dt>来源</dt><dd>{capability.source === "chatus" ? "Chatus 内置" : "管理员配置"}</dd></div>
      <div><dt>启用</dt><dd>{activationLabel(capability.activation)}</dd></div>
      <div><dt>执行</dt><dd>{executionLabel(capability.disclosure.execution)}</dd></div>
      <div><dt>数据</dt><dd>{dataClassesLabel(capability.disclosure.dataClasses)}</dd></div>
      <div><dt>延迟</dt><dd>{latencyLabel(capability.disclosure.latency)}</dd></div>
      <div><dt>费用</dt><dd>{costLabel(capability.disclosure.cost)}</dd></div>
    </dl>
  );
}

function CapabilityAvailabilityBadge({ capability }: { capability: PublicCapabilityV1 }) {
  return <span className={`capability-availability ${capability.availability}`}>{capabilityAvailabilityLabel(capability)}</span>;
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
  if (section === "files") return { label: "文件", icon: Files };
  if (section === "sharing") return { label: "共享", icon: Share2 };
  return { label: "能力", icon: Sparkles };
}

function selectedRouteLabel(session: SessionProjection, routeId: string): string {
  const route = session.routes.find((candidate) => candidate.id === routeId);
  return route ? `${route.label} · ${route.model}` : "尚未配置可用线路";
}

function imageModeLabel(mode: SessionProjection["routes"][number]["imageMode"]): string {
  if (mode === "native") return "模型原生支持";
  if (mode === "assisted_tool") return "受信视觉工具辅助";
  if (mode === "assisted_preanswer") return "回答前视觉辅助";
  return "当前线路不可用";
}

function imageModeDescription(mode: SessionProjection["routes"][number]["imageMode"]): string {
  if (mode === "native") return "图片随本轮请求由所选模型线路处理。";
  if (mode === "assisted_tool") return "图片仅进入受信视觉工具，文字结果再交给回答线路。";
  if (mode === "assisted_preanswer") return "图片先由配置的视觉线路处理，主回答只接收受限证据。";
  return "移除图片、切换到支持图片的模型，或联系管理员完成视觉配置。";
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

function mcpConnectionStatusLabel(status: McpOAuthConnection["status"]): string {
  if (status === "connected") return "已连接";
  if (status === "expired") return "已过期";
  if (status === "review_required") return "需要重审";
  return "未连接";
}

function capabilityTurnKindLabel(kind: CapabilityTurnKind): string {
  if (kind === "workflow_selection") return "工作流选择";
  if (kind === "web_research") return "联网研究";
  if (kind === "image_understanding") return "图像理解";
  return "工具执行";
}

function capabilityTurnStatusLabel(status: CapabilityTurnStatus): string {
  if (status === "selected") return "已选择";
  if (status === "waiting") return "等待中";
  if (status === "running") return "执行中";
  if (status === "succeeded") return "已完成";
  if (status === "unavailable") return "不可用";
  if (status === "denied") return "已拒绝";
  if (status === "timed_out") return "已超时";
  if (status === "cancelled") return "已取消";
  return "失败";
}

function capabilityAvailabilityLabel(capability: PublicCapabilityV1): string {
  if (capability.availability === "available") return "可用";
  if (capability.availability === "disabled") return "已停用";
  if (capability.availability === "requires_setup") return unavailableReasonLabel(capability.unavailableReason, "需要设置");
  return unavailableReasonLabel(capability.unavailableReason, "不可用");
}

function unavailableReasonLabel(reason: PublicCapabilityV1["unavailableReason"], fallback: string): string {
  if (reason === "connection_required") return "需要连接";
  if (reason === "review_required") return "需要重审";
  if (reason === "helper_unavailable") return "辅助线路未就绪";
  if (reason === "route_incompatible") return "线路不兼容";
  if (reason === "not_assigned") return "未分配";
  if (reason === "tool_unavailable") return "工具未就绪";
  return fallback;
}

function activationLabel(activation: PublicCapabilityV1["activation"]): string {
  if (activation === "workflow") return "工作流";
  if (activation === "explicit_turn") return "本轮显式选择";
  return "线路增强";
}

function executionLabel(execution: PublicCapabilityV1["disclosure"]["execution"]): string {
  if (execution === "instructions") return "指令工作流";
  if (execution === "trusted_local") return "受信本地执行";
  if (execution === "auxiliary_provider") return "辅助模型请求";
  return "已审核 MCP";
}

function dataClassesLabel(dataClasses: PublicCapabilityV1["disclosure"]["dataClasses"]): string {
  if (!dataClasses.length) return "不发送内容";
  return dataClasses.map((dataClass) => (
    dataClass === "prompt_text" ? "提示文本" : dataClass === "search_query" ? "搜索查询" : "图片"
  )).join("、");
}

function latencyLabel(latency: PublicCapabilityV1["disclosure"]["latency"]): string {
  if (latency === "none") return "无额外延迟";
  if (latency === "small") return "少量";
  return "不固定";
}

function costLabel(cost: PublicCapabilityV1["disclosure"]["cost"]): string {
  if (cost === "none") return "无额外费用";
  if (cost === "provider_request") return "模型请求";
  return "外部服务";
}
