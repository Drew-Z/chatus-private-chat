import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { UIMessage } from "ai";
import { ConversationSidebar, type SidebarView } from "../../../../client/src/components/ConversationSidebar";
import { MessageComposer } from "../../../../client/src/components/MessageComposer";
import { MessageView, type MessageAction } from "../../../../client/src/components/MessageView";
import { ReliabilityTable } from "../../../../client/src/components/ReliabilityAdminPanel";
import { WorkspaceHeader, type ConnectionState } from "../../../../client/src/components/WorkspaceHeader";
import type { AdminReliabilityProvider, AgentConversation, SessionProjection } from "../../../../client/src/lib/api";
import "../../../../client/src/styles.css";

const now = Date.now();
const initialConversations: AgentConversation[] = [
  {
    id: "visual-long",
    title: "整理一个很长很长的项目复盘标题，用来确认会话列表和头部不会挤压操作区",
    createdAt: now - 86_400_000,
    updatedAt: now,
    summary: "Synthetic visual fixture",
    pinned: false,
    routeId: "reasoning",
    skillIds: ["project"],
    messageCount: 8,
  },
  {
    id: "visual-second",
    title: "第二个会话",
    createdAt: now - 172_800_000,
    updatedAt: now - 7_200_000,
    summary: "Synthetic visual fixture",
    pinned: false,
    routeId: "reasoning",
    skillIds: [],
    messageCount: 3,
  },
  {
    id: "visual-third",
    title: "移动端操作检查",
    createdAt: now - 259_200_000,
    updatedAt: now - 172_800_000,
    summary: "Synthetic visual fixture",
    pinned: false,
    routeId: "reasoning",
    skillIds: [],
    messageCount: 12,
  },
];

const session: SessionProjection = {
  user: "visual-fixture-member",
  displayName: "测试成员",
  usage: { used: 12, limit: 100, remaining: 88 },
  routes: [{
    id: "reasoning",
    label: "高质量推理线路",
    model: "synthetic-reasoning-model-with-a-long-name",
    type: "openai-chat",
    supportsTools: true,
    healthStatus: "healthy",
  }],
  defaultRoute: "reasoning",
  allowBringYourOwnKey: false,
  hasUserSystemPrompt: false,
  skills: [{ id: "project", label: "项目协作", description: "合成测试能力", toolIds: ["search"] }],
  tools: [{ id: "search", label: "项目资料检索", description: "合成测试工具", source: "builtin", confirmation: "always" }],
  agent: { transport: "websocket", basePath: "agent", instance: "visual-fixture" },
};

const messages: UIMessage[] = [
  {
    id: "user-visual",
    role: "user",
    parts: [{
      type: "text",
      text: "# 用户消息标题\n请检查 [链接](https://example.com/docs) 与 `inline-code` 的对比度。\n\n> 这是一段引用。",
    }],
  },
  {
    id: "assistant-visual",
    role: "assistant",
    metadata: { finishReason: "length" },
    parts: [
      {
        type: "text",
        text: "## 可读内容\n\n正文包含不会折断布局的长词：`abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz`。\n\n| 项目 | 状态 |\n| --- | --- |\n| 视觉层级 | 已检查 |\n\n```ts\nconst extremelyLongIdentifierThatMustScrollInsideTheCodeBlockInsteadOfWideningThePage = true;\n```",
      },
      { type: "file", mediaType: "application/pdf", filename: "一个非常非常长的合成附件名称用于验证省略和容器边界而不会泄露任何真实内容.pdf", url: "about:blank" },
      { type: "reasoning", text: "这是纯合成的折叠内容，用于验证渐进展开布局。" },
      {
        type: "dynamic-tool",
        toolName: "synthetic_search",
        toolCallId: "visual-tool-call",
        state: "approval-requested",
        input: { query: "synthetic" },
        approval: { id: "visual-approval" },
      },
      { type: "source-url", sourceId: "source-1", url: "https://example.com/a/very/long/source/path/that/stays/inside/the/message", title: "一条很长的合成网页来源标题，用于验证来源分组和省略" },
      { type: "source-document", sourceId: "source-2", mediaType: "text/plain", title: "合成文档来源" },
    ],
  },
];

