import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { UIMessage } from "ai";
import { ConversationSidebar, type SidebarView } from "../../../../client/src/components/ConversationSidebar";
import { MessageComposer } from "../../../../client/src/components/MessageComposer";
import { MessageView, type MessageAction } from "../../../../client/src/components/MessageView";
import { AdminOperationsContent } from "../../../../client/src/components/AdminOperationsPanel";
import { AdminWorkspace } from "../../../../client/src/components/AdminWorkspace";
import { ReliabilityTable } from "../../../../client/src/components/ReliabilityAdminPanel";
import { WorkspaceHeader, type ConnectionState } from "../../../../client/src/components/WorkspaceHeader";
import {
  isActiveTurnPhase,
  isPendingToolApprovalPart,
  resolveMessageActionAvailability,
  type TurnPhase,
} from "../../../../client/src/lib/state";
import type { AdminOperationsSnapshot, AdminReliabilityProvider, AgentConversation, SessionProjection } from "../../../../client/src/lib/api";
import {
  addDraftAttachmentFiles,
  readDraftAttachment,
  releaseAttachmentPreviews,
  type DraftAttachment,
} from "../../../../client/src/lib/image-input";
import { DEFAULT_FILE_INPUT_POLICY } from "../../../../src/contracts/file";
import { AGENT_MEMORY_PROPOSAL_TOOL_NAME } from "../../../../src/contracts/agent";
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
  {
    id: "visual-branch",
    title: "第二个会话 · 编辑分支",
    createdAt: now - 86_000_000,
    updatedAt: now - 1_000_000,
    summary: "Synthetic branch fixture",
    pinned: false,
    routeId: "reasoning",
    parentChatId: "visual-second",
    skillIds: ["project"],
    messageCount: 2,
  },
  {
    id: "visual-orphan",
    title: "缺失来源分支",
    createdAt: now - 85_000_000,
    updatedAt: now - 500_000,
    summary: "Synthetic missing-parent branch fixture",
    pinned: false,
    routeId: "reasoning",
    parentChatId: "deleted-parent",
    skillIds: ["project"],
    messageCount: 2,
  },
];

const memberSession: SessionProjection = {
  access: "member",
  user: "visual-fixture-member",
  displayName: "测试成员",
  usage: { used: 12, limit: 100, remaining: 88 },
  routes: [{
    id: "reasoning",
    label: "高质量推理线路",
    model: "synthetic-reasoning-model-with-a-long-name",
    type: "openai-chat",
    supportsImages: true,
    supportsTools: true,
    healthStatus: "healthy",
  }],
  defaultRoute: "reasoning",
  allowBringYourOwnKey: false,
  hasUserSystemPrompt: false,
  imageInput: {
    acceptedMediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    maxImages: 4,
    maxImageBytes: 1_300_000,
    maxTotalImageBytes: 1_300_000,
  },
  fileInput: { ...DEFAULT_FILE_INPUT_POLICY },
  capabilities: {
    imageInput: true,
    fileInput: true,
    memory: true,
    messageActions: true,
    feedback: true,
    accountData: true,
  },
  skills: [{ id: "project", label: "项目协作", description: "合成测试能力", toolIds: ["search"] }],
  tools: [{ id: "search", label: "项目资料检索", description: "合成测试工具", source: "builtin", confirmation: "always" }],
  agent: { transport: "websocket", basePath: "agent", instance: "visual-fixture" },
};

