import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { RefreshCw, Share2, Trash2, X } from "lucide-react";
import {
  ApiError,
  listConversationShares,
  revokeConversationShare,
  upsertConversationShare,
  type AgentConversation,
  type ConversationGrant,
  type ConversationGrantList,
} from "../lib/api";
import type { ConversationGrantRoleV1 } from "../../../src/contracts/identity";
import { ConfirmDialog } from "./ConfirmDialog";

type ShareViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ConversationGrantList };

type ShareUpsertAttempt = {
  operationId: string;
  granteeLabel: string;
  role: ConversationGrantRoleV1;
  expectedAccessRevision: number;
  pendingKey: string;
};

type ShareRevokeAttempt = {
  operationId: string;
  granteePrincipalId: string;
  expectedAccessRevision: number;
};

export function ConversationShareDialog({
  conversation,
  onClose,
  onAccessChanged,
}: {
  conversation: AgentConversation;
  onClose: () => void;
  onAccessChanged: (accessRevision: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const initialLoadKeyRef = useRef("");
  const titleId = useId();
  const descriptionId = useId();
  const [view, setView] = useState<ShareViewState>({ status: "loading" });
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<ConversationGrantRoleV1>("viewer");
  const [pendingKey, setPendingKey] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [retryAttempt, setRetryAttempt] = useState<ShareUpsertAttempt | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ConversationGrant | null>(null);
  const [revokeAttempt, setRevokeAttempt] = useState<ShareRevokeAttempt | null>(null);

  const load = async (): Promise<ConversationGrantList | null> => {
    setView({ status: "loading" });
    setMutationError("");
    try {
      const data = await listConversationShares(conversation);
      setView({ status: "ready", data });
      return data;
    } catch (error) {
      setView({ status: "error", message: shareError(error, "共享成员读取失败，请重试。") });
      return null;
    }
  };

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const loadKey = `${conversation.resourceId || ""}:${conversation.id}`;
    if (initialLoadKeyRef.current !== loadKey) {
      initialLoadKeyRef.current = loadKey;
      void load();
    }
    return () => {
      if (dialog?.open) dialog.close();
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, [conversation.id, conversation.resourceId]);

  useEffect(() => {
    if (view.status === "loading") return;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-share-initial-focus]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view.status]);

  const commit = async (
    granteeLabel: string,
    nextRole: ConversationGrantRoleV1,
    key: string,
    retry?: ShareUpsertAttempt,
  ) => {
    if (view.status !== "ready" || pendingKey) return;
    const attempt = retry || (retryAttempt
      && retryAttempt.granteeLabel === granteeLabel
      && retryAttempt.role === nextRole
      && retryAttempt.pendingKey === key
      ? retryAttempt
      : {
          operationId: `conversation-share-${crypto.randomUUID()}`,
          granteeLabel,
          role: nextRole,
          expectedAccessRevision: view.data.accessRevision,
          pendingKey: key,
        });
    setPendingKey(key);
    setMutationError("");
    try {
      const result = await upsertConversationShare({
        conversation,
        operationId: attempt.operationId,
        granteeLabel: attempt.granteeLabel,
        role: attempt.role,
        expectedAccessRevision: attempt.expectedAccessRevision,
      });
      setView({ status: "ready", data: result });
      setRetryAttempt(null);
      onAccessChanged(result.accessRevision);
      if (key === "grant") setLabel("");
    } catch (error) {
      setMutationError(shareError(error, "共享设置保存失败，请重试。"));
      if (isAccessRefreshError(error)) {
        setRetryAttempt(null);
        await load();
      } else {
        setRetryAttempt(attempt);
      }
    } finally {
      setPendingKey("");
    }
  };

  const grant = async () => {
    const granteeLabel = label.trim();
    if (!granteeLabel) {
      setMutationError("请输入成员标签。");
      return;
    }
    await commit(granteeLabel, role, "grant");
  };

  const openRevoke = (grant: ConversationGrant) => {
    if (view.status !== "ready") return;
    setRevokeTarget(grant);
    setRevokeAttempt({
      operationId: `conversation-revoke-${crypto.randomUUID()}`,
      granteePrincipalId: grant.principalId,
      expectedAccessRevision: view.data.accessRevision,
    });
  };

  const closeRevoke = () => {
    setRevokeTarget(null);
    setRevokeAttempt(null);
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <dialog
        ref={dialogRef}
        className="conversation-share-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={Boolean(pendingKey)}
        onKeyDown={handleDialogKeyDown}
        onCancel={(event) => { event.preventDefault(); if (!pendingKey) onClose(); }}
        onMouseDown={(event) => { if (event.target === event.currentTarget && !pendingKey) onClose(); }}
      >
        <div className="conversation-share-dialog-content">
          <header>
            <div><Share2 size={17} aria-hidden="true" /><h2 id={titleId}>共享对话</h2></div>
            <button className="icon-button" type="button" onClick={onClose} disabled={Boolean(pendingKey)} title="关闭" aria-label="关闭共享窗口"><X size={18} /></button>
          </header>
          <div className="conversation-share-dialog-body">
            <p id={descriptionId}>按成员标签授权当前对话。查看者只能阅读，编辑者可以发送消息和重命名。</p>
            {view.status === "loading" ? (
              <div className="share-dialog-state" role="status">正在读取共享成员...</div>
            ) : view.status === "error" ? (
              <div className="share-dialog-state error" role="alert">
                <span>{view.message}</span>
                <button className="quiet-button icon-text-button" data-share-initial-focus type="button" onClick={() => void load()}><RefreshCw size={15} /><span>重试</span></button>
              </div>
            ) : (
              <>
                <form className="share-grant-form" onSubmit={(event) => { event.preventDefault(); void grant(); }}>
                  <label>
                    <span>成员标签</span>
                    <input data-share-initial-focus value={label} onChange={(event) => {
                      setLabel(event.target.value);
                      if (retryAttempt?.pendingKey === "grant") {
                        setRetryAttempt(null);
                        setMutationError("");
                      }
                    }} maxLength={80} autoComplete="off" placeholder="输入精确成员标签" disabled={Boolean(pendingKey)} />
                  </label>
                  <label>
                    <span>角色</span>
                    <select value={role} onChange={(event) => {
                      setRole(event.target.value as ConversationGrantRoleV1);
                      if (retryAttempt?.pendingKey === "grant") {
                        setRetryAttempt(null);
                        setMutationError("");
                      }
                    }} disabled={Boolean(pendingKey)}>
                      <option value="viewer">查看者</option>
                      <option value="editor">编辑者</option>
                    </select>
                  </label>
                  <button className="primary-button" type="submit" disabled={Boolean(pendingKey) || !label.trim()}>{pendingKey === "grant" ? "授权中..." : "添加共享"}</button>
                </form>
                <section className="share-grant-list" aria-label="当前共享成员">
                  <div className="share-grant-list-head"><strong>当前成员</strong><span>{view.data.grants.length}</span></div>
                  {!view.data.grants.length && <div className="share-dialog-state">尚未共享给其他成员。</div>}
                  {view.data.grants.map((grant) => (
                    <div className="share-grant-row" key={grant.principalId}>
                      <div><strong>{grant.alias}</strong><small>{grant.role === "editor" ? "编辑者" : "查看者"}</small></div>
                      <select
                        aria-label={`更改 ${grant.alias} 的角色`}
                        value={grant.role}
                        disabled={Boolean(pendingKey)}
                        onChange={(event) => void commit(
                          grant.alias,
                          event.target.value as ConversationGrantRoleV1,
                          grant.principalId,
                        )}
                      >
                        <option value="viewer">查看者</option>
                        <option value="editor">编辑者</option>
                      </select>
                      <button className="icon-button danger" type="button" disabled={Boolean(pendingKey)} onClick={() => openRevoke(grant)} title="撤销共享" aria-label={`撤销 ${grant.alias} 的共享`}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </section>
                {mutationError && (
                  <div className="share-dialog-error" role="alert">
                    <span>{mutationError}</span>
                    {retryAttempt && (
                      <button className="quiet-button icon-text-button" type="button" disabled={Boolean(pendingKey)} onClick={() => void commit(
                        retryAttempt.granteeLabel,
                        retryAttempt.role,
                        retryAttempt.pendingKey,
                        retryAttempt,
                      )}><RefreshCw size={15} /><span>重试</span></button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </dialog>
      {revokeTarget && revokeAttempt && view.status === "ready" && (
        <ConfirmDialog
          title="撤销共享？"
          description={`撤销后，${revokeTarget.alias} 将立即失去这段对话的访问权限。`}
          confirmLabel="撤销共享"
          pendingLabel="撤销中..."
          tone="danger"
          onCancel={closeRevoke}
          onConfirm={async () => {
            try {
              const result = await revokeConversationShare({
                conversation,
                operationId: revokeAttempt.operationId,
                granteePrincipalId: revokeAttempt.granteePrincipalId,
                expectedAccessRevision: revokeAttempt.expectedAccessRevision,
              });
              setView({ status: "ready", data: result });
              onAccessChanged(result.accessRevision);
              closeRevoke();
            } catch (error) {
              if (isAccessRefreshError(error)) {
                const refreshed = await load();
                if (refreshed) {
                  setRevokeAttempt({
                    operationId: `conversation-revoke-${crypto.randomUUID()}`,
                    granteePrincipalId: revokeTarget.principalId,
                    expectedAccessRevision: refreshed.accessRevision,
                  });
                }
              }
              throw error;
            }
          }}
        />
      )}
    </>
  );
}

function shareError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function isAccessRefreshError(error: unknown): boolean {
  return error instanceof ApiError
    && (error.code === "conversation_not_found" || error.code === "conversation_access_revision_conflict");
}
