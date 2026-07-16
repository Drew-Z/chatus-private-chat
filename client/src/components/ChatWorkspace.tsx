import { useMemo, useState, type FormEvent } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, type UIMessage } from "ai";
import type { SessionProjection } from "../lib/api";

export function ChatWorkspace({
  session,
  onLogout,
}: {
  session: SessionProjection;
  onLogout: () => Promise<void>;
}) {
  const [routeId, setRouteId] = useState(session.defaultRoute);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const agent = useAgent({
    agent: "TeamAgent",
    basePath: session.agent.basePath,
    defaultCallTimeout: 30_000,
  });
  const chat = useAgentChat({
    agent,
    credentials: "include",
    resume: true,
    cancelOnClientAbort: false,
    body: () => ({ routeId, skillIds }),
  });
  const busy = chat.isStreaming || chat.isRecovering;
  const route = useMemo(() => session.routes.find((candidate) => candidate.id === routeId), [routeId, session.routes]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    chat.sendMessage({ role: "user", parts: [{ type: "text", text }] });
    setInput("");
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div className="brand-lockup compact">
          <div className="brand-mark small">C</div>
          <div><strong>Chatus</strong><span>私人 AI 工作台</span></div>
        </div>
        <div className="header-meta">
          <span>{session.displayName}</span>
          <button className="quiet-button" type="button" onClick={() => void onLogout()}>退出</button>
        </div>
      </header>

      <section className="workspace-layout">
        <aside className="workspace-sidebar" aria-label="工作台设置">
          <div className="sidebar-section">
            <span className="section-label">模型线路</span>
            <select value={routeId} onChange={(event) => setRouteId(event.target.value)} disabled={busy}>
              {session.routes.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}
            </select>
            <small>{route?.model ?? "未选择线路"}</small>
          </div>
          <div className="sidebar-section">
            <div className="section-heading"><span className="section-label">Skills</span><small>{skillIds.length}/3</small></div>
            <div className="skill-list">
              {session.skills.map((skill) => (
                <label className="skill-option" key={skill.id}>
                  <input
                    type="checkbox"
                    checked={skillIds.includes(skill.id)}
                    disabled={(!skillIds.includes(skill.id) && skillIds.length >= 3) || busy}
                    onChange={() => setSkillIds((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])}
                  />
                  <span><strong>{skill.label}</strong><small>{skill.description || "已分配能力"}</small></span>
                </label>
              ))}
            </div>
          </div>
          <div className="usage-card">
            <span>今日剩余</span>
            <strong>{session.usage.remaining}</strong>
            <small>已使用 {session.usage.used} / {session.usage.limit}</small>
          </div>
        </aside>

        <section className="chat-panel" aria-label="对话">
          <div className="chat-toolbar">
            <div><span className="eyebrow">AGENT SESSION</span><h1>工作对话</h1></div>
            <div className={`connection ${agent.connectionError ? "error" : agent.identified ? "ready" : "connecting"}`}>
              {agent.connectionError ? "连接异常" : agent.identified ? "Agent 已连接" : "正在连接"}
            </div>
          </div>
          <div className="message-list" aria-live="polite">
            {chat.messages.length === 0 && <div className="empty-state"><strong>从一个具体任务开始</strong><span>写代码、整理项目、分析资料，Agent 会根据已授权能力继续工作。</span></div>}
            {chat.messages.map((message) => <MessageView key={message.id} message={message} onApprove={chat.addToolApprovalResponse} />)}
            {chat.isRecovering && <div className="stream-note">正在恢复中断的任务...</div>}
          </div>
          {chat.error && <div className="error-banner" role="alert">{chat.error.message || "本轮任务暂时失败，请稍后重试。"}</div>}
          <form className="composer" onSubmit={send}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
              placeholder="描述你要完成的任务..."
              rows={3}
              disabled={busy}
            />
            <div className="composer-footer">
              <span>{chat.isRecovering ? "正在恢复任务，可随时停止" : "Enter 发送，Shift + Enter 换行"}</span>
              {busy
                ? <button type="button" className="stop-action" onClick={() => chat.stop()}>停止任务</button>
                : <button type="submit" disabled={!input.trim()}>发送</button>}
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}

function MessageView({ message, onApprove }: { message: UIMessage; onApprove: (input: { id: string; approved: boolean }) => void }) {
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const approvals = message.parts.filter(isApprovalRequest);
  return (
    <article className={`message ${message.role}`}>
      <div className="message-role">{message.role === "user" ? "你" : "Agent"}</div>
      {text && <div className="message-content">{text}</div>}
      {approvals.map((part) => (
        <div className="approval-card" key={part.approval.id}>
          <strong>需要确认工具操作</strong>
          <span>Agent 请求执行一项已授权但需要确认的操作。</span>
          <div className="approval-actions">
            <button type="button" onClick={() => onApprove({ id: part.approval.id, approved: true })}>批准</button>
            <button type="button" className="quiet-button" onClick={() => onApprove({ id: part.approval.id, approved: false })}>拒绝</button>
          </div>
        </div>
      ))}
    </article>
  );
}

type ApprovalRequestPart = UIMessage["parts"][number] & {
  state: "approval-requested";
  approval: { id: string };
};

function isApprovalRequest(part: UIMessage["parts"][number]): part is ApprovalRequestPart {
  return isToolUIPart(part) && part.state === "approval-requested";
}
