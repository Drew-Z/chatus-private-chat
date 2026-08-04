import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { KeyRound, Plus, RefreshCw, RotateCcw, Save, Search, Trash2, WandSparkles, X } from "lucide-react";
import {
  ApiError,
  discoverAdminProviderModels,
  fetchAdminConfig,
  fetchAdminRouteSecrets,
  migrateAdminLegacyRoutes,
  putAdminConfig,
  putAdminRouteSecret,
  deleteAdminRouteSecret,
  type AdminConfigSnapshot,
  type AdminRouteSecretsSnapshot,
} from "../lib/api";
import {
  addDiscoveredModels,
  applyProviderDraft,
  canDeleteProvider,
  createProviderDraft,
  hasProviderIdConflict,
  projectAdminLogicalModels,
  projectAdminProviders,
  projectLegacyRouteMigrationCandidates,
  validateProviderDraft,
  type ProviderDraft,
} from "../lib/admin-provider";
import { ConfirmDialog } from "./ConfirmDialog";

type Notice = { kind: "success" | "warning" | "error"; text: string };

type ProviderConfirmation =
  | { kind: "select"; id: string }
  | { kind: "delete-provider"; id: string; label: string }
  | { kind: "delete-secret"; ref: string }
  | { kind: "migrate-legacy"; routeIds: string[] };

type ProviderAdminPanelProps = {
  snapshot: AdminConfigSnapshot;
  onSnapshot: (snapshot: AdminConfigSnapshot) => void;
  onSessionExpired: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotice: (notice: Notice | null) => void;
  onSetupChanged: () => void;
  resetKey?: number;
};

