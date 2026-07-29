import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  HeartPulse,
  KeyRound,
  Network,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import type { AdminSetupStatus, AdminSetupStep } from "../lib/api";

export type AdminSetupTarget = "providers" | "models" | "members";

type SetupItem = {
  key: keyof AdminSetupStatus["steps"];
  label: string;
  icon: typeof HeartPulse;
  target?: AdminSetupTarget;
  actionLabel?: string;
};

const SETUP_ITEMS: SetupItem[] = [
  { key: "health", label: "运行健康", icon: HeartPulse },
  { key: "provider", label: "Provider 密钥", icon: KeyRound, target: "providers", actionLabel: "打开服务商" },
  { key: "model", label: "Logical model / offering", icon: Network, target: "models", actionLabel: "打开逻辑模型" },
  { key: "member", label: "首位成员", icon: UserPlus, target: "members", actionLabel: "创建成员" },
  { key: "permission", label: "成员权限", icon: ShieldCheck, target: "members", actionLabel: "配置权限" },
  { key: "smoke", label: "无模型 smoke", icon: CheckCircle2 },
];

export function AdminSetupGuide({
  status,
  checking,
  onNavigate,
  onRefresh,
  onRunSmoke,
}: {
  status: AdminSetupStatus;
  checking: boolean;
  onNavigate: (target: AdminSetupTarget) => void;
  onRefresh: () => void;
  onRunSmoke: () => void;
}) {
  return (
    <section className="typed-admin-setup" aria-labelledby="typed-admin-setup-title">
      <header className="typed-admin-setup-header">
        <div>
          <p className="typed-admin-eyebrow">{status.configSource.toUpperCase()} CONFIG</p>
          <h1 id="typed-admin-setup-title">首次配置</h1>
        </div>
        <div className={`typed-admin-setup-summary ${status.ready ? "ready" : "pending"}`} role="status">
          {status.ready ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
          <span>{status.ready ? "全部就绪" : `${readyStepCount(status)} / ${SETUP_ITEMS.length} 已就绪`}</span>
        </div>
      </header>

      <ol className="typed-admin-setup-list">
        {SETUP_ITEMS.map((item, index) => {
          const step = status.steps[item.key];
          const Icon = item.icon;
          const target = item.target;
          const smokeBlocked = item.key === "smoke" && step.status === "blocked";
          return (
            <li className={step.ready ? "ready" : "pending"} key={item.key}>
              <span className="typed-admin-setup-index" aria-hidden="true">{step.ready ? <CheckCircle2 size={18} /> : index + 1}</span>
              <span className="typed-admin-setup-icon" aria-hidden="true"><Icon size={18} /></span>
              <span className="typed-admin-setup-copy">
                <strong>{item.label}</strong>
                <small>{setupStatusLabel(step)}</small>
              </span>
              <span className="typed-admin-setup-count">{step.count}</span>
              {target ? (
                <button className="quiet-button icon-text-button" type="button" onClick={() => onNavigate(target)}>
                  <span>{item.actionLabel}</span><ArrowRight size={15} />
                </button>
              ) : item.key === "health" ? (
                <button className="quiet-button icon-text-button" type="button" onClick={onRefresh} disabled={checking}>
                  <RefreshCw size={15} /><span>{checking ? "检查中..." : "重新检查"}</span>
                </button>
              ) : (
                <button
                  className="primary-button icon-text-button"
                  type="button"
                  onClick={onRunSmoke}
                  disabled={checking || smokeBlocked}
                >
                  <ShieldCheck size={15} /><span>{checking ? "检查中..." : step.ready ? "重新运行" : "运行 smoke"}</span>
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function readyStepCount(status: AdminSetupStatus): number {
  return Object.values(status.steps).filter((step) => step.ready).length;
}

function setupStatusLabel(step: AdminSetupStep): string {
  switch (step.status) {
    case "ready": return "已就绪";
    case "blocked": return "等待前置步骤";
    case "not_run": return "尚未运行";
    case "stale": return "配置已变化，需重新运行";
    case "incomplete": return "待完成";
  }
}
