import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  KeyRound,
  PackageOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ServerCog,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  ApiError,
  deleteAdminMcpSecret,
  discoverAdminMcpTools,
  fetchAdminCapabilityCatalog,
  fetchAdminConfig,
  fetchAdminMcpSecrets,
  putAdminConfig,
  putAdminMcpSecret,
  installAdminCapabilityPack,
  type AdminCapabilityCatalogSnapshot,
  type AdminConfigSnapshot,
  type AdminMcpDiscoveryResponse,
  type AdminMcpSecretsSnapshot,
  type AdminMemberProjection,
} from "../lib/api";
import {
  applyMcpServerDraft,
  applySkillDraft,
  applyToolPolicyDraft,
  canDeleteTool,
  compareCapabilityText,
  createMcpServerDraft,
  createSkillDraft,
  createToolPolicyDraft,
  deleteMcpServer,
  deleteRemoteTool,
  deleteSkill,
  mergeMcpDiscovery,
  MCP_OAUTH_CALLBACK_PATH,
  orderedMcpServerEntries,
  orderedSkillEntries,
  orderedToolEntries,
  validateMcpServerDraft,
  validateSkillDraft,
  validateToolPolicyDraft,
  type McpServerDraft,
  type SkillDraft,
  type ToolPolicyDraft,
} from "../lib/admin-capabilities";
import {
  DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS,
  MAX_VISION_ASSIST_MAX_OUTPUT_CHARS,
  MIN_VISION_ASSIST_MAX_OUTPUT_CHARS,
} from "../../../src/contracts/vision-assist";

type Notice = { kind: "success" | "warning" | "error"; text: string };
type CapabilityTab = "skills" | "tools" | "mcp" | "catalog";
type Selection = { tab: CapabilityTab; id: string | null };
type ConfirmState =
  | { kind: "discard"; selection: Selection }
  | { kind: "delete-skill"; id: string; label: string }
  | { kind: "delete-tool"; id: string; label: string }
  | { kind: "delete-mcp"; id: string; label: string }
  | { kind: "delete-secret"; ref: string };
type PendingConfirmationFocus =
  | { kind: "selection"; selection: Selection }
  | { kind: "opener"; opener: HTMLElement | null; fallbackId?: string };
type VisionAssistDraft = { enabled: boolean; routeId: string; maxOutputChars: number };

type CapabilityAdminPanelProps = {
  snapshot: AdminConfigSnapshot;
  members: AdminMemberProjection[];
  onSnapshot: (snapshot: AdminConfigSnapshot) => void;
  onSessionExpired: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotice: (notice: Notice | null) => void;
  resetKey?: number;
};