export function ProviderAdminPanel({
  snapshot,
  onSnapshot,
  onSessionExpired,
  onDirtyChange,
  onNotice,
  onSetupChanged,
  resetKey = 0,
}: ProviderAdminPanelProps) {
  const [secrets, setSecrets] = useState<AdminRouteSecretsSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [secretValue, setSecretValue] = useState("");
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveryProviderId, setDiscoveryProviderId] = useState("");
  const [discoveryModels, setDiscoveryModels] = useState<string[]>([]);
  const [discoverySelected, setDiscoverySelected] = useState<string[]>([]);
  const [discoverySearch, setDiscoverySearch] = useState("");
  const [discoveryRouteId, setDiscoveryRouteId] = useState("");
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<ProviderConfirmation | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const providers = useMemo(() => projectAdminProviders(snapshot.config, secrets?.items || []), [snapshot.config, secrets]);
  const legacyCandidates = useMemo(
    () => projectLegacyRouteMigrationCandidates(snapshot.config, secrets?.items || []),
    [snapshot.config, secrets],
  );
  const readyLegacyCandidates = legacyCandidates.filter((candidate) => candidate.status === "ready");
  const blockedLegacyCandidates = legacyCandidates.filter((candidate) => candidate.status === "blocked");
  const logicalModels = useMemo(() => projectAdminLogicalModels(snapshot.config), [snapshot.config]);
  const selectedProvider = providers.find((provider) => provider.id === selectedId) || null;
  const secretRef = draft?.apiKeyRef?.trim() || "";
  const selectedSecret = secretRef
    ? secrets?.items.find((item) => item.apiKeyRef === secretRef)
    : undefined;
  const secretCanEdit = Boolean(
    secretRef
      && selectedId !== "__new__"
      && selectedProvider
      && selectedProvider.apiKeyRef === secretRef,
  );
  const visibleDiscoveryModels = discoveryModels.filter((model) => model.toLocaleLowerCase().includes(discoverySearch.trim().toLocaleLowerCase()));

  useEffect(() => {
    void refreshSecrets();
  }, []);

  useEffect(() => {
    setSecretValue("");
  }, [secretRef]);

  useEffect(() => {
    const first = Object.keys(snapshot.config.providers).sort((a, b) => a.localeCompare(b))[0] || null;
    if (!selectedId || (!Object.prototype.hasOwnProperty.call(snapshot.config.providers, selectedId) && selectedId !== "__new__")) {
      setSelectedId(first);
      setDraft(first ? createProviderDraft(snapshot.config.providers[first], first) : null);
      setDirty(false);
      setConflict(false);
      onDirtyChange(false);
    } else if (!dirty && selectedId !== "__new__") {
      const provider = snapshot.config.providers[selectedId];
      if (provider) setDraft(createProviderDraft(provider, selectedId));
    }
  }, [snapshot.revision, resetKey]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!discoveryOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [discoveryOpen]);

  async function refreshSecrets() {
    setSecretValue("");
    try {
      setSecrets(await fetchAdminRouteSecrets());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "warning", text: getErrorMessage(error, "暂时无法读取密钥状态。") });
    }
  }

  function selectProvider(id: string) {
    if (busy || discoveryBusy) return;
    if (dirty) {
      setConfirmation({ kind: "select", id });
      return;
    }
    applyProviderSelection(id);
  }

  function applyProviderSelection(id: string) {
    if (id === "__new__") {
      setSelectedId("__new__");
      setDraft(createProviderDraft(undefined, ""));
    } else {
      const provider = snapshot.config.providers[id];
      if (!provider) return;
      setSelectedId(id);
      setDraft(createProviderDraft(provider, id));
    }
    setDirty(false);
    setConflict(false);
    setSecretValue("");
    onNotice(null);
  }

  function updateDraft(update: (current: ProviderDraft) => ProviderDraft) {
    if (!draft || busy) return;
    setDraft(update(draft));
    setDirty(true);
    onNotice(null);
  }

  async function saveProvider(event?: FormEvent) {
    event?.preventDefault();
    if (!draft || busy) return;
    const validation = validateProviderDraft(draft);
    if (!validation.ok) {
      onNotice({ kind: "error", text: validation.message });
      return;
    }
    if (selectedId === "__new__" && Object.prototype.hasOwnProperty.call(snapshot.config.providers, draft.id)) {
      onNotice({ kind: "error", text: "这个服务商 ID 已存在，请换一个。" });
      return;
    }
    if (hasProviderIdConflict(snapshot.config, selectedId === "__new__" ? null : selectedId, draft.id)) {
      onNotice({ kind: "error", text: "改名后的服务商 ID 已存在，请换一个。" });
      return;
    }
    setBusy(true);
    onNotice(null);
    try {
      const config = applyProviderDraft(snapshot.config, selectedId === "__new__" ? null : selectedId, draft);
      const next = await putAdminConfig(config, snapshot.revision);
      onSnapshot(next);
      setSelectedId(draft.id);
      setDraft(createProviderDraft(next.config.providers[draft.id], draft.id));
      setDirty(false);
      setConflict(false);
      onNotice({ kind: "success", text: "服务商配置已保存。" });
    } catch (error) {
      await handleConfigError(error);
    } finally {
      setBusy(false);
    }
  }

  function requestDeleteProvider() {
    if (!selectedProvider || busy) return;
    const guard = canDeleteProvider(snapshot.config, selectedProvider.id);
    if (!guard.ok) {
      onNotice({ kind: "warning", text: `不能删除，仍被逻辑模型引用：${guard.referencedBy.join("、")}` });
      return;
    }
    setConfirmation({ kind: "delete-provider", id: selectedProvider.id, label: selectedProvider.label });
  }

  async function deleteProvider(id: string) {
    const provider = snapshot.config.providers[id];
    if (!provider || busy) return;
    setBusy(true);
    try {
      const providers = { ...snapshot.config.providers };
      delete providers[id];
      const next = await putAdminConfig({ ...snapshot.config, providers }, snapshot.revision);
      onSnapshot(next);
      const nextId = Object.keys(next.config.providers).sort()[0] || null;
      setSelectedId(nextId);
      setDraft(nextId ? createProviderDraft(next.config.providers[nextId], nextId) : null);
      setDirty(false);
      setConflict(false);
      onNotice({ kind: "success", text: "服务商已删除。" });
    } catch (error) {
      await handleConfigError(error);
      throw new Error(getErrorMessage(error, "服务商删除失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function saveSecret() {
    const ref = secretRef;
    if (!secretCanEdit || !secretValue.trim() || busy) return;
    setBusy(true);
    try {
      const result = await putAdminRouteSecret(ref, secretValue.trim(), selectedSecret?.revision);
      setSecrets((current) => current ? {
        ...current,
        items: [...current.items.filter((item) => item.apiKeyRef !== ref), result.item].sort((a, b) => a.apiKeyRef.localeCompare(b.apiKeyRef)),
      } : current);
      setSecretValue("");
      onSetupChanged();
      onNotice({ kind: "success", text: "密钥已保存，输入框已清空。" });
    } catch (error) {
      setSecretValue("");
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "error", text: getErrorMessage(error, "密钥保存失败。") });
    } finally {
      setBusy(false);
    }
  }

  function requestRemoveSecret() {
    const ref = secretRef;
    if (!secretCanEdit || busy || !selectedSecret?.managed) return;
    setConfirmation({ kind: "delete-secret", ref });
  }

  async function removeSecret(ref: string) {
    if (!secretCanEdit || busy || !selectedSecret?.managed || secretRef !== ref) return;
    setBusy(true);
    try {
      const result = await deleteAdminRouteSecret(ref, selectedSecret.revision);
      setSecrets((current) => current ? {
        ...current,
        items: [...current.items.filter((item) => item.apiKeyRef !== ref), result.item],
      } : current);
      setSecretValue("");
      onSetupChanged();
      onNotice({ kind: "success", text: "托管密钥已删除。" });
    } catch (error) {
      setSecretValue("");
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "error", text: getErrorMessage(error, "密钥删除失败。") });
      throw new Error(getErrorMessage(error, "密钥删除失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmProviderAction() {
    if (!confirmation) return;
    if (confirmation.kind === "select") {
      applyProviderSelection(confirmation.id);
      return;
    }
    if (confirmation.kind === "delete-provider") {
      await deleteProvider(confirmation.id);
      return;
    }
    if (confirmation.kind === "migrate-legacy") {
      await migrateLegacyRoutes(confirmation.routeIds);
      return;
    }
    await removeSecret(confirmation.ref);
  }

  async function migrateLegacyRoutes(routeIds: string[]) {
    if (busy || dirty || !routeIds.length) return;
    setBusy(true);
    onNotice(null);
    try {
      const result = await migrateAdminLegacyRoutes(routeIds, snapshot.revision);
      const latest = await fetchAdminConfig();
      onSnapshot(latest);
      setConflict(false);
      await refreshSecrets();
      onSetupChanged();
      onNotice({ kind: "success", text: `已迁移 ${result.migrated.length} 条旧线路。` });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
      } else if (error instanceof ApiError && error.code === "config_conflict") {
        const latest = await fetchAdminConfig();
        onSnapshot(latest);
        onNotice({ kind: "warning", text: "配置已更新，请检查最新迁移状态后重试。" });
      } else if (error instanceof ApiError && error.details.legacyRouteStatuses?.length) {
        onNotice({ kind: "error", text: migrationBlockedMessage(error.details.legacyRouteStatuses) });
      } else {
        onNotice({ kind: "error", text: getErrorMessage(error, "旧线路迁移失败。") });
      }
      throw new Error(getErrorMessage(error, "旧线路迁移失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function openDiscovery() {
    if (!selectedProvider || selectedId === "__new__" || busy) return;
    setDiscoveryProviderId(selectedProvider.id);
    setDiscoveryModels([]);
    setDiscoverySelected([]);
    setDiscoverySearch("");
    setDiscoveryRouteId("");
    setDiscoveryOpen(true);
    setDiscoveryBusy(true);
    try {
      const result = await discoverAdminProviderModels(selectedProvider.id);
      setDiscoveryModels(result.models);
    } catch (error) {
      setDiscoveryOpen(false);
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "error", text: getErrorMessage(error, "模型发现失败。") });
    } finally {
      setDiscoveryBusy(false);
    }
  }

  async function addSelectedModels() {
    if (!discoverySelected.length || discoveryBusy) return;
    setDiscoveryBusy(true);
    try {
      const result = addDiscoveredModels(snapshot.config, discoveryProviderId, discoverySelected, discoveryRouteId || undefined);
      if (!result.routeIds.length) {
        onNotice({ kind: "warning", text: "没有可添加的模型，可能是服务商已在目标逻辑模型中存在。" });
        return;
      }
      const next = await putAdminConfig(result.config, snapshot.revision);
      onSnapshot(next);
      setDiscoveryOpen(false);
      onNotice({ kind: "success", text: `已添加 ${result.routeIds.length} 个逻辑模型。` });
    } catch (error) {
      await handleConfigError(error);
    } finally {
      setDiscoveryBusy(false);
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
        onNotice({ kind: "warning", text: "配置已被其他窗口更新；当前服务商草稿仍保留，请确认后重新保存。" });
      } catch (refreshError) {
        onNotice({ kind: "error", text: getErrorMessage(refreshError, "配置冲突后无法刷新服务器版本。") });
      }
      return;
    }
    onNotice({ kind: "error", text: getErrorMessage(error, "配置保存失败。") });
  }

  function useServerVersion() {
    const ids = Object.keys(snapshot.config.providers).sort((left, right) => left.localeCompare(right));
    const nextId = selectedId && selectedId !== "__new__" && Object.prototype.hasOwnProperty.call(snapshot.config.providers, selectedId)
      ? selectedId
      : ids[0] || null;
    setSelectedId(nextId);
    setDraft(nextId ? createProviderDraft(snapshot.config.providers[nextId], nextId) : null);
    setDirty(false);
    setConflict(false);
    setSecretValue("");
    onDirtyChange(false);
    onNotice({ kind: "success", text: "已切换到服务器版本，当前草稿已放弃。" });
  }

  const canEdit = Boolean(draft) && !busy;
  return (
    <section className="admin-pool-panel" aria-labelledby="provider-admin-title">
      <div className="admin-pool-sidebar">
        <div className="admin-pool-sidebar-head">
          <div>
            <p className="eyebrow">PROVIDER POOL</p>
            <h1 id="provider-admin-title">服务商</h1>
          </div>
          <button id="provider-admin-add" className="icon-button" type="button" onClick={() => selectProvider("__new__")} disabled={busy} aria-label="新增服务商" title="新增服务商"><Plus size={17} /></button>
        </div>
        <div className="admin-pool-list" role="listbox" aria-label="服务商列表">
          {providers.map((provider) => (
            <button className={`admin-pool-list-item ${provider.id === selectedId ? "active" : ""}`} type="button" key={provider.id} onClick={() => selectProvider(provider.id)} aria-selected={provider.id === selectedId}>
              <span><strong>{provider.label}</strong><small>服务商 ID：{provider.id}</small></span>
              <em className={`status-dot ${provider.credentialStatus}`}>{provider.credentialStatus === "configured" ? "已配置" : provider.credentialStatus === "missing" ? "缺密钥" : provider.credentialStatus === "unavailable" ? "不可用" : "需用户密钥"}</em>
            </button>
          ))}
          {!providers.length && <p className="admin-pool-empty">还没有服务商</p>}
        </div>
      </div>

      <div className="admin-pool-editor">
        {legacyCandidates.length > 0 && (
          <section className="admin-migration-band" aria-labelledby="legacy-route-migration-title">
            <div>
              <p className="eyebrow">LEGACY MIGRATION</p>
              <h2 id="legacy-route-migration-title">{legacyCandidates.length} 条旧线路待迁移</h2>
              <p>{readyLegacyCandidates.length} 条可安全迁移，{blockedLegacyCandidates.length} 条需要先补齐密钥配置。阻断项不会写入配置。</p>
            </div>
            <div className="admin-migration-inventory">
              {legacyCandidates.map((candidate) => (
                <span key={candidate.routeId} className={candidate.status === "ready" ? "ready" : "blocked"}>
                  <strong>{candidate.routeId}</strong>
                  <small>{candidate.status === "ready" ? "可迁移" : legacyMigrationReason(candidate.reason)}</small>
                </span>
              ))}
            </div>
            <button
              className="primary-button icon-text-button"
              type="button"
              onClick={() => setConfirmation({ kind: "migrate-legacy", routeIds: readyLegacyCandidates.map((candidate) => candidate.routeId) })}
              disabled={busy || dirty || readyLegacyCandidates.length === 0}
            >
              <WandSparkles size={15} /><span>迁移可安全线路</span>
            </button>
          </section>
        )}
        {!draft ? (
          <div className="admin-pool-empty-state"><p>暂无服务商配置</p><button className="primary-button icon-text-button" type="button" onClick={() => selectProvider("__new__")}><Plus size={16} /><span>新增服务商</span></button></div>
        ) : (
          <>
            <div className="admin-pool-editor-head">
              <div><p className="eyebrow">PROVIDER INSTANCE</p><h2>{selectedId === "__new__" ? "新增服务商" : draft.label || draft.id}</h2><p className="admin-pool-meta">一个服务商可以被多个逻辑模型复用，凭据不会复制到模型行。</p></div>
              <div className="admin-pool-actions">
                {conflict && <button className="quiet-button icon-text-button" type="button" onClick={useServerVersion}><RotateCcw size={15} /><span>使用服务器版本</span></button>}
                {selectedProvider && <button className="quiet-button icon-text-button" type="button" onClick={() => void openDiscovery()} disabled={!canEdit}><WandSparkles size={15} /><span>发现模型</span></button>}
                {selectedProvider && <button className="quiet-button danger icon-text-button" type="button" onClick={requestDeleteProvider} disabled={!canEdit}><Trash2 size={15} /><span>删除</span></button>}
                <button className="primary-button icon-text-button" type="button" onClick={() => void saveProvider()} disabled={!canEdit || !dirty}><Save size={15} /><span>{busy ? "保存中..." : "保存服务商"}</span></button>
              </div>
            </div>
            <form className="admin-pool-form" onSubmit={(event) => void saveProvider(event)}>
              <div className="admin-form-grid two">
                <label><span>服务商 ID</span><input value={draft.id} onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))} autoComplete="off" maxLength={80} /></label>
                <label><span>显示名称</span><input value={draft.label} onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value }))} maxLength={120} /></label>
                <label><span>协议</span><select value={draft.type} onChange={(event) => updateDraft((current) => ({ ...current, type: event.target.value as ProviderDraft["type"] }))}><option value="openai-chat">OpenAI 兼容</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
                <label><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => updateDraft((current) => ({ ...current, baseUrl: event.target.value }))} inputMode="url" /></label>
                <label><span>API Key Ref</span><input value={draft.apiKeyRef || ""} onChange={(event) => updateDraft((current) => ({ ...current, apiKeyRef: event.target.value || undefined }))} autoComplete="off" maxLength={64} placeholder="例如 SHARED_KEY" /></label>
                <label><span>并发策略</span><select value={draft.concurrency || "unlimited"} onChange={(event) => updateDraft((current) => ({ ...current, concurrency: event.target.value as ProviderDraft["concurrency"] }))}><option value="unlimited">不限并发</option><option value="exclusive">独占（一次一位用户）</option><option value="bounded">有上限</option></select></label>
                {draft.concurrency === "bounded" && <label><span>最大并发</span><input type="number" min={1} max={100} value={draft.maxConcurrent || 1} onChange={(event) => updateDraft((current) => ({ ...current, maxConcurrent: Number(event.target.value) }))} /></label>}
                <label><span>繁忙等待（毫秒）</span><input type="number" min={0} max={10000} value={draft.queueTimeoutMs || 0} onChange={(event) => updateDraft((current) => ({ ...current, queueTimeoutMs: Number(event.target.value) }))} /></label>
                <label><span>管理员优先级</span><input type="number" value={draft.priority || 0} onChange={(event) => updateDraft((current) => ({ ...current, priority: Number(event.target.value) }))} /></label>
              </div>
              <fieldset className="admin-check-grid"><legend>能力与策略</legend><label><input type="checkbox" checked={draft.enabled !== false} onChange={(event) => updateDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用服务商</span></label><label><input type="checkbox" checked={draft.directEndpoint === true} onChange={(event) => updateDraft((current) => ({ ...current, directEndpoint: event.target.checked }))} /><span>直接请求端点</span></label><label><input type="checkbox" checked={draft.supportsImages !== false} onChange={(event) => updateDraft((current) => ({ ...current, supportsImages: event.target.checked }))} /><span>支持图片</span></label><label><input type="checkbox" checked={draft.supportsTools === true} onChange={(event) => updateDraft((current) => ({ ...current, supportsTools: event.target.checked }))} /><span>支持工具</span></label><label><input type="checkbox" checked={draft.allowUserKey !== false} onChange={(event) => updateDraft((current) => ({ ...current, allowUserKey: event.target.checked }))} /><span>允许用户密钥</span></label><label><input type="checkbox" checked={draft.requiresUserKey === true} onChange={(event) => updateDraft((current) => ({ ...current, requiresUserKey: event.target.checked }))} /><span>必须使用用户密钥</span></label></fieldset>
            </form>

            <section className="admin-secret-box" aria-labelledby="provider-secret-title">
              <div><p className="eyebrow">CREDENTIAL VAULT</p><h3 id="provider-secret-title">密钥状态</h3><p>{selectedSecret ? `${selectedSecret.source === "managed" ? "托管密钥" : "Worker Secret"} · ${selectedSecret.status}` : draft.apiKeyRef ? "尚未读取到此 Ref 的状态" : "先填写 API Key Ref，再保存服务商配置"}</p></div>
              <div className="admin-secret-actions"><input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder={secretCanEdit ? "只写入，不会回显" : "先保存服务商和 API Key Ref"} autoComplete="new-password" disabled={!secretCanEdit || busy} /><button className="quiet-button icon-text-button" type="button" onClick={() => void saveSecret()} disabled={!secretCanEdit || !secretValue.trim() || busy}><KeyRound size={15} /><span>保存密钥</span></button>{selectedSecret?.managed && <button className="quiet-button danger icon-text-button" type="button" onClick={requestRemoveSecret} disabled={!secretCanEdit || busy}><Trash2 size={15} /><span>删除托管密钥</span></button>}</div>
            </section>

            <section className="admin-reference-box"><h3>已被逻辑模型引用</h3><div className="admin-reference-list">{selectedProvider?.referencedBy.length ? selectedProvider.referencedBy.map((routeId) => {
              const logicalModel = logicalModels.find((model) => model.id === routeId);
              return <span key={routeId}>{logicalModel ? `${logicalModel.label}（模型 ID：${routeId}）` : `模型 ID：${routeId}`}</span>;
            }) : <span className="muted">尚未引用</span>}</div></section>
          </>
        )}
      </div>

      {confirmation && (
        <ConfirmDialog
          key={providerConfirmationKey(confirmation)}
          {...providerConfirmationCopy(confirmation)}
          fallbackFocus={confirmation.kind === "delete-provider" ? providerFallbackFocus : undefined}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmProviderAction}
        />
      )}

      <dialog ref={dialogRef} className="admin-discovery-dialog" onCancel={() => setDiscoveryOpen(false)}>
        <div className="admin-dialog-head"><div><p className="eyebrow">MODEL DISCOVERY</p><h2>从 {discoveryProviderId} 发现模型</h2></div><button className="icon-button" type="button" onClick={() => setDiscoveryOpen(false)} aria-label="关闭模型发现" title="关闭"><X size={17} /></button></div>
        <label className="admin-discovery-search"><Search size={15} /><input value={discoverySearch} onChange={(event) => setDiscoverySearch(event.target.value)} placeholder="搜索已发现的模型" autoFocus /></label>
        <div className="admin-discovery-list">{discoveryBusy && !discoveryModels.length ? <p className="admin-pool-empty">正在读取模型列表...</p> : visibleDiscoveryModels.map((model) => <label key={model}><input type="checkbox" checked={discoverySelected.includes(model)} onChange={(event) => setDiscoverySelected((current) => event.target.checked ? [...current, model] : current.filter((item) => item !== model))} /><span>{model}</span></label>)}{!discoveryBusy && !visibleDiscoveryModels.length && <p className="admin-pool-empty">没有匹配模型</p>}</div>
        <label className="admin-discovery-target"><span>第一个模型加入</span><select value={discoveryRouteId} onChange={(event) => setDiscoveryRouteId(event.target.value)}><option value="">新建逻辑模型</option>{logicalModels.map((model) => <option value={model.id} key={model.id}>{model.label} · {model.id}</option>)}</select></label>
        <div className="admin-dialog-actions"><span>{discoverySelected.length} 个已选择</span><button className="quiet-button" type="button" onClick={() => setDiscoveryOpen(false)}>取消</button><button className="primary-button icon-text-button" type="button" onClick={() => void addSelectedModels()} disabled={!discoverySelected.length || discoveryBusy}><Plus size={15} /><span>添加到池子</span></button></div>
      </dialog>
    </section>
  );
}

