import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Globe2, RotateCcw, Save } from "lucide-react";
import {
  ApiError,
  fetchAdminConfig,
  putAdminConfig,
  type AdminConfigSnapshot,
  type AdminPublicAccessConfig,
} from "../lib/api";

type Notice = { kind: "success" | "warning" | "error"; text: string };

type PublicAccessDraft = {
  enabled: boolean;
  routeId: string;
  sessionTtlSeconds: string;
  dailyMessageLimit: string;
  minuteMessageLimit: string;
  sourceDailyMessageLimit: string;
  sourceMinuteMessageLimit: string;
};

type PublicAccessAdminPanelProps = {
  snapshot: AdminConfigSnapshot;
  onSnapshot: (snapshot: AdminConfigSnapshot) => void;
  onSessionExpired: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotice: (notice: Notice | null) => void;
  resetKey?: number;
};

const NUMBER_FIELDS = [
  ["sessionTtlSeconds", 900, 604_800, "会话有效期"],
  ["dailyMessageLimit", 1, 1_000, "访客每日额度"],
  ["minuteMessageLimit", 1, 60, "访客每分钟额度"],
  ["sourceDailyMessageLimit", 1, 10_000, "来源每日额度"],
  ["sourceMinuteMessageLimit", 1, 600, "来源每分钟额度"],
] as const;

export function PublicAccessAdminPanel({
  snapshot,
  onSnapshot,
  onSessionExpired,
  onDirtyChange,
  onNotice,
  resetKey = 0,
}: PublicAccessAdminPanelProps) {
  const [draft, setDraft] = useState(() => createDraft(snapshot.config.publicAccess));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const routes = useMemo(
    () => Object.entries(snapshot.config.routes).sort(([leftId, left], [rightId, right]) => (
      left.label.localeCompare(right.label) || leftId.localeCompare(rightId)
    )),
    [snapshot.config.routes],
  );

  useEffect(() => {
    if (dirty) return;
    setDraft(createDraft(snapshot.config.publicAccess));
    setConflict(false);
  }, [snapshot.revision, resetKey]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function updateDraft(update: (current: PublicAccessDraft) => PublicAccessDraft) {
    if (busy) return;
    setDraft((current) => update(current));
    setDirty(true);
    onNotice(null);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !dirty) return;
    const parsed = parseDraft(draft, snapshot.config.routes);
    if (!parsed.ok) {
      onNotice({ kind: "error", text: parsed.message });
      return;
    }
    setBusy(true);
    try {
      const next = await putAdminConfig({ ...snapshot.config, publicAccess: parsed.value }, snapshot.revision);
      onSnapshot(next);
      setDraft(createDraft(next.config.publicAccess));
      setDirty(false);
      setConflict(false);
      onNotice({ kind: "success", text: next.config.publicAccess.enabled ? "公开访问已保存。" : "公开访问已关闭。" });
    } catch (error) {
      await handleConfigError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfigError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      onSessionExpired();
      return;
    }
    if (error instanceof ApiError && error.code === "config_conflict") {
      try {
        const latest = await fetchAdminConfig();
        onSnapshot(latest);
        setConflict(true);
        onNotice({ kind: "warning", text: "配置已被其他窗口更新；当前公开访问草稿仍保留，请确认后重新保存。" });
      } catch (refreshError) {
        onNotice({ kind: "error", text: errorMessage(refreshError, "配置冲突后无法刷新服务器版本。") });
      }
      return;
    }
    onNotice({ kind: "error", text: errorMessage(error, "公开访问配置保存失败。") });
  }

  function useServerVersion() {
    setDraft(createDraft(snapshot.config.publicAccess));
    setDirty(false);
    setConflict(false);
    onDirtyChange(false);
    onNotice({ kind: "success", text: "已切换到服务器版本，当前草稿已放弃。" });
  }

  return (
    <section className="admin-public-panel" aria-labelledby="public-access-admin-title">
      <header className="admin-public-header">
        <div>
          <p className="eyebrow">PUBLIC ACCESS</p>
          <h1 id="public-access-admin-title">公开访问</h1>
        </div>
        <div className="admin-pool-actions">
          {conflict && <button className="quiet-button icon-text-button" type="button" onClick={useServerVersion}><RotateCcw size={15} /><span>使用服务器版本</span></button>}
          <button className="primary-button icon-text-button" type="button" onClick={() => void save()} disabled={busy || !dirty}><Save size={15} /><span>{busy ? "保存中..." : "保存公开访问"}</span></button>
        </div>
      </header>

      <form className="admin-public-form" onSubmit={(event) => void save(event)}>
        <fieldset className="admin-public-toggle">
          <legend>访问状态</legend>
          <label>
            <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft((current) => ({ ...current, enabled: event.target.checked }))} disabled={busy} />
            <span><strong>允许访客使用</strong><small>关闭后，未登录访问者将只看到成员登录页。</small></span>
          </label>
        </fieldset>

        <div className="admin-form-grid two">
          <label className="admin-public-route-field">
            <span>访客逻辑模型</span>
            <select value={draft.routeId} onChange={(event) => updateDraft((current) => ({ ...current, routeId: event.target.value }))} disabled={busy} required={draft.enabled}>
              <option value="">未选择</option>
              {routes.map(([id, route]) => (
                <option value={id} key={id} disabled={route.enabled === false}>{route.label || id} · {id}{route.enabled === false ? " · 已停用" : ""}</option>
              ))}
            </select>
          </label>
          <NumberField label="会话有效期（秒）" value={draft.sessionTtlSeconds} min={900} max={604_800} busy={busy} onChange={(value) => updateDraft((current) => ({ ...current, sessionTtlSeconds: value }))} />
          <NumberField label="每位访客每天消息数" value={draft.dailyMessageLimit} min={1} max={1_000} busy={busy} onChange={(value) => updateDraft((current) => ({ ...current, dailyMessageLimit: value }))} />
          <NumberField label="每位访客每分钟消息数" value={draft.minuteMessageLimit} min={1} max={60} busy={busy} onChange={(value) => updateDraft((current) => ({ ...current, minuteMessageLimit: value }))} />
          <NumberField label="同一来源每天消息数" value={draft.sourceDailyMessageLimit} min={1} max={10_000} busy={busy} onChange={(value) => updateDraft((current) => ({ ...current, sourceDailyMessageLimit: value }))} />
          <NumberField label="同一来源每分钟消息数" value={draft.sourceMinuteMessageLimit} min={1} max={600} busy={busy} onChange={(value) => updateDraft((current) => ({ ...current, sourceMinuteMessageLimit: value }))} />
        </div>
        <div className="admin-public-policy" aria-label="访客策略">
          <Globe2 size={18} aria-hidden="true" />
          <span>每位访客同时只运行一个请求；服务商密钥继续由托管密钥存储提供。</span>
        </div>
      </form>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  busy,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  return <label><span>{label}</span><input type="number" step="1" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} disabled={busy} required /></label>;
}