const reliabilityProviders: AdminReliabilityProvider[] = [{
  providerId: "synthetic-provider",
  label: "合成服务商",
  enabled: true,
  credentialStatus: "configured",
  concurrency: "bounded",
  maxConcurrent: 2,
  queueTimeoutMs: 750,
  routes: [{
    routeId: "reasoning",
    model: "synthetic-reasoning-model",
    enabled: true,
    attempts: 6,
    successes: 5,
    averageLatencyMs: 820,
    lastOutcome: "success",
    observedAt: new Date(now).toISOString(),
    lastFallback: false,
    fallbackCount: 1,
    streamSamples: 5,
    progressiveSamples: 4,
    averageFirstVisibleLatencyMs: 210,
    lastFirstVisibleLatencyMs: 180,
    lastStreamShape: "progressive",
  }, {
    routeId: "buffered",
    model: "synthetic-buffered-model",
    enabled: true,
    attempts: 2,
    successes: 2,
    averageLatencyMs: 1_400,
    lastOutcome: "success",
    observedAt: new Date(now - 60_000).toISOString(),
    lastFallback: false,
    fallbackCount: 0,
    streamSamples: 2,
    progressiveSamples: 0,
    averageFirstVisibleLatencyMs: 1_350,
    lastFirstVisibleLatencyMs: 1_300,
    lastStreamShape: "single_chunk",
  }],
}];

function WorkspaceFixture() {
  const params = new URLSearchParams(window.location.search);
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialConversations[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(params.get("drawer") === "open");
  const [sidebarView, setSidebarView] = useState<SidebarView>("history");
  const [input, setInput] = useState(params.get("draft") === "long" ? "第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行" : "准备发送的合成消息");
  const [busy, setBusy] = useState(params.get("busy") === "1");
  const connectionState = (params.get("connection") || "ready") as ConnectionState;
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;

  const handleMessageAction = async (_action: MessageAction, _editedText?: string) => undefined;

  if (params.get("view") === "reliability") {
    return (
      <main data-visual-fixture="true" style={{ minHeight: "100dvh", overflow: "hidden", background: "var(--surface)" }}>
        <ReliabilityTable providers={reliabilityProviders} />
      </main>
    );
  }

  return (
    <main className="workspace-shell" data-visual-fixture="true">
      <WorkspaceHeader
        session={session}
        conversation={activeConversation}
        routeId="reasoning"
        connectionState={connectionState}
        busy={busy}
        accountBusy={false}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenRouteSettings={() => { setSidebarView("settings"); setSidebarOpen(true); }}
        onOpenMemory={() => undefined}
        onLogout={async () => undefined}
      />
      <div className="workspace-layout">
        <ConversationSidebar
          open={sidebarOpen}
          session={session}
          conversations={conversations}
          activeId={activeId}
          routeId="reasoning"
          skillIds={["project"]}
          view={sidebarView}
          busy={busy}
          loading={false}
          onClose={() => setSidebarOpen(false)}
          onViewChange={setSidebarView}
          onSelect={(conversation) => setActiveId(conversation.id)}
          onCreate={async () => undefined}
          onRename={async (conversation, title) => setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, title } : item))}
          onDelete={async (conversation) => setConversations((current) => current.filter((item) => item.id !== conversation.id))}
          onRouteChange={() => undefined}
          onSkillChange={() => undefined}
          onRevokeAllSessions={async () => undefined}
          onDeleteUserData={async () => undefined}
          onExportUserData={async () => ({ truncated: false })}
        />
        {sidebarOpen && <button className="sidebar-scrim mobile-only" type="button" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" />}
        <section className="chat-panel" aria-label="对话">
          <div className="conversation-chat">
            <div className="message-list" aria-live="polite">
              <div className="message-column">
                {messages.map((message) => (
                  <MessageView
                    key={message.id}
                    message={message}
                    onApprove={() => undefined}
                    onAction={handleMessageAction}
                    onFeedback={async () => undefined}
                    canContinue={message.role === "assistant"}
                  />
                ))}
                {busy && <div className="thinking-row" role="status"><span className="thinking-indicator" aria-hidden="true" /><span>正在等待首字输出 · 4s</span></div>}
              </div>
            </div>
            <MessageComposer
              value={input}
              onChange={setInput}
              onSubmit={() => setBusy(true)}
              onStop={() => setBusy(false)}
              busy={busy}
              blocked={false}
              online
              routeAvailable
              agentReady
              placeholder="输入消息"
              statusText={busy ? "Agent 正在继续处理" : ""}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><WorkspaceFixture /></StrictMode>);
