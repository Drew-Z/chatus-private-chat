import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Copy,
  ExternalLink,
  Gauge,
  KeyRound,
  LogOut,
  Network,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserX,
  Wrench,
  X,
} from "lucide-react";
import {
  adminLogout,
  ApiError,
  createAdminMemberAccess,
  fetchAdminConfig,
  fetchAdminMembers,
  putAdminConfig,
  removeAdminMemberConfig,
  resetAdminMemberUsage,
  revokeAdminMemberAccess,
  revokeAdminMemberSessions,
  rotateAdminMemberAccess,
  type AdminConfigSnapshot,
  type AdminMemberConfigRemovalResponse,
  type AdminMemberCredentialResponse,
  type AdminMemberProjection,
  type AdminMemberSessionsResponse,
  type AdminSessionRevocation,
  type AdminUsageResetResponse,
} from "../lib/api";
import {
  applyCapabilityAssignmentDraft,
  createCapabilityAssignmentDraft,
  DEFAULT_ADMIN_MEMBER,
  getCapabilityAssignmentDraftError,
  getMemberPolicyLimitError,
  isRouteEnabled,
  orderedRouteIds,
  rebaseCapabilityAssignmentDraft,
  setDefaultRoute,
  setDefaultRouteInheritance,
  setMemberPolicyInheritance,
  setRouteAllowed,
  setRouteInheritance,
  type CapabilityAssignmentDraft,
} from "../lib/admin-config";
import { mergeAdminMemberProjection } from "../lib/admin-members";
import { LogicalModelAdminPanel } from "./LogicalModelAdminPanel";
import { AdminOperationsPanel } from "./AdminOperationsPanel";
import { CapabilityAdminPanel } from "./CapabilityAdminPanel";
import { ProviderAdminPanel } from "./ProviderAdminPanel";
import { PublicAccessAdminPanel } from "./PublicAccessAdminPanel";
import { ReliabilityAdminPanel } from "./ReliabilityAdminPanel";

type AdminData = {
  snapshot: AdminConfigSnapshot;
  members: AdminMemberProjection[];
  accessRevision: string;
  accessSource: "kv" | "secret" | "managed";
};

type Notice = { kind: "success" | "warning" | "error"; text: string };

type AdminView = "members" | "providers" | "models" | "capabilities" | "public" | "reliability" | "operations";

type MemberAccessDialogState =
  | { kind: "create"; label: string; existingMember: boolean }
  | { kind: "rotate"; member: AdminMemberProjection }
  | { kind: "revoke"; member: AdminMemberProjection }
  | { kind: "remove-config"; member: AdminMemberProjection }
  | { kind: "sessions"; member: AdminMemberProjection }
  | { kind: "usage"; member: AdminMemberProjection }
  | {
      kind: "credential";
      action: "create" | "rotate";
      label: string;
      accessCode: string;
      sessionRevocation: AdminSessionRevocation;
    };