function createDraft(config: AdminPublicAccessConfig): PublicAccessDraft {
  return {
    enabled: config.enabled,
    routeId: config.routeId,
    sessionTtlSeconds: String(config.sessionTtlSeconds),
    dailyMessageLimit: String(config.dailyMessageLimit),
    minuteMessageLimit: String(config.minuteMessageLimit),
    sourceDailyMessageLimit: String(config.sourceDailyMessageLimit),
    sourceMinuteMessageLimit: String(config.sourceMinuteMessageLimit),
  };
}

function parseDraft(
  draft: PublicAccessDraft,
  routes: AdminConfigSnapshot["config"]["routes"],
): { ok: true; value: AdminPublicAccessConfig } | { ok: false; message: string } {
  const route = routes[draft.routeId];
  if (draft.enabled && (!route || route.enabled === false)) {
    return { ok: false, message: "开启公开访问前，请选择一个已启用的逻辑模型。" };
  }
  const values = new Map<keyof PublicAccessDraft, number>();
  for (const [key, minimum, maximum, label] of NUMBER_FIELDS) {
    const value = Number(draft[key]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      return { ok: false, message: `${label}必须是 ${minimum} 至 ${maximum} 的整数。` };
    }
    values.set(key, value);
  }
  return {
    ok: true,
    value: {
      enabled: draft.enabled,
      routeId: draft.routeId,
      sessionTtlSeconds: values.get("sessionTtlSeconds")!,
      dailyMessageLimit: values.get("dailyMessageLimit")!,
      minuteMessageLimit: values.get("minuteMessageLimit")!,
      sourceDailyMessageLimit: values.get("sourceDailyMessageLimit")!,
      sourceMinuteMessageLimit: values.get("sourceMinuteMessageLimit")!,
    },
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
