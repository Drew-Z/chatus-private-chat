import type { JSONSchema7 } from "@ai-sdk/provider";
import { jsonSchema, tool, type ToolSet } from "ai";
import {
  AGENT_MEMORY_PROPOSAL_TOOL_NAME,
  type AgentMemoryMutationResult,
} from "../contracts/agent";
import type {
  CapabilityToolRunner,
  NormalizedToolDefinition,
} from "../contracts/capability";
import { normalizeToolConfirmation } from "./capability-registry";

type AgentToolApprovalStore = {
  isTrusted: (conversationId: string, toolId: string, reviewRevision: string) => boolean | Promise<boolean>;
  markTrusted: (conversationId: string, toolId: string, reviewRevision: string) => void | Promise<void>;
};

type CreateAgentToolSetArgs = {
  definitions: NormalizedToolDefinition[];
  conversationId: string;
  runTool: CapabilityToolRunner;
  approvals: AgentToolApprovalStore;
  memory?: {
    revision: string;
    maxChars: number;
    update: (memory: string, expectedRevision: string) => Promise<AgentMemoryMutationResult>;
  };
};

type MemoryProposalInput = {
  memory: string;
  expectedRevision: string;
};

export function createAgentToolSet(args: CreateAgentToolSetArgs): ToolSet {
  const tools: ToolSet = {};

  for (const definition of args.definitions) {
    const confirmation = normalizeToolConfirmation(definition.config);
    const reviewRevision = definition.config.reviewRevision || "";
    tools[definition.providerName] = tool({
      description: definition.description,
      inputSchema: jsonSchema<unknown>(definition.inputSchema as JSONSchema7),
      needsApproval: confirmation === "always"
        ? true
        : confirmation === "first-per-conversation"
          ? async () => !(await args.approvals.isTrusted(args.conversationId, definition.id, reviewRevision))
          : false,
      execute: async (input, options) => {
        const result = await args.runTool(definition, input, options.abortSignal);
        if (confirmation === "first-per-conversation") {
          await args.approvals.markTrusted(args.conversationId, definition.id, reviewRevision);
        }
        return result.text;
      },
    });
  }

  if (args.memory) {
    const memory = args.memory;
    const maxChars = Math.max(1, Math.floor(memory.maxChars));
    const inputSchema: JSONSchema7 = {
      type: "object",
      properties: {
        memory: {
          type: "string",
          maxLength: maxChars,
          description: "The complete long-term memory after applying the proposed change.",
        },
        expectedRevision: {
          type: "string",
          const: memory.revision,
          description: "The exact current memory revision. Do not modify this value.",
        },
      },
      required: ["memory", "expectedRevision"],
      additionalProperties: false,
    };
    tools[AGENT_MEMORY_PROPOSAL_TOOL_NAME] = tool({
      description:
        "Propose a complete replacement for the user's long-term memory when they state a stable preference, background fact, or request to forget something. "
        + "The user must approve before the change is applied. Never copy conversation transcripts, credentials, or temporary task details. "
        + "Pass the exact expectedRevision required by the schema.",
      inputSchema: jsonSchema<MemoryProposalInput>(inputSchema),
      needsApproval: true,
      execute: async (input) => {
        const proposal = normalizeMemoryProposalInput(input, maxChars);
        if (!proposal || proposal.expectedRevision !== memory.revision) {
          return JSON.stringify({ ok: false, error: "memory_proposal_invalid" });
        }
        const result = await memory.update(proposal.memory, proposal.expectedRevision);
        if (!result.ok) return JSON.stringify({ ok: false, error: result.error || "memory_update_failed" });
        return JSON.stringify({ ok: true, status: "memory_updated", updatedAt: result.record?.updatedAt || 0 });
      },
    });
  }

  return tools;
}

function normalizeMemoryProposalInput(value: unknown, maxChars: number): MemoryProposalInput | null {
  if (!isRecord(value)) return null;
  const input = value;
  if (Object.keys(input).some((key) => key !== "memory" && key !== "expectedRevision")) return null;
  if (typeof input.memory !== "string" || input.memory.length > maxChars) return null;
  if (typeof input.expectedRevision !== "string") return null;
  return { memory: input.memory, expectedRevision: input.expectedRevision };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