export function CapabilityAdminPanel({
  snapshot,
  members,
  onSnapshot,
  onSessionExpired,
  onDirtyChange,
  onNotice,
  resetKey = 0,
}: CapabilityAdminPanelProps) {
  const initialSelection = getInitialSelection(snapshot, "skills");
  const [activeTab, setActiveTab] = useState<CapabilityTab>(initialSelection.tab);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection.id);
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(() => createSelectedSkillDraft(snapshot, initialSelection.id));
  const [toolDraft, setToolDraft] = useState<ToolPolicyDraft | null>(null);
  const [mcpDraft, setMcpDraft] = useState<McpServerDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [catalog, setCatalog] = useState<AdminCapabilityCatalogSnapshot | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogSelection, setCatalogSelection] = useState<string[]>([]);
  const [visionAssistDraft, setVisionAssistDraft] = useState<VisionAssistDraft>(() => createVisionAssistDraft(snapshot));
  const [secrets, setSecrets] = useState<AdminMcpSecretsSnapshot | null>(null);
  const [secretValue, setSecretValue] = useState("");
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [pendingDiscovery, setPendingDiscovery] = useState<AdminMcpDiscoveryResponse | null>(null);
  const [oauthMemberLabel, setOauthMemberLabel] = useState(() => members[0]?.label || "");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const confirmOpenerRef = useRef<HTMLElement | null>(null);
  const pendingConfirmationFocusRef = useRef<PendingConfirmationFocus | null>(null);

  const skills = useMemo(() => orderedSkillEntries(snapshot.config), [snapshot.config]);
  const tools = useMemo(() => orderedToolEntries(snapshot.config), [snapshot.config]);
  const servers = useMemo(() => orderedMcpServerEntries(snapshot.config), [snapshot.config]);
  const savedTool = activeTab === "tools" && selectedId ? snapshot.config.tools[selectedId] : undefined;
  const savedServer = activeTab === "mcp" && selectedId ? snapshot.config.mcpServers[selectedId] : undefined;
  const memberLabels = useMemo(() => members.map((member) => member.label), [members]);
  const secretRef = mcpDraft?.authType === "bearer" || mcpDraft?.authType === "x-api-key"
    ? mcpDraft.secretRef.trim()
    : mcpDraft?.authType === "oauth2"
      ? mcpDraft.clientSecretRef.trim()
      : "";
  const savedSecretRef = savedServer?.auth.type === "bearer" || savedServer?.auth.type === "x-api-key"
    ? savedServer.auth.secretRef
    : savedServer?.auth.type === "oauth2"
      ? savedServer.auth.clientSecretRef || ""
      : "";
  const secretMetadata = secretRef ? secrets?.items.find((item) => item.secretRef === secretRef) : undefined;
  const secretCanEdit = Boolean(
    savedServer
      && mcpDraft
      && !dirty
      && selectedId === mcpDraft.id
      && savedSecretRef === secretRef
      && secretRef,
  );
  const visionAssistDirty = isVisionAssistDraftDirty(snapshot, visionAssistDraft);

  useEffect(() => {
    if (!memberLabels.includes(oauthMemberLabel)) setOauthMemberLabel(memberLabels[0] || "");
  }, [memberLabels, oauthMemberLabel]);

  useEffect(() => {
    void refreshSecrets();
  }, []);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setSecretValue("");
  }, [activeTab, selectedId, secretRef, snapshot.revision, resetKey]);

  useEffect(() => {
    if (activeTab === "catalog") void refreshCatalog();
  }, [activeTab, snapshot.revision, resetKey]);

  useEffect(() => () => setSecretValue(""), []);

  useEffect(() => {
    if (dirty) return;
    const selection = normalizeSelection(snapshot, { tab: activeTab, id: selectedId });
    applySelection(selection, false);
  }, [snapshot.revision, resetKey]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!confirmState || !dialog) return;
    if (!dialog.open) dialog.showModal();
    const focusFrame = requestAnimationFrame(() => confirmCancelRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      if (dialog.open) dialog.close();
    };
  }, [confirmState]);

  useEffect(() => {
    const pending = pendingConfirmationFocusRef.current;
    if (confirmState || !pending) return;
    const focusFrame = requestAnimationFrame(() => {
      const target = pending.kind === "selection"
        ? resolveSelectionFocusTarget(pending.selection)
        : pending.opener?.isConnected
          ? pending.opener
          : pending.fallbackId
            ? document.getElementById(pending.fallbackId)
            : null;
      pendingConfirmationFocusRef.current = null;
      target?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [confirmState, activeTab, selectedId, snapshot.revision]);

  async function refreshSecrets() {
    setSecretValue("");
    try {
      setSecrets(await fetchAdminMcpSecrets());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "warning", text: getErrorMessage(error, "暂时无法读取 MCP 密钥状态。") });
    }
  }

  async function refreshCatalog() {
    if (catalogLoading) return;
    setCatalogLoading(true);
    setCatalogError("");
    try {
      setCatalog(await fetchAdminCapabilityCatalog());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else setCatalogError(getErrorMessage(error, "暂时无法读取能力目录。"));
    } finally {
      setCatalogLoading(false);
    }
  }

  function requestSelection(selection: Selection) {
    if (busy || discoveryBusy || sameSelection(selection, { tab: activeTab, id: selectedId })) return;
    if (dirty) {
      openConfirmation({ kind: "discard", selection });
      return;
    }
    applySelection(selection, true);
  }

  function applySelection(selection: Selection, clearNotice: boolean, source = snapshot) {
    const normalized = normalizeSelection(source, selection);
    setActiveTab(normalized.tab);
    setSelectedId(normalized.id);
    setSkillDraft(normalized.tab === "skills" ? createSelectedSkillDraft(source, normalized.id) : null);
    setToolDraft(normalized.tab === "tools" && normalized.id ? createToolPolicyDraft(source.config.tools[normalized.id]) : null);
    setMcpDraft(normalized.tab === "mcp" ? createSelectedMcpDraft(source, normalized.id) : null);
    setVisionAssistDraft(createVisionAssistDraft(source));
    setCatalogSelection([]);
    setDirty(false);
    setConflict(false);
    setPendingDiscovery(null);
    setSecretValue("");
    if (clearNotice) onNotice(null);
  }

  function updateSkill(update: (draft: SkillDraft) => SkillDraft) {
    if (!skillDraft || busy) return;
    setSkillDraft(update(skillDraft));
    markDirty();
  }

  function updateTool(update: (draft: ToolPolicyDraft) => ToolPolicyDraft) {
    if (!toolDraft || busy) return;
    setToolDraft(update(toolDraft));
    markDirty();
  }

  function updateMcp(update: (draft: McpServerDraft) => McpServerDraft) {
    if (!mcpDraft || busy) return;
    setMcpDraft(update(mcpDraft));
    setSecretValue("");
    markDirty();
  }

  function markDirty() {
    setDirty(true);
    setConflict(false);
    onNotice(null);
  }

  function toggleCatalogItem(id: string) {
    if (busy) return;
    setCatalogSelection((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      setDirty(next.length > 0 || visionAssistDirty);
      return next;
    });
    setConflict(false);
    onNotice(null);
  }

  async function installCatalogSelection() {
    if (!catalogSelection.length || busy || !catalog || visionAssistDirty) return;
    const pack = catalog.packs.find(({ items }) => catalogSelection.some((id) => items.some((item) => item.id === id)));
    if (!pack) return;
    const selectedItems = pack.items.filter((item) => catalogSelection.includes(item.id));
    if (selectedItems.length !== catalogSelection.length || selectedItems.some((item) => !item.installable)) return;
    setBusy(true);
    onNotice(null);
    try {
      const result = await installAdminCapabilityPack(pack.id, catalogSelection, snapshot.revision);
      const next: AdminConfigSnapshot = { config: result.config, source: result.source, revision: result.revision };
      onSnapshot(next);
      setCatalogSelection([]);
      setDirty(false);
      setConflict(false);
      onNotice({ kind: "success", text: `已安装 ${result.installed.length} 项能力。` });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
      } else if (error instanceof ApiError && error.code === "config_conflict") {
        try {
          onSnapshot(await fetchAdminConfig());
          setConflict(true);
          setDirty(true);
          onNotice({ kind: "warning", text: "配置已更新；目录选择仍保留，请核对状态后重试。" });
        } catch (refreshError) {
          onNotice({ kind: "error", text: getErrorMessage(refreshError, "配置冲突后无法刷新服务器版本。") });
        }
      } else {
        onNotice({ kind: "error", text: getErrorMessage(error, "能力目录安装失败。") });
      }
    } finally {
      setBusy(false);
    }
  }

  function useServerCatalogVersion() {
    setCatalogSelection([]);
    setVisionAssistDraft(createVisionAssistDraft(snapshot));
    setDirty(false);
    setConflict(false);
    onDirtyChange(false);
    onNotice({ kind: "success", text: "已切换到服务器目录与视觉辅助配置。" });
  }

  function updateVisionAssist(update: (draft: VisionAssistDraft) => VisionAssistDraft) {
    if (busy) return;
    setVisionAssistDraft((current) => {
      const next = update(current);
      setDirty(catalogSelection.length > 0 || isVisionAssistDraftDirty(snapshot, next));
      return next;
    });
    setConflict(false);
    onNotice(null);
  }

  async function saveVisionAssist() {
    if (!visionAssistDirty || catalogSelection.length > 0 || busy) return;
    if (visionAssistDraft.enabled && !visionAssistDraft.routeId) {
      onNotice({ kind: "error", text: "启用视觉辅助前请选择逻辑模型。" });
      return;
    }
    if (!Number.isInteger(visionAssistDraft.maxOutputChars)
      || visionAssistDraft.maxOutputChars < MIN_VISION_ASSIST_MAX_OUTPUT_CHARS
      || visionAssistDraft.maxOutputChars > MAX_VISION_ASSIST_MAX_OUTPUT_CHARS) {
      onNotice({
        kind: "error",
        text: `证据字符上限必须是 ${MIN_VISION_ASSIST_MAX_OUTPUT_CHARS} 至 ${MAX_VISION_ASSIST_MAX_OUTPUT_CHARS} 的整数。`,
      });
      return;
    }
    setBusy(true);
    onNotice(null);
    try {
      const next = await putAdminConfig({
        ...snapshot.config,
        visionAssist: {
          enabled: visionAssistDraft.enabled,
          routeId: visionAssistDraft.routeId,
          maxOutputChars: visionAssistDraft.maxOutputChars,
        },
      }, snapshot.revision);
      onSnapshot(next);
      setVisionAssistDraft(createVisionAssistDraft(next));
      setDirty(false);
      setConflict(false);
      onNotice({ kind: "success", text: "视觉辅助配置已保存。" });
    } catch (error) {
      await handleConfigError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveSkill(event?: FormEvent) {
    event?.preventDefault();
    if (!skillDraft || !dirty || busy) return;
    const previousId = selectedId === "__new__" ? null : selectedId;
    const validation = validateSkillDraft(skillDraft, snapshot.config, previousId);
    if (!validation.ok) return onNotice({ kind: "error", text: validation.message });
    await saveConfig(
      applySkillDraft(snapshot.config, previousId, skillDraft),
      skillDraft.id,
      "Skill 已保存。",
    );
  }

  async function saveTool(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedId || !savedTool || !toolDraft || !dirty || busy) return;
    const validation = validateToolPolicyDraft(savedTool, toolDraft, snapshot.config, selectedId);
    if (!validation.ok) return onNotice({ kind: "error", text: validation.message });
    await saveConfig(
      applyToolPolicyDraft(snapshot.config, selectedId, toolDraft),
      selectedId,
      "工具策略已保存。",
    );
  }

  async function saveMcp(event?: FormEvent) {
    event?.preventDefault();
    if (!mcpDraft || !dirty || busy) return;
    const previousId = selectedId === "__new__" ? null : selectedId;
    const validation = validateMcpServerDraft(mcpDraft, snapshot.config, previousId);
    if (!validation.ok) return onNotice({ kind: "error", text: validation.message });
    await saveConfig(
      applyMcpServerDraft(snapshot.config, previousId, mcpDraft),
      mcpDraft.id,
      "MCP Server 已保存。",
    );
  }

  async function saveConfig(config: AdminConfigSnapshot["config"], nextId: string | null, successText: string) {
    setBusy(true);
    setSecretValue("");
    onNotice(null);
    try {
      const next = await putAdminConfig(config, snapshot.revision);
      onSnapshot(next);
      setSelectedId(nextId);
      if (activeTab === "skills") setSkillDraft(nextId ? createSelectedSkillDraft(next, nextId) : null);
      if (activeTab === "tools") setToolDraft(nextId && next.config.tools[nextId] ? createToolPolicyDraft(next.config.tools[nextId]) : null);
      if (activeTab === "mcp") setMcpDraft(nextId ? createSelectedMcpDraft(next, nextId) : null);
      setDirty(false);
      setConflict(false);
      setPendingDiscovery(null);
      onNotice({ kind: "success", text: successText });
    } catch (error) {
      await handleConfigError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfigError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      setSecretValue("");
      onSessionExpired();
      return;
    }
    if (error instanceof ApiError && error.code === "config_conflict") {
      try {
        const latest = await fetchAdminConfig();
        onSnapshot(latest);
        setConflict(true);
        setDirty(true);
        onNotice({ kind: "warning", text: "配置已被其他窗口更新；当前能力草稿仍保留。" });
      } catch (refreshError) {
        onNotice({ kind: "error", text: getErrorMessage(refreshError, "配置冲突后无法刷新服务器版本。") });
      }
      return;
    }
    onNotice({ kind: "error", text: getErrorMessage(error, "能力配置保存失败。") });
  }

  function useServerVersion() {
    applySelection(normalizeSelection(snapshot, { tab: activeTab, id: selectedId }), false);
    setSecretValue("");
    onDirtyChange(false);
    onNotice({ kind: "success", text: "已切换到服务器版本。" });
  }

  async function confirmAction() {
    const action = confirmState;
    if (!action || busy) return;
    if (action.kind === "discard") {
      queueSelectionFocus(action.selection);
      setConfirmState(null);
      applySelection(action.selection, true);
      return;
    }
    setBusy(true);
    try {
      if (action.kind === "delete-secret") {
        if (await removeSecret(action.ref)) {
          queueConfirmationOpener("mcp-managed-secret-input");
          setConfirmState(null);
        }
        return;
      }
      const nextConfig = action.kind === "delete-skill"
        ? deleteSkill(snapshot.config, action.id)
        : action.kind === "delete-tool"
          ? deleteRemoteTool(snapshot.config, action.id)
          : deleteMcpServer(snapshot.config, action.id);
      const next = await putAdminConfig(nextConfig, snapshot.revision);
      onSnapshot(next);
      const selection = getInitialSelection(next, activeTab);
      queueSelectionFocus(selection);
      setConfirmState(null);
      applySelection(selection, false, next);
      onNotice({ kind: "success", text: action.kind === "delete-skill" ? "Skill 已删除。" : action.kind === "delete-tool" ? "远程工具已删除。" : "MCP Server 已删除。" });
    } catch (error) {
      await handleConfigError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveSecret() {
    if (!secretCanEdit || !secretRef || secretValue.length === 0 || busy) return;
    setBusy(true);
    try {
      const result = await putAdminMcpSecret(secretRef, secretValue, secretMetadata?.revision);
      setSecrets((current) => current ? {
        ...current,
        items: [...current.items.filter((item) => item.secretRef !== secretRef), result.item]
          .sort((left, right) => compareCapabilityText(left.secretRef, right.secretRef)),
      } : current);
      onNotice({ kind: "success", text: "MCP 密钥已保存。" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "error", text: getErrorMessage(error, "MCP 密钥保存失败。") });
    } finally {
      setSecretValue("");
      setBusy(false);
    }
  }

  async function removeSecret(ref: string): Promise<boolean> {
    try {
      const result = await deleteAdminMcpSecret(ref, secretMetadata?.revision);
      setSecrets((current) => current ? {
        ...current,
        items: [...current.items.filter((item) => item.secretRef !== ref), result.item]
          .sort((left, right) => compareCapabilityText(left.secretRef, right.secretRef)),
      } : current);
      onNotice({ kind: "success", text: "MCP 托管密钥已删除。" });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "error", text: getErrorMessage(error, "MCP 密钥删除失败。") });
      return false;
    } finally {
      setSecretValue("");
    }
  }

  async function discoverTools() {
    if (
      !selectedId
      || !savedServer
      || !mcpDraft
      || dirty
      || busy
      || discoveryBusy
      || (savedServer.auth.type === "oauth2" && !oauthMemberLabel)
    ) return;
    setDiscoveryBusy(true);
    setSecretValue("");
    try {
      const result = await discoverAdminMcpTools({
        ...(savedServer.auth.type === "oauth2"
          ? { serverId: selectedId, memberLabel: oauthMemberLabel }
          : {
              serverId: selectedId,
              label: savedServer.label,
              endpoint: savedServer.endpoint,
              auth: savedServer.auth,
            }),
      });
      setPendingDiscovery(result);
      await commitDiscovery(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      else onNotice({ kind: "error", text: getErrorMessage(error, "MCP 工具发现失败。") });
    } finally {
      setDiscoveryBusy(false);
    }
  }

  async function commitDiscovery(result = pendingDiscovery) {
    if (!result || busy) return;
    const merged = mergeMcpDiscovery(snapshot.config, result);
    setBusy(true);
    try {
      const next = await putAdminConfig(merged.config, snapshot.revision);
      onSnapshot(next);
      setPendingDiscovery(null);
      setConflict(false);
      setDirty(false);
      onNotice({
        kind: merged.changed ? "warning" : "success",
        text: `发现 ${result.tools.length} 个工具；新增 ${merged.added}，治理变更 ${merged.changed}，拒绝 ${result.rejected}。`,
      });
    } catch (error) {
      await handleConfigError(error);
    } finally {
      setBusy(false);
    }
  }

  function openConfirmation(state: ConfirmState) {
    confirmOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pendingConfirmationFocusRef.current = null;
    setConfirmState(state);
  }

  function closeConfirmation(restoreFocus = true) {
    if (busy) return;
    if (restoreFocus) queueConfirmationOpener();
    setConfirmState(null);
  }

  function queueConfirmationOpener(fallbackId?: string) {
    pendingConfirmationFocusRef.current = { kind: "opener", opener: confirmOpenerRef.current, fallbackId };
  }

  function queueSelectionFocus(selection: Selection) {
    pendingConfirmationFocusRef.current = { kind: "selection", selection };
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: CapabilityTab) {
    const currentIndex = CAPABILITY_TABS.indexOf(tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % CAPABILITY_TABS.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + CAPABILITY_TABS.length) % CAPABILITY_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = CAPABILITY_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = CAPABILITY_TABS[nextIndex];
    requestSelection(getInitialSelection(snapshot, nextTab));
    if (!dirty) requestAnimationFrame(() => document.getElementById(capabilityTabId(nextTab))?.focus());
  }

  const list = activeTab === "skills" ? skills : activeTab === "tools" ? tools : activeTab === "mcp" ? servers : [];
  const canCreate = activeTab === "skills" || activeTab === "mcp";
  return (
    <section className="admin-pool-panel capability-admin-panel" aria-labelledby="capability-admin-title">
      <div className={`admin-pool-sidebar ${activeTab === "catalog" ? "catalog-active" : ""}`}>
        <div className="capability-admin-tabs" role="tablist" aria-label="AI 能力类型">
          <button id={capabilityTabId("skills")} type="button" role="tab" aria-label="Skills" aria-controls="capability-admin-tabpanel" aria-selected={activeTab === "skills"} tabIndex={activeTab === "skills" ? 0 : -1} onKeyDown={(event) => handleTabKeyDown(event, "skills")} onClick={() => requestSelection(getInitialSelection(snapshot, "skills"))}><Sparkles size={15} /><span>Skills</span></button>
          <button id={capabilityTabId("tools")} type="button" role="tab" aria-label="工具" aria-controls="capability-admin-tabpanel" aria-selected={activeTab === "tools"} tabIndex={activeTab === "tools" ? 0 : -1} onKeyDown={(event) => handleTabKeyDown(event, "tools")} onClick={() => requestSelection(getInitialSelection(snapshot, "tools"))}><Wrench size={15} /><span>工具</span></button>
          <button id={capabilityTabId("mcp")} type="button" role="tab" aria-label="MCP" aria-controls="capability-admin-tabpanel" aria-selected={activeTab === "mcp"} tabIndex={activeTab === "mcp" ? 0 : -1} onKeyDown={(event) => handleTabKeyDown(event, "mcp")} onClick={() => requestSelection(getInitialSelection(snapshot, "mcp"))}><ServerCog size={15} /><span>MCP</span></button>
          <button id={capabilityTabId("catalog")} type="button" role="tab" aria-label="能力目录" aria-controls="capability-admin-tabpanel" aria-selected={activeTab === "catalog"} tabIndex={activeTab === "catalog" ? 0 : -1} onKeyDown={(event) => handleTabKeyDown(event, "catalog")} onClick={() => requestSelection(getInitialSelection(snapshot, "catalog"))}><PackageOpen size={15} /><span>目录</span></button>
        </div>
        <div className="admin-pool-sidebar-head">
          <div><p className="eyebrow">AI CAPABILITIES</p><h1 id="capability-admin-title">{tabLabel(activeTab)}</h1></div>
          {canCreate && <button className="icon-button" type="button" onClick={() => requestSelection({ tab: activeTab, id: "__new__" })} disabled={busy} aria-label={`新增${tabLabel(activeTab)}`} title={`新增${tabLabel(activeTab)}`}><Plus size={17} /></button>}
        </div>
        {activeTab !== "catalog" && <div className="admin-pool-list" role="group" aria-label={`${tabLabel(activeTab)}列表`}>
          {list.map(([id, item]) => (
            <button id={capabilityOptionId(activeTab, id)} className={`admin-pool-list-item ${id === selectedId ? "active" : ""}`} type="button" key={id} onClick={() => requestSelection({ tab: activeTab, id })} aria-pressed={id === selectedId}>
              <span><strong>{item.label}</strong><small>{id}</small></span>
              <em className={`status-dot ${item.enabled ? "configured" : "missing"}`}>{item.enabled ? "已启用" : "已停用"}</em>
            </button>
          ))}
          {!list.length && <p className="admin-pool-empty">暂无配置</p>}
        </div>}
      </div>

      <div id="capability-admin-tabpanel" className="admin-pool-editor" role="tabpanel" aria-labelledby={capabilityTabId(activeTab)}>
        {activeTab === "catalog" ? (
          <CapabilityCatalogView
            catalog={catalog}
            loading={catalogLoading}
            error={catalogError}
            selected={catalogSelection}
            busy={busy}
            conflict={conflict}
            routes={snapshot.config.routes}
            visionDraft={visionAssistDraft}
            visionDirty={visionAssistDirty}
            onToggle={toggleCatalogItem}
            onVisionUpdate={updateVisionAssist}
            onVisionSave={() => void saveVisionAssist()}
            onInstall={() => void installCatalogSelection()}
            onRetry={() => void refreshCatalog()}
            onUseServer={useServerCatalogVersion}
          />
        ) : activeTab === "skills" ? (
          <SkillEditor
            draft={skillDraft}
            isNew={selectedId === "__new__"}
            tools={tools}
            dirty={dirty}
            busy={busy}
            conflict={conflict}
            onUpdate={updateSkill}
            onSave={saveSkill}
            onUseServer={useServerVersion}
            onDelete={() => selectedId && skillDraft && openConfirmation({ kind: "delete-skill", id: selectedId, label: skillDraft.label })}
          />
        ) : activeTab === "tools" ? (
          <ToolEditor
            id={selectedId}
            tool={savedTool}
            draft={toolDraft}
            dirty={dirty}
            busy={busy}
            conflict={conflict}
            onUpdate={updateTool}
            onSave={saveTool}
            onUseServer={useServerVersion}
            onDelete={() => selectedId && savedTool && openConfirmation({ kind: "delete-tool", id: selectedId, label: savedTool.label })}
          />
        ) : (
          <McpEditor
            id={selectedId}
            draft={mcpDraft}
            isNew={selectedId === "__new__"}
            dirty={dirty}
            busy={busy}
            conflict={conflict}
            discoveryBusy={discoveryBusy}
            pendingDiscovery={pendingDiscovery}
            secretValue={secretValue}
            secretCanEdit={secretCanEdit}
            secretMetadata={secretMetadata}
            masterKeyReady={secrets?.masterKeyReady ?? false}
            memberLabels={memberLabels}
            oauthMemberLabel={oauthMemberLabel}
            onUpdate={updateMcp}
            onSave={saveMcp}
            onUseServer={useServerVersion}
            onDelete={() => selectedId && mcpDraft && openConfirmation({ kind: "delete-mcp", id: selectedId, label: mcpDraft.label })}
            onDiscover={() => void discoverTools()}
            onCommitDiscovery={() => void commitDiscovery()}
            onSecretChange={setSecretValue}
            onSaveSecret={() => void saveSecret()}
            onDeleteSecret={() => secretRef && openConfirmation({ kind: "delete-secret", ref: secretRef })}
            onRefreshSecrets={() => void refreshSecrets()}
            onOauthMemberLabelChange={setOauthMemberLabel}
          />
        )}
      </div>

      <CapabilityConfirmDialog
        dialogRef={confirmDialogRef}
        cancelRef={confirmCancelRef}
        state={confirmState}
        busy={busy}
        onClose={closeConfirmation}
        onConfirm={() => void confirmAction()}
      />
    </section>
  );
}

function SkillEditor({ draft, isNew, tools, dirty, busy, conflict, onUpdate, onSave, onUseServer, onDelete }: {
  draft: SkillDraft | null;
  isNew: boolean;
  tools: ReturnType<typeof orderedToolEntries>;
  dirty: boolean;
  busy: boolean;
  conflict: boolean;
  onUpdate: (update: (draft: SkillDraft) => SkillDraft) => void;
  onSave: (event?: FormEvent) => Promise<void>;
  onUseServer: () => void;
  onDelete: () => void;
}) {
  if (!draft) return <EmptyCapabilityState label="Skill" />;
  return (
    <form className="capability-editor-form" onSubmit={(event) => void onSave(event)}>
      <EditorHeader eyebrow="SKILL" title={isNew ? "新增 Skill" : draft.label || draft.id} dirty={dirty} busy={busy} conflict={conflict} onUseServer={onUseServer} onDelete={isNew ? undefined : onDelete} onSave={() => void onSave()} saveLabel="保存 Skill" />
      <div className="admin-form-grid two">
        <label><span>Skill ID</span><input value={draft.id} maxLength={80} autoComplete="off" onChange={(event) => onUpdate((current) => ({ ...current, id: event.target.value }))} /></label>
        <label><span>显示名称</span><input value={draft.label} maxLength={80} onChange={(event) => onUpdate((current) => ({ ...current, label: event.target.value }))} /></label>
        <label><span>排序</span><input type="number" min={-10000} max={10000} step={1} value={draft.order} onChange={(event) => onUpdate((current) => ({ ...current, order: Number(event.target.value) }))} /></label>
        <label className="admin-checkbox-row"><input type="checkbox" checked={draft.enabled} onChange={(event) => onUpdate((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用 Skill</span></label>
      </div>
      <label className="admin-form-wide"><span>说明</span><input value={draft.description} maxLength={500} onChange={(event) => onUpdate((current) => ({ ...current, description: event.target.value }))} /></label>
      <label className="admin-form-wide"><span>Instructions</span><textarea value={draft.instructions} maxLength={8000} rows={9} onChange={(event) => onUpdate((current) => ({ ...current, instructions: event.target.value }))} /></label>
      <fieldset className="admin-check-grid capability-tool-checks"><legend>可调用工具</legend>{tools.map(([id, tool]) => <label key={id}><input type="checkbox" checked={draft.toolIds.includes(id)} onChange={(event) => onUpdate((current) => ({ ...current, toolIds: event.target.checked ? [...current.toolIds, id] : current.toolIds.filter((item) => item !== id) }))} /><span>{tool.label} <small>{id}</small></span></label>)}</fieldset>
    </form>
  );
}

function ToolEditor({ id, tool, draft, dirty, busy, conflict, onUpdate, onSave, onUseServer, onDelete }: {
  id: string | null;
  tool: AdminConfigSnapshot["config"]["tools"][string] | undefined;
  draft: ToolPolicyDraft | null;
  dirty: boolean;
  busy: boolean;
  conflict: boolean;
  onUpdate: (update: (draft: ToolPolicyDraft) => ToolPolicyDraft) => void;
  onSave: (event?: FormEvent) => Promise<void>;
  onUseServer: () => void;
  onDelete: () => void;
}) {
  if (!id || !tool || !draft) return <EmptyCapabilityState label="工具" />;
  const options = tool.executor.type === "builtin"
    ? [{ value: "auto", label: "自动执行" }, { value: "always", label: "每次确认" }]
    : [{ value: "first-per-conversation", label: "每个会话首次确认" }, { value: "always", label: "每次确认" }];
  return (
    <form className="capability-editor-form" onSubmit={(event) => void onSave(event)}>
      <EditorHeader eyebrow={tool.executor.type === "mcp" ? "REMOTE TOOL" : "BUILT-IN TOOL"} title={draft.label || id} dirty={dirty} busy={busy} conflict={conflict} onUseServer={onUseServer} onDelete={canDeleteTool(tool) ? onDelete : undefined} onSave={() => void onSave()} saveLabel="保存工具策略" />
      <div className="admin-form-grid two">
        <label><span>工具 ID</span><input value={id} readOnly /></label>
        <label><span>显示名称</span><input value={draft.label} maxLength={80} onChange={(event) => onUpdate((current) => ({ ...current, label: event.target.value }))} /></label>
        <label><span>确认策略</span><select value={draft.confirmation} onChange={(event) => onUpdate((current) => ({ ...current, confirmation: event.target.value as ToolPolicyDraft["confirmation"] }))}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label className="admin-checkbox-row"><input type="checkbox" checked={draft.enabled} onChange={(event) => onUpdate((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用工具</span></label>
        {tool.executor.type === "mcp" && <label><span>显式能力角色</span><select value={draft.capabilityRole} onChange={(event) => onUpdate((current) => ({ ...current, capabilityRole: event.target.value as ToolPolicyDraft["capabilityRole"] }))}><option value="">普通 MCP 工具</option><option value="web_search">联网研究</option></select></label>}
      </div>
      <label className="admin-form-wide"><span>说明</span><input value={draft.description} maxLength={1000} onChange={(event) => onUpdate((current) => ({ ...current, description: event.target.value }))} /></label>
      <details className="capability-schema"><summary>输入 Schema</summary><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>
      {tool.schemaFingerprint && <p className="capability-fingerprint"><span>Schema Fingerprint</span><code>{tool.schemaFingerprint}</code></p>}
    </form>
  );
}

function McpEditor({
  id, draft, isNew, dirty, busy, conflict, discoveryBusy, pendingDiscovery, secretValue, secretCanEdit,
  secretMetadata, masterKeyReady, onUpdate, onSave, onUseServer, onDelete, onDiscover, onCommitDiscovery,
  memberLabels, oauthMemberLabel, onSecretChange, onSaveSecret, onDeleteSecret, onRefreshSecrets,
  onOauthMemberLabelChange,
}: {
  id: string | null;
  draft: McpServerDraft | null;
  isNew: boolean;
  dirty: boolean;
  busy: boolean;
  conflict: boolean;
  discoveryBusy: boolean;
  pendingDiscovery: AdminMcpDiscoveryResponse | null;
  secretValue: string;
  secretCanEdit: boolean;
  secretMetadata: AdminMcpSecretsSnapshot["items"][number] | undefined;
  masterKeyReady: boolean;
  memberLabels: string[];
  oauthMemberLabel: string;
  onUpdate: (update: (draft: McpServerDraft) => McpServerDraft) => void;
  onSave: (event?: FormEvent) => Promise<void>;
  onUseServer: () => void;
  onDelete: () => void;
  onDiscover: () => void;
  onCommitDiscovery: () => void;
  onSecretChange: (value: string) => void;
  onSaveSecret: () => void;
  onDeleteSecret: () => void;
  onRefreshSecrets: () => void;
  onOauthMemberLabelChange: (label: string) => void;
}) {
  if (!draft) return <EmptyCapabilityState label="MCP Server" />;
  const usesStaticSecret = draft.authType === "bearer" || draft.authType === "x-api-key";
  const usesManagedSecret = usesStaticSecret || (draft.authType === "oauth2" && Boolean(draft.clientSecretRef.trim()));
  const discoveryDisabled = dirty || busy || discoveryBusy || (draft.authType === "oauth2" && !oauthMemberLabel);
  return (
    <form className="capability-editor-form" onSubmit={(event) => void onSave(event)}>
      <EditorHeader eyebrow="MCP SERVER" title={isNew ? "新增 MCP Server" : draft.label || draft.id} dirty={dirty} busy={busy} conflict={conflict} onUseServer={onUseServer} onDelete={isNew ? undefined : onDelete} onSave={() => void onSave()} saveLabel="保存 MCP" extraAction={!isNew ? <button className="quiet-button icon-text-button" type="button" onClick={onDiscover} disabled={discoveryDisabled}><RefreshCw size={15} /><span>{discoveryBusy ? "发现中..." : "发现工具"}</span></button> : undefined} />
      <div className="admin-form-grid two">
        <label><span>Server ID</span><input value={draft.id} maxLength={80} autoComplete="off" onChange={(event) => onUpdate((current) => ({ ...current, id: event.target.value }))} /></label>
        <label><span>显示名称</span><input value={draft.label} maxLength={80} onChange={(event) => onUpdate((current) => ({ ...current, label: event.target.value }))} /></label>
        <label className="admin-form-span"><span>HTTPS Endpoint</span><input value={draft.endpoint} maxLength={2048} inputMode="url" onChange={(event) => onUpdate((current) => ({ ...current, endpoint: event.target.value }))} /></label>
        <label><span>认证方式</span><select value={draft.authType} onChange={(event) => onUpdate((current) => ({ ...current, authType: event.target.value as McpServerDraft["authType"] }))}><option value="none">无需认证</option><option value="bearer">Bearer Token</option><option value="x-api-key">X-API-Key</option><option value="oauth2">OAuth 2.0 + PKCE</option></select></label>
        {usesStaticSecret && <label><span>Secret Ref</span><input value={draft.secretRef} maxLength={64} autoComplete="off" placeholder="例如 DOCS_MCP_TOKEN" onChange={(event) => onUpdate((current) => ({ ...current, secretRef: event.target.value }))} /></label>}
        <label className="admin-checkbox-row"><input type="checkbox" checked={draft.enabled} onChange={(event) => onUpdate((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用 Server</span></label>
        {draft.authType === "oauth2" && <>
          <label className="admin-form-span"><span>OAuth Issuer</span><input value={draft.issuer} maxLength={2048} inputMode="url" placeholder="https://identity.example" onChange={(event) => onUpdate((current) => ({ ...current, issuer: event.target.value }))} /></label>
          <label><span>Client ID</span><input value={draft.clientId} maxLength={256} autoComplete="off" onChange={(event) => onUpdate((current) => ({ ...current, clientId: event.target.value }))} /></label>
          <label><span>Scopes</span><input value={draft.scopes} maxLength={3903} autoComplete="off" placeholder="openid profile mcp.tools" onChange={(event) => onUpdate((current) => ({ ...current, scopes: event.target.value }))} /></label>
          <label><span>固定 Callback Path</span><input value={MCP_OAUTH_CALLBACK_PATH} readOnly /></label>
          <label><span>Client Secret Ref（可选）</span><input value={draft.clientSecretRef} maxLength={64} autoComplete="off" placeholder="例如 DOCS_MCP_CLIENT_SECRET" onChange={(event) => onUpdate((current) => ({ ...current, clientSecretRef: event.target.value }))} /></label>
          <label className="admin-form-span"><span>成员 Discovery Candidate</span><select value={oauthMemberLabel} onChange={(event) => onOauthMemberLabelChange(event.target.value)}><option value="">选择已完成成员发现的账号</option>{memberLabels.map((label) => <option key={label} value={label}>{label}</option>)}</select></label>
        </>}
      </div>
      {usesManagedSecret && (
        <section className="admin-secret-box" aria-labelledby="mcp-secret-title">
          <div><h3 id="mcp-secret-title">托管密钥</h3><p>{secretMetadata ? `${secretMetadata.source} · ${secretMetadata.status}` : masterKeyReady ? "未配置" : "主密钥不可用"}</p></div>
          <div className="admin-secret-actions">
            <input id="mcp-managed-secret-input" type="password" value={secretValue} onChange={(event) => onSecretChange(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); if (secretCanEdit && secretValue.length > 0 && !busy) onSaveSecret(); }} autoComplete="new-password" aria-label="MCP 托管密钥" placeholder={secretCanEdit ? "输入新密钥" : "先保存 Server 与 Secret Ref"} disabled={!secretCanEdit || busy} />
            <button className="quiet-button icon-text-button" type="button" onClick={onSaveSecret} disabled={!secretCanEdit || secretValue.length === 0 || busy}><KeyRound size={15} /><span>保存密钥</span></button>
            {secretMetadata?.managed && <button className="quiet-button danger icon-text-button" type="button" onClick={onDeleteSecret} disabled={!secretCanEdit || busy}><Trash2 size={15} /><span>删除密钥</span></button>}
            <button className="icon-button" type="button" onClick={onRefreshSecrets} disabled={busy} aria-label="刷新 MCP 密钥状态" title="刷新密钥状态"><RefreshCw size={16} /></button>
          </div>
        </section>
      )}
      {pendingDiscovery && <div className="capability-discovery-pending" role="status"><span>发现结果等待写入当前配置</span><button className="primary-button icon-text-button" type="button" onClick={onCommitDiscovery} disabled={busy}><Save size={15} /><span>保存发现结果</span></button></div>}
    </form>
  );
}

function EditorHeader({ eyebrow, title, dirty, busy, conflict, onUseServer, onDelete, onSave, saveLabel, extraAction }: {
  eyebrow: string;
  title: string;
  dirty: boolean;
  busy: boolean;
  conflict: boolean;
  onUseServer: () => void;
  onDelete?: () => void;
  onSave: () => void;
  saveLabel: string;
  extraAction?: React.ReactNode;
}) {
  return <div className="admin-pool-editor-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{dirty && <p className="admin-pool-meta">有未保存修改</p>}</div><div className="admin-pool-actions">{conflict && <button className="quiet-button icon-text-button" type="button" onClick={onUseServer}><RotateCcw size={15} /><span>使用服务器版本</span></button>}{extraAction}{onDelete && <button className="quiet-button danger icon-text-button" type="button" onClick={onDelete} disabled={busy}><Trash2 size={15} /><span>删除</span></button>}<button className="primary-button icon-text-button" type="button" onClick={onSave} disabled={!dirty || busy}><Save size={15} /><span>{busy ? "保存中..." : saveLabel}</span></button></div></div>;
}

function CapabilityConfirmDialog({ dialogRef, cancelRef, state, busy, onClose, onConfirm }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  state: ConfirmState | null;
  busy: boolean;
  onClose: (restoreFocus?: boolean) => void;
  onConfirm: () => void;
}) {
  const copy = getConfirmationCopy(state);
  return (
    <dialog ref={dialogRef} className="admin-confirm-dialog" aria-labelledby="capability-confirm-title" aria-describedby="capability-confirm-copy" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="admin-dialog-head"><div><h2 id="capability-confirm-title">{copy.title}</h2></div><button className="icon-button" type="button" onClick={() => onClose()} disabled={busy} aria-label="关闭确认窗口" title="关闭"><X size={17} /></button></div>
      <p id="capability-confirm-copy">{copy.body}</p>
      <div className="admin-dialog-actions"><button ref={cancelRef} className="quiet-button" type="button" onClick={() => onClose()} disabled={busy}>取消</button><button className={state?.kind === "discard" ? "primary-button" : "primary-button danger"} type="button" onClick={onConfirm} disabled={busy}>{busy ? "处理中..." : copy.action}</button></div>
    </dialog>
  );
}

function EmptyCapabilityState({ label }: { label: string }) {
  return <div className="admin-pool-empty-state"><p>暂无{label}</p></div>;
}

function CapabilityCatalogView({
  catalog, loading, error, selected, busy, conflict, routes, visionDraft, visionDirty,
  onToggle, onVisionUpdate, onVisionSave, onInstall, onRetry, onUseServer,
}: {
  catalog: AdminCapabilityCatalogSnapshot | null;
  loading: boolean;
  error: string;
  selected: string[];
  busy: boolean;
  conflict: boolean;
  routes: AdminConfigSnapshot["config"]["routes"];
  visionDraft: VisionAssistDraft;
  visionDirty: boolean;
  onToggle: (id: string) => void;
  onVisionUpdate: (update: (draft: VisionAssistDraft) => VisionAssistDraft) => void;
  onVisionSave: () => void;
  onInstall: () => void;
  onRetry: () => void;
  onUseServer: () => void;
}) {
  if (!catalog && loading) return <div className="admin-pool-empty-state" role="status"><p>正在读取能力目录...</p></div>;
  if (!catalog && error) return <div className="admin-pool-empty-state" role="alert"><p>{error}</p><button className="quiet-button" type="button" onClick={onRetry}>重试</button></div>;
  if (!catalog) return <EmptyCapabilityState label="目录项" />;
  const selectedItems = catalog.packs.flatMap((pack) => pack.items).filter((item) => selected.includes(item.id));
  const canInstall = !visionDirty && selectedItems.length === selected.length && selectedItems.length > 0
    && selectedItems.every((item) => item.installable);
  const visionItem = catalog.packs.flatMap((pack) => pack.items)
    .find((item) => item.id === "chatus:vision_assist");
  return (
    <div className="capability-catalog-view">
      <div className="admin-pool-editor-head">
        <div><p className="eyebrow">CATALOG V{catalog.version}</p><h2>Chatus 能力目录</h2>{selected.length > 0 && <p className="admin-pool-meta">已选择 {selected.length} 项</p>}</div>
        <div className="admin-pool-actions">
          {conflict && <button className="quiet-button icon-text-button" type="button" onClick={onUseServer}><RotateCcw size={15} /><span>使用服务器版本</span></button>}
          <button className="icon-button" type="button" onClick={onRetry} disabled={busy || loading} aria-label="刷新能力目录" title="刷新能力目录"><RefreshCw size={16} /></button>
          <button className="primary-button icon-text-button" type="button" onClick={onInstall} disabled={!canInstall || busy}><Save size={15} /><span>{busy ? "安装中..." : "安装所选"}</span></button>
        </div>
      </div>
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
      <section className="capability-vision-setup" aria-labelledby="capability-vision-setup-title">
        <div className="capability-vision-setup-head">
          <div>
            <p className="eyebrow">ROUTE AUGMENTATION</p>
            <h3 id="capability-vision-setup-title">视觉辅助设置</h3>
            <p>为不支持图片的文本模型选择一条使用实例凭据的原生图片逻辑模型。保存只更新配置，不会发起模型探测。</p>
          </div>
          <span className={`capability-vision-readiness status-${visionItem?.status || "requires_setup"}`} role="status">
            服务器状态：{visionItem ? capabilityStatusLabel(visionItem.status) : "需要配置"}
          </span>
        </div>
        <div className="admin-form-grid two capability-vision-fields">
          <label className="admin-form-span">
            <span>辅助视觉逻辑模型</span>
            <select value={visionDraft.routeId} disabled={busy} onChange={(event) => onVisionUpdate((current) => ({ ...current, routeId: event.target.value }))}>
              <option value="">选择逻辑模型</option>
              {Object.entries(routes).map(([id, route]) => (
                <option key={id} value={id}>{route.label} · {id}{route.enabled === false ? "（已停用）" : ""}</option>
              ))}
            </select>
          </label>
          <label>
            <span>证据字符上限</span>
            <input
              type="number"
              min={MIN_VISION_ASSIST_MAX_OUTPUT_CHARS}
              max={MAX_VISION_ASSIST_MAX_OUTPUT_CHARS}
              step={1}
              value={visionDraft.maxOutputChars}
              disabled={busy}
              onChange={(event) => onVisionUpdate((current) => ({ ...current, maxOutputChars: Number(event.target.value) }))}
            />
          </label>
          <label className="admin-checkbox-row">
            <input type="checkbox" checked={visionDraft.enabled} disabled={busy} onChange={(event) => onVisionUpdate((current) => ({ ...current, enabled: event.target.checked }))} />
            <span>启用视觉辅助</span>
          </label>
        </div>
        <footer className="capability-vision-actions">
          <span>{visionDirty ? "有未保存修改" : selected.length ? "请先安装或清除目录选择" : "配置已与服务器同步"}</span>
          <button className="primary-button icon-text-button" type="button" onClick={onVisionSave} disabled={!visionDirty || selected.length > 0 || busy}>
            <Save size={15} /><span>{busy ? "保存中..." : "保存视觉辅助"}</span>
          </button>
        </footer>
      </section>
      <div className="capability-catalog-packs">
        {catalog.packs.map((pack) => (
          <section className="capability-catalog-pack" aria-labelledby={`capability-pack-${pack.id}`} key={pack.id}>
            <div className="capability-catalog-pack-head"><div><h3 id={`capability-pack-${pack.id}`}>{pack.label}</h3><p>{pack.description}</p></div><code>v{pack.version}</code></div>
            <div className="capability-catalog-items">
              {pack.items.map((item) => {
                const checked = selected.includes(item.id);
                return (
                  <label className={`capability-catalog-item status-${item.status}`} key={item.id}>
                    <input type="checkbox" checked={checked} disabled={busy || (!item.installable && !checked)} onChange={() => onToggle(item.id)} />
                    <span className="capability-catalog-item-copy"><span><strong>{item.label}</strong><code>{item.id}</code></span><small>{item.description}</small><span className="capability-catalog-meta"><em>{capabilityStatusLabel(item.status)}</em><span>{capabilitySourceLabel(item.source)}</span><span>{capabilityActivationLabel(item.activation)}</span><span>{item.disclosure.dataClasses.map(capabilityDataClassLabel).join(" · ")}</span><span>{item.disclosure.externalRequest ? "外部请求" : "仅本地指令"}</span></span></span>
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function getInitialSelection(snapshot: AdminConfigSnapshot, tab: CapabilityTab): Selection {
  if (tab === "catalog") return { tab, id: null };
  const ids = tab === "skills"
    ? orderedSkillEntries(snapshot.config).map(([id]) => id)
    : tab === "tools"
      ? orderedToolEntries(snapshot.config).map(([id]) => id)
      : orderedMcpServerEntries(snapshot.config).map(([id]) => id);
  return { tab, id: ids[0] || null };
}

function normalizeSelection(snapshot: AdminConfigSnapshot, selection: Selection): Selection {
  if (selection.tab === "catalog") return { tab: "catalog", id: null };
  if (selection.id === "__new__" && selection.tab !== "tools") return selection;
  const registry = selection.tab === "skills" ? snapshot.config.skills : selection.tab === "tools" ? snapshot.config.tools : snapshot.config.mcpServers;
  return selection.id && Object.prototype.hasOwnProperty.call(registry, selection.id)
    ? selection
    : getInitialSelection(snapshot, selection.tab);
}

function createSelectedSkillDraft(snapshot: AdminConfigSnapshot, id: string | null): SkillDraft | null {
  if (!id) return null;
  return createSkillDraft(id === "__new__" ? undefined : snapshot.config.skills[id], id === "__new__" ? "" : id);
}

function createSelectedMcpDraft(snapshot: AdminConfigSnapshot, id: string | null): McpServerDraft | null {
  if (!id) return null;
  return createMcpServerDraft(id === "__new__" ? undefined : snapshot.config.mcpServers[id], id === "__new__" ? "" : id);
}

function createVisionAssistDraft(snapshot: AdminConfigSnapshot): VisionAssistDraft {
  return {
    enabled: snapshot.config.visionAssist?.enabled === true,
    routeId: snapshot.config.visionAssist?.routeId || "",
    maxOutputChars: snapshot.config.visionAssist?.maxOutputChars ?? DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS,
  };
}

function isVisionAssistDraftDirty(snapshot: AdminConfigSnapshot, draft: VisionAssistDraft): boolean {
  const saved = createVisionAssistDraft(snapshot);
  return saved.enabled !== draft.enabled
    || saved.routeId !== draft.routeId
    || saved.maxOutputChars !== draft.maxOutputChars;
}

function sameSelection(left: Selection, right: Selection): boolean {
  return left.tab === right.tab && left.id === right.id;
}

function tabLabel(tab: CapabilityTab): string {
  return tab === "skills" ? "Skills" : tab === "tools" ? "工具" : tab === "mcp" ? "MCP Servers" : "能力目录";
}

const CAPABILITY_TABS: CapabilityTab[] = ["skills", "tools", "mcp", "catalog"];

function capabilityTabId(tab: CapabilityTab): string {
  return `capability-admin-tab-${tab}`;
}

function capabilityOptionId(tab: CapabilityTab, id: string): string {
  return `capability-admin-option-${tab}-${id}`;
}

function resolveSelectionFocusTarget(selection: Selection): HTMLElement | null {
  const option = selection.id
    ? document.getElementById(capabilityOptionId(selection.tab, selection.id))
    : null;
  return option || document.getElementById(capabilityTabId(selection.tab));
}

function getConfirmationCopy(state: ConfirmState | null): { title: string; body: string; action: string } {
  if (!state) return { title: "确认操作", body: "", action: "确认" };
  if (state.kind === "discard") return { title: "放弃当前草稿？", body: "未保存的能力配置会被丢弃。", action: "放弃并切换" };
  if (state.kind === "delete-skill") return { title: `删除 Skill「${state.label}」？`, body: "默认配置和成员分配中的引用会一并移除。", action: "删除 Skill" };
  if (state.kind === "delete-tool") return { title: `删除工具「${state.label}」？`, body: "Skill 和成员分配中的工具引用会一并移除。", action: "删除工具" };
  if (state.kind === "delete-mcp") return { title: `删除 MCP Server「${state.label}」？`, body: "该 Server 的远程工具和所有引用会一并移除；托管密钥会保留。", action: "删除 Server" };
  return { title: `删除托管密钥 ${state.ref}？`, body: "Server 配置会保留，但认证请求将不可用。", action: "删除密钥" };
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}

function capabilityStatusLabel(status: AdminCapabilityCatalogSnapshot["packs"][number]["items"][number]["status"]): string {
  if (status === "installed") return "已安装";
  if (status === "missing") return "可安装";
  if (status === "disabled") return "已停用";
  if (status === "conflict") return "ID 冲突";
  return "需要配置";
}

function capabilityActivationLabel(activation: AdminCapabilityCatalogSnapshot["packs"][number]["items"][number]["activation"]): string {
  if (activation === "workflow") return "工作流";
  if (activation === "explicit_turn") return "每轮显式启用";
  return "线路增强";
}

function capabilitySourceLabel(source: AdminCapabilityCatalogSnapshot["packs"][number]["items"][number]["source"]): string {
  return source === "chatus" ? "Chatus 内置" : source;
}

function capabilityDataClassLabel(value: "prompt_text" | "search_query" | "image"): string {
  if (value === "prompt_text") return "对话文本";
  if (value === "search_query") return "搜索查询";
  return "图像";
}
