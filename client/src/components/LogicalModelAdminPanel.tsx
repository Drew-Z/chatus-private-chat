import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { ApiError, fetchAdminConfig, putAdminConfig, type AdminConfigSnapshot, type AdminModelOffering } from "../lib/api";
import {
  applyLogicalModelDraft,
  createLogicalModelDraft,
  hasLogicalModelIdConflict,
  projectAdminLogicalModels,
  projectAdminProviders,
  validateLogicalModelDraft,
  type LogicalModelDraft,
} from "../lib/admin-provider";
import { ConfirmDialog } from "./ConfirmDialog";

type Notice = { kind: "success" | "warning" | "error"; text: string };

type LogicalModelConfirmation =
  | { kind: "select"; id: string }
  | { kind: "delete"; id: string; label: string };

type LogicalModelAdminPanelProps = {
  snapshot: AdminConfigSnapshot;
  onSnapshot: (snapshot: AdminConfigSnapshot) => void;
  onSessionExpired: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotice: (notice: Notice | null) => void;
  resetKey?: number;
};

export function LogicalModelAdminPanel({
  snapshot,
  onSnapshot,
  onSessionExpired,
  onDirtyChange,
  onNotice,
  resetKey = 0,
}: LogicalModelAdminPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LogicalModelDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmation, setConfirmation] = useState<LogicalModelConfirmation | null>(null);

  const models = useMemo(() => projectAdminLogicalModels(snapshot.config), [snapshot.config]);
  const providers = useMemo(() => projectAdminProviders(snapshot.config), [snapshot.config]);
  const selectedModel = models.find((model) => model.id === selectedId);

  useEffect(() => {
    const first = models[0]?.id || null;
    if (!selectedId || (!Object.prototype.hasOwnProperty.call(snapshot.config.routes, selectedId) && selectedId !== "__new__")) {
      setSelectedId(first);
      setDraft(first ? createLogicalModelDraft(snapshot.config.routes[first], first) : null);
      setDirty(false);
      setConflict(false);
      onDirtyChange(false);
    } else if (!dirty && selectedId !== "__new__") {
      const route = snapshot.config.routes[selectedId];
      if (route) setDraft(createLogicalModelDraft(route, selectedId));
    }
  }, [snapshot.revision, resetKey]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function selectModel(id: string) {
    if (busy) return;
    if (dirty) {
      setConfirmation({ kind: "select", id });
      return;
    }
    applyModelSelection(id);
  }

  function applyModelSelection(id: string) {
    if (id === "__new__") {
      const provider = providers[0]?.id || "";
      setSelectedId("__new__");
      setDraft(createLogicalModelDraft(undefined, "", provider));
    } else {
      const route = snapshot.config.routes[id];
      if (!route) return;
      setSelectedId(id);
      setDraft(createLogicalModelDraft(route, id));
    }
    setDirty(false);
    setConflict(false);
    onNotice(null);
  }

  function updateDraft(update: (current: LogicalModelDraft) => LogicalModelDraft) {
    if (!draft || busy) return;
    setDraft(update(draft));
    setDirty(true);
    onNotice(null);
  }

  async function saveModel(event?: FormEvent) {
    event?.preventDefault();
    if (!draft || busy) return;
    const validation = validateLogicalModelDraft(draft, snapshot.config);
    if (!validation.ok) {
      onNotice({ kind: "error", text: validation.message });
      return;
    }
    if (selectedId === "__new__" && Object.prototype.hasOwnProperty.call(snapshot.config.routes, draft.id)) {
      onNotice({ kind: "error", text: "这个逻辑模型 ID 已存在，请换一个。" });
      return;
    }
    if (hasLogicalModelIdConflict(snapshot.config, selectedId === "__new__" ? null : selectedId, draft.id)) {
      onNotice({ kind: "error", text: "改名后的逻辑模型 ID 已存在，请换一个。" });
      return;
    }
    setBusy(true);
    try {
      const next = await putAdminConfig(
        applyLogicalModelDraft(snapshot.config, selectedId === "__new__" ? null : selectedId, draft),
        snapshot.revision,
      );
      onSnapshot(next);
      setSelectedId(draft.id);
      setDraft(createLogicalModelDraft(next.config.routes[draft.id], draft.id));
      setDirty(false);
      setConflict(false);
      onNotice({ kind: "success", text: "逻辑模型已保存。" });
    } catch (error) {
      await handleConfigError(error);
    } finally {
      setBusy(false);
    }
  }

  function requestDeleteModel() {
    if (!selectedModel || !draft || busy) return;
    if (selectedModel.referencedBy.length) {
      onNotice({ kind: "warning", text: `不能删除，仍被引用：${selectedModel.referencedBy.join("、")}` });
      return;
    }
    setConfirmation({ kind: "delete", id: selectedModel.id, label: selectedModel.label });
  }

  async function deleteModel(id: string) {
    if (!snapshot.config.routes[id] || busy) return;
    setBusy(true);
    try {
      const routes = { ...snapshot.config.routes };
      delete routes[id];
      const next = await putAdminConfig({ ...snapshot.config, routes }, snapshot.revision);
      onSnapshot(next);
      const nextId = projectAdminLogicalModels(next.config)[0]?.id || null;
      setSelectedId(nextId);
      setDraft(nextId ? createLogicalModelDraft(next.config.routes[nextId], nextId) : null);
      setDirty(false);
      setConflict(false);
      onNotice({ kind: "success", text: "逻辑模型已删除。" });
    } catch (error) {
      await handleConfigError(error);
      throw new Error(getErrorMessage(error, "逻辑模型删除失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmLogicalModelAction() {
    if (!confirmation) return;
    if (confirmation.kind === "select") {
      applyModelSelection(confirmation.id);
      return;
    }
    await deleteModel(confirmation.id);
  }

  function addOffering() {
    if (!draft || !providers.length) return;
    const providerId = providers.find((provider) => !draft.offerings?.some((offering) => offering.providerId === provider.id))?.id || providers[0].id;
    updateDraft((current) => ({ ...current, offerings: [...(current.offerings || []), { providerId, model: "", enabled: true, priority: 0 }] }));
  }

  function updateOffering(index: number, update: (offering: AdminModelOffering) => AdminModelOffering) {
    updateDraft((current) => ({ ...current, offerings: (current.offerings || []).map((offering, itemIndex) => itemIndex === index ? update(offering) : offering) }));
  }

  function moveOffering(index: number, direction: -1 | 1) {
    if (!draft) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= (draft.offerings || []).length) return;
    updateDraft((current) => {
      const offerings = [...(current.offerings || [])];
      [offerings[index], offerings[nextIndex]] = [offerings[nextIndex], offerings[index]];
      return { ...current, offerings };
    });
  }

  function removeOffering(index: number) {
    updateDraft((current) => ({ ...current, offerings: (current.offerings || []).filter((_, itemIndex) => itemIndex !== index) }));
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
        onNotice({ kind: "warning", text: "配置已被其他窗口更新；当前逻辑模型草稿仍保留，请确认后重新保存。" });
      } catch (refreshError) {
        onNotice({ kind: "error", text: getErrorMessage(refreshError, "配置冲突后无法刷新服务器版本。") });
      }
      return;
    }
    onNotice({ kind: "error", text: getErrorMessage(error, "逻辑模型保存失败。") });
  }

  function useServerVersion() {
    const ids = projectAdminLogicalModels(snapshot.config).map((model) => model.id);
    const nextId = selectedId && selectedId !== "__new__" && Object.prototype.hasOwnProperty.call(snapshot.config.routes, selectedId)
      ? selectedId
      : ids[0] || null;
    setSelectedId(nextId);
    setDraft(nextId ? createLogicalModelDraft(snapshot.config.routes[nextId], nextId) : null);
    setDirty(false);
    setConflict(false);
    onDirtyChange(false);
    onNotice({ kind: "success", text: "已切换到服务器版本，当前草稿已放弃。" });
  }

  return (
    <section className="admin-pool-panel" aria-labelledby="logical-model-admin-title">
      <div className="admin-pool-sidebar">
        <div className="admin-pool-sidebar-head"><div><p className="eyebrow">LOGICAL MODELS</p><h1 id="logical-model-admin-title">逻辑模型</h1></div><button id="logical-model-admin-add" className="icon-button" type="button" onClick={() => selectModel("__new__")} disabled={busy} aria-label="新增逻辑模型" title="新增逻辑模型"><Plus size={17} /></button></div>
        <div className="admin-pool-list" role="listbox" aria-label="逻辑模型列表">{models.map((model) => <button className={`admin-pool-list-item ${model.id === selectedId ? "active" : ""}`} type="button" key={model.id} onClick={() => selectModel(model.id)} aria-selected={model.id === selectedId}><span><strong>{model.label}</strong><small>{model.id} · {model.offerings.length} 个服务商</small></span><em className={`status-dot ${model.enabled ? "configured" : "missing"}`}>{model.enabled ? "启用" : "停用"}</em></button>)}{!models.length && <p className="admin-pool-empty">还没有逻辑模型</p>}</div>
      </div>
      <div className="admin-pool-editor">
        {!draft ? <div className="admin-pool-empty-state"><p>暂无逻辑模型配置</p><button className="primary-button icon-text-button" type="button" onClick={() => selectModel("__new__")}><Plus size={16} /><span>新增逻辑模型</span></button></div> : <>
          <div className="admin-pool-editor-head"><div><p className="eyebrow">LOGICAL MODEL</p><h2>{selectedId === "__new__" ? "新增逻辑模型" : draft.label || draft.id}</h2><p className="admin-pool-meta">成员只看到这个名称；服务商和上游模型只在管理员侧维护。</p></div><div className="admin-pool-actions">{conflict && <button className="quiet-button icon-text-button" type="button" onClick={useServerVersion}><RotateCcw size={15} /><span>使用服务器版本</span></button>}{selectedModel && <button className="quiet-button danger icon-text-button" type="button" onClick={requestDeleteModel} disabled={busy}><Trash2 size={15} /><span>删除</span></button>}<button className="primary-button icon-text-button" type="button" onClick={() => void saveModel()} disabled={busy || !dirty}><Save size={15} /><span>{busy ? "保存中..." : "保存逻辑模型"}</span></button></div></div>
          <form className="admin-pool-form" onSubmit={(event) => void saveModel(event)}><div className="admin-form-grid two"><label><span>逻辑模型 ID</span><input value={draft.id} onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))} maxLength={80} autoComplete="off" /></label><label><span>对外名称</span><input value={draft.label} onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value }))} maxLength={120} /></label><label><span>Fallback（逗号分隔）</span><input value={(draft.fallbacks || []).join(", ")} onChange={(event) => updateDraft((current) => ({ ...current, fallbacks: splitIds(event.target.value) }))} placeholder="例如 backup-model" /></label></div><fieldset className="admin-check-grid"><legend>逻辑模型能力</legend><label><input type="checkbox" checked={draft.enabled !== false} onChange={(event) => updateDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用</span></label><label><input type="checkbox" checked={draft.supportsImages !== false} onChange={(event) => updateDraft((current) => ({ ...current, supportsImages: event.target.checked }))} /><span>支持图片</span></label><label><input type="checkbox" checked={draft.supportsTools === true} onChange={(event) => updateDraft((current) => ({ ...current, supportsTools: event.target.checked }))} /><span>支持工具</span></label></fieldset>
            <div className="admin-offerings-head"><div><h3>服务商出口</h3><p>优先级小的先尝试；每个服务商在同一逻辑模型中只能出现一次。</p></div><button className="quiet-button icon-text-button" type="button" onClick={addOffering} disabled={busy || !providers.length}><Plus size={15} /><span>添加出口</span></button></div>
            <div className="admin-offerings-list">{(draft.offerings || []).map((offering, index) => <div className="admin-offering-row" key={`${offering.providerId}-${index}`}><div className="admin-offering-order"><button className="icon-button" type="button" onClick={() => moveOffering(index, -1)} disabled={index === 0 || busy} aria-label="上移出口" title="上移"><ArrowUp size={14} /></button><button className="icon-button" type="button" onClick={() => moveOffering(index, 1)} disabled={index === (draft.offerings || []).length - 1 || busy} aria-label="下移出口" title="下移"><ArrowDown size={14} /></button></div><label><span>服务商</span><select value={offering.providerId} onChange={(event) => updateOffering(index, (current) => ({ ...current, providerId: event.target.value }))}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label} · {provider.id}</option>)}</select></label><label><span>上游模型</span><input value={offering.model} onChange={(event) => updateOffering(index, (current) => ({ ...current, model: event.target.value }))} /></label><label className="compact-field"><span>优先级</span><input type="number" value={offering.priority || 0} onChange={(event) => updateOffering(index, (current) => ({ ...current, priority: Number(event.target.value) }))} /></label><label className="offering-enabled"><span>出口状态</span><select value={offering.enabled === undefined ? "" : offering.enabled ? "true" : "false"} onChange={(event) => updateOffering(index, (current) => ({ ...current, enabled: event.target.value === "" ? undefined : event.target.value === "true" }))}><option value="">继承</option><option value="true">启用</option><option value="false">停用</option></select></label><label className="offering-enabled"><span>图片能力</span><select value={offering.supportsImages === undefined ? "" : offering.supportsImages ? "true" : "false"} onChange={(event) => updateOffering(index, (current) => ({ ...current, supportsImages: event.target.value === "" ? undefined : event.target.value === "true" }))}><option value="">继承</option><option value="true">支持</option><option value="false">不支持</option></select></label><label className="offering-enabled"><span>工具能力</span><select value={offering.supportsTools === undefined ? "" : offering.supportsTools ? "true" : "false"} onChange={(event) => updateOffering(index, (current) => ({ ...current, supportsTools: event.target.value === "" ? undefined : event.target.value === "true" }))}><option value="">继承</option><option value="true">支持</option><option value="false">不支持</option></select></label><button className="icon-button danger" type="button" onClick={() => removeOffering(index)} disabled={busy} aria-label="删除出口" title="删除出口"><Trash2 size={15} /></button></div>)}{!(draft.offerings || []).length && <p className="admin-pool-empty">还没有出口，请先添加服务商。</p>}</div>
          </form>
          <section className="admin-reference-box"><h3>当前引用</h3><div className="admin-reference-list">{selectedModel?.referencedBy.length ? selectedModel.referencedBy.map((reference) => <span key={reference}>{reference}</span>) : <span className="muted">没有成员或 fallback 引用</span>}</div></section>
        </>}
      </div>
      {confirmation && (
        <ConfirmDialog
          key={`${confirmation.kind}:${confirmation.id}`}
          {...logicalModelConfirmationCopy(confirmation)}
          fallbackFocus={confirmation.kind === "delete" ? logicalModelFallbackFocus : undefined}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmLogicalModelAction}
        />
      )}
    </section>
  );
}

function logicalModelConfirmationCopy(state: LogicalModelConfirmation) {
  if (state.kind === "select") {
    return {
      title: "放弃当前逻辑模型草稿？",
      description: `目标：${state.id === "__new__" ? "新增逻辑模型" : state.id}。当前未保存修改会被丢弃。`,
      confirmLabel: "放弃并切换",
      tone: "danger" as const,
    };
  }
  return {
    title: `删除逻辑模型「${state.label}」？`,
    description: `目标：${state.id}。该逻辑模型配置将被永久删除。`,
    confirmLabel: "删除逻辑模型",
    tone: "danger" as const,
  };
}

function logicalModelFallbackFocus(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[aria-label="逻辑模型列表"] .admin-pool-list-item.active')
    || document.getElementById("logical-model-admin-add");
}

function splitIds(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}
