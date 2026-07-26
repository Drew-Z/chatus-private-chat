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
        isTrusted: (_conversationId, toolId) => trusted.has(toolId),
        markTrusted: (_conversationId, toolId) => trusted.add(toolId),
      },
    });

    expect(tools[autoDefinition.providerName]?.needsApproval).toBe(false);
    expect(await needsApproval(tools, reviewedDefinition.providerName, { query: "Agents SDK" })).toBe(true);

    const output = await executeTool(tools, reviewedDefinition.providerName, { query: "Agents SDK" });
    expect(output).toContain(reviewedDefinition.id);
    expect(trusted.has(reviewedDefinition.id)).toBe(true);
    expect(await needsApproval(tools, reviewedDefinition.providerName, { query: "Agents SDK" })).toBe(false);
    expect(runTool).toHaveBeenCalledTimes(1);
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
