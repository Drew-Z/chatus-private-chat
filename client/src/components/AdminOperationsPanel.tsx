import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowRight, BookOpenText, ChevronLeft, ChevronRight, CircleDollarSign, Gauge, ListChecks, MessageSquareText, ReceiptText, RefreshCw, RotateCcw, Route, ScrollText, ShieldCheck, ThumbsDown, ThumbsUp, TriangleAlert, Users, X } from "lucide-react";
import {
  ApiError,
  adminLegacySurfaceRequiredEvidence,
  advanceAdminLegacySurface,
  createAdminProviderBudgetPolicy,
  createAdminProviderPriceCatalog,
  fetchAdminOperations,
  importAdminProviderReconciliation,
  reconcileAdminProviderBudgetReservation,
  rollbackAdminLegacySurface,
  type AdminAuditEntry,
  type AdminFeedbackEntry,
  type AdminLegacySurfaceAction,
  type AdminLegacySurfaceAdvanceInput,
  type AdminLegacySurfaceEvidence,
  type AdminLegacySurfacePhase,
  type AdminLegacySurfaceProjection,
  type AdminLegacySurfaceRollbackInput,
  type AdminOperationsSnapshot,
  type AdminProviderBudgetOperatorAction,
  type AdminProviderBudgetPolicyInput,
  type AdminProviderBudgetReservation,
  type AdminProviderFinanceAttempt,
  type AdminProviderFinanceProvider,
  type AdminProviderPriceCatalog,
  type AdminProviderReconciliationInput,
  type ModelMonitorSnapshot,
} from "../lib/api";
import { ConfirmDialog } from "./ConfirmDialog";

type Notice = { kind: "success" | "warning" | "error"; text: string };

type AdminOperationsPanelProps = {
  onSessionExpired: () => void;
  onNotice: (notice: Notice | null) => void;
  onDirtyChange: (dirty: boolean) => void;
  refreshKey?: number;
};

type OperationsViewState =
  | { status: "loading" }
  | { status: "ready"; snapshot: AdminOperationsSnapshot; refreshing: boolean }
  | { status: "error"; message: string };

type OperationsList = "legacySurfaces" | "routes" | "feedback" | "audit" | "users" | "providers" | "catalogs" | "financeAttempts" | "reconciliations" | "budgetPolicies" | "budgetBalances" | "budgetReservations";
type OperationsPages = Record<OperationsList, number>;

