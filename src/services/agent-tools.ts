import type { JSONSchema7 } from "@ai-sdk/provider";
import { jsonSchema, tool, type ToolSet } from "ai";
import type {
  CapabilityToolRunner,
  NormalizedToolDefinition,
} from "../contracts/capability";
import { normalizeToolConfirmation } from "./capability-registry";

type AgentToolApprovalStore = {
  isTrusted: (conversationId: string, toolId: string) => boolean | Promise<boolean>;
  markTrusted: (conversationId: string, toolId: string) => void | Promise<void>;
};

type CreateAgentToolSetArgs = {
  definitions: NormalizedToolDefinition[];
  conversationId: string;
  runTool: CapabilityToolRunner;
  approvals: AgentToolApprovalStore;
};

export function createAgentToolSet(args: CreateAgentToolSetArgs): ToolSet {
  const tools: ToolSet = {};

  for (const definition of args.definitions) {
    const confirmation = normalizeToolConfirmation(definition.config);
    tools[definition.providerName] = tool({
      description: definition.description,
      inputSchema: jsonSchema<unknown>(definition.inputSchema as JSONSchema7),
      needsApproval: confirmation === "always"
        ? true
        : confirmation === "first-per-conversation"
          ? async () => !(await args.approvals.isTrusted(args.conversationId, definition.id))
          : false,
      execute: async (input, options) => {
        const result = await args.runTool(definition, input, options.abortSignal);
        if (confirmation === "first-per-conversation") {
          await args.approvals.markTrusted(args.conversationId, definition.id);
        }
        return result.text;
      },
    });
  }

  return tools;
}
