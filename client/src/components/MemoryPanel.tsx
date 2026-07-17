import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, RefreshCw, Save, Trash2, X } from "lucide-react";
import { ApiError, getAgentMemory, putAgentMemory, type AgentMemory } from "../lib/api";
import { resolveLoadedMemoryDraft } from "../lib/state";

export function MemoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadGeneration = useRef(0);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (message = "", { preserveDraft = false }: { preserveDraft?: boolean } = {}) => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setLoading(true);
    setStatus("");
    try {
      const next = await getAgentMemory();
      if (generation !== loadGeneration.current) return;
      setMemory(next);
      setDraft((current) => resolveLoadedMemoryDraft(current, next.memory, preserveDraft));
      setStatus(message);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setStatus(error instanceof ApiError ? error.message : "暂时无法读取长期记忆。");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    else loadGeneration.current += 1;
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  const normalizedDraft = draft.trim();
  const changed = memory !== null && normalizedDraft !== memory.memory;
  const requestClose = useCallback(() => {
    if (changed && !window.confirm("放弃尚未保存的长期记忆修改？")) return;
    onClose();
  }, [changed, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

  if (!open) return null;

  const save = async () => {
    if (!memory || saving) return;
    setSaving(true);
    setStatus("");
    try {
      const next = await putAgentMemory(memory, normalizedDraft);
      setMemory(next);
      setDraft(next.memory);
      setStatus("长期记忆已保存。之后的相关对话会参考这些信息。");
    } catch (error) {
      if (error instanceof ApiError && error.code === "memory_conflict") {
        await load("检测到其他设备的更新；本地修改仍已保留，请对照较新版本后再次保存。", { preserveDraft: true });
      } else {
        setStatus(error instanceof ApiError ? error.message : "保存失败，请稍后重试。");
      }
    } finally {
      setSaving(false);
    }
  };

  const refresh = () => {
    if (changed && !window.confirm("重新读取会覆盖尚未保存的修改，是否继续？")) return;
    void load();
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <aside ref={panelRef} className="memory-panel" role="dialog" aria-modal="true" aria-labelledby="memory-title" tabIndex={-1}>
        <header>
          <div><Brain size={19} /><h2 id="memory-title">长期记忆</h2></div>
          <button ref={closeButtonRef} className="icon-button" type="button" onClick={requestClose} title="关闭" aria-label="关闭长期记忆"><X size={18} /></button>
        </header>
        <div className="memory-body">
          {loading && !memory ? (
            <div className="panel-state">正在读取...</div>
          ) : (
            <>
              <label htmlFor="memory-editor">Agent 在相关任务中可以参考的稳定偏好和背景</label>
              <textarea
                id="memory-editor"
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, memory?.maxChars || 4_000))}
                rows={16}
                disabled={!memory || saving}
                placeholder="例如：偏好的回答方式、常用技术栈、长期项目背景。"
              />
              <div className="memory-meta">
                <span>{draft.length} / {memory?.maxChars || 4_000}</span>
                {memory?.updatedAt ? <span>更新于 {new Date(memory.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span> : null}
              </div>
            </>
          )}
          {status && <p className="panel-status" role="status">{status}</p>}
        </div>
        <footer>
          <button className="quiet-button icon-text-button" type="button" onClick={refresh} disabled={loading || saving}>
            <RefreshCw size={15} /><span>重新读取</span>
          </button>
          <div>
            <button className="quiet-button danger icon-text-button" type="button" onClick={() => setDraft("")} disabled={!memory || saving || !draft}>
              <Trash2 size={15} /><span>清空</span>
            </button>
            <button className="primary-button icon-text-button" type="button" onClick={() => void save()} disabled={!changed || saving}>
              <Save size={15} /><span>{saving ? "保存中" : "保存"}</span>
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