type FinanceActions = {
  createPrice: (input: AdminProviderPriceCatalog) => Promise<void>;
  importReconciliation: (input: AdminProviderReconciliationInput) => Promise<void>;
  createBudgetPolicy: (input: AdminProviderBudgetPolicyInput) => Promise<void>;
  reconcileBudgetReservation: (input: AdminProviderBudgetOperatorAction) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

type LegacySurfaceActions = {
  advance: (input: AdminLegacySurfaceAdvanceInput) => Promise<void>;
  rollback: (input: AdminLegacySurfaceRollbackInput) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

type LegacySurfaceEvidenceDraft = {
  kind: AdminLegacySurfaceEvidence["kind"];
  evidenceId: string;
  digest: string;
  deploymentSha: string;
  observedAt: string;
  count: string;
  result: AdminLegacySurfaceEvidence["result"];
};

export type LegacySurfaceTransitionDraft = {
  surfaceId: string;
  expectedRevision: number;
  fromPhase: AdminLegacySurfacePhase;
  operationId: string;
  action: AdminLegacySurfaceAction;
  rollbackReason: AdminLegacySurfaceRollbackInput["reason"];
  evidence: LegacySurfaceEvidenceDraft[];
};

type PreparedLegacySurfaceTransition = AdminLegacySurfaceAdvanceInput | AdminLegacySurfaceRollbackInput;

export const OPERATIONS_PAGE_SIZE = 20;

export function AdminOperationsPanel({ onSessionExpired, onNotice, onDirtyChange, refreshKey = 0 }: AdminOperationsPanelProps) {
  const [viewState, setViewState] = useState<OperationsViewState>({ status: "loading" });
  const [filter, setFilter] = useState("");
  const refreshGeneration = useRef(0);
  const loading = viewState.status === "loading" || (viewState.status === "ready" && viewState.refreshing);

  useEffect(() => {
    onDirtyChange(false);
    void refresh();
  }, [refreshKey]);

  async function refresh(): Promise<boolean> {
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    setViewState((current) => current.status === "ready"
      ? { ...current, refreshing: true }
      : { status: "loading" });
    try {
      const snapshot = await fetchAdminOperations();
      if (generation !== refreshGeneration.current) return false;
      setViewState({ status: "ready", snapshot, refreshing: false });
      onNotice(null);
      return true;
    } catch (error) {
      if (generation !== refreshGeneration.current) return false;
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return false;
      }
      const message = error instanceof Error ? error.message : "暂时无法读取运营数据。";
      setViewState((current) => current.status === "ready"
        ? { ...current, refreshing: false }
        : { status: "error", message });
      onNotice({ kind: "error", text: message });
      return false;
    }
  }

  async function runFinanceMutation(action: () => Promise<unknown>, successText: string) {
    try {
      await action();
      if (!await refresh()) throw new Error("操作已提交，但暂时无法刷新权威数据。请重试确认以恢复状态。");
      onNotice({ kind: "success", text: successText });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      throw error;
    }
  }

  async function runLegacySurfaceMutation(action: () => Promise<unknown>, successText: string) {
    try {
      await action();
      if (!await refresh()) throw new Error("治理操作已提交，但暂时无法刷新权威状态。请重试确认。");
      onNotice({ kind: "success", text: successText });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSessionExpired();
      throw error;
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
      {viewState.status === "loading" ? (
        <div className="admin-pool-empty-state" role="status"><p>正在读取运营数据...</p></div>
      ) : viewState.status === "error" ? (
        <div className="typed-admin-panel-state admin-load-error" role="alert">
          <h2>无法读取运营数据</h2>
          <p>{viewState.message}</p>
          <button className="primary-button icon-text-button" type="button" onClick={() => void refresh()}>
            <RefreshCw size={15} /><span>重试读取运营数据</span>
          </button>
        </div>
      ) : (
        <AdminOperationsContent
          snapshot={viewState.snapshot}
          filter={filter}
          financeActions={{
            createPrice: (input) => runFinanceMutation(
              () => createAdminProviderPriceCatalog(input),
              "价格目录已保存。",
            ),
            importReconciliation: (input) => runFinanceMutation(
              () => importAdminProviderReconciliation(input),
              "Provider 对账摘要已导入。",
            ),
            createBudgetPolicy: (input) => runFinanceMutation(
              () => createAdminProviderBudgetPolicy(input),
              "Provider 预算策略已保存。",
            ),
            reconcileBudgetReservation: (input) => runFinanceMutation(
              () => reconcileAdminProviderBudgetReservation(input),
              input.action === "release" ? "Provider 预算占用已人工释放。" : "Provider 预算占用已人工对账。",
            ),
            onDirtyChange,
          }}
          legacySurfaceActions={{
            advance: (input) => runLegacySurfaceMutation(
              () => advanceAdminLegacySurface(input),
              `旧功能面 ${input.surfaceId} 已推进到 ${legacySurfacePhaseLabel(input.targetPhase)}。`,
            ),
            rollback: (input) => runLegacySurfaceMutation(
              () => rollbackAdminLegacySurface(input),
              `旧功能面 ${input.surfaceId} 已完成${input.scope === "read" ? "读取" : "写入"}回滚。`,
            ),
            onDirtyChange,
          }}
        />
      )}
    </section>
  );
}

export function AdminOperationsContent({
  snapshot,
  filter = "",
  financeActions,
  legacySurfaceActions,
}: {
  snapshot: AdminOperationsSnapshot;
  filter?: string;
  financeActions?: FinanceActions;
  legacySurfaceActions?: LegacySurfaceActions;
}) {
  const query = filter.trim().toLocaleLowerCase();
  const [pages, setPages] = useState<OperationsPages>({
    legacySurfaces: 1,
    routes: 1,
    feedback: 1,
    audit: 1,
    users: 1,
    providers: 1,
    catalogs: 1,
    financeAttempts: 1,
    reconciliations: 1,
    budgetPolicies: 1,
    budgetBalances: 1,
    budgetReservations: 1,
  });
  const [priceDirty, setPriceDirty] = useState(false);
  const [reconciliationDirty, setReconciliationDirty] = useState(false);
  const [budgetPolicyDirty, setBudgetPolicyDirty] = useState(false);
  const [budgetActionDirty, setBudgetActionDirty] = useState(false);
  const [legacySurfaceDraft, setLegacySurfaceDraft] = useState<LegacySurfaceTransitionDraft | null>(null);
  const [preparedLegacySurfaceTransition, setPreparedLegacySurfaceTransition] = useState<PreparedLegacySurfaceTransition | null>(null);
  const [legacySurfaceConfirmationOpen, setLegacySurfaceConfirmationOpen] = useState(false);
  const [legacySurfaceValidationError, setLegacySurfaceValidationError] = useState("");
  const maxRequests = Math.max(1, ...snapshot.stats.trend.map((item) => item.requests));
  const users = useMemo(() => snapshot.stats.users.filter((user) => matchesQuery(query, user.label, user.displayName, user.defaultRoute)), [query, snapshot.stats.users]);
  const routes = useMemo(() => snapshot.stats.routeStats.filter((route) => matchesQuery(query, route.id, route.label, route.model)), [query, snapshot.stats.routeStats]);
  const audit = useMemo(() => snapshot.audit.filter((entry) => matchesQuery(query, entry.action, auditAction(entry), entry.target)), [query, snapshot.audit]);
  const feedback = useMemo(() => snapshot.feedback.filter((entry) => matchesQuery(query, entry.label, entry.routeId, entry.reason, feedbackReason(entry.reason))), [query, snapshot.feedback]);
  const financeProviders = useMemo(() => snapshot.finance.providers.filter((provider) => matchesQuery(query, provider.providerId, provider.label)), [query, snapshot.finance.providers]);
  const catalogs = useMemo(() => snapshot.finance.providers.flatMap((provider) => provider.catalogs
    .filter((catalog) => matchesQuery(query, provider.providerId, provider.label, catalog.catalogVersionId, catalog.offeringId, catalog.model, catalog.currency))
    .map((catalog) => ({ provider, catalog }))), [query, snapshot.finance.providers]);
  const financeAttempts = useMemo(() => snapshot.finance.providers.flatMap((provider) => provider.attempts
    .filter((attempt) => matchesQuery(query, provider.providerId, provider.label, attempt.logicalRouteId, attempt.model, attempt.usageState, attempt.costState))
    .map((attempt) => ({ provider, attempt }))), [query, snapshot.finance.providers]);
  const reconciliations = useMemo(() => snapshot.finance.providers.flatMap((provider) => provider.reconciliations
    .filter((entry) => matchesQuery(query, provider.providerId, provider.label, entry.currency, entry.status))
    .map((entry) => ({ provider, entry }))), [query, snapshot.finance.providers]);
  const budgetPolicies = useMemo(() => snapshot.finance.providers.flatMap((provider) => provider.budgetPolicies
    .filter((policy) => matchesQuery(query, provider.providerId, provider.label, policy.policyId, policy.currency, policy.mode))
    .map((policy) => ({ provider, policy }))), [query, snapshot.finance.providers]);
  const budgetBalances = useMemo(() => snapshot.finance.providers.flatMap((provider) => provider.budgetBalances
    .filter((balance) => matchesQuery(query, provider.providerId, provider.label, balance.policyId, balance.currency, balance.mode))
    .map((balance) => ({ provider, balance }))), [query, snapshot.finance.providers]);
  const budgetReservations = useMemo(() => snapshot.finance.providers.flatMap((provider) => provider.budgetReservations
    .filter((reservation) => matchesQuery(query, provider.providerId, provider.label, reservation.policyId, reservation.currency, reservation.status))
    .map((reservation) => ({ provider, reservation }))), [query, snapshot.finance.providers]);
  const legacySurfaces = useMemo(() => snapshot.legacySurfaces.surfaces.filter((surface) => matchesQuery(
    query,
    surface.surfaceId,
    surface.phase,
    surface.owner,
    surface.readControl,
    surface.writeControl,
    ...surface.blockerCodes,
  )), [query, snapshot.legacySurfaces.surfaces]);
  const legacySurfacePage = paginateOperations(legacySurfaces, pages.legacySurfaces);
  const routePage = paginateOperations(routes, pages.routes);
  const feedbackPage = paginateOperations(feedback, pages.feedback);
  const auditPage = paginateOperations(audit, pages.audit);
  const userPage = paginateOperations(users, pages.users);
  const providerPage = paginateOperations(financeProviders, pages.providers);
  const catalogPage = paginateOperations(catalogs, pages.catalogs);
  const financeAttemptPage = paginateOperations(financeAttempts, pages.financeAttempts);
  const reconciliationPage = paginateOperations(reconciliations, pages.reconciliations);
  const budgetPolicyPage = paginateOperations(budgetPolicies, pages.budgetPolicies);
  const budgetBalancePage = paginateOperations(budgetBalances, pages.budgetBalances);
  const budgetReservationPage = paginateOperations(budgetReservations, pages.budgetReservations);

  useEffect(() => {
    setPages({ legacySurfaces: 1, routes: 1, feedback: 1, audit: 1, users: 1, providers: 1, catalogs: 1, financeAttempts: 1, reconciliations: 1, budgetPolicies: 1, budgetBalances: 1, budgetReservations: 1 });
  }, [query]);

  useEffect(() => {
    const dirty = priceDirty || reconciliationDirty || budgetPolicyDirty || budgetActionDirty || Boolean(legacySurfaceDraft);
    financeActions?.onDirtyChange(dirty);
    legacySurfaceActions?.onDirtyChange(dirty);
    return () => {
      financeActions?.onDirtyChange(false);
      legacySurfaceActions?.onDirtyChange(false);
    };
  }, [financeActions, legacySurfaceActions, legacySurfaceDraft, priceDirty, reconciliationDirty, budgetPolicyDirty, budgetActionDirty]);

  function setPage(list: OperationsList, page: number) {
    setPages((current) => ({ ...current, [list]: page }));
  }

  function startLegacySurfaceTransition(surface: AdminLegacySurfaceProjection, action: AdminLegacySurfaceAction) {
    if (legacySurfaceDraft) return;
    setLegacySurfaceDraft(emptyLegacySurfaceTransitionDraft(surface, action));
    setPreparedLegacySurfaceTransition(null);
    setLegacySurfaceValidationError("");
  }

  function updateLegacySurfaceEvidence<K extends keyof LegacySurfaceEvidenceDraft>(
    index: number,
    key: K,
    value: LegacySurfaceEvidenceDraft[K],
  ) {
    setLegacySurfaceDraft((current) => current ? {
      ...current,
      evidence: current.evidence.map((entry, entryIndex) => entryIndex === index
        ? { ...entry, [key]: value }
        : entry),
    } : current);
    setPreparedLegacySurfaceTransition(null);
    setLegacySurfaceValidationError("");
  }

  function reviewLegacySurfaceTransition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!legacySurfaceDraft) return;
    try {
      const prepared = prepareLegacySurfaceTransition(legacySurfaceDraft);
      setPreparedLegacySurfaceTransition(prepared);
      setLegacySurfaceConfirmationOpen(true);
      setLegacySurfaceValidationError("");
    } catch (error) {
      setLegacySurfaceValidationError(error instanceof Error ? error.message : "治理证据格式无效。");
    }
  }

  async function confirmLegacySurfaceTransition() {
    if (!preparedLegacySurfaceTransition || !legacySurfaceActions) throw new Error("治理操作草稿已失效，请重新检查。");
    if ("targetPhase" in preparedLegacySurfaceTransition) {
      await legacySurfaceActions.advance(preparedLegacySurfaceTransition);
    } else {
      await legacySurfaceActions.rollback(preparedLegacySurfaceTransition);
    }
    setLegacySurfaceDraft(null);
    setPreparedLegacySurfaceTransition(null);
    setLegacySurfaceValidationError("");
  }

  function cancelLegacySurfaceTransition() {
    setLegacySurfaceConfirmationOpen(false);
    setPreparedLegacySurfaceTransition(null);
    setLegacySurfaceDraft(null);
    setLegacySurfaceValidationError("");
  }

  const summary: Array<{ label: string; value: string | number }> = [
    { label: "7 日请求", value: snapshot.stats.totals.requests },
    { label: "错误", value: snapshot.stats.totals.errors },
    { label: "错误率", value: `${snapshot.stats.totals.errorRate}%` },
    { label: "Fallback", value: snapshot.stats.totals.fallbacks },
    { label: "限流", value: snapshot.stats.totals.rateLimited },
    { label: "Provider 调用", value: snapshot.finance.providers.reduce((total, provider) => total + provider.capacity.calls, 0) },
    { label: "Usage 未知", value: snapshot.finance.providers.reduce((total, provider) => total + provider.capacity.unknownUsageAttempts, 0) },
    { label: "预算待结算", value: snapshot.finance.providers.reduce((total, provider) => total + provider.budgetBalances.reduce((sum, balance) => sum + balance.pendingSettlementCount, 0), 0) },
    { label: "预算待复核", value: snapshot.finance.providers.reduce((total, provider) => total + provider.budgetBalances.reduce((sum, balance) => sum + balance.reviewRequiredCount, 0), 0) },
    { label: "治理面", value: snapshot.legacySurfaces.total },
  ];

  return (
    <div className="admin-operations-content">
      <dl className="admin-operations-summary" aria-label="7 日运营摘要">
        {summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>

      <OperationsSection
        icon={<Activity size={17} />}
        title="模型监控 · 最近 24 小时"
        meta={snapshot.modelMonitor ? `生成于 ${formatMonitorTime(snapshot.modelMonitor.generatedAt)} · 滚动窗口` : "暂无监控快照"}
      >
        {snapshot.modelMonitor ? (
          <ModelMonitorSection snapshot={snapshot.modelMonitor} />
        ) : (
          <p className="typed-admin-empty">模型监控暂时不可用；不影响现有运营统计和消息发送。</p>
        )}
      </OperationsSection>

      <OperationsSection icon={<ListChecks size={17} />} title="旧功能面治理" meta={pageCountMeta(legacySurfacePage)}>
        <div className="legacy-surface-list">
          {legacySurfacePage.items.map((surface) => (
            <div className="legacy-surface-row" key={surface.surfaceId}>
              <div className="legacy-surface-identity">
                <strong>{surface.surfaceId}</strong>
                <span className={`legacy-surface-phase phase-${surface.phase}`}>{legacySurfacePhaseLabel(surface.phase)}</span>
              </div>
              <dl className="legacy-surface-facts">
                <div><dt>读取</dt><dd>{legacySurfaceControlLabel(surface.readControl)}</dd></div>
                <div><dt>写入</dt><dd>{legacySurfaceControlLabel(surface.writeControl)}</dd></div>
                <div><dt>负责人</dt><dd>{legacySurfaceOwnerLabel(surface.owner)}</dd></div>
                <div><dt>证据</dt><dd>{surface.evidence.present} / {surface.evidence.required}{surface.evidence.complete ? " · 完整" : " · 待补"}</dd></div>
                <div><dt>观察</dt><dd>{legacySurfaceObservationLabel(surface)}</dd></div>
                <div><dt>部署</dt><dd>{surface.lastDeploymentSha || "未记录"}</dd></div>
                <div><dt>修订</dt><dd>{surface.revision}</dd></div>
              </dl>
              <div className="legacy-surface-blockers">
                {surface.blockerCodes.length
                  ? surface.blockerCodes.map((blocker) => <span key={blocker}>{legacySurfaceBlockerLabel(blocker)}</span>)
                  : <span className="clear">无阻塞项</span>}
              </div>
              <div className="legacy-surface-actions">
                {legacySurfaceActions && surface.allowedActions.map((action) => (
                  <button
                    className="quiet-button icon-text-button"
                    type="button"
                    key={legacySurfaceActionKey(action)}
                    onClick={() => startLegacySurfaceTransition(surface, action)}
                    disabled={Boolean(legacySurfaceDraft)}
                  >
                    {action.kind === "advance" ? <ArrowRight size={15} /> : <RotateCcw size={15} />}
                    <span>{legacySurfaceActionLabel(action)}</span>
                  </button>
                ))}
                {!surface.allowedActions.length && <small>当前无已授权操作</small>}
              </div>
            </div>
          ))}
          {!legacySurfacePage.total && <p className="typed-admin-empty">没有匹配的旧功能面</p>}
        </div>
        <PaginationControls label="旧功能面治理" page={legacySurfacePage} onPageChange={(page) => setPage("legacySurfaces", page)} />

        {legacySurfaceDraft && legacySurfaceActions && (
          <form className="legacy-surface-transition-form" onSubmit={reviewLegacySurfaceTransition}>
            <header>
              <div>
                <h3>{legacySurfaceDraft.surfaceId}</h3>
                <p>{legacySurfacePhaseLabel(legacySurfaceDraft.fromPhase)} → {legacySurfaceActionTargetLabel(legacySurfaceDraft.action)}</p>
              </div>
              <button className="icon-button" type="button" onClick={cancelLegacySurfaceTransition} aria-label="取消旧功能面操作" title="取消"><X size={17} /></button>
            </header>
            {legacySurfaceDraft.action.kind === "rollback" && (
              <label className="legacy-surface-reason"><span>回滚原因</span><select
                value={legacySurfaceDraft.rollbackReason}
                onChange={(event) => {
                  setLegacySurfaceDraft((current) => current ? { ...current, rollbackReason: event.target.value as AdminLegacySurfaceRollbackInput["reason"] } : current);
                  setPreparedLegacySurfaceTransition(null);
                }}
              >
                <option value="control_failure">控制失效</option>
                <option value="evidence_invalidated">证据失效</option>
                <option value="parity_regression">一致性回退</option>
                <option value="recovery_failure">恢复失败</option>
                <option value="runtime_regression">运行回退</option>
              </select></label>
            )}
            <div className="legacy-surface-evidence-list">
              {legacySurfaceDraft.evidence.map((evidence, index) => (
                <fieldset key={evidence.kind}>
                  <legend>{legacySurfaceEvidenceKindLabel(evidence.kind)}</legend>
                  <div className="admin-form-grid two">
                    <label><span>证据 ID</span><input value={evidence.evidenceId} maxLength={160} onChange={(event) => updateLegacySurfaceEvidence(index, "evidenceId", event.target.value)} required /></label>
                    <label><span>结果</span><select value={evidence.result} onChange={(event) => updateLegacySurfaceEvidence(index, "result", event.target.value as LegacySurfaceEvidenceDraft["result"])}><option value="passed">通过</option><option value="complete">完成</option><option value="approved">已批准</option></select></label>
                    <label className="admin-form-wide"><span>SHA-256 摘要</span><input value={evidence.digest} maxLength={64} pattern="[a-f0-9]{64}" onChange={(event) => updateLegacySurfaceEvidence(index, "digest", event.target.value)} required /></label>
                    <label className="admin-form-wide"><span>部署 Commit SHA</span><input value={evidence.deploymentSha} maxLength={40} pattern="[a-f0-9]{40}" onChange={(event) => updateLegacySurfaceEvidence(index, "deploymentSha", event.target.value)} required /></label>
                    <label><span>观察时间</span><input type="datetime-local" value={evidence.observedAt} onChange={(event) => updateLegacySurfaceEvidence(index, "observedAt", event.target.value)} required /></label>
                    <label><span>计数</span><input type="number" min="0" step="1" value={evidence.count} onChange={(event) => updateLegacySurfaceEvidence(index, "count", event.target.value)} required /></label>
                  </div>
                </fieldset>
              ))}
            </div>
            {legacySurfaceValidationError && <p className="form-message error" role="alert">{legacySurfaceValidationError}</p>}
            <div className="legacy-surface-form-actions">
              <button className="quiet-button icon-text-button" type="button" onClick={cancelLegacySurfaceTransition}><X size={15} /><span>取消</span></button>
              <button className="primary-button icon-text-button" type="submit"><ShieldCheck size={15} /><span>检查并确认</span></button>
            </div>
          </form>
        )}
      </OperationsSection>

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

        <OperationsSection icon={<Route size={17} />} title="逻辑模型结果" meta={pageCountMeta(routePage)}>
          <div className="operations-compact-list">
            {routePage.items.map((route) => (
              <div key={route.id}><span><strong>{route.label}</strong><small>{route.id}{route.model ? ` · ${route.model}` : ""}</small></span><em>成功 {route.ok7d} · 失败 {route.error7d} · {route.errorRate7d}%</em></div>
            ))}
            {!routePage.total && <p className="typed-admin-empty">没有匹配的线路统计</p>}
          </div>
          <PaginationControls label="逻辑模型结果" page={routePage} onPageChange={(page) => setPage("routes", page)} />
        </OperationsSection>

        <OperationsSection icon={<Gauge size={17} />} title="Provider 容量" meta={pageCountMeta(providerPage)}>
          <div className="operations-compact-list">
            {providerPage.items.map((provider) => (
              <div key={provider.providerId}>
                <span><strong>{provider.label}</strong><small>{provider.providerId} · Token {formatTokenTotal(provider)}</small></span>
                <em>调用 {provider.capacity.calls} · 失败 {provider.capacity.failures} · 重试 {provider.capacity.retries} · Fallback {provider.capacity.fallbacks} · 平均 {provider.capacity.averageLatencyMs === null ? "未知" : `${provider.capacity.averageLatencyMs} ms`} · Usage 未知 {provider.capacity.unknownUsageAttempts}</em>
              </div>
            ))}
            {!financeProviders.length && <p className="typed-admin-empty">没有匹配的 Provider 容量记录</p>}
          </div>
          <PaginationControls label="Provider 容量" page={providerPage} onPageChange={(page) => setPage("providers", page)} />
        </OperationsSection>

        <OperationsSection icon={<CircleDollarSign size={17} />} title="成本证据" meta="Provider 实例级预算 v1">
          <div className="operations-compact-list">
            {financeProviders.flatMap((provider) => provider.costs.map((cost) => (
              <div key={`${provider.providerId}:${cost.currency}`}>
                <span><strong>{provider.label} · {cost.currency}</strong><small>未知 {cost.unknownAttempts} 次</small></span>
                <em>暂估 {formatMicros(cost.provisionalMicros, cost.currency)} · 对账 {formatMicros(cost.settledMicros, cost.currency)} · 更正 {formatMicros(cost.correctedMicros, cost.currency)}</em>
              </div>
            )))}
            {!financeProviders.some((provider) => provider.costs.length) && <p className="typed-admin-empty">尚无可计算成本，缺失值保持未知</p>}
          </div>
        </OperationsSection>

        <OperationsSection icon={<ShieldCheck size={17} />} title="预算策略" meta={pageCountMeta(budgetPolicyPage)}>
          <div className="operations-compact-list">
            {budgetPolicyPage.items.map(({ provider, policy }) => (
              <div key={`${provider.providerId}:${policy.policyId}:${policy.policyVersion}`}>
                <span><strong>{provider.label} · {budgetModeLabel(policy.mode)}</strong><small>{policy.policyId} · 版本 {policy.policyVersion} · {policy.currency} · {formatShortDate(policy.periodStart)} 至 {formatShortDate(policy.periodEnd)}</small></span>
                <em>上限 {formatMicros(policy.limitMicros, policy.currency)} · 单次预留 {formatMicros(policy.maxAttemptReserveMicros, policy.currency)}</em>
              </div>
            ))}
            {!budgetPolicyPage.total && <p className="typed-admin-empty">尚无预算策略，Provider 调用保持 disabled 行为</p>}
          </div>
          <PaginationControls label="预算策略" page={budgetPolicyPage} onPageChange={(page) => setPage("budgetPolicies", page)} />
        </OperationsSection>

        <OperationsSection icon={<TriangleAlert size={17} />} title="预算余额与告警" meta={pageCountMeta(budgetBalancePage)}>
          <div className="operations-compact-list">
            {budgetBalancePage.items.map(({ provider, balance }) => (
              <div key={`${provider.providerId}:${balance.policyId}`}>
                <span><strong>{provider.label} · 可用 {formatMicros(balance.availableMicros, balance.currency)}</strong><small>{budgetModeLabel(balance.mode)} · 已结算 {formatMicros(balance.settledMicros, balance.currency)} · 已预留 {formatMicros(balance.reservedMicros, balance.currency)} · Hold {formatMicros(balance.heldMicros, balance.currency)}</small></span>
                <em>拒绝 {balance.denialCount} · 告警 {balance.alertCount} · 待结算 {balance.pendingSettlementCount} · 待复核 {balance.reviewRequiredCount}</em>
              </div>
            ))}
            {!budgetBalancePage.total && <p className="typed-admin-empty">尚无预算余额或告警</p>}
          </div>
          <PaginationControls label="预算余额与告警" page={budgetBalancePage} onPageChange={(page) => setPage("budgetBalances", page)} />
        </OperationsSection>

        <OperationsSection icon={<BookOpenText size={17} />} title="价格目录" meta={pageCountMeta(catalogPage)}>
          <div className="operations-compact-list">
            {catalogPage.items.map(({ provider, catalog }) => (
              <div key={`${provider.providerId}:${catalog.catalogVersionId}`}>
                <span><strong>{provider.label} · {catalog.model}</strong><small>{catalog.catalogVersionId} · {catalog.currency} / {catalog.unit}</small></span>
                <em>{formatCatalogPrice(catalog.inputNoCachePriceMicros, catalog.currency)} 输入 · 生效 {formatShortDate(catalog.effectiveFrom)}</em>
              </div>
            ))}
            {!catalogPage.total && <p className="typed-admin-empty">尚无价格目录</p>}
          </div>
          <PaginationControls label="价格目录" page={catalogPage} onPageChange={(page) => setPage("catalogs", page)} />
        </OperationsSection>

        <OperationsSection icon={<MessageSquareText size={17} />} title="成员反馈" meta={feedbackSummary(feedback, feedbackPage.displayed)}>
          <div className="operations-event-list">
            {feedbackPage.items.map((entry) => (
              <div key={entry.id}>
                <span className={`operations-event-marker ${entry.rating === "up" ? "positive" : "negative"}`}>
                  {entry.rating === "up" ? <ThumbsUp size={13} aria-hidden="true" /> : <ThumbsDown size={13} aria-hidden="true" />}
                  <span className="sr-only">{entry.rating === "up" ? "有帮助" : "无帮助"}</span>
                </span>
                <span><strong>{entry.label}</strong><small>{entry.routeId}{entry.reason ? ` · ${feedbackReason(entry.reason)}` : ""} · <time dateTime={entry.at}>{formatRelativeTime(entry.at)}</time></small></span>
              </div>
            ))}
            {!feedbackPage.total && <p className="typed-admin-empty">暂无匹配反馈</p>}
          </div>
          <PaginationControls label="成员反馈" page={feedbackPage} onPageChange={(page) => setPage("feedback", page)} />
        </OperationsSection>

        <OperationsSection icon={<ScrollText size={17} />} title="管理审计" meta={pageCountMeta(auditPage)}>
          <div className="operations-event-list">
            {auditPage.items.map((entry) => (
              <div key={entry.id}>
                <span className="operations-event-marker audit" aria-hidden="true" />
                <span><strong>{auditAction(entry)}</strong><small>{entry.target ? `${entry.target} · ` : ""}<time dateTime={entry.at}>{formatRelativeTime(entry.at)}</time></small></span>
              </div>
            ))}
            {!auditPage.total && <p className="typed-admin-empty">暂无匹配管理记录</p>}
          </div>
          <PaginationControls label="管理审计" page={auditPage} onPageChange={(page) => setPage("audit", page)} />
        </OperationsSection>
      </div>

      <OperationsSection icon={<Users size={17} />} title="成员用量" meta={pageCountMeta(userPage)}>
        <div className="operations-user-table-wrap">
          <table className="operations-user-table">
            <thead><tr><th scope="col">成员</th><th scope="col">今日用量</th><th scope="col">剩余</th><th scope="col">活跃会话</th><th scope="col">7 日请求</th><th scope="col">错误</th><th scope="col">记忆</th><th scope="col">默认模型</th></tr></thead>
            <tbody>{userPage.items.map((user) => (
              <tr key={user.label}>
                <td><strong>{user.displayName}</strong><small>{user.label}{user.enabled ? "" : " · 已暂停"}</small></td>
                <td>{user.used} / {user.dailyLimit}</td><td>{user.remaining}</td><td>{user.activeSessions}</td><td>{user.requests7d}</td><td>{user.errors7d} · {user.errorRate7d}%</td><td>{user.memoryChars} 字</td><td>{user.defaultRoute || "未设置"}</td>
              </tr>
            ))}</tbody>
          </table>
          {!userPage.total && <p className="typed-admin-empty">没有匹配成员</p>}
        </div>
        <PaginationControls label="成员用量" page={userPage} onPageChange={(page) => setPage("users", page)} />
      </OperationsSection>

      <OperationsSection icon={<Activity size={17} />} title="Provider 尝试" meta={pageCountMeta(financeAttemptPage)}>
        <div className="operations-user-table-wrap">
          <table className="operations-user-table">
            <thead><tr><th scope="col">Provider</th><th scope="col">逻辑模型</th><th scope="col">结果</th><th scope="col">Usage</th><th scope="col">成本</th><th scope="col">延迟</th><th scope="col">价格</th></tr></thead>
            <tbody>{financeAttemptPage.items.map(({ provider, attempt }) => (
              <tr key={attempt.attemptId}>
                <td><strong>{provider.label}</strong><small>{provider.providerId}</small></td>
                <td>{attempt.logicalRouteId}<small>{attempt.model}</small></td>
                <td>{attempt.status}<small>{attempt.errorClass}</small></td>
                <td>{financeUsageLabel(attempt)}<small>{formatAttemptTokens(attempt)}</small></td>
                <td>{financeCostLabel(attempt)}<small>{formatAttemptCosts(attempt)}</small></td>
                <td>{attempt.latencyMs === null ? "未知" : `${attempt.latencyMs} ms`}</td>
                <td>{attempt.priceResolution === "matched" ? "已绑定" : "缺失"}<small>{attempt.catalogVersionId || "无目录版本"} · {attempt.fallbackIndex > 0 ? `Fallback #${attempt.fallbackIndex}` : "首选"}</small></td>
              </tr>
            ))}</tbody>
          </table>
          {!financeAttemptPage.total && <p className="typed-admin-empty">暂无匹配 Provider 尝试</p>}
        </div>
        <PaginationControls label="Provider 尝试" page={financeAttemptPage} onPageChange={(page) => setPage("financeAttempts", page)} />
      </OperationsSection>

      <OperationsSection icon={<TriangleAlert size={17} />} title="预算占用与复核" meta={pageCountMeta(budgetReservationPage)}>
        <div className="operations-user-table-wrap">
          <table className="operations-user-table">
            <thead><tr><th scope="col">Provider</th><th scope="col">状态</th><th scope="col">预留</th><th scope="col">已结算</th><th scope="col">已释放</th><th scope="col">Hold</th><th scope="col">复核时间</th></tr></thead>
            <tbody>{budgetReservationPage.items.map(({ provider, reservation }) => (
              <tr key={reservation.reservationId}>
                <td><strong>{provider.label}</strong><small>{provider.providerId} · {reservation.policyId} · {reservation.reservationId}</small></td>
                <td>{budgetReservationStatusLabel(reservation.status)}<small>策略版本 {reservation.policyVersion}</small></td>
                <td>{formatMicros(reservation.reservedMicros, reservation.currency)}</td>
                <td>{formatMicros(reservation.settledMicros, reservation.currency)}</td>
                <td>{formatMicros(reservation.releasedMicros, reservation.currency)}</td>
                <td>{formatMicros(reservation.heldMicros, reservation.currency)}</td>
                <td>{formatShortDateTime(reservation.reviewAfter)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!budgetReservationPage.total && <p className="typed-admin-empty">暂无预算占用</p>}
        </div>
        <PaginationControls label="预算占用与复核" page={budgetReservationPage} onPageChange={(page) => setPage("budgetReservations", page)} />
      </OperationsSection>

      <OperationsSection icon={<ReceiptText size={17} />} title="Provider 对账" meta={pageCountMeta(reconciliationPage)}>
        <div className="operations-event-list">
          {reconciliationPage.items.map(({ provider, entry }) => (
            <div key={entry.reconciliationId}>
              <span className="operations-event-marker audit" aria-hidden="true" />
              <span><strong>{provider.label} · {reconciliationStatus(entry.status)} · 修订 {entry.revision}</strong><small>{entry.currency} · 报告 {formatMicros(entry.reportedTotalMicros, entry.currency)} · 匹配 {formatMicros(entry.matchedTotalMicros, entry.currency)} · 差异 {formatMicros(entry.unmatchedVarianceMicros, entry.currency)} · {entry.supersedesReconciliationId ? `继承 ${entry.supersedesReconciliationId}` : "初始导入"} · <time dateTime={new Date(entry.importedAt).toISOString()}>{formatRelativeTime(new Date(entry.importedAt).toISOString())}</time></small></span>
            </div>
          ))}
          {!reconciliationPage.total && <p className="typed-admin-empty">暂无对账摘要</p>}
        </div>
        <PaginationControls label="Provider 对账" page={reconciliationPage} onPageChange={(page) => setPage("reconciliations", page)} />
      </OperationsSection>

      {financeActions && (
        <AdminFinanceEntryTools
          providers={snapshot.finance.providers}
          onCreatePrice={async (input) => {
            await financeActions.createPrice(input);
            setPriceDirty(false);
          }}
          onImportReconciliation={async (input) => {
            await financeActions.importReconciliation(input);
            setReconciliationDirty(false);
          }}
          onPriceDirtyChange={setPriceDirty}
          onReconciliationDirtyChange={setReconciliationDirty}
          onCreateBudgetPolicy={async (input) => {
            await financeActions.createBudgetPolicy(input);
            setBudgetPolicyDirty(false);
          }}
          onReconcileBudgetReservation={async (input) => {
            await financeActions.reconcileBudgetReservation(input);
            setBudgetActionDirty(false);
          }}
          onBudgetPolicyDirtyChange={setBudgetPolicyDirty}
          onBudgetActionDirtyChange={setBudgetActionDirty}
        />
      )}
      {legacySurfaceConfirmationOpen && legacySurfaceDraft && preparedLegacySurfaceTransition && (
        <ConfirmDialog
          title={legacySurfaceDraft.action.kind === "advance" ? "确认推进旧功能面" : "确认回滚旧功能面"}
          description={<>
            将 <strong>{legacySurfaceDraft.surfaceId}</strong> 从 {legacySurfacePhaseLabel(legacySurfaceDraft.fromPhase)} 变更到 {legacySurfaceActionTargetLabel(legacySurfaceDraft.action)}，提交修订 {legacySurfaceDraft.expectedRevision} 的证据。
          </>}
          confirmLabel={legacySurfaceDraft.action.kind === "advance" ? "确认推进" : "确认回滚"}
          pendingLabel="正在提交..."
          tone={legacySurfaceDraft.action.kind === "rollback" ? "danger" : "default"}
          onCancel={() => setLegacySurfaceConfirmationOpen(false)}
          onConfirm={confirmLegacySurfaceTransition}
        />
      )}
    </div>
  );
}

function ModelMonitorSection({ snapshot }: { snapshot: ModelMonitorSnapshot }) {
  const [groupKind, setGroupKind] = useState<ModelMonitorGroupKind>("routes");
  const [groupPageNumber, setGroupPageNumber] = useState(1);
  const maxAttempts = Math.max(1, ...snapshot.trend.map((item) => item.attempts));
  const total = snapshot.totals;
  const groups = groupKind === "routes" ? snapshot.routes : groupKind === "providers" ? snapshot.providers : snapshot.models;
  const groupPage = paginateOperations(groups, groupPageNumber);

  function selectGroupKind(nextKind: ModelMonitorGroupKind) {
    setGroupKind(nextKind);
    setGroupPageNumber(1);
  }

  return (
    <div className="model-monitor-content">
      <dl className="model-monitor-summary" aria-label="最近 24 小时模型监控摘要">
        <div><dt>Provider 请求</dt><dd>{total.attempts}</dd></div>
        <div><dt>成功</dt><dd>{total.succeeded}</dd></div>
        <div><dt>失败</dt><dd>{total.failures}</dd></div>
        <div><dt>进行中</dt><dd>{total.inFlight}</dd></div>
        <div><dt>成功率</dt><dd>{total.successRate === null ? "—" : `${Math.round(total.successRate * 1000) / 10}%`}</dd></div>
        <div><dt>Fallback</dt><dd>{total.fallbacks}</dd></div>
        <div><dt>平均延迟</dt><dd>{total.averageLatencyMs === null ? "未知" : `${total.averageLatencyMs} ms`}</dd></div>
      </dl>
      <div className="model-monitor-grid">
        <div>
          <h3>小时趋势</h3>
          <div className="model-monitor-trend">
            {snapshot.trend.map((item) => (
              <div className="model-monitor-trend-row" key={item.bucketStart}>
                <span>{new Date(item.bucketStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <progress max={maxAttempts} value={item.attempts} aria-label={`${formatMonitorTime(item.bucketStart)} 请求 ${item.attempts}`} />
                <small>{item.attempts} · 成 {item.succeeded} · 败 {item.failures} · F {item.fallbacks}</small>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>线路 / Provider / 模型</h3>
          <div className="model-monitor-group-switcher" role="group" aria-label="模型监控分组">
            {([
              ["routes", "线路"],
              ["providers", "Provider"],
              ["models", "模型"],
            ] as const).map(([kind, label]) => (
              <button key={kind} type="button" aria-pressed={groupKind === kind} onClick={() => selectGroupKind(kind)}>
                {label}
              </button>
            ))}
          </div>
          <div className="model-monitor-groups">
            {groupPage.items.map((group) => <MonitorGroupRow key={`${groupKind}:${group.id}`} prefix={groupKind === "routes" ? "线路" : groupKind === "providers" ? "Provider" : "模型"} group={group} />)}
            {!groupPage.total && <p className="typed-admin-empty">当前分组暂无记录</p>}
          </div>
          <PaginationControls label={`模型监控${groupKind === "routes" ? "线路" : groupKind === "providers" ? "Provider" : "模型"}`} page={groupPage} onPageChange={setGroupPageNumber} />
        </div>
      </div>
      <div className="model-monitor-foot">
        <span>失败类别：{snapshot.failureClasses.length ? snapshot.failureClasses.map((item) => `${item.errorClass} ${item.count}`).join(" · ") : "无"}</span>
        <span>仅统计实际 Provider attempt；Fallback 单独计数。窗口：{formatMonitorTime(snapshot.periodStart)} — {formatMonitorTime(snapshot.periodEnd)}</span>
      </div>
    </div>
  );
}

type ModelMonitorGroupKind = "routes" | "providers" | "models";

function MonitorGroupRow({ prefix, group }: { prefix: string; group: ModelMonitorSnapshot["routes"][number] }) {
  return (
    <div className="model-monitor-group-row">
      <span><strong>{prefix} · {group.label}</strong><small>{group.model || group.id}</small></span>
      <em>{group.attempts} 次 · 成 {group.succeeded} · 败 {group.failures} · {group.successRate === null ? "—" : `${Math.round(group.successRate * 100)}%`}</em>
    </div>
  );
}

function AdminFinanceEntryTools({
  providers,
  onCreatePrice,
  onImportReconciliation,
  onCreateBudgetPolicy,
  onReconcileBudgetReservation,
  onPriceDirtyChange,
  onReconciliationDirtyChange,
  onBudgetPolicyDirtyChange,
  onBudgetActionDirtyChange,
}: {
  providers: AdminProviderFinanceProvider[];
  onCreatePrice: (input: AdminProviderPriceCatalog) => Promise<void>;
  onImportReconciliation: (input: AdminProviderReconciliationInput) => Promise<void>;
  onCreateBudgetPolicy: (input: AdminProviderBudgetPolicyInput) => Promise<void>;
  onReconcileBudgetReservation: (input: AdminProviderBudgetOperatorAction) => Promise<void>;
  onPriceDirtyChange: (dirty: boolean) => void;
  onReconciliationDirtyChange: (dirty: boolean) => void;
  onBudgetPolicyDirtyChange: (dirty: boolean) => void;
  onBudgetActionDirtyChange: (dirty: boolean) => void;
}) {
  return (
    <OperationsSection icon={<CircleDollarSign size={17} />} title="财务与预算操作" meta="版本化、幂等、保留审计">
      <div className="admin-finance-entry-grid">
        <ProviderBudgetPolicyForm providers={providers} onSubmit={onCreateBudgetPolicy} onDirtyChange={onBudgetPolicyDirtyChange} />
        <ProviderBudgetReservationForm providers={providers} onSubmit={onReconcileBudgetReservation} onDirtyChange={onBudgetActionDirtyChange} />
        <ProviderPriceCatalogForm providers={providers} onSubmit={onCreatePrice} onDirtyChange={onPriceDirtyChange} />
        <ProviderReconciliationForm providers={providers} onSubmit={onImportReconciliation} onDirtyChange={onReconciliationDirtyChange} />
      </div>
    </OperationsSection>
  );
}

type BudgetPolicyDraft = {
  providerId: string;
  mode: AdminProviderBudgetPolicyInput["mode"];
  currency: string;
  periodStart: string;
  periodEnd: string;
  limit: string;
  maxAttemptReserve: string;
};

function ProviderBudgetPolicyForm({
  providers,
  onSubmit,
  onDirtyChange,
}: {
  providers: AdminProviderFinanceProvider[];
  onSubmit: (input: AdminProviderBudgetPolicyInput) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<BudgetPolicyDraft>(() => emptyBudgetPolicyDraft(providers[0]));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!providers.length) return;
    if (!providers.some((provider) => provider.providerId === draft.providerId)) {
      setDraft(emptyBudgetPolicyDraft(providers[0]));
      onDirtyChange(false);
    }
  }, [draft.providerId, onDirtyChange, providers]);

  function update<K extends keyof BudgetPolicyDraft>(key: K, value: BudgetPolicyDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    onDirtyChange(true);
    setSuccess("");
  }

  function selectProvider(providerId: string) {
    const provider = providers.find((entry) => entry.providerId === providerId);
    setDraft(emptyBudgetPolicyDraft(provider));
    onDirtyChange(true);
    setError("");
    setSuccess("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const provider = providers.find((entry) => entry.providerId === draft.providerId);
      if (!provider) throw new Error("请选择有效的 Provider。");
      await onSubmit(toBudgetPolicyInput(draft, provider));
      onDirtyChange(false);
      setSuccess("预算策略版本已提交。切换到 hard 前应先核对 shadow / soft 证据。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "预算策略提交失败。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-pool-form admin-finance-form" onSubmit={(event) => void submit(event)}>
      <div className="admin-finance-form-heading"><h3>新增预算策略版本</h3><p>一个 Provider、一个币种、一个 UTC 窗口；soft 可作为 hard 的回滚版本。</p></div>
      <div className="admin-form-grid two">
        <label><span>Provider</span><select value={draft.providerId} onChange={(event) => selectProvider(event.target.value)} required><option value="">选择 Provider</option>{providers.map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.label}（{provider.providerId}）</option>)}</select></label>
        <label><span>策略模式</span><select value={draft.mode} onChange={(event) => update("mode", event.target.value as BudgetPolicyDraft["mode"])}><option value="disabled">Disabled</option><option value="shadow">Shadow</option><option value="soft">Soft</option><option value="hard">Hard</option></select></label>
        <label><span>货币</span><input value={draft.currency} maxLength={3} onChange={(event) => update("currency", event.target.value.toUpperCase())} pattern="[A-Z]{3}" required /></label>
        <label><span>窗口开始</span><input type="datetime-local" value={draft.periodStart} onChange={(event) => update("periodStart", event.target.value)} required /></label>
        <label><span>窗口结束</span><input type="datetime-local" value={draft.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} required /></label>
        <label><span>预算上限</span><input inputMode="decimal" value={draft.limit} onChange={(event) => update("limit", event.target.value)} required /></label>
        <label><span>单次最大预留</span><input inputMode="decimal" value={draft.maxAttemptReserve} onChange={(event) => update("maxAttemptReserve", event.target.value)} required /></label>
      </div>
      {(error || success) && <p className={error ? "form-message error" : "form-message"} role={error ? "alert" : "status"}>{error || success}</p>}
      <button className="primary-button icon-text-button" type="submit" disabled={pending || !providers.length}><ShieldCheck size={15} /><span>{pending ? "保存中..." : "保存预算策略"}</span></button>
    </form>
  );
}

type BudgetReservationOption = {
  provider: AdminProviderFinanceProvider;
  reservation: AdminProviderBudgetReservation;
};

type BudgetReservationDraft = {
  reservationId: string;
  action: AdminProviderBudgetOperatorAction["action"];
  amount: string;
  reason: string;
};

function ProviderBudgetReservationForm({
  providers,
  onSubmit,
  onDirtyChange,
}: {
  providers: AdminProviderFinanceProvider[];
  onSubmit: (input: AdminProviderBudgetOperatorAction) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const options = useMemo(() => actionableBudgetReservations(providers), [providers]);
  const [draft, setDraft] = useState<BudgetReservationDraft>(() => emptyBudgetReservationDraft(options[0]));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (options.some((option) => option.reservation.reservationId === draft.reservationId)) return;
    setDraft(emptyBudgetReservationDraft(options[0]));
    onDirtyChange(false);
  }, [draft.reservationId, onDirtyChange, options]);

  function update<K extends keyof BudgetReservationDraft>(key: K, value: BudgetReservationDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    onDirtyChange(true);
    setSuccess("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const selected = options.find((option) => option.reservation.reservationId === draft.reservationId);
      if (!selected) throw new Error("请选择仍待处理的预算占用。");
      const reason = draft.reason.trim();
      if (!reason || reason.length > 320) throw new Error("处理原因必须为 1 至 320 个字符。");
      const amountMicros = draft.action === "release" ? 0 : parseRequiredMoneyMicros(draft.amount, "对账金额");
      await onSubmit({
        version: 1,
        providerId: selected.provider.providerId,
        reservationId: selected.reservation.reservationId,
        action: draft.action,
        amountMicros,
        reason,
      });
      onDirtyChange(false);
      setSuccess(draft.action === "release" ? "预算占用已人工释放并保留审计事件。" : "预算占用已人工对账并保留审计事件。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "预算占用处理失败。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-pool-form admin-finance-form" onSubmit={(event) => void submit(event)}>
      <div className="admin-finance-form-heading"><h3>处理预算占用</h3><p>仅对 pending、hold 或待复核记录执行幂等的对账或人工释放。</p></div>
      <div className="admin-form-grid two">
        <label className="admin-form-wide"><span>预算占用</span><select value={draft.reservationId} onChange={(event) => update("reservationId", event.target.value)} required><option value="">选择预算占用</option>{options.map(({ provider, reservation }) => <option key={reservation.reservationId} value={reservation.reservationId}>{provider.label} · {budgetReservationStatusLabel(reservation.status)} · {formatMicros(reservation.heldMicros || reservation.reservedMicros, reservation.currency)}</option>)}</select></label>
        <label><span>处理方式</span><select value={draft.action} onChange={(event) => update("action", event.target.value as BudgetReservationDraft["action"])}><option value="reconcile">按实际金额对账</option><option value="release">人工释放</option></select></label>
        <label><span>对账金额</span><input inputMode="decimal" value={draft.amount} onChange={(event) => update("amount", event.target.value)} disabled={draft.action === "release"} required={draft.action === "reconcile"} /></label>
        <label className="admin-form-wide"><span>处理原因</span><input value={draft.reason} maxLength={320} onChange={(event) => update("reason", event.target.value)} required /></label>
      </div>
      {(error || success) && <p className={error ? "form-message error" : "form-message"} role={error ? "alert" : "status"}>{error || success}</p>}
      <button className="primary-button icon-text-button" type="submit" disabled={pending || !options.length}><ReceiptText size={15} /><span>{pending ? "处理中..." : "提交预算处理"}</span></button>
    </form>
  );
}

type PriceDraft = {
  providerId: string;
  catalogVersionId: string;
  offeringId: string;
  model: string;
  currency: string;
  precision: string;
  inputNoCachePrice: string;
  cacheReadInputPrice: string;
  cacheWriteInputPrice: string;
  outputTextPrice: string;
  reasoningOutputPrice: string;
  effectiveFrom: string;
  effectiveTo: string;
  approver: string;
  provenance: string;
};

function ProviderPriceCatalogForm({
  providers,
  onSubmit,
  onDirtyChange,
}: {
  providers: AdminProviderFinanceProvider[];
  onSubmit: (input: AdminProviderPriceCatalog) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<PriceDraft>(() => emptyPriceDraft(providers[0]?.providerId || ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!draft.providerId && providers[0]) setDraft((current) => ({ ...current, providerId: providers[0].providerId }));
  }, [draft.providerId, providers]);

  function update<K extends keyof PriceDraft>(key: K, value: PriceDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    onDirtyChange(true);
    setSuccess("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const input = toPriceCatalogInput(draft);
      await onSubmit(input);
      onDirtyChange(false);
      setSuccess("价格目录已提交，重复版本会保持幂等。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "价格目录提交失败。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-pool-form admin-finance-form" onSubmit={(event) => void submit(event)}>
      <div className="admin-finance-form-heading"><h3>新增价格目录</h3><p>按生效时间绑定到后续 Provider 尝试。</p></div>
      <div className="admin-form-grid two">
        <label><span>Provider</span><select value={draft.providerId} onChange={(event) => update("providerId", event.target.value)} required><option value="">选择 Provider</option>{providers.map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.label}（{provider.providerId}）</option>)}</select></label>
        <label><span>目录版本 ID</span><input value={draft.catalogVersionId} maxLength={160} onChange={(event) => update("catalogVersionId", event.target.value)} required /></label>
        <label><span>Offering ID</span><input value={draft.offeringId} maxLength={160} onChange={(event) => update("offeringId", event.target.value)} required /></label>
        <label><span>上游模型</span><input value={draft.model} maxLength={240} onChange={(event) => update("model", event.target.value)} required /></label>
        <label><span>货币</span><input value={draft.currency} maxLength={3} onChange={(event) => update("currency", event.target.value.toUpperCase())} pattern="[A-Z]{3}" required /></label>
        <label><span>精度</span><input type="number" min="0" max="6" step="1" value={draft.precision} onChange={(event) => update("precision", event.target.value)} required /></label>
        <label><span>输入单价 / 百万 Token</span><input inputMode="decimal" value={draft.inputNoCachePrice} onChange={(event) => update("inputNoCachePrice", event.target.value)} placeholder="必填至少一项" /></label>
        <label><span>缓存读单价</span><input inputMode="decimal" value={draft.cacheReadInputPrice} onChange={(event) => update("cacheReadInputPrice", event.target.value)} /></label>
        <label><span>缓存写单价</span><input inputMode="decimal" value={draft.cacheWriteInputPrice} onChange={(event) => update("cacheWriteInputPrice", event.target.value)} /></label>
        <label><span>输出单价</span><input inputMode="decimal" value={draft.outputTextPrice} onChange={(event) => update("outputTextPrice", event.target.value)} /></label>
        <label><span>推理输出单价</span><input inputMode="decimal" value={draft.reasoningOutputPrice} onChange={(event) => update("reasoningOutputPrice", event.target.value)} /></label>
        <label><span>生效时间</span><input type="datetime-local" value={draft.effectiveFrom} onChange={(event) => update("effectiveFrom", event.target.value)} required /></label>
        <label><span>结束时间（可选）</span><input type="datetime-local" value={draft.effectiveTo} onChange={(event) => update("effectiveTo", event.target.value)} /></label>
        <label><span>审批人</span><input value={draft.approver} maxLength={160} onChange={(event) => update("approver", event.target.value)} required /></label>
        <label><span>价格来源</span><input value={draft.provenance} maxLength={320} onChange={(event) => update("provenance", event.target.value)} required /></label>
      </div>
      {(error || success) && <p className={error ? "form-message error" : "form-message"} role={error ? "alert" : "status"}>{error || success}</p>}
      <button className="primary-button icon-text-button" type="submit" disabled={pending || !providers.length}><BookOpenText size={15} /><span>{pending ? "保存中..." : "保存价格目录"}</span></button>
    </form>
  );
}

type ReconciliationDraft = {
  providerId: string;
  fingerprint: string;
  accountFingerprint: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  reportedTotal: string;
  matchedTotal: string;
  status: AdminProviderReconciliationInput["status"];
};

function ProviderReconciliationForm({
  providers,
  onSubmit,
  onDirtyChange,
}: {
  providers: AdminProviderFinanceProvider[];
  onSubmit: (input: AdminProviderReconciliationInput) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<ReconciliationDraft>(() => emptyReconciliationDraft(providers[0]?.providerId || ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!draft.providerId && providers[0]) setDraft((current) => ({ ...current, providerId: providers[0].providerId }));
  }, [draft.providerId, providers]);

  function update<K extends keyof ReconciliationDraft>(key: K, value: ReconciliationDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    onDirtyChange(true);
    setSuccess("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const input = toReconciliationInput(draft);
      await onSubmit(input);
      onDirtyChange(false);
      setSuccess("对账摘要已提交，原始发票不会进入系统。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "对账摘要提交失败。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-pool-form admin-finance-form" onSubmit={(event) => void submit(event)}>
      <div className="admin-finance-form-heading"><h3>导入对账摘要</h3><p>只保存指纹、期间、金额和状态，不上传发票文件。</p></div>
      <div className="admin-form-grid two">
        <label><span>Provider</span><select value={draft.providerId} onChange={(event) => update("providerId", event.target.value)} required><option value="">选择 Provider</option>{providers.map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.label}（{provider.providerId}）</option>)}</select></label>
        <label><span>货币</span><input value={draft.currency} maxLength={3} onChange={(event) => update("currency", event.target.value.toUpperCase())} pattern="[A-Z]{3}" required /></label>
        <label className="admin-form-wide"><span>对账指纹</span><input value={draft.fingerprint} maxLength={71} onChange={(event) => update("fingerprint", event.target.value)} placeholder="sha256:..." required /></label>
        <label className="admin-form-wide"><span>账户指纹</span><input value={draft.accountFingerprint} maxLength={76} onChange={(event) => update("accountFingerprint", event.target.value)} placeholder="acct_sha256:..." required /></label>
        <label><span>期间开始</span><input type="datetime-local" value={draft.periodStart} onChange={(event) => update("periodStart", event.target.value)} required /></label>
        <label><span>期间结束</span><input type="datetime-local" value={draft.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} required /></label>
        <label><span>报告总额</span><input inputMode="decimal" value={draft.reportedTotal} onChange={(event) => update("reportedTotal", event.target.value)} required /></label>
        <label><span>已匹配总额</span><input inputMode="decimal" value={draft.matchedTotal} onChange={(event) => update("matchedTotal", event.target.value)} required /></label>
        <label><span>对账状态</span><select value={draft.status} onChange={(event) => update("status", event.target.value as ReconciliationDraft["status"])}><option value="matched">已匹配</option><option value="partial">部分匹配</option><option value="disputed">有争议</option><option value="corrected">已更正</option><option value="closed">已关闭</option></select></label>
      </div>
      {(error || success) && <p className={error ? "form-message error" : "form-message"} role={error ? "alert" : "status"}>{error || success}</p>}
      <button className="primary-button icon-text-button" type="submit" disabled={pending || !providers.length}><ReceiptText size={15} /><span>{pending ? "导入中..." : "导入对账摘要"}</span></button>
    </form>
  );
}

function emptyLegacySurfaceTransitionDraft(
  surface: AdminLegacySurfaceProjection,
  action: AdminLegacySurfaceAction,
): LegacySurfaceTransitionDraft {
  const observedAt = formatDateTimeLocal(Date.now());
  return {
    surfaceId: surface.surfaceId,
    expectedRevision: surface.revision,
    fromPhase: surface.phase,
    operationId: `legacy-surface:${crypto.randomUUID()}`,
    action,
    rollbackReason: "runtime_regression",
    evidence: adminLegacySurfaceRequiredEvidence(action).map((kind) => ({
      kind,
      evidenceId: "",
      digest: "",
      deploymentSha: "",
      observedAt,
      count: "0",
      result: kind === "owner_approval" || kind.endsWith("_approval") ? "approved" : "passed",
    })),
  };
}

export function prepareLegacySurfaceTransition(
  draft: LegacySurfaceTransitionDraft,
  requestedAt = Date.now(),
): PreparedLegacySurfaceTransition {
  if (!Number.isSafeInteger(requestedAt) || requestedAt <= 0) {
    throw new Error("请求时间格式无效。");
  }
  if (!Number.isSafeInteger(draft.expectedRevision) || draft.expectedRevision < 0) {
    throw new Error("服务端修订号格式无效，请刷新后重试。");
  }
  if (draft.operationId.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(draft.operationId)) {
    throw new Error("操作标识格式无效，请重新打开表单。");
  }

  const requiredKinds = adminLegacySurfaceRequiredEvidence(draft.action);
  if (
    draft.evidence.length !== requiredKinds.length
    || draft.evidence.some((entry, index) => entry.kind !== requiredKinds[index])
  ) {
    throw new Error("证据类型与服务端授权操作不一致，请重新打开表单。");
  }

  const evidence: AdminLegacySurfaceEvidence[] = draft.evidence.map((entry) => {
    const evidenceId = entry.evidenceId.trim();
    if (evidenceId.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(evidenceId)) {
      throw new Error(`${legacySurfaceEvidenceKindLabel(entry.kind)}的证据 ID 格式无效。`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.digest)) {
      throw new Error(`${legacySurfaceEvidenceKindLabel(entry.kind)}的 SHA-256 摘要格式无效。`);
    }
    if (!/^[a-f0-9]{40}$/.test(entry.deploymentSha)) {
      throw new Error(`${legacySurfaceEvidenceKindLabel(entry.kind)}的部署 Commit SHA 格式无效。`);
    }
    const observedAt = parseDateTime(entry.observedAt, `${legacySurfaceEvidenceKindLabel(entry.kind)}观察时间`);
    if (observedAt <= 0 || observedAt > requestedAt) {
      throw new Error(`${legacySurfaceEvidenceKindLabel(entry.kind)}的观察时间不能晚于请求时间。`);
    }
    const count = parseInteger(entry.count, `${legacySurfaceEvidenceKindLabel(entry.kind)}计数`);
    if (entry.result !== "passed" && entry.result !== "complete" && entry.result !== "approved") {
      throw new Error(`${legacySurfaceEvidenceKindLabel(entry.kind)}的结果格式无效。`);
    }
    return {
      version: 1,
      kind: entry.kind,
      evidenceId,
      digest: entry.digest,
      deploymentSha: entry.deploymentSha,
      observedAt,
      count,
      result: entry.result,
    };
  });

  if (draft.action.kind === "advance") {
    return {
      version: 1,
      surfaceId: draft.surfaceId,
      expectedRevision: draft.expectedRevision,
      operationId: draft.operationId,
      targetPhase: draft.action.targetPhase,
      requestedAt,
      evidence,
    };
  }
  return {
    version: 1,
    surfaceId: draft.surfaceId,
    expectedRevision: draft.expectedRevision,
    operationId: draft.operationId,
    scope: draft.action.scope,
    reason: draft.rollbackReason,
    requestedAt,
    evidence,
  };
}

function legacySurfacePhaseLabel(phase: AdminLegacySurfacePhase): string {
  return ({
    discovered: "已发现",
    instrumented: "已接入观测",
    censused: "调用已盘点",
    parity_proven: "一致性已证明",
    shadowing: "影子运行",
    write_disabled: "写入已停用",
    write_observing: "写入观察中",
    recovery_proven: "恢复已证明",
    read_disabled: "读取已停用",
    read_observing: "读取观察中",
    approved_for_cleanup: "已批准清理",
  } as const)[phase];
}

function legacySurfaceControlLabel(control: AdminLegacySurfaceProjection["readControl"]): string {
  return control === "enabled" ? "启用" : "停用";
}

function legacySurfaceOwnerLabel(owner: AdminLegacySurfaceProjection["owner"]): string {
  return ({
    unassigned: "未分配",
    frontend: "前端",
    operations: "运营",
    data: "数据",
    provider: "Provider",
    security: "安全",
  } as const)[owner];
}

function legacySurfaceObservationLabel(surface: AdminLegacySurfaceProjection): string {
  if (!surface.observationStartedAt && !surface.observationRequiredUntil) return "未要求";
  if (!surface.observationStartedAt) return "尚未开始";
  if (surface.observationRequiredUntil <= Date.now()) {
    return `已完成于 ${formatShortDateTime(surface.observationRequiredUntil)}`;
  }
  return `观察至 ${formatShortDateTime(surface.observationRequiredUntil)}`;
}

function legacySurfaceBlockerLabel(blocker: AdminLegacySurfaceProjection["blockerCodes"][number]): string {
  return ({
    maximum_phase_reached: "已达到代码支持上限",
    owner_unassigned: "负责人未分配",
    missing_evidence: "缺少证据",
    observation_incomplete: "观察窗口未完成",
    manifest_conflict: "清单冲突",
    state_invalid: "状态不可用",
  } as const)[blocker];
}

function legacySurfaceActionKey(action: AdminLegacySurfaceAction): string {
  return action.kind === "advance"
    ? `advance:${action.targetPhase}`
    : `rollback:${action.scope}:${action.targetPhase}`;
}

function legacySurfaceActionLabel(action: AdminLegacySurfaceAction): string {
  return action.kind === "advance"
    ? `推进至${legacySurfacePhaseLabel(action.targetPhase)}`
    : `回滚${action.scope === "read" ? "读取" : "写入"}`;
}

function legacySurfaceActionTargetLabel(action: AdminLegacySurfaceAction): string {
  return `${legacySurfacePhaseLabel(action.targetPhase)}${action.kind === "rollback" ? `（${action.scope === "read" ? "读取" : "写入"}回滚）` : ""}`;
}

function legacySurfaceEvidenceKindLabel(kind: AdminLegacySurfaceEvidence["kind"]): string {
  return ({
    caller_map: "调用方清单",
    instrumentation_contract: "观测契约",
    deployment: "部署证据",
    census_window: "调用盘点窗口",
    parity_digest: "一致性摘要",
    shadow_reconciliation: "影子对账",
    write_disable_approval: "停写批准",
    rollback_rehearsal: "回滚演练",
    write_observation: "停写观察",
    capture_evidence: "捕获证据",
    isolated_restore: "隔离恢复",
    read_disable_approval: "停读批准",
    read_observation: "停读观察",
    owner_approval: "负责人批准",
  } as const)[kind];
}

function emptyBudgetPolicyDraft(provider: AdminProviderFinanceProvider | undefined): BudgetPolicyDraft {
  const latest = provider?.budgetPolicies.reduce((current, policy) => (
    !current || policy.policyVersion > current.policyVersion ? policy : current
  ), undefined as AdminProviderFinanceProvider["budgetPolicies"][number] | undefined);
  const start = latest?.periodStart ?? Date.now();
  const end = latest?.periodEnd ?? start + 30 * 24 * 60 * 60 * 1_000;
  return {
    providerId: provider?.providerId || "",
    mode: latest?.mode || "shadow",
    currency: latest?.currency || "USD",
    periodStart: formatDateTimeLocal(start),
    periodEnd: formatDateTimeLocal(end),
    limit: latest ? formatMoneyInput(latest.limitMicros) : "",
    maxAttemptReserve: latest ? formatMoneyInput(latest.maxAttemptReserveMicros) : "",
  };
}

function emptyBudgetReservationDraft(option: BudgetReservationOption | undefined): BudgetReservationDraft {
  return {
    reservationId: option?.reservation.reservationId || "",
    action: "reconcile",
    amount: "",
    reason: "",
  };
}

function actionableBudgetReservations(providers: AdminProviderFinanceProvider[]): BudgetReservationOption[] {
  return providers.flatMap((provider) => provider.budgetReservations
    .filter((reservation) => reservation.status === "reserved" || reservation.status === "held" || reservation.status === "review_required")
    .map((reservation) => ({ provider, reservation })));
}

function toBudgetPolicyInput(
  draft: BudgetPolicyDraft,
  provider: AdminProviderFinanceProvider,
): AdminProviderBudgetPolicyInput {
  const periodStart = parseDateTime(draft.periodStart, "窗口开始");
  const periodEnd = parseDateTime(draft.periodEnd, "窗口结束");
  if (periodEnd <= periodStart) throw new Error("窗口结束必须晚于窗口开始。");
  if (periodEnd <= Date.now()) throw new Error("窗口结束必须晚于当前时间。");
  const limitMicros = parseRequiredMoneyMicros(draft.limit, "预算上限");
  const maxAttemptReserveMicros = parseRequiredMoneyMicros(draft.maxAttemptReserve, "单次最大预留");
  if (limitMicros <= 0) throw new Error("预算上限必须大于零。");
  if (maxAttemptReserveMicros <= 0 || maxAttemptReserveMicros > limitMicros) {
    throw new Error("单次最大预留必须大于零且不超过预算上限。");
  }
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("货币必须为三位大写代码。");
  const matching = provider.budgetPolicies.filter((policy) => (
    policy.currency === currency
    && policy.periodStart === periodStart
    && policy.periodEnd === periodEnd
  ));
  const expectedPreviousVersion = matching.reduce((latest, policy) => Math.max(latest, policy.policyVersion), 0);
  return {
    version: 1,
    providerId: provider.providerId,
    currency,
    mode: draft.mode,
    periodStart,
    periodEnd,
    limitMicros,
    maxAttemptReserveMicros,
    expectedPreviousVersion,
  };
}

function emptyPriceDraft(providerId: string): PriceDraft {
  return {
    providerId,
    catalogVersionId: "",
    offeringId: "",
    model: "",
    currency: "USD",
    precision: "6",
    inputNoCachePrice: "",
    cacheReadInputPrice: "",
    cacheWriteInputPrice: "",
    outputTextPrice: "",
    reasoningOutputPrice: "",
    effectiveFrom: formatDateTimeLocal(Date.now()),
    effectiveTo: "",
    approver: "",
    provenance: "",
  };
}

function emptyReconciliationDraft(providerId: string): ReconciliationDraft {
  const end = Date.now();
  return {
    providerId,
    fingerprint: "",
    accountFingerprint: "",
    periodStart: formatDateTimeLocal(end - 24 * 60 * 60 * 1_000),
    periodEnd: formatDateTimeLocal(end),
    currency: "USD",
    reportedTotal: "",
    matchedTotal: "",
    status: "partial",
  };
}

function toPriceCatalogInput(draft: PriceDraft): AdminProviderPriceCatalog {
  const effectiveFrom = parseDateTime(draft.effectiveFrom, "生效时间");
  const effectiveTo = draft.effectiveTo ? parseDateTime(draft.effectiveTo, "结束时间") : null;
  if (effectiveTo !== null && effectiveTo <= effectiveFrom) throw new Error("结束时间必须晚于生效时间。");
  const prices = {
    inputNoCachePriceMicros: parseMoneyMicros(draft.inputNoCachePrice, "输入单价"),
    cacheReadInputPriceMicros: parseMoneyMicros(draft.cacheReadInputPrice, "缓存读单价"),
    cacheWriteInputPriceMicros: parseMoneyMicros(draft.cacheWriteInputPrice, "缓存写单价"),
    outputTextPriceMicros: parseMoneyMicros(draft.outputTextPrice, "输出单价"),
    reasoningOutputPriceMicros: parseMoneyMicros(draft.reasoningOutputPrice, "推理输出单价"),
  };
  if (!Object.values(prices).some((value) => value !== null)) throw new Error("至少填写一项 Token 单价。");
  return {
    version: 1,
    catalogVersionId: draft.catalogVersionId.trim(),
    providerId: draft.providerId,
    offeringId: draft.offeringId.trim(),
    model: draft.model.trim(),
    currency: draft.currency.trim().toUpperCase(),
    precision: parseInteger(draft.precision, "精度"),
    unit: "million_tokens",
    ...prices,
    effectiveFrom,
    effectiveTo,
    approver: draft.approver.trim(),
    provenance: draft.provenance.trim(),
    createdAt: Math.min(Date.now(), effectiveFrom),
  };
}

function toReconciliationInput(draft: ReconciliationDraft): AdminProviderReconciliationInput {
  const periodStart = parseDateTime(draft.periodStart, "期间开始");
  const periodEnd = parseDateTime(draft.periodEnd, "期间结束");
  if (periodEnd <= periodStart) throw new Error("期间结束必须晚于期间开始。");
  const reportedTotalMicros = parseMoneyMicros(draft.reportedTotal, "报告总额");
  const matchedTotalMicros = parseMoneyMicros(draft.matchedTotal, "已匹配总额");
  if (reportedTotalMicros === null || matchedTotalMicros === null) throw new Error("报告总额和已匹配总额必须填写。");
  if (matchedTotalMicros > reportedTotalMicros) throw new Error("已匹配总额不能超过报告总额。");
  return {
    version: 1,
    fingerprint: draft.fingerprint.trim(),
    providerId: draft.providerId,
    accountFingerprint: draft.accountFingerprint.trim(),
    periodStart,
    periodEnd,
    currency: draft.currency.trim().toUpperCase(),
    reportedTotalMicros,
    matchedTotalMicros,
    status: draft.status,
    importedAt: Date.now(),
  };
}

function parseDateTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}格式无效。`);
  return parsed;
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}格式无效。`);
  return parsed;
}

function parseMoneyMicros(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  const micros = Math.round(parsed * 1_000_000);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(micros)) throw new Error(`${label}格式无效。`);
  return micros;
}

function parseRequiredMoneyMicros(value: string, label: string): number {
  const micros = parseMoneyMicros(value, label);
  if (micros === null) throw new Error(`${label}必须填写。`);
  return micros;
}

function formatMoneyInput(value: number): string {
  return String(value / 1_000_000);
}

export function paginateOperations<T>(items: T[], requestedPage: number, pageSize = OPERATIONS_PAGE_SIZE) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
  const visible = items.slice((page - 1) * pageSize, page * pageSize);
  return { items: visible, page, pageCount, displayed: visible.length, total };
}

type OperationsPage<T> = ReturnType<typeof paginateOperations<T>>;

function PaginationControls<T>({ label, page, onPageChange }: { label: string; page: OperationsPage<T>; onPageChange: (page: number) => void }) {
  return (
    <nav className="operations-pagination" aria-label={`${label}分页`}>
      <button className="icon-button" type="button" onClick={() => onPageChange(page.page - 1)} disabled={page.page <= 1} aria-label={`${label}：上一页`} title="上一页"><ChevronLeft size={15} /></button>
      <span>第 {page.page} / {page.pageCount} 页</span>
      <button className="icon-button" type="button" onClick={() => onPageChange(page.page + 1)} disabled={page.page >= page.pageCount} aria-label={`${label}：下一页`} title="下一页"><ChevronRight size={15} /></button>
    </nav>
  );
}

function OperationsSection({ icon, title, meta, children }: { icon: ReactNode; title: string; meta: string; children: ReactNode }) {
  return <section className="admin-operations-section"><header><span aria-hidden="true">{icon}</span><h2>{title}</h2><small>{meta}</small></header>{children}</section>;
}

function pageCountMeta<T>(page: OperationsPage<T>): string {
  return `当前显示 ${page.displayed} / ${page.total}`;
}

function matchesQuery(query: string, ...values: unknown[]): boolean {
  return !query || values.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
}

function feedbackSummary(entries: AdminFeedbackEntry[], displayed: number): string {
  if (!entries.length) return "当前显示 0 / 0";
  const positive = entries.filter((entry) => entry.rating === "up").length;
  return `${Math.round((positive / entries.length) * 100)}% 有帮助 · 当前显示 ${displayed} / ${entries.length}`;
}

function feedbackReason(reason: AdminFeedbackEntry["reason"]): string {
  const labels: Record<string, string> = { inaccurate: "不准确", misunderstood: "未理解", verbose: "过于冗长", format: "格式问题", other: "其他" };
  return reason ? labels[reason] || reason : "";
}

function formatTokenTotal(provider: AdminProviderFinanceProvider): string {
  const values = Object.values(provider.usage);
  const known = values.filter((value): value is number => value !== null);
  if (!known.length) return "未知";
  const total = known.reduce((sum, value) => sum + value, 0).toLocaleString();
  return known.length === values.length ? total : `部分 ${total}`;
}

function financeUsageLabel(attempt: AdminProviderFinanceAttempt): string {
  const labels = { unknown: "未知", partial: "部分", reported: "Provider 上报", estimated: "估算", reconciled: "已对账" } as const;
  return labels[attempt.usageState];
}

function financeCostLabel(attempt: AdminProviderFinanceAttempt): string {
  const labels = { unknown: "未知", provisional: "暂估", settled: "已对账", corrected: "已更正" } as const;
  return labels[attempt.costState];
}

function formatAttemptTokens(attempt: AdminProviderFinanceAttempt): string {
  const values = Object.values(attempt.usage);
  const known = values.filter((value): value is number => value !== null);
  if (!known.length) return "无可用 Token 证据";
  const total = `${known.reduce((sum, value) => sum + value, 0).toLocaleString()} Token`;
  return known.length === values.length ? total : `部分 ${total}`;
}

function formatAttemptCosts(attempt: AdminProviderFinanceAttempt): string {
  return attempt.costs.length
    ? attempt.costs.map((cost) => formatMicros(cost.totalMicros, cost.currency)).join(" · ")
    : "无可用金额证据";
}

function formatMicros(value: number, currency: string): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value / 1_000_000);
}

function formatCatalogPrice(value: number | null, currency: string): string {
  return value === null ? "未知" : formatMicros(value, currency);
}

function formatShortDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(value);
}

function formatShortDateTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value);
}

function formatMonitorTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value);
}

function formatDateTimeLocal(value: number): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function reconciliationStatus(status: AdminProviderFinanceProvider["reconciliations"][number]["status"]): string {
  return ({ matched: "已匹配", partial: "部分匹配", disputed: "有争议", corrected: "已更正", closed: "已关闭" } as const)[status];
}

function budgetModeLabel(mode: AdminProviderBudgetPolicyInput["mode"]): string {
  return ({ disabled: "Disabled", shadow: "Shadow", soft: "Soft", hard: "Hard" } as const)[mode];
}

function budgetReservationStatusLabel(status: AdminProviderBudgetReservation["status"]): string {
  return ({
    reserved: "待结算",
    settled: "已结算",
    held: "Hold",
    review_required: "待复核",
    reconciled: "已对账",
    operator_released: "人工释放",
  } as const)[status];
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
