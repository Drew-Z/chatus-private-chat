import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, MessageSquareText, RefreshCw, Route, ScrollText, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import {
  ApiError,
  fetchAdminOperations,
  type AdminAuditEntry,
  type AdminFeedbackEntry,
  type AdminOperationsSnapshot,
} from "../lib/api";

type Notice = { kind: "success" | "warning" | "error"; text: string };

type AdminOperationsPanelProps = {
  onSessionExpired: () => void;
  onNotice: (notice: Notice | null) => void;
  onDirtyChange: (dirty: boolean) => void;
  refreshKey?: number;
};

export function AdminOperationsPanel({ onSessionExpired, onNotice, onDirtyChange, refreshKey = 0 }: AdminOperationsPanelProps) {
  const [snapshot, setSnapshot] = useState<AdminOperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    onDirtyChange(false);
    void refresh();
  }, [refreshKey]);

  async function refresh() {
    setLoading(true);
    try {
      setSnapshot(await fetchAdminOperations());
      onNotice(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "error", text: error instanceof Error ? error.message : "暂时无法读取运营数据。" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="admin-operations-panel" aria-labelledby="operations-admin-title" aria-busy={loading}>
      <div className="admin-operations-head">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1 id="operations-admin-title">运营</h1>
          <p className="admin-pool-meta">真实任务聚合 · 不含消息内容</p>
        </div>
        <div className="admin-pool-actions">
          <input className="admin-inline-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选运营记录" aria-label="筛选运营数据" />
          <button className="icon-button" type="button" onClick={() => void refresh()} disabled={loading} aria-label="刷新运营数据" title="刷新运营数据"><RefreshCw size={17} /></button>
        </div>
      </div>
      {loading && !snapshot
        ? <div className="admin-pool-empty-state" role="status"><p>正在读取运营数据...</p></div>
        : snapshot && <AdminOperationsContent snapshot={snapshot} filter={filter} />}
    </section>
  );
}

export function AdminOperationsContent({ snapshot, filter = "" }: { snapshot: AdminOperationsSnapshot; filter?: string }) {
  const query = filter.trim().toLocaleLowerCase();
  const maxRequests = Math.max(1, ...snapshot.stats.trend.map((item) => item.requests));
  const users = useMemo(() => snapshot.stats.users.filter((user) => matchesQuery(query, user.label, user.displayName, user.defaultRoute)), [query, snapshot.stats.users]);
  const routes = useMemo(() => snapshot.stats.routeStats.filter((route) => matchesQuery(query, route.id, route.label, route.model)), [query, snapshot.stats.routeStats]);
  const audit = useMemo(() => snapshot.audit.filter((entry) => matchesQuery(query, entry.action, auditAction(entry), entry.target)), [query, snapshot.audit]);
  const feedback = useMemo(() => snapshot.feedback.filter((entry) => matchesQuery(query, entry.label, entry.routeId, entry.reason, feedbackReason(entry.reason))), [query, snapshot.feedback]);

  const summary: Array<{ label: string; value: string | number }> = [
    { label: "7 日请求", value: snapshot.stats.totals.requests },
    { label: "错误", value: snapshot.stats.totals.errors },
    { label: "错误率", value: `${snapshot.stats.totals.errorRate}%` },
    { label: "Fallback", value: snapshot.stats.totals.fallbacks },
    { label: "限流", value: snapshot.stats.totals.rateLimited },
  ];

  return (
    <div className="admin-operations-content">
      <dl className="admin-operations-summary" aria-label="7 日运营摘要">
        {summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>

      <div className="admin-operations-grid">
        <OperationsSection icon={<Activity size={17} />} title="7 日请求趋势" meta={`统计日 ${snapshot.stats.day}`}>
          <div className="operations-trend-list">
            {[...snapshot.stats.trend].reverse().map((item) => (
              <div className="operations-trend-row" key={item.day}>
                <span>{item.day.slice(5)}</span>
                <progress max={maxRequests} value={item.requests} aria-label={`${item.day} 请求 ${item.requests}`} />
                <small>{item.requests} 次 · 错 {item.errors} · {item.errorRate}%</small>
              </div>
            ))}
          </div>
        </OperationsSection>

        <OperationsSection icon={<Route size={17} />} title="逻辑模型结果" meta={`${routes.length} 条`}>
          <div className="operations-compact-list">
            {routes.slice(0, 20).map((route) => (
              <div key={route.id}><span><strong>{route.label}</strong><small>{route.id}{route.model ? ` · ${route.model}` : ""}</small></span><em>成功 {route.ok7d} · 失败 {route.error7d} · {route.errorRate7d}%</em></div>
            ))}
            {!routes.length && <p className="typed-admin-empty">没有匹配的线路统计</p>}
          </div>
        </OperationsSection>

        <OperationsSection icon={<MessageSquareText size={17} />} title="成员反馈" meta={feedbackSummary(feedback)}>
          <div className="operations-event-list">
            {feedback.slice(0, 20).map((entry) => (
              <div key={entry.id}>
                <span className={`operations-event-marker ${entry.rating === "up" ? "positive" : "negative"}`}>
                  {entry.rating === "up" ? <ThumbsUp size={13} aria-hidden="true" /> : <ThumbsDown size={13} aria-hidden="true" />}
                  <span className="sr-only">{entry.rating === "up" ? "有帮助" : "无帮助"}</span>
                </span>
                <span><strong>{entry.label}</strong><small>{entry.routeId}{entry.reason ? ` · ${feedbackReason(entry.reason)}` : ""} · <time dateTime={entry.at}>{formatRelativeTime(entry.at)}</time></small></span>
              </div>
            ))}
            {!feedback.length && <p className="typed-admin-empty">暂无匹配反馈</p>}
          </div>
        </OperationsSection>

        <OperationsSection icon={<ScrollText size={17} />} title="管理审计" meta={`${audit.length} 条`}>
          <div className="operations-event-list">
            {audit.slice(0, 20).map((entry) => (
              <div key={entry.id}>
                <span className="operations-event-marker audit" aria-hidden="true" />
                <span><strong>{auditAction(entry)}</strong><small>{entry.target ? `${entry.target} · ` : ""}<time dateTime={entry.at}>{formatRelativeTime(entry.at)}</time></small></span>
              </div>
            ))}
            {!audit.length && <p className="typed-admin-empty">暂无匹配管理记录</p>}
          </div>
        </OperationsSection>
      </div>

      <OperationsSection icon={<Users size={17} />} title="成员用量" meta={`${users.length} 位`}>
        <div className="operations-user-table-wrap">
          <table className="operations-user-table">
            <thead><tr><th>成员</th><th>今日用量</th><th>剩余</th><th>活跃会话</th><th>7 日请求</th><th>错误</th><th>记忆</th><th>默认模型</th></tr></thead>
            <tbody>{users.map((user) => (
              <tr key={user.label}>
                <td><strong>{user.displayName}</strong><small>{user.label}{user.enabled ? "" : " · 已暂停"}</small></td>
                <td>{user.used} / {user.dailyLimit}</td><td>{user.remaining}</td><td>{user.activeSessions}</td><td>{user.requests7d}</td><td>{user.errors7d} · {user.errorRate7d}%</td><td>{user.memoryChars} 字</td><td>{user.defaultRoute || "未设置"}</td>
              </tr>
            ))}</tbody>
          </table>
          {!users.length && <p className="typed-admin-empty">没有匹配成员</p>}
        </div>
      </OperationsSection>
    </div>
  );
}

function OperationsSection({ icon, title, meta, children }: { icon: ReactNode; title: string; meta: string; children: ReactNode }) {
  return <section className="admin-operations-section"><header><span aria-hidden="true">{icon}</span><h2>{title}</h2><small>{meta}</small></header>{children}</section>;
}

function matchesQuery(query: string, ...values: unknown[]): boolean {
  return !query || values.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
}

function feedbackSummary(entries: AdminFeedbackEntry[]): string {
  if (!entries.length) return "暂无";
  const positive = entries.filter((entry) => entry.rating === "up").length;
  return `${Math.round((positive / entries.length) * 100)}% 有帮助 · ${entries.length} 条`;
}

function feedbackReason(reason: AdminFeedbackEntry["reason"]): string {
  const labels: Record<string, string> = { inaccurate: "不准确", misunderstood: "未理解", verbose: "过于冗长", format: "格式问题", other: "其他" };
  return reason ? labels[reason] || reason : "";
}

function auditAction(entry: AdminAuditEntry): string {
  const labels: Record<string, string> = {
    "config.update": "更新配置", "config.reset": "恢复部署配置", "access.update": "更新成员访问", "access.reset": "恢复成员访问",
    "member.access.create": "创建成员访问", "member.access.rotate": "轮换成员访问", "member.access.revoke": "撤销成员访问",
    "member.config.remove": "恢复成员默认配置", "sessions.revoke": "注销成员会话", "sessions.revoke.incomplete": "成员会话注销未完全",
    "route-secret.update": "更新服务商密钥", "route-secret.delete": "删除服务商密钥", "mcp-secret.update": "更新 MCP 密钥",
    "mcp-secret.delete": "删除 MCP 密钥", "mcp.discovery": "发现 MCP 工具", "memory.update": "更新成员记忆", "memory.clear": "清空成员记忆",
    "usage.reset": "重置成员用量", "user.create": "创建成员",
  };
  return labels[entry.action] || entry.action;
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}
