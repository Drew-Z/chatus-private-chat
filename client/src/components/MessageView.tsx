import { useState } from "react";
import { Check, ChevronDown, Copy, FileText, Link, Wrench } from "lucide-react";
import { isToolUIPart, type UIMessage } from "ai";
import { copyText, sanitizeMarkdownUrl } from "../lib/markdown";
import { MarkdownContent } from "./MarkdownContent";

type ApprovalHandler = (input: { id: string; approved: boolean }) => void;

export function MessageView({
  message,
  onApprove,
}: {
  message: UIMessage;
  onApprove: ApprovalHandler;
}) {
  const [copied, setCopied] = useState(false);
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  const copy = async () => {
    if (!text || !(await copyText(text))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <article className={`message ${message.role}`}>
      <div className="message-role">{message.role === "user" ? "你" : "Chatus"}</div>
      <div className="message-body">
        {message.parts.map((part, index) => {
          const key = `${message.id}-${index}`;
          if (part.type === "text") return <MarkdownContent key={key} text={part.text} />;
          if (part.type === "file") {
            return part.mediaType.startsWith("image/")
              ? <img className="message-image" src={part.url} alt={part.filename || "对话图片"} key={key} />
              : <div className="message-file" key={key}><FileText size={16} /><span>{part.filename || "附件"}</span></div>;
          }
          if (part.type === "reasoning" && part.text.trim()) {
            return (
              <details className="reasoning-block" key={key}>
                <summary>查看思考过程</summary>
                <div>{part.text}</div>
              </details>
            );
          }
          if (part.type === "source-url") {
            const href = sanitizeMarkdownUrl(part.url);
            if (!href) {
              return <div className="source-link" key={key}><Link size={14} /><span>{part.title || part.url}</span></div>;
            }
            return (
              <a className="source-link" href={href} target="_blank" rel="noreferrer" key={key}>
                <Link size={14} /><span>{part.title || part.url}</span>
              </a>
            );
          }
          if (part.type === "source-document") {
            return <div className="source-link" key={key}><FileText size={14} /><span>{part.title}</span></div>;
          }
          if (isToolUIPart(part)) return <ToolTrace part={part} onApprove={onApprove} key={part.toolCallId} />;
          return null;
        })}
      </div>
      {text && (
        <div className="message-actions" aria-label="消息操作">
          <button className="icon-button" type="button" onClick={() => void copy()} title="复制消息" aria-label="复制消息">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
      )}
    </article>
  );
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
