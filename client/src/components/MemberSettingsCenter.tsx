import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Brain,
  Cable,
  ChevronRight,
  Download,
  Laptop,
  LogOut,
  Trash2,
} from "lucide-react";
import type { SessionProjection } from "../lib/api";
import type { ThemePreference } from "../lib/device-preferences";
import { ConfirmDialog } from "./ConfirmDialog";
import { ProductBrand } from "./ProductBrand";

type SettingsSection = "appearance" | "memory" | "connections" | "account" | "sessions";

export function MemberSettingsCenter({
  open,
  nestedOpen,
  session,
  themePreference,
  connectedMcpCount,
  busy,
  onClose,
  onThemePreferenceChange,
  onOpenMemory,
  onOpenMcpConnections,
  onExportUserData,
  onRevokeAllSessions,
  onDeleteUserData,
}: {
  open: boolean;
  nestedOpen: boolean;
  session: SessionProjection;
  themePreference: ThemePreference;
  connectedMcpCount: number;
  busy: boolean;
  onClose: () => void;
  onThemePreferenceChange: (preference: ThemePreference) => boolean;
  onOpenMemory: () => void;
  onOpenMcpConnections: () => void;
  onExportUserData: () => Promise<{ truncated: boolean }>;
  onRevokeAllSessions: () => Promise<void>;
  onDeleteUserData: () => Promise<void>;
}) {
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [mobileDetail, setMobileDetail] = useState(false);
  const [themeStatus, setThemeStatus] = useState("");
  const [exportPending, setExportPending] = useState(false);
  const [accountStatus, setAccountStatus] = useState("");
  const [accountError, setAccountError] = useState("");
  const [confirmation, setConfirmation] = useState<"sessions" | "delete" | null>(null);
  const centerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setMobileDetail(false);
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || nestedOpen || confirmation) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const center = centerRef.current;
      if (!center) return;
      const focusable = [...center.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      )].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !center.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmation, nestedOpen, onClose, open]);

  if (!open) return null;

  const selectSection = (next: SettingsSection) => {
    setSection(next);
    setMobileDetail(true);
  };
  const changeTheme = (next: ThemePreference) => {
    const persisted = onThemePreferenceChange(next);
    setThemeStatus(persisted ? "已保存" : "当前主题已应用，但浏览器未能保存偏好");
  };
  const exportData = async () => {
    if (busy || exportPending) return;
    setExportPending(true);
    setAccountStatus("");
    setAccountError("");
    try {
      const result = await onExportUserData();
      setAccountStatus(result.truncated ? "导出已下载；较早内容因文件大小限制已省略。" : "导出已开始下载。");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "数据导出失败，请稍后重试。");
    } finally {
      setExportPending(false);
    }
  };

  return (
    <div className="member-settings-layer">
      <section ref={centerRef} className={`member-settings-center ${mobileDetail ? "mobile-detail-open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="member-settings-title">
        <div className="member-settings-layout">
          <nav className="member-settings-nav" aria-label="设置分区">
            <div className="settings-nav-header">
              <ProductBrand meta="BIAU PORT · Chatus" />
              <button ref={closeRef} className="settings-close-button" type="button" onClick={onClose} title="返回对话" aria-label="返回对话"><ArrowLeft size={15} /><span>返回对话</span></button>
            </div>
            <h1 id="member-settings-title">设置</h1>
            <div className="settings-nav-list">
              <SettingsNavButton active={section === "appearance"} label="外观" detail={themePreferenceLabel(themePreference)} onClick={() => selectSection("appearance")} />
              {session.capabilities.memory && <SettingsNavButton active={section === "memory"} label="记忆" detail="查看和管理 Agent 记忆" onClick={() => selectSection("memory")} />}
              {session.access === "member" && <SettingsNavButton active={section === "connections"} label="连接" detail={`MCP · ${connectedMcpCount} 已连接`} onClick={() => selectSection("connections")} />}
              {session.capabilities.accountData && <SettingsNavButton active={section === "account"} label="账户与数据" detail="导出、会话和删除" onClick={() => selectSection("account")} />}
              {session.capabilities.accountData && <SettingsNavButton active={section === "sessions"} label="会话与设备" detail="查看与撤销登录会话" onClick={() => selectSection("sessions")} />}
            </div>
            <p className="settings-nav-footer">{session.displayName} · 当前设备</p>
          </nav>
          <div className="member-settings-detail">
            <button className="settings-mobile-back" type="button" onClick={() => setMobileDetail(false)} aria-label="返回设置列表"><ArrowLeft size={17} /><span>设置</span></button>
            {section === "appearance" && (
              <SettingsDetail id="appearance" title="外观" description="选择 Chatus 在当前设备上的显示方式。默认跟随系统设置。">
                <fieldset className="theme-choice">
                  <legend>主题</legend>
                  <small>偏好保存在当前浏览器，系统模式会随操作系统切换。</small>
                  <div role="group" aria-label="主题">
                    <ThemeButton active={themePreference === "follow-system"} label="跟随系统" onClick={() => changeTheme("follow-system")} />
                    <ThemeButton active={themePreference === "light"} label="浅色" onClick={() => changeTheme("light")} />
                    <ThemeButton active={themePreference === "dark"} label="深色" onClick={() => changeTheme("dark")} />
                  </div>
                </fieldset>
                <p className="preference-save-state" role="status" aria-live="polite">{themeStatus || "\u00a0"}</p>
                <section className="theme-preview-section" aria-label="工作台预览">
                  <h3>工作台预览</h3>
                  <div className="theme-preview">
                    <aside><strong>泊语 HarborTalk</strong><span>设计评审</span></aside>
                    <div>
                      <strong>干净、稳定、适合长期工作</strong>
                      <p>中性画布承载内容，cobalt 只用于动作与选中状态。弱边界保持结构，留白建立层级。</p>
                      <span className="theme-preview-message">主题变化不改变信息架构和组件密度。</span>
                      <span className="theme-preview-composer">发送消息…<i aria-hidden="true" /></span>
                    </div>
                  </div>
                </section>
              </SettingsDetail>
            )}
            {section === "memory" && session.capabilities.memory && (
              <SettingsDetail id="memory" title="记忆" description="查看和维护 Agent 可在相关任务中参考的稳定偏好与背景。">
                <div className="settings-action-row">
                  <div><Brain size={18} /><span><strong>长期记忆编辑器</strong><small>保留现有版本冲突和本地草稿保护。</small></span></div>
                  <button className="quiet-button icon-text-button" type="button" onClick={onOpenMemory} disabled={busy}><Brain size={15} /><span>编辑记忆</span></button>
                </div>
              </SettingsDetail>
            )}
            {section === "connections" && session.access === "member" && (
              <SettingsDetail id="connections" title="连接" description="连接和维护当前成员可用的 MCP 服务。授权、发现和撤销均需明确执行。">
                <div className="settings-action-row">
                  <div><Cable size={18} /><span><strong>MCP 连接</strong><small>{session.mcpConnections.length} 个可用服务，{connectedMcpCount} 个已连接。</small></span></div>
                  <button className="quiet-button icon-text-button" type="button" onClick={onOpenMcpConnections} disabled={busy}><Cable size={15} /><span>管理连接</span></button>
                </div>
              </SettingsDetail>
            )}
            {section === "account" && session.capabilities.accountData && (
              <SettingsDetail id="account" title="账户与数据" description="管理导出、登录会话和账户数据。">
                <div className="settings-usage-summary"><span>今日剩余</span><strong>{session.usage.remaining}</strong><small>已使用 {session.usage.used} / {session.usage.limit}</small></div>
                <div className="settings-operation-list">
                  <button type="button" onClick={() => void exportData()} disabled={busy || exportPending}><Download size={17} /><span><strong>{exportPending ? "正在导出" : "导出我的数据"}</strong><small>下载当前账户和对话数据的副本。</small></span></button>
                  <button className="danger" type="button" onClick={() => setConfirmation("delete")} disabled={busy}><Trash2 size={17} /><span><strong>删除账户数据</strong><small>永久删除个人数据并退出所有设备。</small></span></button>
                </div>
                {accountStatus && <p className="account-status" role="status">{accountStatus}</p>}
                {accountError && <p className="account-status error" role="alert">{accountError}</p>}
              </SettingsDetail>
            )}
            {section === "sessions" && session.capabilities.accountData && (
              <SettingsDetail id="sessions" title="会话与设备" description="当前版本提供全量会话撤销；不会展示无法由现有接口验证的设备详情。">
                <div className="settings-action-row">
                  <div><Laptop size={18} /><span><strong>当前浏览器</strong><small>正在使用的成员会话</small></span></div>
                  <span className="current-session-state">当前</span>
                </div>
                <div className="settings-operation-list">
                  <button type="button" onClick={() => setConfirmation("sessions")} disabled={busy}><LogOut size={17} /><span><strong>注销所有设备</strong><small>撤销当前成员的全部登录会话。</small></span></button>
                </div>
              </SettingsDetail>
            )}
          </div>
        </div>
      </section>
      {confirmation && (
        <ConfirmDialog
          title={confirmation === "delete" ? "删除账户数据？" : "注销所有设备？"}
          description={confirmation === "delete"
            ? "该操作不可撤销。聊天记录、长期记忆、用量和反馈只会在服务器确认成功后删除；访问权限仍保留。"
            : "所有设备的登录会话会立即注销，聊天记录、长期记忆和访问权限不会改变。"}
          confirmLabel={confirmation === "delete" ? "确认删除" : "确认注销"}
          pendingLabel="处理中..."
          tone={confirmation === "delete" ? "danger" : "default"}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmation === "delete" ? onDeleteUserData : onRevokeAllSessions}
        />
      )}
    </div>
  );
}

function SettingsNavButton({ active, label, detail, onClick }: {
  active: boolean;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick}>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>
  );
}

function SettingsDetail({ id, title, description, children }: { id: SettingsSection; title: string; description: string; children: ReactNode }) {
  return (
    <section className="settings-detail-section" aria-labelledby={`settings-${id}`}>
      <header><h2 id={`settings-${id}`}>{title}</h2><span>{description}</span></header>
      <div className="settings-detail-body">{children}</div>
    </section>
  );
}

function ThemeButton({ active, label, onClick }: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return <button type="button" aria-label={label} aria-pressed={active} onClick={onClick}>{label}</button>;
}

function themePreferenceLabel(preference: ThemePreference): string {
  if (preference === "light") return "浅色 · 当前设备";
  if (preference === "dark") return "深色 · 当前设备";
  return "跟随系统 · 当前设备";
}
