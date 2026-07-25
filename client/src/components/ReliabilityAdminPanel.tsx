import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { ApiError, fetchAdminReliability, type AdminReliabilityProvider, type AdminReliabilityRoute, type AdminReliabilitySnapshot } from "../lib/api";

type Notice = { kind: "success" | "warning" | "error"; text: string };

type ReliabilityAdminPanelProps = {
  onSessionExpired: () => void;
  onNotice: (notice: Notice | null) => void;
  onDirtyChange: (dirty: boolean) => void;
  refreshKey?: number;
};

export function ReliabilityAdminPanel({ onSessionExpired, onNotice, onDirtyChange, refreshKey = 0 }: ReliabilityAdminPanelProps) {
  const [snapshot, setSnapshot] = useState<AdminReliabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    onDirtyChange(false);
    void refresh();
  }, [refreshKey]);

  async function refresh() {
    setLoading(true);
    try {
      setSnapshot(await fetchAdminReliability());
      onNotice(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "error", text: error instanceof Error ? error.message : "暂时无法读取可靠性数据。" });
    } finally {
      setLoading(false);
    }
  }

  const providers = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!snapshot || !query) return snapshot?.providers || [];
    return snapshot.providers.map((provider) => ({
      ...provider,
      routes: provider.routes.filter((route) => `${provider.providerId} ${provider.label} ${route.routeId} ${route.model} ${route.lastOutcome || ""}`.toLocaleLowerCase().includes(query)),
    })).filter((provider) => provider.providerId.toLocaleLowerCase().includes(query) || provider.label.toLocaleLowerCase().includes(query) || provider.routes.length > 0);
  }, [filter, snapshot]);

  return (
    <section className="admin-reliability-panel" aria-labelledby="reliability-admin-title">
      <div className="admin-reliability-head">
        <div>
          <p className="eyebrow">PASSIVE RELIABILITY</p>
          <h1 id="reliability-admin-title">可靠性</h1>
          <p className="admin-pool-meta">只读取真实用户任务记录，不会发送测活请求或模型测试消息。</p>
        </div>
        <div className="admin-pool-actions">
          <input className="admin-inline-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选服务商或模型" aria-label="筛选可靠性" />
          <button className="icon-button" type="button" onClick={() => void refresh()} disabled={loading} aria-label="刷新可靠性" title="刷新可靠性"><RefreshCw size={17} /></button>
        </div>
      </div>
      <div className="admin-reliability-meta">
        <span><ShieldCheck size={15} /> 数据源：真实任务被动记录</span>
        <span>{snapshot ? `生成于 ${formatDate(snapshot.generatedAt)}` : "尚未读取"}</span>
      </div>
      {loading && !snapshot ? <div className="admin-pool-empty-state"><p>正在读取可靠性数据...</p></div> : <ReliabilityTable providers={providers} />}
    </section>
  );
}

export function ReliabilityTable({ providers }: { providers: AdminReliabilityProvider[] }) {
  if (!providers.length) return <div className="admin-pool-empty-state"><p>没有匹配的服务商或逻辑模型。</p></div>;
  return (
    <div className="admin-reliability-table-wrap">
      <table className="admin-reliability-table">
        <thead><tr><th>服务商</th><th>状态</th><th>容量策略</th><th>凭据</th><th>逻辑模型 / 上游模型</th><th>尝试</th><th>成功</th><th>平均延迟</th><th>首字输出</th><th>输出形态</th><th>最近结果</th><th>最近观察</th><th>Fallback</th></tr></thead>
        <tbody>{providers.flatMap((provider) => provider.routes.length
          ? provider.routes.map((route) => <ReliabilityRow key={`${provider.providerId}-${route.routeId}`} provider={provider} route={route} />)
          : [<ReliabilityRow key={provider.providerId} provider={provider} />]
        )}</tbody>
      </table>
    </div>
  );
}

function ReliabilityRow({ provider, route }: { provider: AdminReliabilityProvider; route?: AdminReliabilityRoute }) {
  const routeEnabled = route?.enabled !== false;
  return (
    <tr>
      <td><strong>{provider.label}</strong><small>{provider.providerId}</small></td>
      <td><span className={`reliability-badge ${provider.enabled && routeEnabled ? "configured" : "missing"}`}>{provider.enabled ? routeEnabled ? "已启用" : "线路停用" : "服务商停用"}</span><small>{provider.enabled && routeEnabled ? "可参与候选" : "不会参与新请求"}</small></td>
      <td><span className={`reliability-badge ${provider.concurrency}`}>{provider.concurrency === "exclusive" ? "独占" : provider.concurrency === "bounded" ? `上限 ${provider.maxConcurrent}` : "不限"}</span><small>等待 {provider.queueTimeoutMs}ms</small></td>
      <td><span className={`reliability-badge ${provider.credentialStatus}`}>{credentialLabel(provider.credentialStatus)}</span></td>
      <td>{route ? <><strong>{route.routeId}</strong><small>{route.model}</small></> : <span className="muted">暂无逻辑模型出口</span>}</td>
      <td>{route ? route.attempts : "未知"}</td>
      <td>{route ? route.successes : "未知"}</td>
      <td>{route?.attempts ? `${route.averageLatencyMs}ms` : "未知"}</td>
      <td>{route?.streamSamples ? <><strong>{route.averageFirstVisibleLatencyMs}ms</strong><small>最近 {route.lastFirstVisibleLatencyMs}ms</small></> : <span className="muted">未知</span>}</td>
      <td>{route?.lastStreamShape ? <><span className={`reliability-badge ${route.lastStreamShape}`}>{streamShapeLabel(route.lastStreamShape)}</span><small>渐进 {route.progressiveSamples}/{route.streamSamples}</small></> : <span className="muted">未知</span>}</td>
      <td>{route?.lastOutcome ? <span className={`reliability-outcome ${route.lastOutcome === "success" ? "ok" : "bad"}`}>{outcomeLabel(route.lastOutcome)}</span> : <span className="muted">未知</span>}</td>
      <td>{route?.observedAt ? formatDate(route.observedAt) : <span className="muted">暂无</span>}</td>
      <td>{route?.lastFallback === undefined ? <span className="muted">未知</span> : `${route.fallbackCount || 0} 次${route.lastFallback ? " · 最近发生" : ""}`}</td>
    </tr>
  );
}

function streamShapeLabel(shape: AdminReliabilityRoute["lastStreamShape"]): string {
  return shape === "progressive" ? "渐进" : "单块";
}

function credentialLabel(status: string): string {
  if (status === "configured") return "已就绪";
  if (status === "user_key_required") return "需用户密钥";
  if (status === "unavailable") return "不可读取";
  return "缺少密钥";
}

function outcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    success: "成功",
    timeout: "超时",
    upstream_auth: "认证错误",
    upstream_rate_limit: "上游限流",
    upstream_client: "上游拒绝",
    upstream_server: "上游错误",
    protocol_error: "协议错误",
    network_error: "网络错误",
  };
  return labels[outcome] || outcome;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