const guestSession: SessionProjection = {
  ...memberSession,
  access: "guest",
  user: "guest-visual-fixture",
  displayName: "访客",
  routes: [{
    id: "public",
    label: "公开模型",
    model: "synthetic-public-model",
    type: "openai-chat",
    supportsImages: true,
    supportsTools: false,
    healthStatus: "unknown",
  }],
  defaultRoute: "public",
  hasUserSystemPrompt: false,
  capabilities: {
    imageInput: true,
    fileInput: false,
    memory: false,
    messageActions: false,
    feedback: false,
    accountData: false,
  },
  skills: [],
  tools: [],
  agent: { transport: "websocket", basePath: "agent", instance: "visual-guest-fixture" },
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
        toolName: AGENT_MEMORY_PROPOSAL_TOOL_NAME,
        toolCallId: "visual-tool-call",
        state: "approval-requested",
        input: { memory: "- 偏好简洁、直接的回答\n- 长期使用 TypeScript", expectedRevision: "visual-revision" },
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

const operationsSnapshot: AdminOperationsSnapshot = {
  stats: {
    day: "2026-07-26",
    days: ["2026-07-26", "2026-07-25"],
    totals: { requests: 8, errors: 1, fallbacks: 1, rateLimited: 1, errorRate: 12.5 },
    trend: [
      { day: "2026-07-26", requests: 5, errors: 1, fallbacks: 1, rateLimited: 1, errorRate: 20 },
      { day: "2026-07-25", requests: 3, errors: 0, fallbacks: 0, rateLimited: 0, errorRate: 0 },
    ],
    routeStats: [{
      id: "reasoning",
      label: "高质量推理逻辑模型",
      model: "synthetic-operation-model-with-a-long-name",
      ok7d: 7,
      error7d: 1,
      errorRate7d: 12.5,
      days: [
        { day: "2026-07-26", ok: 4, error: 1 },
        { day: "2026-07-25", ok: 3, error: 0 },
      ],
    }],
    users: [{
      label: "synthetic-operations-member",
      enabled: true,
      displayName: "合成运营成员名称用于验证窄屏容器",
      used: 5,
      dailyLimit: 10,
      remaining: 5,
      defaultRoute: "reasoning",
      allowedRoutes: ["reasoning"],
      allowBringYourOwnKey: false,
      hasSystemPrompt: false,
      systemPromptChars: 0,
      activeSessions: 2,
      memoryChars: 120,
      requests7d: 8,
      errors7d: 1,
      errorRate7d: 12.5,
      usageByDay: [
        { day: "2026-07-26", used: 5 },
        { day: "2026-07-25", used: 3 },
      ],
    }],
    routes: [{
      id: "reasoning",
      enabled: true,
      label: "高质量推理逻辑模型",
      apiKeyRef: "",
      requiresUserKey: false,
      supportsImages: true,
    }],
    configSource: "kv",
    accessCodeSource: "managed",
  },
  audit: [{ id: "audit-1", action: "config.update", target: "reasoning", at: "2026-07-26T08:00:00.000Z" }],
  feedback: [{
    id: "feedback-1",
    label: "synthetic-operations-member",
    rating: "down",
    reason: "inaccurate",
    routeId: "reasoning",
    chatId: "chat-1",
    messageId: "message-1",
    at: "2026-07-26T08:10:00.000Z",
  }],
};

const fixturePixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function fixtureAttachments(mode: string | null): DraftAttachment[] {
  if (mode !== "states") return [];
  return [{
    id: "ready-image",
    kind: "image",
    file: new File([new Uint8Array([65])], "ready-preview.png", { type: "image/png" }),
    filename: "ready-preview.png",
    mediaType: "image/png",
    size: 1,
    previewUrl: fixturePixel,
    dataUrl: "data:image/png;base64,QQ==",
    status: "ready",
  }, {
    id: "ready-file",
    kind: "file",
    file: new File(["synthetic fixture text"], "notes.md", { type: "text/markdown" }),
    filename: "notes.md",
    mediaType: "text/markdown",
    size: 22,
    previewUrl: "",
    dataUrl: "data:text/markdown;base64,c3ludGhldGljIGZpeHR1cmUgdGV4dA==",
    text: "synthetic fixture text",
    status: "ready",
  }, {
    id: "reading-image",
    kind: "image",
    file: new File([new Uint8Array([66])], "reading-preview.png", { type: "image/png" }),
    filename: "reading-preview.png",
    mediaType: "image/png",
    size: 1,
    previewUrl: fixturePixel,
    status: "reading",
  }, {
    id: "error-image",
    kind: "image",
    file: new File([new Uint8Array([67])], "unsupported.svg", { type: "image/svg+xml" }),
    filename: "unsupported.svg",
    mediaType: "",
    size: 1,
    previewUrl: "",
    status: "error",
    error: "unsupported_type",
  }];
}

function WorkspaceFixture() {
  const params = new URLSearchParams(window.location.search);
  const initialActiveId = params.get("branch") === "present"
    ? "visual-branch"
    : params.get("branch") === "missing"
      ? "visual-orphan"
      : initialConversations[0].id;
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialActiveId);
  const [sidebarOpen, setSidebarOpen] = useState(params.get("drawer") === "open");
  const [sidebarView, setSidebarView] = useState<SidebarView>("history");
  const [input, setInput] = useState(params.get("draft") === "long" ? "第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行" : "准备发送的合成消息");
  const [attachments, setAttachments] = useState(() => fixtureAttachments(params.get("attachments")));
  const [busy, setBusy] = useState(params.get("busy") === "1");
  const forcedPhase = readTurnPhase(params.get("phase"));
  const turnPhase = forcedPhase || (busy ? "waiting-first-output" : "completed");
  const turnBusy = isActiveTurnPhase(turnPhase);
  const online = params.get("online") !== "0";
  const routeAvailable = params.get("route") !== "0";
  const blocked = params.get("blocked") === "1";
  const connectionState = (params.get("connection") || "ready") as ConnectionState;
  const session = params.get("access") === "guest" ? guestSession : memberSession;
  const routeId = session.defaultRoute || "reasoning";
  const skillIds = session.access === "member" ? ["project"] : [];
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;
  const parentConversation = activeConversation?.parentChatId
    ? conversations.find((conversation) => conversation.id === activeConversation.parentChatId) || null
    : null;
  const parentMissing = Boolean(activeConversation?.parentChatId && !parentConversation);

  const handleMessageAction = async (_action: MessageAction, _editedText?: string) => undefined;

  const addAttachments = (files: File[]) => {
    const currentIds = new Set(attachments.map((attachment) => attachment.id));
    const next = addDraftAttachmentFiles(
      attachments,
      files,
      session.imageInput,
      session.fileInput,
      { imagesSupported: session.capabilities.imageInput, filesSupported: session.capabilities.fileInput },
    );
    setAttachments(next);
    for (const attachment of next) {
      if (currentIds.has(attachment.id) || attachment.status !== "reading") continue;
      void readDraftAttachment(attachment, session.fileInput).then((updated) => {
        setAttachments((current) => current.map((item) => item.id === updated.id ? updated : item));
      });
    }
  };

  if (params.get("view") === "reliability") {
    return (
      <main data-visual-fixture="true" style={{ minHeight: "100dvh", overflow: "hidden", background: "var(--surface)" }}>
        <ReliabilityTable providers={reliabilityProviders} />
      </main>
    );
  }

  if (params.get("view") === "operations") {
    return (
      <main data-visual-fixture="true" style={{ height: "100dvh", overflowX: "hidden", overflowY: "auto", background: "var(--surface)" }}>
        <AdminOperationsContent snapshot={operationsSnapshot} />
      </main>
    );
  }

  if (params.get("view") === "admin-members") {
    return (
      <div data-visual-fixture="true">
        <AdminWorkspace onSessionExpired={() => undefined} onLogout={() => undefined} />
      </div>
    );
  }

  return (
    <main className="workspace-shell" data-visual-fixture="true">
      <WorkspaceHeader
        session={session}
        conversation={activeConversation}
        routeId={routeId}
        connectionState={connectionState}
        busy={turnBusy}
        accountBusy={false}
        parentConversation={parentConversation}
        parentMissing={parentMissing}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenRouteSettings={() => { setSidebarView("settings"); setSidebarOpen(true); }}
        onOpenMemory={() => undefined}
        onReturnToParent={() => {
          if (parentConversation) setActiveId(parentConversation.id);
        }}
        onMemberLogin={() => undefined}
        onLogout={async () => undefined}
      />
      <div className="workspace-layout">
        <ConversationSidebar
          open={sidebarOpen}
          session={session}
          conversations={conversations}
          activeId={activeId}
          routeId={routeId}
          skillIds={skillIds}
          view={sidebarView}
          busy={turnBusy || blocked}
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
          <div className="conversation-chat" data-turn-phase={turnPhase}>
            <div className="message-list" aria-live="polite">
              <div className="message-column">
                {messages.map((message, index) => (
                  <MessageView
                    key={message.id}
                    message={message}
                    onApprove={() => undefined}
                    onAction={session.capabilities.messageActions ? handleMessageAction : undefined}
                    onFeedback={session.capabilities.feedback ? async () => undefined : undefined}
                    availability={resolveMessageActionAvailability({
                      phase: turnPhase,
                      role: message.role,
                      isLatestMessage: index === messages.length - 1,
                      online,
                      blocked,
                      routeAvailable,
                      messageActionsEnabled: session.capabilities.messageActions,
                      feedbackEnabled: session.capabilities.feedback,
                      hasText: message.parts.some((part) => part.type === "text" && Boolean(part.text.trim())),
                      canContinue: message.role === "assistant",
                      toolApprovalPending: message.parts.some(isPendingToolApprovalPart),
                    })}
                  />
                ))}
                {(turnPhase === "submitted" || turnPhase === "waiting-first-output") && <div className="thinking-row" role="status"><span className="thinking-indicator" aria-hidden="true" /><span>正在等待首字输出 · 4s</span></div>}
              </div>
            </div>
            <MessageComposer
              value={input}
              attachments={attachments}
              imagePolicy={session.imageInput}
              filePolicy={session.fileInput}
              imagesSupported={session.capabilities.imageInput && params.get("images") !== "0"}
              filesSupported={session.capabilities.fileInput}
              onChange={setInput}
              onAddAttachments={addAttachments}
              onRemoveAttachment={(id: string) => setAttachments((current) => {
                const removed = current.filter((attachment) => attachment.id === id);
                releaseAttachmentPreviews(removed);
                return current.filter((attachment) => attachment.id !== id);
              })}
              onRetryAttachment={(id: string) => setAttachments((current) => current.map((attachment) => (
                attachment.id === id ? { ...attachment, status: "reading", error: undefined } : attachment
              )))}
              onSubmit={() => setBusy(true)}
              onStop={() => setBusy(false)}
              busy={turnBusy}
              blocked={blocked}
              online={online}
              routeAvailable={routeAvailable}
              agentReady
              placeholder="输入消息"
              statusText={turnBusy ? "Agent 正在继续处理" : ""}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function readTurnPhase(value: string | null): TurnPhase | null {
  if (
    value === "idle"
    || value === "submitted"
    || value === "waiting-first-output"
    || value === "streaming"
    || value === "tool-running"
    || value === "recovering"
    || value === "completed"
    || value === "stopped"
    || value === "failed"
  ) return value;
  return null;
}

createRoot(document.getElementById("root")!).render(<StrictMode><WorkspaceFixture /></StrictMode>);