export function AdminWorkspace({
  onSessionExpired,
  onLogout,
}: {
  onSessionExpired: () => void;
  onLogout: () => void;
}) {
  const [data, setData] = useState<AdminData | null>(null);
  const [selectedMember, setSelectedMember] = useState(DEFAULT_ADMIN_MEMBER);
  const [draft, setDraft] = useState<CapabilityAssignmentDraft | null>(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [memberDialog, setMemberDialog] = useState<MemberAccessDialogState | null>(null);
  const [memberDialogError, setMemberDialogError] = useState("");
  const [memberActionBusy, setMemberActionBusy] = useState(false);
  const [activeView, setActiveView] = useState<AdminView>("members");
  const [poolDirty, setPoolDirty] = useState(false);
  const [panelResetKey, setPanelResetKey] = useState(0);

  useEffect(() => {
    void loadAdminData(false);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !poolDirty && memberDialog?.kind !== "credential") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, memberDialog?.kind, poolDirty]);

  const allMemberOptions = useMemo(() => {
    const options: AdminMemberProjection[] = [
      { label: DEFAULT_ADMIN_MEMBER, displayName: "默认配置", configured: true, hasAccessCode: false },
      ...(data?.members || []),
    ];
    if (dirty && selectedMember && !options.some((member) => member.label === selectedMember)) {
      options.push({ label: selectedMember, displayName: selectedMember, configured: false, hasAccessCode: false });
    }
    return options;
  }, [data?.members, dirty, selectedMember]);

  const memberOptions = useMemo(() => {
    return allMemberOptions.filter((member) => {
      const query = search.trim().toLocaleLowerCase();
      return !query || `${member.label} ${member.displayName}`.toLocaleLowerCase().includes(query);
    });
  }, [allMemberOptions, search]);

  const selected = useMemo(
    () => (data?.members || []).find((member) => member.label === selectedMember),
    [data?.members, selectedMember],
  );

  async function loadAdminData(preserveDraft: boolean): Promise<boolean> {
    setLoading(true);
    try {
      const [snapshot, memberSnapshot] = await Promise.all([fetchAdminConfig(), fetchAdminMembers()]);
      const stillExists = selectedMember === DEFAULT_ADMIN_MEMBER
        || memberSnapshot.members.some((member) => member.label === selectedMember);
      const nextMember = preserveDraft ? selectedMember : stillExists ? selectedMember : DEFAULT_ADMIN_MEMBER;
      setData({ snapshot, ...memberSnapshot });
      setSelectedMember(nextMember);
      if (!preserveDraft) {
        setDraft(createCapabilityAssignmentDraft(snapshot.config, nextMember));
        setDirty(false);
        setConflict(false);
      }
      if (preserveDraft) {
        setDraft((current) => current ? rebaseCapabilityAssignmentDraft(snapshot.config, selectedMember, current) : current);
        setConflict(true);
        setNotice({ kind: "warning", text: "配置已更新，当前草稿仍保留；再次保存将应用本页的成员分配。" });
      }
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return false;
      }
      setNotice({ kind: "error", text: getAdminErrorMessage(error) });
      return false;
    } finally {
      setLoading(false);
    }
  }

  function selectMember(label: string) {
    if (saving || loading || memberActionBusy) return;
    if (label === selectedMember) return;
    if (dirty && !window.confirm("放弃当前成员的未保存分配？")) return;
    setSelectedMember(label);
    if (data) setDraft(createCapabilityAssignmentDraft(data.snapshot.config, label));
    setDirty(false);
    setConflict(false);
    setNotice(null);
  }

  function updateDraft(update: (current: CapabilityAssignmentDraft) => CapabilityAssignmentDraft) {
    if (saving) return;
    setDraft((current) => current ? update(current) : current);
    setDirty(true);
    if (!conflict) setNotice(null);
  }

  async function saveDraft() {
    if (!data || !draft || saving) return;
    const draftError = getCapabilityAssignmentDraftError(draft);
    if (draftError) {
      setNotice({ kind: "error", text: draftError });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const config = applyCapabilityAssignmentDraft(data.snapshot.config, selectedMember, draft);
      const snapshot = await putAdminConfig(config, data.snapshot.revision);
      const members = data.members.map((member) => (
        member.label === selectedMember ? { ...member, configured: selectedMember === DEFAULT_ADMIN_MEMBER || Boolean(snapshot.config.users[selectedMember]) } : member
      ));
      setData({ ...data, snapshot, members });
      setDraft(createCapabilityAssignmentDraft(snapshot.config, selectedMember));
      setDirty(false);
      setConflict(false);
      setNotice({ kind: "success", text: "成员分配与使用策略已保存。" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error instanceof ApiError && error.code === "config_conflict") {
        await loadAdminData(true);
      } else {
        setNotice({ kind: "error", text: getAdminErrorMessage(error) });
      }
    } finally {
      setSaving(false);
    }
  }

  function resetDraft() {
    if (!data) return;
    setDraft(createCapabilityAssignmentDraft(data.snapshot.config, selectedMember));
    setDirty(false);
    setConflict(false);
    setNotice({ kind: "success", text: "已恢复服务器版本。" });
  }

  function applyPoolSnapshot(snapshot: AdminConfigSnapshot) {
    setData((current) => current ? { ...current, snapshot } : current);
    if (dirty && draft) {
      setDraft((current) => current ? rebaseCapabilityAssignmentDraft(snapshot.config, selectedMember, current) : current);
      setConflict(true);
    } else {
      setDraft(createCapabilityAssignmentDraft(snapshot.config, selectedMember));
      setConflict(false);
    }
    setPanelResetKey((value) => value + 1);
  }

  function setPanelNotice(panelNotice: Notice | null) {
    setNotice(panelNotice);
  }

  function selectView(view: AdminView) {
    if (view === activeView) return;
    const leavingPoolEditor = activeView === "providers" || activeView === "models" || activeView === "capabilities" || activeView === "public";
    if (leavingPoolEditor && poolDirty) {
      if (!window.confirm("当前配置有未保存修改，切换视图会放弃这些修改，继续吗？")) return;
      setPoolDirty(false);
    }
    if (activeView === "members" && dirty && !window.confirm("当前成员分配草稿会保留，切换视图后仍可继续编辑，继续吗？")) return;
    setActiveView(view);
    setNotice(null);
  }

  async function refresh() {
    if ((dirty || poolDirty) && !window.confirm("刷新会丢弃当前未保存修改，继续吗？")) return;
    if (await loadAdminData(false)) {
      setPanelResetKey((value) => value + 1);
      setNotice({ kind: "success", text: "配置已刷新。" });
    }
  }

  async function logout() {
    if ((dirty || poolDirty) && !window.confirm("当前有未保存修改，仍要退出吗？")) return;
    setMemberDialog(null);
    setMemberDialogError("");
    await adminLogout();
    onLogout();
  }

  function openCreateMember(label = "") {
    setMemberDialogError("");
    setMemberDialog({ kind: "create", label, existingMember: Boolean(label) });
  }

  function openMemberConfirmation(kind: "rotate" | "revoke" | "remove-config" | "sessions" | "usage", member: AdminMemberProjection) {
    if (kind === "remove-config" && dirty && selectedMember === member.label) {
      if (!window.confirm("恢复默认配置会丢弃当前成员尚未保存的分配，继续吗？")) return;
    }
    setMemberDialogError("");
    setMemberDialog({ kind, member });
  }

  function closeMemberDialog() {
    if (memberActionBusy) return;
    setMemberDialog(null);
    setMemberDialogError("");
  }

  async function createMember(label: string) {
    if (!data || memberActionBusy) return;
    setMemberActionBusy(true);
    setMemberDialogError("");
    try {
      const result = await createAdminMemberAccess(label, data.accessRevision);
      applyCredentialResult(result, "create");
    } catch (error) {
      await handleMemberActionError(error);
    } finally {
      setMemberActionBusy(false);
    }
  }

  async function rotateMember(member: AdminMemberProjection) {
    if (!data || memberActionBusy) return;
    setMemberActionBusy(true);
    setMemberDialogError("");
    try {
      const result = await rotateAdminMemberAccess(member.label, data.accessRevision);
      applyCredentialResult(result, "rotate");
    } catch (error) {
      await handleMemberActionError(error);
    } finally {
      setMemberActionBusy(false);
    }
  }

  async function revokeMember(member: AdminMemberProjection) {
    if (!data || memberActionBusy) return;
    setMemberActionBusy(true);
    setMemberDialogError("");
    try {
      const result = await revokeAdminMemberAccess(member.label, data.accessRevision);
      setData((current) => current ? {
        ...current,
        members: mergeAdminMemberProjection(current.members, member.label, result.member),
        accessRevision: result.accessRevision,
        accessSource: "kv",
      } : current);
      if (!result.member && selectedMember === member.label && !dirty && data) {
        setSelectedMember(DEFAULT_ADMIN_MEMBER);
        setDraft(createCapabilityAssignmentDraft(data.snapshot.config, DEFAULT_ADMIN_MEMBER));
        setConflict(false);
      }
      setMemberDialog(null);
      setNotice({
        kind: result.sessionRevocation.complete ? "success" : "warning",
        text: result.sessionRevocation.complete
          ? `已撤销 ${member.label} 的访问权限，现有会话已注销。`
          : `${member.label} 的访问码已撤销，但会话注销未完成，请在完整后台重试。`,
      });
    } catch (error) {
      await handleMemberActionError(error);
    } finally {
      setMemberActionBusy(false);
    }
  }

  async function removeMemberConfig(member: AdminMemberProjection) {
    if (!data || memberActionBusy) return;
    setMemberActionBusy(true);
    setMemberDialogError("");
    try {
      const result = await removeAdminMemberConfig(member.label, data.snapshot.revision);
      applyConfigRemovalResult(result, member.label);
    } catch (error) {
      await handleMemberConfigActionError(error);
    } finally {
      setMemberActionBusy(false);
    }
  }

  async function revokeMemberSessions(member: AdminMemberProjection) {
    if (!data || memberActionBusy) return;
    setMemberActionBusy(true);
    setMemberDialogError("");
    try {
      const result = await revokeAdminMemberSessions(member.label);
      applySessionRevocationResult(result);
    } catch (error) {
      await handleMemberActionError(error);
    } finally {
      setMemberActionBusy(false);
    }
  }

  async function resetMemberUsage(member: AdminMemberProjection) {
    if (!data || memberActionBusy) return;
    setMemberActionBusy(true);
    setMemberDialogError("");
    try {
      const result = await resetAdminMemberUsage(member.label);
      applyUsageResetResult(result);
    } catch (error) {
      await handleMemberActionError(error);
    } finally {
      setMemberActionBusy(false);
    }
  }

  function applyCredentialResult(result: AdminMemberCredentialResponse, action: "create" | "rotate") {
    setData((current) => current ? {
      ...current,
      members: mergeAdminMemberProjection(current.members, result.member.label, result.member),
      accessRevision: result.accessRevision,
      accessSource: "kv",
    } : current);
    if (action === "create" && !dirty && data) {
      setSelectedMember(result.member.label);
      setDraft(createCapabilityAssignmentDraft(data.snapshot.config, result.member.label));
      setConflict(false);
    }
    setMemberDialog({
      kind: "credential",
      action,
      label: result.member.label,
      accessCode: result.accessCode,
      sessionRevocation: result.sessionRevocation,
    });
    setNotice({
      kind: result.sessionRevocation.complete ? "success" : "warning",
      text: result.sessionRevocation.complete
        ? action === "create" ? "成员访问已创建。" : "访问码已轮换，旧会话已注销。"
        : "新访问码已生效，但会话注销未完成，请在完整后台重试。",
    });
  }

  function applyConfigRemovalResult(result: AdminMemberConfigRemovalResponse, label: string) {
    setData((current) => current ? {
      ...current,
      snapshot: {
        config: result.config,
        source: result.source,
        revision: result.revision,
      },
      members: mergeAdminMemberProjection(current.members, label, result.member),
    } : current);

    const wasSelected = selectedMember === label;
    if (wasSelected) {
      if (result.member) {
        setDraft(createCapabilityAssignmentDraft(result.config, label));
      } else {
        setSelectedMember(DEFAULT_ADMIN_MEMBER);
        setDraft(createCapabilityAssignmentDraft(result.config, DEFAULT_ADMIN_MEMBER));
      }
      setDirty(false);
      setConflict(false);
    } else if (dirty) {
      setDraft((current) => current ? rebaseCapabilityAssignmentDraft(result.config, selectedMember, current) : current);
    }
    setMemberDialog(null);
    setNotice({ kind: "success", text: result.member ? `${label} 已恢复默认配置，访问权限和用户数据未改变。` : `${label} 的独立配置已删除。` });
  }

  function applySessionRevocationResult(result: AdminMemberSessionsResponse) {
    setMemberDialog(null);
    setNotice({
      kind: result.complete ? "success" : "warning",
      text: result.complete
        ? result.revoked ? `已注销 ${result.label} 的 ${result.revoked} 个会话。` : `${result.label} 当前没有活动会话。`
        : `${result.label} 的访问会话只注销了一部分，请稍后重试。`,
    });
  }

  function applyUsageResetResult(result: AdminUsageResetResponse) {
    setMemberDialog(null);
    setPanelResetKey((value) => value + 1);
    setNotice({ kind: "success", text: `${result.label} 的今日用量已重置。` });
  }

  async function handleMemberActionError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      setMemberDialog(null);
      onSessionExpired();
      return;
    }
    if (error instanceof ApiError && error.code === "access_codes_conflict") {
      const refreshed = await refreshMemberSnapshot();
      setMemberDialogError(refreshed
        ? "成员访问状态已更新，请确认后重试。"
        : "成员访问状态已变化，但暂时无法刷新，请稍后重试。");
      return;
    }
    setMemberDialogError(getAdminErrorMessage(error));
  }

  async function handleMemberConfigActionError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      setMemberDialog(null);
      onSessionExpired();
      return;
    }
    if (error instanceof ApiError && error.code === "config_conflict") {
      const refreshed = await loadAdminData(true);
      setMemberDialogError(refreshed
        ? "成员配置已更新，请确认后重试。"
        : "成员配置已变化，但暂时无法刷新，请稍后重试。");
      return;
    }
    setMemberDialogError(getAdminErrorMessage(error));
  }

  async function refreshMemberSnapshot(): Promise<boolean> {
    try {
      const memberSnapshot = await fetchAdminMembers();
      setData((current) => current ? { ...current, ...memberSnapshot } : current);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      return false;
    }
  }

  const selectedName = selectedMember === DEFAULT_ADMIN_MEMBER ? "默认配置" : selected?.displayName || selectedMember;
  const filteredMembers = memberOptions;
  const routeIds = data ? orderedRouteIds(data.snapshot.config) : [];
  const enabledSelectedRoutes = data && draft
    ? draft.allowedRoutes.filter((id) => isRouteEnabled(data.snapshot.config.routes[id]))
    : [];
  const defaultRouteOptions = data && draft
    ? routeIds.filter((id) => draft.allowedRoutes.includes(id) && isRouteEnabled(data.snapshot.config.routes[id]))
    : [];
  const policyError = draft ? getCapabilityAssignmentDraftError(draft) : null;
  const dailyLimitError = draft ? getMemberPolicyLimitError(draft, "dailyMessageLimit") : null;
  const minuteLimitError = draft ? getMemberPolicyLimitError(draft, "minuteMessageLimit") : null;
  const dailyLimitInvalid = Boolean(dailyLimitError);
  const minuteLimitInvalid = Boolean(minuteLimitError);
  const routeInheritanceNoteId = "typed-admin-route-inheritance-note";
  const dailyLimitErrorId = "typed-admin-policy-daily-error";
  const minuteLimitErrorId = "typed-admin-policy-minute-error";

  return (
    <main className="admin-react-shell">
      <header className="typed-admin-header">
        <div className="typed-admin-brand">
          <div className="brand-mark small">C</div>
          <div>
            <strong>Chatus</strong>
            <span>{adminViewLabel(activeView)}</span>
          </div>
        </div>
        <nav className="typed-admin-nav" aria-label="管理视图">
          <button className={activeView === "members" ? "active" : ""} type="button" onClick={() => selectView("members")} aria-pressed={activeView === "members"}>成员访问</button>
          <button className={activeView === "providers" ? "active" : ""} type="button" onClick={() => selectView("providers")} aria-pressed={activeView === "providers"}>服务商</button>
          <button className={activeView === "models" ? "active" : ""} type="button" onClick={() => selectView("models")} aria-pressed={activeView === "models"}>逻辑模型</button>
          <button className={activeView === "capabilities" ? "active" : ""} type="button" onClick={() => selectView("capabilities")} aria-pressed={activeView === "capabilities"}>AI 能力</button>
          <button className={activeView === "public" ? "active" : ""} type="button" onClick={() => selectView("public")} aria-pressed={activeView === "public"}>公开访问</button>
          <button className={activeView === "reliability" ? "active" : ""} type="button" onClick={() => selectView("reliability")} aria-pressed={activeView === "reliability"}>可靠性</button>
          <button className={activeView === "operations" ? "active" : ""} type="button" onClick={() => selectView("operations")} aria-pressed={activeView === "operations"}>运营</button>
        </nav>
        <div className="typed-admin-actions">
          <button
            className="quiet-button icon-text-button"
            type="button"
            onClick={() => openCreateMember()}
            disabled={loading || saving || memberActionBusy}
            aria-label="创建成员"
            title="创建成员"
          >
            <UserPlus size={15} />
            <span>创建成员</span>
          </button>
          <a className="quiet-button icon-text-button" href="/" aria-label="返回聊天" title="返回聊天">
            <ExternalLink size={15} />
            <span>返回聊天</span>
          </a>
          <a className="quiet-button icon-text-button" href="/admin.html" aria-label="打开完整后台" title="打开完整后台">
            <ExternalLink size={15} />
            <span>完整后台</span>
          </a>
          <button className="icon-button" type="button" onClick={() => void refresh()} disabled={loading || saving || memberActionBusy} aria-label="刷新配置" title="刷新配置">
            <RefreshCw size={17} />
          </button>
          <button className="quiet-button icon-text-button" type="button" onClick={() => void logout()} disabled={saving || memberActionBusy}>
            <LogOut size={15} />
            <span>退出</span>
          </button>
        </div>
      </header>

      {notice && (
        <div className={`admin-react-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          {conflict && <button className="quiet-button" type="button" onClick={resetDraft}>使用服务器版本</button>}
        </div>
      )}

      {activeView === "members" ? (
      <div className="typed-admin-layout">
        <aside className="typed-admin-members" aria-label="成员列表">
          <label className="typed-admin-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">搜索成员</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索成员" />
          </label>
          <nav className="typed-admin-member-list" aria-label="选择成员">
            {filteredMembers.map((member) => (
              <button
                className={`typed-admin-member ${member.label === selectedMember ? "active" : ""}`}
                type="button"
                key={member.label || "defaults"}
                onClick={() => selectMember(member.label)}
                disabled={saving || loading || memberActionBusy}
                aria-pressed={member.label === selectedMember}
              >
                <span className="typed-admin-member-copy">
                  <strong>{member.displayName}</strong>
                  <small>{member.label || "全局默认"}</small>
                </span>
                <span className="typed-admin-member-state">
                  {member.hasAccessCode ? member.configured ? "可登录" : "继承默认" : "无访问码"}
                </span>
              </button>
            ))}
            {!filteredMembers.length && <p className="typed-admin-empty">没有匹配成员</p>}
          </nav>
        </aside>

        <section className="typed-admin-editor" aria-labelledby="typed-admin-title">
          <div className="typed-admin-editor-head">
            <div>
              <p className="eyebrow">MEMBER ACCESS</p>
              <h1 id="typed-admin-title">{selectedName}</h1>
              <p className="typed-admin-meta">
                {selectedMember === DEFAULT_ADMIN_MEMBER ? "所有未覆盖成员的默认能力" : `${selectedMember}${selected?.hasAccessCode ? " · 已有访问码" : " · 尚无访问码"}`}
              </p>
            </div>
            <select className="typed-admin-mobile-select" value={selectedMember} onChange={(event) => selectMember(event.target.value)} aria-label="选择成员" disabled={saving || loading || memberActionBusy}>
              <option value={DEFAULT_ADMIN_MEMBER}>默认配置</option>
              {allMemberOptions.filter((member) => member.label).map((member) => <option value={member.label} key={member.label}>{member.displayName} · {member.label}</option>)}
            </select>
            <div className="typed-admin-editor-actions">
              {selectedMember !== DEFAULT_ADMIN_MEMBER && selected && !selected.hasAccessCode && (
                <button className="quiet-button icon-text-button" type="button" onClick={() => openCreateMember(selected.label)} disabled={saving || loading || memberActionBusy}>
                  <KeyRound size={15} />
                  <span>生成访问码</span>
                </button>
              )}
              {selectedMember !== DEFAULT_ADMIN_MEMBER && selected?.hasAccessCode && (
                <>
                  <button className="quiet-button icon-text-button" type="button" onClick={() => openMemberConfirmation("rotate", selected)} disabled={saving || loading || memberActionBusy}>
                    <KeyRound size={15} />
                    <span>轮换访问码</span>
                  </button>
                </>
              )}
              {selectedMember !== DEFAULT_ADMIN_MEMBER && selected && (
                <button className="quiet-button icon-text-button" type="button" onClick={() => openMemberConfirmation("sessions", selected)} disabled={saving || loading || memberActionBusy}>
                  <LogOut size={15} />
                  <span>注销会话</span>
                </button>
              )}
              {selectedMember !== DEFAULT_ADMIN_MEMBER && selected?.configured && (
                <button className="quiet-button icon-text-button" type="button" onClick={() => openMemberConfirmation("remove-config", selected)} disabled={saving || loading || memberActionBusy}>
                  <RotateCcw size={15} />
                  <span>恢复默认</span>
                </button>
              )}
              {selectedMember !== DEFAULT_ADMIN_MEMBER && selected?.hasAccessCode && (
                <button className="quiet-button danger icon-text-button" type="button" onClick={() => openMemberConfirmation("revoke", selected)} disabled={saving || loading || memberActionBusy}>
                  <UserX size={15} />
                  <span>撤销访问</span>
                </button>
              )}
              <button className="primary-button icon-text-button" type="button" onClick={() => void saveDraft()} disabled={!draft || !dirty || Boolean(policyError) || saving || loading || memberActionBusy}>
                <Save size={16} />
                <span>{saving ? "保存中..." : "保存分配"}</span>
              </button>
            </div>
          </div>

          {loading || !data || !draft ? (
            <div className="typed-admin-panel-state" aria-live="polite">正在读取配置...</div>
          ) : (
            <>
              <CapabilitySection
                id="policy"
                icon={<Gauge size={17} />}
                title="使用策略"
                canInherit={false}
                disabled={saving}
                inherit={false}
                onInheritChange={() => undefined}
                inheritLabel=""
                count={policySummary(draft)}
                extraAction={selectedMember !== DEFAULT_ADMIN_MEMBER && selected ? (
                  <button
                    className="quiet-button icon-text-button"
                    type="button"
                    onClick={() => openMemberConfirmation("usage", selected)}
                    disabled={saving || memberActionBusy}
                  >
                    <RotateCcw size={15} />
                    <span>重置今日用量</span>
                  </button>
                ) : undefined}
              >
                <div className="typed-admin-policy-list">
                  <div className="typed-admin-policy-row">
                    <div className="typed-admin-policy-copy">
                      <label htmlFor="typed-admin-policy-enabled"><strong>成员状态</strong></label>
                      <small>{draft.inheritEnabled ? "继承默认状态" : draft.enabled ? "允许使用" : "已暂停"}</small>
                    </div>
                    <div className="typed-admin-policy-actions">
                      {selectedMember !== DEFAULT_ADMIN_MEMBER && (
                        <label className="typed-admin-inherit">
                          <input
                            type="checkbox"
                            checked={draft.inheritEnabled}
                            disabled={saving}
                            onChange={(event) => updateDraft((current) => setMemberPolicyInheritance(data.snapshot.config, current, "enabled", event.target.checked))}
                          />
                          <span>继承默认状态</span>
                        </label>
                      )}
                      <label className="typed-admin-policy-toggle">
                        <input
                          id="typed-admin-policy-enabled"
                          type="checkbox"
                          checked={draft.enabled}
                          disabled={draft.inheritEnabled || saving}
                          onChange={(event) => updateDraft((current) => ({ ...current, enabled: event.target.checked, enabledDirty: true }))}
                        />
                        <span>允许使用</span>
                      </label>
                    </div>
                  </div>

                  <div className="typed-admin-policy-row">
                    <div className="typed-admin-policy-copy">
                      <label htmlFor="typed-admin-policy-daily"><strong>每日消息额度</strong></label>
                      <small>{draft.inheritDailyMessageLimit ? "继承默认额度" : "独立额度"}</small>
                    </div>
                    <div className="typed-admin-policy-actions">
                      {selectedMember !== DEFAULT_ADMIN_MEMBER && (
                        <label className="typed-admin-inherit">
                          <input
                            type="checkbox"
                            checked={draft.inheritDailyMessageLimit}
                            disabled={saving}
                            onChange={(event) => updateDraft((current) => setMemberPolicyInheritance(data.snapshot.config, current, "dailyMessageLimit", event.target.checked))}
                          />
                          <span>继承默认每日额度</span>
                        </label>
                      )}
                      <input
                        id="typed-admin-policy-daily"
                        className="typed-admin-policy-number"
                        type="number"
                        min={1}
                        step={1}
                        value={draft.dailyMessageLimit ?? ""}
                        disabled={draft.inheritDailyMessageLimit || saving}
                        aria-invalid={dailyLimitInvalid}
                        aria-describedby={dailyLimitError ? dailyLimitErrorId : undefined}
                        onChange={(event) => updateDraft((current) => ({
                          ...current,
                          dailyMessageLimit: parsePolicyLimit(event.target.value),
                          dailyMessageLimitDirty: true,
                        }))}
                      />
                    </div>
                  </div>

                  <div className="typed-admin-policy-row">
                    <div className="typed-admin-policy-copy">
                      <label htmlFor="typed-admin-policy-minute"><strong>每分钟消息额度</strong></label>
                      <small>{draft.inheritMinuteMessageLimit ? "继承默认额度" : "独立额度"}</small>
                    </div>
                    <div className="typed-admin-policy-actions">
                      {selectedMember !== DEFAULT_ADMIN_MEMBER && (
                        <label className="typed-admin-inherit">
                          <input
                            type="checkbox"
                            checked={draft.inheritMinuteMessageLimit}
                            disabled={saving}
                            onChange={(event) => updateDraft((current) => setMemberPolicyInheritance(data.snapshot.config, current, "minuteMessageLimit", event.target.checked))}
                          />
                          <span>继承默认每分钟额度</span>
                        </label>
                      )}
                      <input
                        id="typed-admin-policy-minute"
                        className="typed-admin-policy-number"
                        type="number"
                        min={1}
                        step={1}
                        value={draft.minuteMessageLimit ?? ""}
                        disabled={draft.inheritMinuteMessageLimit || saving}
                        aria-invalid={minuteLimitInvalid}
                        aria-describedby={minuteLimitError ? minuteLimitErrorId : undefined}
                        onChange={(event) => updateDraft((current) => ({
                          ...current,
                          minuteMessageLimit: parsePolicyLimit(event.target.value),
                          minuteMessageLimitDirty: true,
                        }))}
                      />
                    </div>
                  </div>
                </div>
                {dailyLimitError && <p id={dailyLimitErrorId} className="typed-admin-policy-error" role="alert">{dailyLimitError}</p>}
                {minuteLimitError && <p id={minuteLimitErrorId} className="typed-admin-policy-error" role="alert">{minuteLimitError}</p>}
              </CapabilitySection>

              <CapabilitySection
                id="routes"
                icon={<Network size={17} />}
                title="模型线路"
                canInherit={selectedMember !== DEFAULT_ADMIN_MEMBER}
                disabled={saving}
                inherit={selectedMember !== DEFAULT_ADMIN_MEMBER && draft.inheritRoutes}
                onInheritChange={(checked) => updateDraft((current) => setRouteInheritance(data.snapshot.config, current, checked))}
                inheritLabel="继承默认可用线路"
                count={draft.allowedRoutes.length === routeIds.length ? `全部 ${routeIds.length} 条` : `${draft.allowedRoutes.length} 条`}
                extraAction={selectedMember !== DEFAULT_ADMIN_MEMBER ? (
                  <label className="typed-admin-inherit">
                    <input
                      type="checkbox"
                      checked={draft.inheritDefaultRoute}
                      disabled={saving}
                      onChange={(event) => updateDraft((current) => setDefaultRouteInheritance(data.snapshot.config, current, event.target.checked))}
                    />
                    <span>继承默认首选线路</span>
                  </label>
                ) : undefined}
              >
                {(draft.inheritRoutes || draft.inheritDefaultRoute) && (
                  <p className="sr-only" id={routeInheritanceNoteId}>已启用的继承项由默认配置提供。</p>
                )}
                <div className="typed-admin-route-default">
                  <label htmlFor="typed-admin-default-route">默认线路</label>
                  <select
                    id="typed-admin-default-route"
                    value={draft.defaultRoute}
                    disabled={draft.inheritDefaultRoute || saving}
                    aria-describedby={draft.inheritDefaultRoute ? routeInheritanceNoteId : undefined}
                    onChange={(event) => updateDraft((current) => setDefaultRoute(data.snapshot.config, current, event.target.value))}
                  >
                    {defaultRouteOptions.map((id) => (
                      <option value={id} key={id}>{data.snapshot.config.routes[id].label || id} · {id}</option>
                    ))}
                  </select>
                </div>
                <fieldset
                  className="typed-admin-route-fieldset"
                  disabled={draft.inheritRoutes || saving}
                  aria-describedby={draft.inheritRoutes ? routeInheritanceNoteId : undefined}
                >
                  <legend>允许线路</legend>
                  <div className="typed-admin-option-list">
                    {routeIds.map((id) => {
                      const route = data.snapshot.config.routes[id];
                      const checked = draft.allowedRoutes.includes(id);
                      const enabled = isRouteEnabled(route);
                      const lastEnabled = checked && enabled && enabledSelectedRoutes.length <= 1;
                      return (
                        <label className={`typed-admin-option ${enabled ? "" : "disabled"}`} key={id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={(!enabled && !checked) || lastEnabled}
                            onChange={(event) => updateDraft((current) => setRouteAllowed(data.snapshot.config, current, id, event.target.checked))}
                          />
                          <span>
                            <strong>{route.label || id}</strong>
                            <small>{enabled ? id : checked ? `${id} · 已停用，可移除` : `${id} · 已停用`}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </CapabilitySection>

              <CapabilitySection
                id="skills"
                icon={<Sparkles size={17} />}
                title="Skills"
                canInherit={selectedMember !== DEFAULT_ADMIN_MEMBER}
                disabled={saving}
                inherit={selectedMember !== DEFAULT_ADMIN_MEMBER && draft.inheritSkills}
                onInheritChange={(checked) => updateDraft((current) => ({ ...current, inheritSkills: checked }))}
                inheritLabel="继承默认 Skill"
                count={`${draft.allowedSkills.length} 项`}
              >
                <div className="typed-admin-option-list">
                  {Object.entries(data.snapshot.config.skills)
                    .sort(([leftId, left], [rightId, right]) => (left.order || 0) - (right.order || 0) || leftId.localeCompare(rightId))
                    .map(([id, skill]) => (
                      <label className={`typed-admin-option ${skill.enabled ? "" : "disabled"}`} key={id}>
                        <input
                          type="checkbox"
                          checked={draft.allowedSkills.includes(id)}
                          disabled={draft.inheritSkills || saving}
                          onChange={() => updateDraft((current) => ({ ...current, allowedSkills: toggleId(current.allowedSkills, id) }))}
                        />
                        <span>
                          <strong>{skill.label || id}</strong>
                          <small>{skill.enabled ? (skill.description || id) : "已停用"}</small>
                        </span>
                      </label>
                    ))}
                  {!Object.keys(data.snapshot.config.skills).length && <p className="typed-admin-empty">暂无 Skill</p>}
                </div>
              </CapabilitySection>

              <CapabilitySection
                id="tools"
                icon={<Wrench size={17} />}
                title="工具"
                canInherit={selectedMember !== DEFAULT_ADMIN_MEMBER}
                disabled={saving}
                inherit={selectedMember !== DEFAULT_ADMIN_MEMBER && draft.inheritTools}
                onInheritChange={(checked) => updateDraft((current) => ({ ...current, inheritTools: checked }))}
                inheritLabel="继承默认工具"
                count={`${draft.allowedTools.length} 项`}
              >
                <div className="typed-admin-option-list">
                  {Object.entries(data.snapshot.config.tools)
                    .sort(([leftId, left], [rightId, right]) => left.label.localeCompare(right.label) || leftId.localeCompare(rightId))
                    .map(([id, tool]) => (
                      <label className={`typed-admin-option ${tool.enabled ? "" : "disabled"}`} key={id}>
                        <input
                          type="checkbox"
                          checked={draft.allowedTools.includes(id)}
                          disabled={draft.inheritTools || saving}
                          onChange={() => updateDraft((current) => ({ ...current, allowedTools: toggleId(current.allowedTools, id) }))}
                        />
                        <span>
                          <strong>{tool.label || id}</strong>
                          <small>{tool.enabled ? `${tool.executor.type === "mcp" ? "MCP" : "内置"} · ${tool.description || id}` : "已停用"}</small>
                        </span>
                      </label>
                    ))}
                  {!Object.keys(data.snapshot.config.tools).length && <p className="typed-admin-empty">暂无工具</p>}
                </div>
              </CapabilitySection>

              <footer className="typed-admin-editor-footer">
                <span className="typed-admin-revision">
                  <ShieldCheck size={15} />
                  {data.snapshot.source} · revision {data.snapshot.revision.slice(0, 8)}
                </span>
                {dirty && <span className="typed-admin-dirty">有未保存修改</span>}
              </footer>
            </>
          )}
        </section>
      </div>
      ) : data ? (
        activeView === "providers" ? (
          <ProviderAdminPanel
            snapshot={data.snapshot}
            onSnapshot={applyPoolSnapshot}
            onSessionExpired={onSessionExpired}
            onDirtyChange={setPoolDirty}
            onNotice={setPanelNotice}
            resetKey={panelResetKey}
          />
        ) : activeView === "models" ? (
          <LogicalModelAdminPanel
            snapshot={data.snapshot}
            onSnapshot={applyPoolSnapshot}
            onSessionExpired={onSessionExpired}
            onDirtyChange={setPoolDirty}
            onNotice={setPanelNotice}
            resetKey={panelResetKey}
          />
        ) : activeView === "capabilities" ? (
          <CapabilityAdminPanel
            snapshot={data.snapshot}
            onSnapshot={applyPoolSnapshot}
            onSessionExpired={onSessionExpired}
            onDirtyChange={setPoolDirty}
            onNotice={setPanelNotice}
            resetKey={panelResetKey}
          />
        ) : activeView === "public" ? (
          <PublicAccessAdminPanel
            snapshot={data.snapshot}
            onSnapshot={applyPoolSnapshot}
            onSessionExpired={onSessionExpired}
            onDirtyChange={setPoolDirty}
            onNotice={setPanelNotice}
            resetKey={panelResetKey}
          />
        ) : activeView === "reliability" ? (
          <ReliabilityAdminPanel
            onSessionExpired={onSessionExpired}
            onNotice={setPanelNotice}
            onDirtyChange={setPoolDirty}
            refreshKey={panelResetKey}
          />
        ) : (
          <AdminOperationsPanel
            onSessionExpired={onSessionExpired}
            onNotice={setPanelNotice}
            onDirtyChange={setPoolDirty}
            refreshKey={panelResetKey}
          />
        )
      ) : (
        <div className="typed-admin-panel-state" aria-live="polite">正在读取配置...</div>
      )}

      {memberDialog && (
        <MemberAccessDialog
          state={memberDialog}
          busy={memberActionBusy}
          error={memberDialogError}
          onClose={closeMemberDialog}
          onLabelChange={(label) => setMemberDialog((current) => current?.kind === "create" ? { ...current, label } : current)}
          onCreate={(label) => void createMember(label)}
          onRotate={(member) => void rotateMember(member)}
          onRevoke={(member) => void revokeMember(member)}
          onRemoveConfig={(member) => void removeMemberConfig(member)}
          onRevokeSessions={(member) => void revokeMemberSessions(member)}
          onResetUsage={(member) => void resetMemberUsage(member)}
        />
      )}
    </main>
  );
}

function adminViewLabel(view: AdminView): string {
  const labels: Record<AdminView, string> = {
    members: "成员分配",
    providers: "服务商池",
    models: "逻辑模型",
    capabilities: "AI 能力",
    public: "公开访问",
    reliability: "可靠性",
    operations: "运营",
  };
  return labels[view];
}

function MemberAccessDialog({
  state,
  busy,
  error,
  onClose,
  onLabelChange,
  onCreate,
  onRotate,
  onRevoke,
  onRemoveConfig,
  onRevokeSessions,
  onResetUsage,
}: {
  state: MemberAccessDialogState;
  busy: boolean;
  error: string;
  onClose: () => void;
  onLabelChange: (label: string) => void;
  onCreate: (label: string) => void;
  onRotate: (member: AdminMemberProjection) => void;
  onRevoke: (member: AdminMemberProjection) => void;
  onRemoveConfig: (member: AdminMemberProjection) => void;
  onRevokeSessions: (member: AdminMemberProjection) => void;
  onResetUsage: (member: AdminMemberProjection) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    setCopyStatus("");
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.kind, state.kind === "credential" ? state.accessCode : ""]);

  const title = memberDialogTitle(state);
  const dialogIcon = state.kind === "remove-config" || state.kind === "usage"
    ? <RotateCcw size={18} aria-hidden="true" />
    : state.kind === "sessions"
      ? <LogOut size={18} aria-hidden="true" />
      : state.kind === "revoke"
        ? <UserX size={18} aria-hidden="true" />
        : <KeyRound size={18} aria-hidden="true" />;

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) onCreate(state.kind === "create" ? state.label.trim() : "");
  }

  async function copyCredential() {
    if (state.kind !== "credential") return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(state.accessCode);
      setCopyStatus("访问码已复制。");
    } catch {
      codeInputRef.current?.focus();
      codeInputRef.current?.select();
      setCopyStatus("无法自动复制，已选中访问码。");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="member-access-dialog"
      aria-labelledby="member-access-dialog-title"
      aria-describedby="member-access-dialog-description"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div className="member-access-dialog-content">
        <header>
          <div>
            {dialogIcon}
            <h2 id="member-access-dialog-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭" title="关闭">
            <X size={18} />
          </button>
        </header>

        {state.kind === "create" && (
          <form className="member-access-form" onSubmit={submitCreate}>
            <label htmlFor="member-access-label">成员 label</label>
            <input
              id="member-access-label"
              data-dialog-initial-focus
              value={state.label}
              onChange={(event) => onLabelChange(event.target.value)}
              pattern="[A-Za-z0-9._-]{1,80}"
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              required
              readOnly={state.existingMember}
            />
            <p id="member-access-dialog-description">
              {state.existingMember ? "将为该成员恢复登录入口。" : "新成员将继承当前默认分配。"}
            </p>
            {error && <p className="member-dialog-status error" role="alert">{error}</p>}
            <div className="member-dialog-actions">
              <button className="quiet-button" type="button" onClick={onClose} disabled={busy}>取消</button>
              <button className="primary-button icon-text-button" type="submit" disabled={busy || !state.label.trim()}>
                <UserPlus size={15} />
                <span>{busy ? "生成中..." : state.existingMember ? "生成访问码" : "创建成员"}</span>
              </button>
            </div>
          </form>
        )}

        {(state.kind === "rotate" || state.kind === "revoke" || state.kind === "remove-config" || state.kind === "sessions" || state.kind === "usage") && (
          <div className="member-access-confirmation">
            <p className="member-dialog-member"><strong>{state.member.displayName}</strong><span>{state.member.label}</span></p>
            <p id="member-access-dialog-description">
              {state.kind === "rotate"
                ? "旧访问码将立即失效，现有登录会话会被注销。"
                : state.kind === "revoke"
                  ? "该成员将无法再次登录，现有会话会被注销；聊天、记忆和成员分配不会删除。"
                  : state.kind === "remove-config"
                    ? "该成员的独立使用策略、线路、Skill 和工具分配将删除并恢复默认；访问码、会话、聊天和记忆不会改变。"
                    : state.kind === "sessions"
                      ? "该成员在所有设备上的登录会话会立即注销；访问码、成员分配、聊天和记忆不会改变。"
                      : "该成员今天已使用的消息额度将归零；成员配置和历史记录不会改变。"}
            </p>
            {error && <p className="member-dialog-status error" role="alert">{error}</p>}
            <div className="member-dialog-actions">
              <button className="quiet-button" data-dialog-initial-focus type="button" onClick={onClose} disabled={busy}>取消</button>
              {state.kind === "rotate" ? (
                <button className="primary-button icon-text-button" type="button" onClick={() => onRotate(state.member)} disabled={busy}>
                  <KeyRound size={15} />
                  <span>{busy ? "轮换中..." : "确认轮换"}</span>
                </button>
              ) : state.kind === "revoke" ? (
                <button className="danger-button icon-text-button" type="button" onClick={() => onRevoke(state.member)} disabled={busy}>
                  <UserX size={15} />
                  <span>{busy ? "撤销中..." : "确认撤销"}</span>
                </button>
              ) : state.kind === "remove-config" ? (
                <button className="danger-button icon-text-button" type="button" onClick={() => onRemoveConfig(state.member)} disabled={busy}>
                  <RotateCcw size={15} />
                  <span>{busy ? "恢复中..." : "确认恢复默认"}</span>
                </button>
              ) : state.kind === "sessions" ? (
                <button className="primary-button icon-text-button" type="button" onClick={() => onRevokeSessions(state.member)} disabled={busy}>
                  <LogOut size={15} />
                  <span>{busy ? "注销中..." : "注销所有会话"}</span>
                </button>
              ) : (
                <button className="primary-button icon-text-button" type="button" onClick={() => onResetUsage(state.member)} disabled={busy}>
                  <RotateCcw size={15} />
                  <span>{busy ? "重置中..." : "重置今日用量"}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {state.kind === "credential" && (
          <div className="member-access-credential">
            <p className="member-dialog-member" id="member-access-dialog-description"><strong>{state.label}</strong><span>仅显示这一次</span></p>
            <label htmlFor="member-access-code">访问码</label>
            <div className="member-access-code-row">
              <input
                ref={codeInputRef}
                id="member-access-code"
                data-dialog-initial-focus
                value={state.accessCode}
                readOnly
                autoComplete="off"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button className="icon-button" type="button" onClick={() => void copyCredential()} aria-label="复制访问码" title="复制访问码">
                <Copy size={17} />
              </button>
            </div>
            {!state.sessionRevocation.complete && (
              <p className="member-dialog-status warning" role="alert">访问码已生效，但旧会话注销未完成。</p>
            )}
            <p className="member-dialog-status" role="status" aria-live="polite">{copyStatus}</p>
            <div className="member-dialog-actions">
              <button className="primary-button" type="button" onClick={onClose}>完成</button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

function memberDialogTitle(state: MemberAccessDialogState): string {
  switch (state.kind) {
    case "create":
      return state.existingMember ? "生成访问码" : "创建成员";
    case "rotate":
      return "轮换访问码";
    case "revoke":
      return "撤销成员访问";
    case "remove-config":
      return "恢复默认配置";
    case "sessions":
      return "注销成员会话";
    case "usage":
      return "重置今日用量";
    case "credential":
      return state.action === "create" ? "成员访问已创建" : "访问码已轮换";
  }
}

function CapabilitySection({
  id,
  icon,
  title,
  canInherit,
  disabled,
  inherit,
  onInheritChange,
  inheritLabel,
  count,
  extraAction,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  canInherit: boolean;
  disabled: boolean;
  inherit: boolean;
  onInheritChange: (checked: boolean) => void;
  inheritLabel: string;
  count: string;
  extraAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="typed-admin-capability-section" aria-labelledby={`capability-${id}`}>
      <div className="typed-admin-section-head">
        <div className="typed-admin-section-title">
          <span className="typed-admin-section-icon" aria-hidden="true">{icon}</span>
          <div>
            <h2 id={`capability-${id}`}>{title}</h2>
          </div>
        </div>
        <div className="typed-admin-section-actions">
          <span className="typed-admin-count">{count}</span>
          {canInherit && (
            <label className="typed-admin-inherit">
              <input type="checkbox" checked={inherit} disabled={disabled} onChange={(event) => onInheritChange(event.target.checked)} />
              <span>{inheritLabel}</span>
            </label>
          )}
          {extraAction}
        </div>
      </div>
      {children}
    </section>
  );
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function parsePolicyLimit(value: string): number | null {
  const parsed = Number(value);
  return value.trim() && Number.isSafeInteger(parsed) ? parsed : null;
}

function policySummary(draft: CapabilityAssignmentDraft): string {
  const status = draft.enabled ? "启用" : "暂停";
  const daily = draft.dailyMessageLimit === null ? "环境默认" : `${draft.dailyMessageLimit}/天`;
  const minute = draft.minuteMessageLimit === null ? "环境默认" : `${draft.minuteMessageLimit}/分`;
  return `${status} · ${daily} · ${minute}`;
}

function getAdminErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "config_conflict") return "配置已在其他标签页或设备更新，正在加载最新版本。";
    if (error.code === "invalid_config") return "服务器拒绝了这份配置，请检查线路与能力引用。";
    if (error.code === "member_config_not_found") return "该成员已经使用默认配置，请刷新成员列表。";
    if (error.code === "expected_config_revision_required") return "配置版本已失效，请刷新成员列表后重试。";
    return error.message;
  }
  return error instanceof Error ? error.message : "管理请求失败，请稍后重试。";
}
