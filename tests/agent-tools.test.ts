import { convertToModelMessages, type ToolSet, type UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { AGENT_MEMORY_PROPOSAL_TOOL_NAME } from "../src/contracts/agent";
import type { NormalizedToolDefinition } from "../src/contracts/capability";
import { createAgentToolSet } from "../src/services/agent-tools";

const autoDefinition: NormalizedToolDefinition = {
  id: "builtin:text_stats",
  providerName: "text_stats_1111111111",
  label: "Text stats",
  description: "Count text units.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  config: {
    enabled: true,
    label: "Text stats",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    confirmation: "auto",
    executor: { type: "builtin", name: "text_stats" },
  },
};

const reviewedDefinition: NormalizedToolDefinition = {
  id: "mcp:docs:search",
  providerName: "search_docs_2222222222",
  label: "Docs search",
  description: "Search reviewed documentation.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  config: {
    enabled: true,
    label: "Docs search",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    confirmation: "first-per-conversation",
    executor: { type: "mcp", serverId: "docs", remoteName: "search.docs" },
    schemaFingerprint: "a".repeat(64),
    securityFingerprint: "b".repeat(64),
    sideEffect: "read",
    reviewRevision: "c".repeat(64),
    reviewRequired: false,
  },
};

describe("Agent AI SDK tools", () => {
  it("executes auto tools and persists first-per-conversation trust only after execution", async () => {
    const trusted = new Set<string>();
    const runTool = vi.fn(async (definition: NormalizedToolDefinition) => ({
      text: JSON.stringify({ toolId: definition.id, ok: true }),
      preview: "ok",
      truncated: false,
    }));
    const tools = createAgentToolSet({
      definitions: [autoDefinition, reviewedDefinition],
      conversationId: "chat-1",
      runTool,
      approvals: {
        isTrusted: (_conversationId, toolId, reviewRevision) => trusted.has(`${toolId}:${reviewRevision}`),
        markTrusted: (_conversationId, toolId, reviewRevision) => trusted.add(`${toolId}:${reviewRevision}`),
      },
    });

    expect(tools[autoDefinition.providerName]?.needsApproval).toBe(false);
    expect(await needsApproval(tools, reviewedDefinition.providerName, { query: "Agents SDK" })).toBe(true);

    const output = await executeTool(tools, reviewedDefinition.providerName, { query: "Agents SDK" });
    expect(output).toContain(reviewedDefinition.id);
    expect(trusted.has(`${reviewedDefinition.id}:${reviewedDefinition.config.reviewRevision}`)).toBe(true);
    expect(await needsApproval(tools, reviewedDefinition.providerName, { query: "Agents SDK" })).toBe(false);
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it("isolates read trust by review revision and never trusts side-effect tools", async () => {
    const trusted = new Set<string>();
    const markTrusted = vi.fn((_conversationId: string, toolId: string, reviewRevision: string) => {
      trusted.add(`${toolId}:${reviewRevision}`);
    });
    const approvals = {
      isTrusted: (_conversationId: string, toolId: string, reviewRevision: string) => (
        trusted.has(`${toolId}:${reviewRevision}`)
      ),
      markTrusted,
    };
    const runTool = vi.fn(async () => ({ text: "ok", preview: "ok", truncated: false }));
    const firstTools = createAgentToolSet({
      definitions: [reviewedDefinition],
      conversationId: "chat-revision",
      runTool,
      approvals,
    });
    await executeTool(firstTools, reviewedDefinition.providerName, { query: "first" });
    expect(await needsApproval(firstTools, reviewedDefinition.providerName, { query: "again" })).toBe(false);

    const revisedDefinition: NormalizedToolDefinition = {
      ...reviewedDefinition,
      config: { ...reviewedDefinition.config, reviewRevision: "d".repeat(64) },
    };
    const revisedTools = createAgentToolSet({
      definitions: [revisedDefinition],
      conversationId: "chat-revision",
      runTool,
      approvals,
    });
    expect(await needsApproval(revisedTools, revisedDefinition.providerName, { query: "new review" })).toBe(true);

    const sideEffectDefinition: NormalizedToolDefinition = {
      ...reviewedDefinition,
      id: "mcp:docs:delete",
      providerName: "delete_docs_3333333333",
      config: {
        ...reviewedDefinition.config,
        confirmation: "first-per-conversation",
        executor: { type: "mcp", serverId: "docs", remoteName: "delete.docs" },
        sideEffect: "destructive",
        reviewRevision: "e".repeat(64),
      },
    };
    const sideEffectTools = createAgentToolSet({
      definitions: [sideEffectDefinition],
      conversationId: "chat-revision",
      runTool,
      approvals,
    });
    expect(await needsApproval(sideEffectTools, sideEffectDefinition.providerName, {})).toBe(true);
    await executeTool(sideEffectTools, sideEffectDefinition.providerName, {});
    expect(await needsApproval(sideEffectTools, sideEffectDefinition.providerName, {})).toBe(true);
    expect(markTrusted).toHaveBeenCalledTimes(1);
  });

  it("preserves approval request and response parts for continuation model messages", async () => {
    const tools = createAgentToolSet({
      definitions: [reviewedDefinition],
      conversationId: "chat-2",
      runTool: async () => ({ text: "ok", preview: "ok", truncated: false }),
      approvals: { isTrusted: () => false, markTrusted: () => undefined },
    });
    const messages: UIMessage[] = [{
      id: "assistant-1",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: reviewedDefinition.providerName,
        toolCallId: "call-1",
        state: "approval-responded",
        input: { query: "Agents SDK" },
        approval: { id: "approval-1", approved: true },
      }],
    }];

    const converted = await convertToModelMessages(messages, { tools });
    expect(converted).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: reviewedDefinition.providerName,
            input: { query: "Agents SDK" },
            providerExecuted: undefined,
          },
          {
            type: "tool-approval-request",
            approvalId: "approval-1",
            toolCallId: "call-1",
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-approval-response",
          approvalId: "approval-1",
          approved: true,
          reason: undefined,
          providerExecuted: undefined,
        }],
      },
    ]);
  });

  it("requires approval and revision checks before applying a memory proposal", async () => {
    const update = vi.fn(async (memory: string, expectedRevision: string) => ({
      ok: true,
      record: { memory, revision: "next-revision", updatedAt: 42 },
    }));
    const tools = createAgentToolSet({
      definitions: [],
      conversationId: "chat-memory",
      runTool: async () => ({ text: "unused", preview: "unused", truncated: false }),
      approvals: { isTrusted: () => true, markTrusted: () => undefined },
      memory: { revision: "base-revision", maxChars: 100, update },
    });

    const input = { memory: "- 偏好简洁回答", expectedRevision: "base-revision" };
    expect(await needsApproval(tools, AGENT_MEMORY_PROPOSAL_TOOL_NAME, input)).toBe(true);
    expect(update).not.toHaveBeenCalled();
    await expect(executeTool(tools, AGENT_MEMORY_PROPOSAL_TOOL_NAME, input))
      .resolves.toBe(JSON.stringify({ ok: true, status: "memory_updated", updatedAt: 42 }));
    expect(update).toHaveBeenCalledWith(input.memory, input.expectedRevision);

    await expect(executeTool(tools, AGENT_MEMORY_PROPOSAL_TOOL_NAME, {
      memory: "must not overwrite",
      expectedRevision: "stale-revision",
    })).resolves.toBe(JSON.stringify({ ok: false, error: "memory_proposal_invalid" }));
    expect(update).toHaveBeenCalledTimes(1);
  });
});

async function needsApproval(tools: ToolSet, name: string, input: unknown): Promise<boolean> {
  const policy = tools[name]?.needsApproval;
  if (typeof policy === "boolean") return policy;
  if (!policy) return false;
  return policy(input, { toolCallId: "call-1", messages: [] });
}

async function executeTool(tools: ToolSet, name: string, input: unknown): Promise<string> {
  const execute = tools[name]?.execute;
  if (!execute) throw new Error(`Missing execute function for ${name}`);
  const output = await execute(input, { toolCallId: "call-1", messages: [] });
  if (typeof output !== "string") throw new Error("Expected a string tool result");
  return output;
}
