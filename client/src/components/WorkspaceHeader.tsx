import { ArrowLeft, Download, Eye, LogIn, LogOut, Menu, PanelRightOpen, Pencil, Route } from "lucide-react";
import type { AgentConversation, MemberModelAvailability, SessionProjection } from "../lib/api";
import { resolveConversationAccessPermissions } from "../lib/state";
import { ProductBrand } from "./ProductBrand";
import { ModelAvailabilityBadge } from "./ModelAvailabilityBadge";

export type ConnectionState = "connecting" | "ready" | "error";

export function WorkspaceHeader({
  session,
  conversation,
  routeId,
  connectionState,
  modelAvailability,
  modelAvailabilityRefreshing,
  busy,
  accountBusy,
  logoutPending,
  parentConversation,
  parentMissing,
  onOpenSidebar,
  onOpenRouteSettings,
  onReturnToParent,
  onMemberLogin,
  onLogout,
}: {
  session: SessionProjection;
  conversation: AgentConversation | null;
  routeId: string;
  connectionState: ConnectionState;
  modelAvailability?: MemberModelAvailability | null;
  modelAvailabilityRefreshing?: boolean;
  busy: boolean;
  accountBusy: boolean;
  logoutPending: boolean;
  parentConversation: Pick<AgentConversation, "id" | "title"> | null;
  parentMissing: boolean;
  onOpenSidebar: () => void;
  onOpenRouteSettings: () => void;
  onReturnToParent: () => void;
  onMemberLogin: () => void;
  onLogout: () => Promise<void>;
}) {
  const route = session.routes.find((candidate) => candidate.id === routeId);
  const health = routeHealthLabel(route?.healthStatus);
  const availability = modelAvailability?.routes.find((candidate) => candidate.routeId === routeId);
  const connection = connectionLabel(connectionState);
  const logoutLabel = logoutPending ? "正在退出登录" : "退出登录";
  const permissions = resolveConversationAccessPermissions(conversation?.accessRole);
  const sharedRole = conversation?.accessRole && conversation.accessRole !== "owner"
    ? conversation.accessRole
    : undefined;

  return (
    <header className="workspace-header">
      <div className="header-leading">
        <button className="icon-button mobile-only" type="button" onClick={onOpenSidebar} title="打开会话" aria-label="打开会话"><Menu size={19} /></button>
        <div className="header-mobile-brand"><ProductBrand compact /></div>
      </div>

      <div className="header-conversation">
        <div className="header-title-stack">
          <strong className="header-conversation-title" title={conversation?.title || "对话"}>{conversation?.title || "对话"}</strong>
          {parentConversation ? (
            <button
              className="origin-chip"
              type="button"
              onClick={onReturnToParent}
              disabled={busy || accountBusy}
              title={`返回父会话：${parentConversation.title}`}
              aria-label={`返回父会话：${parentConversation.title}`}
            >
              <ArrowLeft size={12} aria-hidden="true" />
              <span>来自 {parentConversation.title}</span>
            </button>
          ) : parentMissing ? (
            <span className="origin-chip static" title="父会话不可用">
              <ArrowLeft size={12} aria-hidden="true" />
              <span>父会话不可用</span>
            </span>
          ) : sharedRole ? (
            <span className={`conversation-access-chip ${sharedRole}`} title={sharedRole === "editor" ? "共享编辑者" : "共享查看者"}>
              {sharedRole === "editor" ? <Pencil size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
              <span>{sharedRole === "editor" ? "编辑者" : "查看者"}</span>
            </span>
          ) : null}
          <span className={`header-context-line ${connectionState}`} role="status">
            {route?.label || "默认线路"} · {connection}
          </span>
        </div>
        {session.access === "guest" || !permissions.canManageSettings ? (
          <div className="header-route-button static" title={route ? `${route.label} · ${route.model}` : "未选择线路"}>
            <Route size={14} aria-hidden="true" />
            <span className="header-route-copy">
              <span>{route ? `${route.label} · ${route.model}` : "未选择线路"}</span>
              <small>{availability ? <><ModelAvailabilityBadge route={availability} compact /> · {health}</> : health}{modelAvailabilityRefreshing ? " · 更新中" : ""}</small>
            </span>
          </div>
        ) : (
          <button className="header-route-button" type="button" onClick={onOpenRouteSettings} disabled={busy || accountBusy} title="查看线路与状态" aria-label="查看线路与状态">
            <Route size={14} aria-hidden="true" />
            <span className="header-route-copy">
              <span>{route ? `${route.label} · ${route.model}` : "未选择线路"}</span>
              <small>{availability ? <><ModelAvailabilityBadge route={availability} compact /> · {health}</> : health}{modelAvailabilityRefreshing ? " · 更新中" : ""}</small>
            </span>
          </button>
        )}
      </div>

      <div className="header-actions">
        <button id="installAppButton" className="icon-button" type="button" hidden title="安装应用" aria-label="安装应用"><Download size={18} /></button>
        {(session.access === "guest" || permissions.canManageSettings) && (
          <button className="icon-text-button inspector-trigger" type="button" onClick={onOpenRouteSettings} disabled={busy || accountBusy} title="打开对话上下文" aria-label="打开对话上下文"><PanelRightOpen size={17} /><span>上下文</span></button>
        )}
        {session.access === "guest" ? (
          <button className="icon-text-button quiet-button" type="button" onClick={onMemberLogin} disabled={busy || accountBusy} title="成员登录" aria-label="成员登录"><LogIn size={17} /><span>成员登录</span></button>
        ) : (
          <button
            className="icon-button"
            type="button"
            onClick={() => void onLogout()}
            disabled={logoutPending || busy || accountBusy}
            title={logoutPending ? logoutLabel : busy ? "请先停止当前任务" : accountBusy ? "账号操作正在处理" : logoutLabel}
            aria-label={logoutLabel}
          ><LogOut size={18} /></button>
        )}
      </div>
    </header>
  );
}

function routeHealthLabel(status: SessionProjection["routes"][number]["healthStatus"]): string {
  if (status === "healthy") return "最近真实任务正常";
  if (status === "unhealthy") return "最近任务有异常，可切换线路";
  return "暂无近期真实任务记录";
}

function connectionLabel(state: ConnectionState): string {
  if (state === "ready") return "已连接";
  if (state === "error") return "连接异常";
  return "连接中";
}