function providerConfirmationKey(state: ProviderConfirmation): string {
  if (state.kind === "select" || state.kind === "delete-provider") return `${state.kind}:${state.id}`;
  if (state.kind === "delete-secret") return `${state.kind}:${state.ref}`;
  return `${state.kind}:${state.routeIds.join(",")}`;
}

function providerConfirmationCopy(state: ProviderConfirmation) {
  if (state.kind === "select") {
    return {
      title: "放弃当前服务商草稿？",
      description: `目标：${state.id === "__new__" ? "新增服务商" : state.id}。当前未保存修改会被丢弃。`,
      confirmLabel: "放弃并切换",
      tone: "danger" as const,
    };
  }
  if (state.kind === "delete-provider") {
    return {
      title: `删除服务商「${state.label}」？`,
      description: `目标：${state.id}。该服务商配置将被永久删除。`,
      confirmLabel: "删除服务商",
      tone: "danger" as const,
    };
  }
  if (state.kind === "migrate-legacy") {
    return {
      title: `迁移 ${state.routeIds.length} 条旧线路？`,
      description: `线路 ID：${state.routeIds.join("、")}。服务端会先验证全部凭据，再一次性写入 Provider 和 Offering。`,
      confirmLabel: "确认迁移",
      tone: "default" as const,
    };
  }
  return {
    title: `删除托管密钥 ${state.ref}？`,
    description: `目标：${state.ref}。服务商配置会保留，但使用该引用的请求将无法认证。`,
    confirmLabel: "删除托管密钥",
    tone: "danger" as const,
  };
}

function legacyMigrationReason(reason: "inline_credential_only" | "credential_unavailable" | "invalid_credential_contract" | undefined): string {
  if (reason === "inline_credential_only") return "需先保存 Key Ref";
  if (reason === "invalid_credential_contract") return "BYOK 策略冲突";
  return "密钥不可用";
}

function migrationBlockedMessage(statuses: import("../lib/api").AdminLegacyRouteMigrationStatus[]): string {
  const blocked = statuses.filter((status) => status.status === "blocked");
  if (!blocked.length) return "迁移条件已变化，请刷新后重试。";
  return blocked.map((status) => `${status.routeId}：${legacyMigrationReason(status.reason)}`).join("；");
}

function providerFallbackFocus(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[aria-label="服务商列表"] .admin-pool-list-item.active')
    || document.getElementById("provider-admin-add");
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}
