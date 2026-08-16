import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FolderUp,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  listWorkspaceFileVersions,
  retryWorkspaceDocumentIngest,
  setConversationWorkspaceFiles,
  updateWorkspaceFile,
  uploadWorkspaceFile,
  workspaceFileDownloadUrl,
  type AgentConversation,
  type WorkspaceFile,
  type WorkspaceTrackedUsage,
  type WorkspaceFileVersion,
} from "../lib/api";
import {
  MAX_WORKSPACE_FILES_PER_CONVERSATION,
} from "../../../src/contracts/workspace-file";
import { workspaceUploadSelectionError } from "../lib/workspace-files";
import { ConfirmDialog } from "./ConfirmDialog";

export function FileWorkspacePanel({
  conversation,
  busy,
  onConversationUpdated,
}: {
  conversation: AgentConversation | null;
  busy: boolean;
  onConversationUpdated: (conversation: AgentConversation) => void;
}) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [usage, setUsage] = useState<WorkspaceTrackedUsage | null>(null);
  const [nextCursor, setNextCursor] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<Record<string, WorkspaceFileVersion[]>>({});
  const [editingId, setEditingId] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceFile | null>(null);
  const [retryTarget, setRetryTarget] = useState<WorkspaceFile | null>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const retryInputRef = useRef<HTMLInputElement>(null);
  const restoreUploadFocusRef = useRef(false);
  const requestSequence = useRef(0);
  const renameButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    directoryInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  useEffect(() => {
    if (!restoreUploadFocusRef.current || deleteTarget) return;
    restoreUploadFocusRef.current = false;
    window.setTimeout(() => uploadButtonRef.current?.focus(), 0);
  }, [deleteTarget]);

  const load = useCallback(async (append = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const page = await listWorkspaceFiles({
        query,
        cursor: append ? nextCursor : undefined,
        limit: 30,
      });
      if (sequence !== requestSequence.current) return;
      setFiles((current) => append
        ? [...new Map([...current, ...page.files].map((file) => [file.id, file])).values()]
        : page.files);
      setUsage(page.usage);
      setNextCursor(page.nextCursor || "");
    } catch (failure) {
      if (sequence === requestSequence.current) {
        if (!append) {
          setFiles([]);
          setUsage(null);
          setNextCursor("");
        }
        setError(fileError(failure, "文件列表读取失败。"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [nextCursor, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!files.some((file) => file.currentVersion?.ingestStatus === "queued" || file.currentVersion?.ingestStatus === "extracting")) return;
    const timer = window.setTimeout(() => void load(false), 1_200);
    return () => window.clearTimeout(timer);
  }, [files, load]);

  const refresh = () => void load(false);

  const loadVersions = async (file: WorkspaceFile): Promise<WorkspaceFileVersion[]> => {
    if (versions[file.id]) return versions[file.id];
    const result = await listWorkspaceFileVersions(file.id);
    const ready = result.versions.filter((version) => version.state === "ready" && version.ingestStatus === "ready");
    setVersions((current) => ({ ...current, [file.id]: ready }));
    return ready;
  };

  const uploadFiles = async (selected: File[]) => {
    if (!selected.length || busy || pendingId) return;
    const uploads = selected.map((file) => ({
      file,
      relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
    const invalid = workspaceUploadSelectionError(uploads.map(({ file, relativePath }) => ({
      name: file.name,
      mediaType: file.type,
      relativePath,
      size: file.size,
    })));
    if (invalid) {
      setError(invalid);
      return;
    }
    setError("");
    setPendingId("upload");
    let firstFailure = "";
    for (const { file, relativePath } of uploads) {
      try {
        await uploadWorkspaceFile({
          file,
          relativePath,
          operationId: `upload-${crypto.randomUUID()}`,
        });
      } catch (failure) {
        firstFailure ||= fileError(failure, `${file.name} 上传失败。`);
      }
    }
    setPendingId("");
    if (firstFailure) setError(firstFailure);
    await load(false);
  };

  const retryUpload = async (file: File) => {
    const target = retryTarget;
    setRetryTarget(null);
    if (!target) return;
    const invalid = workspaceUploadSelectionError([{
      name: file.name,
      mediaType: file.type,
      relativePath: target.path,
      size: file.size,
    }]);
    if (invalid) {
      setError(invalid);
      return;
    }
    setPendingId(target.id);
    setError("");
    try {
      await uploadWorkspaceFile({
        file,
        relativePath: target.path,
        operationId: `retry-${crypto.randomUUID()}`,
        fileId: target.id,
        expectedUpdatedAt: target.updatedAt,
      });
      setVersions((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      await load(false);
    } catch (failure) {
      setError(fileError(failure, "文件重试失败。"));
    } finally {
      setPendingId("");
    }
  };

  const retryDocumentIngest = async (file: WorkspaceFile) => {
    if (!file.currentVersion || busy || pendingId) return;
    setPendingId(`ingest:${file.id}`);
    setError("");
    try {
      await retryWorkspaceDocumentIngest(file.id, file.currentVersion.id);
      setVersions((current) => {
        const next = { ...current };
        delete next[file.id];
        return next;
      });
      await load(false);
    } catch (failure) {
      setError(fileError(failure, "文件解析重试失败。"));
    } finally {
      setPendingId("");
    }
  };

  const mutateFile = async (file: WorkspaceFile, patch: { relativePath?: string; pinned?: boolean }) => {
    setPendingId(file.id);
    setError("");
    const wasRenaming = editingId === file.id;
    try {
      await updateWorkspaceFile(file, patch);
      setEditingId("");
      await load(false);
      if (wasRenaming) restoreRenameFocus(file.id);
    } catch (failure) {
      setError(fileError(failure, "文件更新失败。"));
    } finally {
      setPendingId("");
    }
  };

  const updateConversationRef = async (file: WorkspaceFile, versionId?: string) => {
    if (!conversation || busy || pendingId) return;
    setPendingId(`ref:${file.id}`);
    setError("");
    try {
      const currentRefs = conversation.workspaceFiles.map(({ fileId, versionId: selectedVersionId }) => ({
        fileId,
        versionId: selectedVersionId,
      }));
      const selected = currentRefs.find((ref) => ref.fileId === file.id);
      let nextRefs: Array<{ fileId: string; versionId: string }>;
      if (!versionId && selected) {
        nextRefs = currentRefs.filter((ref) => ref.fileId !== file.id);
      } else {
        const readyVersions = await loadVersions(file);
        const nextVersionId = versionId || file.currentVersion?.id || readyVersions[0]?.id;
        if (!nextVersionId) throw new Error("文件还没有可用版本。");
        if (!selected && currentRefs.length >= MAX_WORKSPACE_FILES_PER_CONVERSATION) throw new Error("每个会话最多选择 10 个文件。");
        nextRefs = [
          ...currentRefs.filter((ref) => ref.fileId !== file.id),
          { fileId: file.id, versionId: nextVersionId },
        ];
      }
      onConversationUpdated(await setConversationWorkspaceFiles(conversation, nextRefs));
    } catch (failure) {
      setError(fileError(failure, "会话文件选择保存失败。"));
    } finally {
      setPendingId("");
    }
  };

  const selectedByFile = new Map(conversation?.workspaceFiles.map((ref) => [ref.fileId, ref]) || []);
  const removeConversationRef = (fileId: string) => {
    if (!conversation || !selectedByFile.has(fileId)) return;
    onConversationUpdated({
      ...conversation,
      workspaceFiles: conversation.workspaceFiles.filter((ref) => ref.fileId !== fileId),
    });
  };
  const restoreRenameFocus = (fileId: string) => {
    window.requestAnimationFrame(() => renameButtonRefs.current.get(fileId)?.focus());
  };

  return (
    <div className="file-workspace" aria-busy={loading || Boolean(pendingId)}>
      {usage && (
        <section className="file-workspace-usage" aria-label="工作区元数据用量" aria-live="polite">
          <div className="file-workspace-quota">
            <span><strong>文件配额</strong><span>{formatBytes(usage.quotaBytes)} / {formatBytes(usage.limitBytes)}</span></span>
            <progress aria-label="文件配额" max={usage.limitBytes} value={Math.min(usage.quotaBytes, usage.limitBytes)} />
          </div>
          <dl>
            <div><dt>解析产物</dt><dd>{formatBytes(usage.extractedBytes)}</dd></div>
            {usage.pendingCleanupBytes > 0 && <div><dt>待清理</dt><dd>{formatBytes(usage.pendingCleanupBytes)}</dd></div>}
            <div><dt>元数据合计</dt><dd>{formatBytes(usage.trackedBytes)}</dd></div>
          </dl>
          <small>仅统计元数据记录，不代表 R2 实际占用。</small>
        </section>
      )}
      <div className="file-workspace-actions">
        <button ref={uploadButtonRef} className="icon-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy || Boolean(pendingId)} title="上传文件" aria-label="上传文件"><Upload size={17} /></button>
        <button className="icon-button" type="button" onClick={() => directoryInputRef.current?.click()} disabled={busy || Boolean(pendingId)} title="上传目录" aria-label="上传目录"><FolderUp size={17} /></button>
        <button className="icon-button" type="button" onClick={refresh} disabled={busy || loading || Boolean(pendingId)} title="刷新文件" aria-label={loading ? "正在刷新文件" : "刷新文件"}><RefreshCw size={17} /></button>
        <input ref={fileInputRef} hidden type="file" multiple onChange={(event) => { void uploadFiles([...event.target.files || []]); event.target.value = ""; }} />
        <input ref={directoryInputRef} hidden type="file" multiple onChange={(event) => { void uploadFiles([...event.target.files || []]); event.target.value = ""; }} />
        <input ref={retryInputRef} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void retryUpload(file); event.target.value = ""; }} />
        <span>{conversation?.workspaceFiles.length || 0}/{MAX_WORKSPACE_FILES_PER_CONVERSATION}</span>
      </div>
      <label className="conversation-search file-search">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">搜索文件</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件路径" />
      </label>
      {error && <div className="file-workspace-error" role="alert"><span>{error}</span><button className="icon-button" type="button" onClick={() => setError("")} aria-label="关闭提示" title="关闭"><X size={15} /></button></div>}
      <div className="file-workspace-list">
        {loading && !files.length && <div className="sidebar-empty">正在读取文件...</div>}
        {!loading && !error && !files.length && <div className="sidebar-empty">{query ? "没有匹配的文件" : "还没有文件"}</div>}
        {files.map((file) => {
          const selected = selectedByFile.get(file.id);
          const readyVersions = versions[file.id];
          const disabled = busy || Boolean(pendingId) || file.state === "uploading" || file.state === "deleting";
          const currentReady = file.state === "ready" && file.currentVersion?.ingestStatus === "ready";
          return (
            <div className={`file-workspace-row ${selected ? "selected" : ""}`} key={file.id}>
              {editingId === file.id ? (
                <form className="file-rename" onSubmit={(event) => { event.preventDefault(); if (pathDraft.trim()) void mutateFile(file, { relativePath: pathDraft.trim() }); }}>
                  <input value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} maxLength={1024} autoFocus />
                  <button className="icon-button" type="submit" disabled={disabled} aria-label="保存路径" title="保存"><Check size={15} /></button>
                  <button className="icon-button" type="button" onClick={() => { setEditingId(""); restoreRenameFocus(file.id); }} disabled={disabled} aria-label="取消重命名" title="取消"><X size={15} /></button>
                </form>
              ) : (
                <>
                  <label className="file-workspace-select">
                    <input
                      type="checkbox"
                      checked={Boolean(selected)}
                      disabled={disabled || (!selected && !currentReady) || (!selected && (conversation?.workspaceFiles.length || 0) >= MAX_WORKSPACE_FILES_PER_CONVERSATION)}
                      onChange={() => void updateConversationRef(file)}
                    />
                    <span><strong title={file.path}>{file.name}</strong><small title={file.path}>{file.path} · {formatBytes(file.currentVersion?.size || 0)} · {workspaceFileStateText(file)}</small></span>
                  </label>
                  <div className="file-workspace-row-actions">
                    <button className="icon-button" type="button" onClick={() => void mutateFile(file, { pinned: !file.pinned })} disabled={disabled} aria-label={file.pinned ? "取消固定" : "固定文件"} title={file.pinned ? "取消固定" : "固定文件"}>{file.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
                    {file.currentVersion && <a className="icon-button" href={workspaceFileDownloadUrl(file.id, selected?.versionId || file.currentVersion.id)} aria-label="下载文件" title="下载"><Download size={14} /></a>}
                    <button
                      ref={(element) => {
                        if (element) renameButtonRefs.current.set(file.id, element);
                        else renameButtonRefs.current.delete(file.id);
                      }}
                      className="icon-button"
                      type="button"
                      onClick={() => { setEditingId(file.id); setPathDraft(file.path); }}
                      disabled={disabled}
                      aria-label="重命名文件"
                      title="重命名"
                    ><Pencil size={14} /></button>
                    {file.ingestRetryAvailable && file.currentVersion && (
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => void retryDocumentIngest(file)}
                        disabled={disabled}
                        aria-label="重试文件解析"
                        title="重试解析"
                      ><RefreshCw size={14} /></button>
                    )}
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => { setRetryTarget(file); window.setTimeout(() => retryInputRef.current?.click(), 0); }}
                      disabled={disabled}
                      aria-label={file.retryAvailable ? "重试上传" : "上传新版本"}
                      title={file.retryAvailable ? "重试上传" : "上传新版本"}
                    >
                      <RotateCw size={14} />
                    </button>
                    <button className="icon-button danger" type="button" onClick={() => setDeleteTarget(file)} disabled={disabled} aria-label="删除文件" title="删除"><Trash2 size={14} /></button>
                  </div>
                  {selected && (
                    <select
                      className="file-version-select"
                      value={selected.versionId}
                      disabled={disabled}
                      onFocus={() => { void loadVersions(file).catch((failure) => setError(fileError(failure, "文件版本读取失败。"))); }}
                      onChange={(event) => void updateConversationRef(file, event.target.value)}
                      aria-label={`${file.name} 的会话版本`}
                    >
                      {!readyVersions && <option value={selected.versionId}>已选版本</option>}
                      {readyVersions?.map((version) => (
                        <option value={version.id} key={version.id}>
                          {version.id === file.currentVersion?.id ? "当前 · " : ""}{formatVersionDate(version.createdAt)}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          );
        })}
        {nextCursor && <button className="quiet-button file-load-more" type="button" onClick={() => void load(true)} disabled={loading || Boolean(pendingId)}>加载更多</button>}
      </div>
      {deleteTarget && (
        <ConfirmDialog
          title="删除文件"
          description={`“${deleteTarget.path}”的所有版本将从工作区删除，关联会话也会解除引用。`}
          confirmLabel="删除"
          pendingLabel="删除中..."
          tone="danger"
          fallbackFocus={() => uploadButtonRef.current}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            restoreUploadFocusRef.current = true;
            const result = await deleteWorkspaceFile(deleteTarget, "delete-" + crypto.randomUUID());
            removeConversationRef(deleteTarget.id);
            if (result.deleted) {
              setFiles((current) => current.filter((file) => file.id !== deleteTarget.id));
              refresh();
            } else {
              setFiles((current) => current.map((file) => file.id === deleteTarget.id
                ? { ...file, state: "deleting" }
                : file));
              setError(result.message);
            }
            setVersions((current) => {
              const next = { ...current };
              delete next[deleteTarget.id];
              return next;
            });
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatVersionDate(value: number): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function workspaceFileStateText(file: WorkspaceFile): string {
  if (file.state === "uploading") return "上传中";
  if (file.state === "failed") return "上传失败";
  if (file.state === "deleting") return "删除中";
  if (file.state === "deleted") return "已删除";
  const status = file.currentVersion?.ingestStatus;
  if (status === "queued") return "等待解析";
  if (status === "extracting") return "解析中";
  if (status === "failed") return "解析失败";
  if (status === "deleted") return "已删除";
  return status === "ready" ? "可用" : "等待上传";
}

function fileError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
