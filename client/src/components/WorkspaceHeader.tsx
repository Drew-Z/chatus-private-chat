import { ArrowLeft, Brain, Cable, Download, Eye, LogIn, LogOut, Menu, Pencil, Route, Wifi, WifiOff } from "lucide-react";
import type { AgentConversation, SessionProjection } from "../lib/api";
import { resolveConversationAccessPermissions } from "../lib/state";

export type ConnectionState = "connecting" | "ready" | "error";

export function WorkspaceHeader({
  session,
  conversation,
  routeId,
  mcpConnections,
  connectionState,
  busy,
  accountBusy,
  logoutPending,
  parentConversation,
  parentMissing,
  onOpenSidebar,
  onOpenRouteSettings,
  onOpenMemory,
  onOpenMcpConnections,
  onReturnToParent,
  onMemberLogin,
  onLogout,
}: {
  session: SessionProjection;
  conversation: AgentConversation | null;
  routeId: string;
  mcpConnections: SessionProjection["mcpConnections"];
  connectionState: ConnectionState;
  busy: boolean;
  accountBusy: boolean;
  logoutPending: boolean;
  parentConversation: Pick<AgentConversation, "id" | "title"> | null;
  parentMissing: boolean;
  onOpenSidebar: () => void;
  onOpenRouteSettings: () => void;
  onOpenMemory: () => void;
  onOpenMcpConnections: () => void;
  onReturnToParent: () => void;
  onMemberLogin: () => void;
  onLogout: () => Promise<void>;
}) {
  const route = session.routes.find((candidate) => candidate.id === routeId);
  const health = routeHealthLabel(route?.healthStatus);
  const connection = connectionLabel(connectionState);
  const connectedMcpCount = mcpConnections.filter((item) => item.connected).length;
  const logoutLabel = logoutPending ? "正在退出登录" : "退出登录";
  const permissions = resolveConversationAccessPermissions(conversation?.accessRole);
  const sharedRole = conversation?.accessRole && conversation.accessRole !== "owner"
    ? conversation.accessRole
    : undefined;

  return (
    <header className="workspace-header">
      <div className="header-leading">
        <button className="icon-button mobile-only" type="button" onClick={onOpenSidebar} title="打开会话" aria-label="打开会话"><Menu size={19} /></button>
        <div className="brand-lockup compact">
          <div className="brand-mark small">C</div>
          <div><strong>Chatus</strong><span>{session.displayName}</span></div>
        </div>
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
        </div>
        {session.access === "guest" || !permissions.canManageSettings ? (
          <div className="header-route-button static" title={route ? `${route.label} · ${route.model}` : "未选择线路"}>
            <Route size={14} aria-hidden="true" />
            <span className="header-route-copy">
              <span>{route ? `${route.label} · ${route.model}` : "未选择线路"}</span>
              <small>{health}</small>
            </span>
          </div>
        ) : (
          <button className="header-route-button" type="button" onClick={onOpenRouteSettings} disabled={busy || accountBusy} title="查看线路与状态" aria-label="查看线路与状态">
            <Route size={14} aria-hidden="true" />
            <span className="header-route-copy">
              <span>{route ? `${route.label} · ${route.model}` : "未选择线路"}</span>
              <small>{health}</small>
            </span>
          </button>
        )}
      </div>

      <div className="header-actions">
        <div className={`connection compact ${connectionState}`} role="status" aria-label={`连接状态：${connection}`}>
          {connectionState === "error" ? <WifiOff size={15} aria-hidden="true" /> : <Wifi size={15} aria-hidden="true" />}
          <span>{connection}</span>
        </div>
        <button id="installAppButton" className="icon-button" type="button" hidden title="安装应用" aria-label="安装应用"><Download size={18} /></button>
        {session.capabilities.memory && permissions.canManageSettings && (
          <button className="icon-text-button quiet-button" type="button" onClick={onOpenMemory} disabled={accountBusy}><Brain size={17} /><span>记忆</span></button>
        )}
        {session.access === "member" && permissions.canUseConversationTools && (
          <button className={`icon-button mcp-connections-trigger ${connectedMcpCount ? "connected" : ""}`} type="button" onClick={onOpenMcpConnections} disabled={busy || accountBusy} title={`MCP 连接${connectedMcpCount ? ` · ${connectedMcpCount} 已连接` : ""}`} aria-label={`MCP 连接${connectedMcpCount ? `，${connectedMcpCount} 个已连接` : ""}`}><Cable size={18} /></button>
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
