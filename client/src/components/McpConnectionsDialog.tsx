import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { ExternalLink, RefreshCw, Search, Unplug, X } from "lucide-react";
import type { McpOAuthConnection } from "../lib/api";

export type McpConnectionNotice = { kind: "success" | "warning" | "error"; text: string };

export function McpConnectionsDialog({
  connections,
  busyServerId,
  notice,
  onClose,
  onRefresh,
  onConnect,
  onDiscover,
  onRevoke,
}: {
  connections: McpOAuthConnection[];
  busyServerId: string;
  notice: McpConnectionNotice | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onConnect: (serverId: string) => Promise<void>;
  onDiscover: (serverId: string) => Promise<void>;
  onRevoke: (serverId: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const busy = Boolean(busyServerId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (dialog?.open) dialog.close();
    };
  }, []);

  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="mcp-connections-dialog"
      aria-labelledby={titleId}
      aria-busy={busy}
      onKeyDown={trapFocus}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div className="mcp-connections-content">
        <header>
          <div>
            <h2 id={titleId}>MCP 连接</h2>
            <span>{connections.length} 个可用服务</span>
          </div>
          <div className="mcp-dialog-head-actions">
            <button className="icon-button" type="button" onClick={() => void onRefresh()} disabled={busy} aria-label="刷新 MCP 连接" title="刷新 MCP 连接"><RefreshCw size={17} /></button>
            <button ref={closeRef} className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭 MCP 连接" title="关闭"><X size={17} /></button>
          </div>
        </header>

        {notice && <p className={`mcp-connection-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}

        <div className="mcp-connection-list">
          {!connections.length && <p className="mcp-connection-empty">当前没有已启用的 OAuth MCP 服务。</p>}
          {connections.map((connection) => {
            const rowBusy = busyServerId === connection.serverId;
            return (
              <section className="mcp-connection-row" key={connection.serverId} aria-labelledby={`mcp-connection-${connection.serverId}`}>
                <div className="mcp-connection-copy">
                  <div className="mcp-connection-title">
                    <strong id={`mcp-connection-${connection.serverId}`}>{connection.label}</strong>
                    <span className={`mcp-connection-status ${connection.status}`}>{connectionStatusLabel(connection.status)}</span>
                  </div>
                  <small>{connection.serverId}</small>
                  {connection.grantedScopes.length > 0 && <p><span>Scopes</span>{connection.grantedScopes.join(", ")}</p>}
                  {connection.expiresAt !== undefined && <p><span>有效期</span>{new Date(connection.expiresAt).toLocaleString()}</p>}
                </div>
                <div className="mcp-connection-actions">
                  {connection.connected && <button className="quiet-button icon-text-button" type="button" onClick={() => void onDiscover(connection.serverId)} disabled={busy}><Search size={15} /><span>生成发现候选</span></button>}
                  <button className="quiet-button icon-text-button" type="button" onClick={() => void onConnect(connection.serverId)} disabled={busy}><ExternalLink size={15} /><span>{connection.status === "disconnected" ? "连接" : "重新连接"}</span></button>
                  {connection.status !== "disconnected" && <button className="quiet-button danger icon-text-button" type="button" onClick={() => void onRevoke(connection.serverId)} disabled={busy}><Unplug size={15} /><span>撤销</span></button>}
                  {rowBusy && <span className="mcp-connection-progress" role="status">处理中...</span>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}

function connectionStatusLabel(status: McpOAuthConnection["status"]): string {
  if (status === "connected") return "已连接";
  if (status === "expired") return "已过期";
  if (status === "review_required") return "需要重审";
  return "未连接";
}
