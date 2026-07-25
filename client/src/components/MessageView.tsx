import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  GitBranch,
  Link,
  FileText,
  Pencil,
  Play,
  RotateCw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from "lucide-react";
import { isToolUIPart, type UIMessage } from "ai";
import { copyText, sanitizeMarkdownUrl } from "../lib/markdown";
import { MarkdownContent } from "./MarkdownContent";

type ApprovalHandler = (input: { id: string; approved: boolean }) => void;
export type MessageAction = "edit" | "resend" | "regenerate" | "continue" | "branch";
type MessageActionHandler = (action: MessageAction, editedText?: string) => void | Promise<void>;
type FeedbackHandler = (rating: "up" | "down") => void | Promise<void>;

export function MessageView({
  message,
  onApprove,
  onAction,
  onFeedback,
  canContinue = false,
  disabled = false,
  generationDisabled = false,
}: {
  message: UIMessage;
  onApprove: ApprovalHandler;
  onAction?: MessageActionHandler;
  onFeedback?: FeedbackHandler;
  canContinue?: boolean;
  disabled?: boolean;
  generationDisabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down">();
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const editOpenerRef = useRef<HTMLButtonElement | null>(null);
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const sourceParts = message.parts.filter((part) => part.type === "source-url" || part.type === "source-document");

  const copy = async () => {
    if (!text || !(await copyText(text))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const runAction = async (action: MessageAction, value?: string) => {
    if (!onAction || disabled || actionBusy || (generationDisabled && action !== "branch")) return;
    setActionBusy(true);
    try {
      await onAction(action, value);
      setEditing(false);
      restoreEditFocus();
    } catch {
      // The owning workspace renders the actionable error; keep this toolbar usable.
    } finally {
      setActionBusy(false);
    }
  };

  const submitFeedback = async (rating: "up" | "down") => {
    if (!onFeedback || disabled || feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      await onFeedback(rating);
      setFeedback(rating);
    } finally {
      setFeedbackBusy(false);
    }
  };

  const startEditing = () => {
    if (disabled || generationDisabled || actionBusy) return;
    setEditText(text);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (actionBusy) return;
    setEditing(false);
    restoreEditFocus();
  };

  const restoreEditFocus = () => {
    window.requestAnimationFrame(() => editOpenerRef.current?.focus());
  };

  return (
    <article className={`message ${message.role}`}>
      <div className="message-role">{message.role === "user" ? "你" : "Chatus"}</div>
      <div className="message-body">
        {message.parts.map((part, index) => {
          const key = `${message.id}-${index}`;
          if (part.type === "text") {
            const attachedFile = parseAttachedFileContext(part.text);
            if (attachedFile) {
              return (
                <div className="message-file" key={key} title={attachedFile.filename}>
                  <FileText size={16} />
                  <span>{attachedFile.filename}</span>
                  <small>{formatBytes(attachedFile.bytes)} · {attachedFile.mediaType}</small>
                </div>
              );
            }
            return <MarkdownContent key={key} text={part.text} />;
          }
          if (part.type === "file") {
            return part.mediaType.startsWith("image/")
              ? <img className="message-image" src={part.url} alt={part.filename || "对话图片"} key={key} />
              : <div className="message-file" key={key} title={part.filename || "附件"}><FileText size={16} /><span>{part.filename || "附件"}</span></div>;
          }
          if (part.type === "reasoning" && part.text.trim()) {
            return (
              <details className="reasoning-block" key={key}>
                <summary>查看思考过程</summary>
                <div>{part.text}</div>
              </details>
            );
          }
          if (part.type === "source-url" || part.type === "source-document") return null;
          if (isToolUIPart(part)) return <ToolTrace part={part} onApprove={onApprove} key={part.toolCallId} />;
          return null;
        })}
      </div>
      {sourceParts.length > 0 && (
        <section className="message-sources" aria-label="消息来源">
          <span className="message-sources-label">来源 · {sourceParts.length}</span>
          {sourceParts.map((part, index) => {
            const key = `${message.id}-source-${index}`;
            if (part.type === "source-document") return <div className="source-link" key={key} title={part.title}><FileText size={14} /><span>{part.title}</span></div>;
            const href = sanitizeMarkdownUrl(part.url);
            if (!href) return <div className="source-link" key={key} title={part.title || part.url}><Link size={14} /><span>{part.title || part.url}</span></div>;
            return <a className="source-link" href={href} target="_blank" rel="noreferrer" key={key} title={part.title || part.url}><Link size={14} /><span>{part.title || part.url}</span></a>;
          })}
        </section>
      )}
      {editing && message.role === "user" && (
        <form
          className="message-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (editText.trim()) void runAction("edit", editText);
          }}
        >
          <textarea
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            rows={3}
            autoFocus
            disabled={actionBusy}
            aria-label="编辑消息"
          />
          <div className="message-edit-actions">
            <button className="quiet-button" type="button" onClick={cancelEditing} disabled={actionBusy}>取消</button>
            <button className="primary-button" type="submit" disabled={actionBusy || !editText.trim()}><Send size={14} />分支发送</button>
          </div>
        </form>
      )}
      {text && (
        <div className="message-actions" aria-label="消息操作">
          <button className="icon-button" type="button" onClick={() => void copy()} title="复制消息" aria-label="复制消息">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {onAction && message.role === "user" && !editing && (
            <>
              <button ref={editOpenerRef} className="icon-button" type="button" onClick={startEditing} disabled={disabled || generationDisabled || actionBusy} title="编辑并分支发送" aria-label="编辑并分支发送"><Pencil size={15} /></button>
              <button className="icon-button" type="button" onClick={() => void runAction("resend")} disabled={disabled || generationDisabled || actionBusy} title="重新发送并创建分支" aria-label="重新发送并创建分支"><RotateCw size={15} /></button>
              <button className="icon-button" type="button" onClick={() => void runAction("branch")} disabled={disabled || actionBusy} title="创建对话分支" aria-label="创建对话分支"><GitBranch size={15} /></button>
            </>
          )}
          {onAction && message.role === "assistant" && (
            <>
              <button className="icon-button" type="button" onClick={() => void runAction("regenerate")} disabled={disabled || generationDisabled || actionBusy} title="重新生成并创建分支" aria-label="重新生成并创建分支"><RotateCw size={15} /></button>
              {canContinue && <button className="icon-button" type="button" onClick={() => void runAction("continue")} disabled={disabled || generationDisabled || actionBusy} title="继续生成并创建分支" aria-label="继续生成并创建分支"><Play size={15} /></button>}
              {onFeedback && (
                <>
                  <button className={`icon-button ${feedback === "up" ? "selected" : ""}`} type="button" onClick={() => void submitFeedback("up")} disabled={disabled || feedbackBusy} title="有帮助" aria-label="有帮助"><ThumbsUp size={15} /></button>
                  <button className={`icon-button ${feedback === "down" ? "selected" : ""}`} type="button" onClick={() => void submitFeedback("down")} disabled={disabled || feedbackBusy} title="没帮助" aria-label="没帮助"><ThumbsDown size={15} /></button>
                </>
              )}
              <button className="icon-button" type="button" onClick={() => void runAction("branch")} disabled={disabled || actionBusy} title="创建对话分支" aria-label="创建对话分支"><GitBranch size={15} /></button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function parseAttachedFileContext(text: string): { filename: string; mediaType: string; bytes: number } | null {
  const match = /^<attached_file name="([^"]*)" mediaType="([^"]*)" bytes="(\d+)">\n[\s\S]*\n<\/attached_file>$/.exec(text.trim());
  if (!match) return null;
  return {
    filename: decodeXmlAttribute(match[1]) || "附件",
    mediaType: decodeXmlAttribute(match[2]) || "text/plain",
    bytes: Number(match[3]) || 0,
  };
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ToolTrace({
  part,
  onApprove,
}: {
  part: UIMessage["parts"][number];
  onApprove: ApprovalHandler;
}) {
  const [deciding, setDeciding] = useState(false);
  if (!isToolUIPart(part)) return null;
  const toolName = part.type === "dynamic-tool"
    ? part.toolName
    : part.title || part.type.replace(/^tool-/, "").replace(/_[0-9a-f]{8,}$/i, "");
  const status = toolStatus(part.state);
  const decide = (approved: boolean) => {
    if (part.state !== "approval-requested" || deciding) return;
    setDeciding(true);
    onApprove({ id: part.approval.id, approved });
  };

  return (
    <details className={`tool-trace state-${part.state}`} open={part.state === "approval-requested"}>
      <summary>
        <Wrench size={15} />
        <span className="tool-name">{toolName || "工具调用"}</span>
        <span className="tool-status">{status}</span>
        <ChevronDown className="tool-chevron" size={15} />
      </summary>
      <div className="tool-detail">
        {part.state === "input-streaming" && <p>Agent 正在准备工具输入。</p>}
        {part.state === "input-available" && <p>工具已进入执行队列。</p>}
        {part.state === "approval-requested" && (
          <>
            <p>这项操作需要你的确认后才能继续。</p>
            <div className="approval-actions">
              <button type="button" disabled={deciding} onClick={() => decide(true)}>批准</button>
              <button type="button" className="quiet-button" disabled={deciding} onClick={() => decide(false)}>拒绝</button>
            </div>
          </>
        )}
        {part.state === "approval-responded" && <p>{part.approval.approved ? "已批准，等待执行。" : "已拒绝执行。"}</p>}
        {part.state === "output-available" && <p>{part.preliminary ? "工具返回了阶段性结果。" : "工具已完成，结果已交给 Agent。"}</p>}
        {part.state === "output-error" && <p className="tool-error">{part.errorText || "工具执行失败。"}</p>}
        {part.state === "output-denied" && <p>这项工具操作已被拒绝。</p>}
      </div>
    </details>
  );
}

function toolStatus(state: string): string {
  if (state === "input-streaming") return "准备中";
  if (state === "input-available") return "执行中";
  if (state === "approval-requested") return "等待确认";
  if (state === "approval-responded") return "已确认";
  if (state === "output-available") return "已完成";
  if (state === "output-error") return "失败";
  if (state === "output-denied") return "已拒绝";
  return "处理中";
}
