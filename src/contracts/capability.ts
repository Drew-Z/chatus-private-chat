import type { ToolEventSummary } from "./chat";
import type { ProviderTokenUsageV1 } from "./provider-finance";

export type ToolConfirmation = "auto" | "first-per-conversation" | "always";
export type McpToolSideEffect = "read" | "write" | "destructive";

export type ToolExecutor =
  | { type: "builtin"; name: "text_stats" }
  | { type: "mcp"; serverId: string; remoteName: string };

export type SkillConfig = {
  enabled?: boolean;
  label: string;
  description?: string;
  instructions: string;
  toolIds?: string[];
  order?: number;
};

export type ToolConfig = {
  enabled?: boolean;
  label: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  confirmation?: ToolConfirmation;
  executor: ToolExecutor;
  schemaFingerprint?: string;
  securityFingerprint?: string;
  sideEffect?: McpToolSideEffect;
  reviewRevision?: string;
  reviewRequired?: boolean;
};

export type McpAuthType = "none" | "bearer" | "x-api-key";

export type McpAuthConfig =
  | { version: 1; type: "none" }
  | { version: 1; type: "bearer" | "x-api-key"; secretRef: string }
  | McpOAuth2AuthConfig;

export type McpOAuth2AuthConfig = {
  version: 1;
  type: "oauth2";
  issuer: string;
  clientId: string;
  scopes: string[];
  callbackPath: string;
  configRevision: string;
  clientSecretRef?: string;
};

export type McpServerConfig = {
  enabled?: boolean;
  label: string;
  endpoint: string;
  auth: McpAuthConfig;
};

export type NormalizedToolDefinition = {
  id: string;
  providerName: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
  config: ToolConfig;
};

export type CapabilityToolExecutionResult = {
  text: string;
  preview: string;
  truncated: boolean;
};

export type CapabilityToolRunner = (
  definition: NormalizedToolDefinition,
  input: unknown,
  signal?: AbortSignal,
) => Promise<CapabilityToolExecutionResult>;

export type NormalizedToolCall = {
  providerCallId: string;
  providerName: string;
  toolId: string;
  arguments: unknown;
  argumentsValid: boolean;
};

export type ModelTurn = {
  text: string;
  toolCalls: NormalizedToolCall[];
  finishReason: string;
  providerTurn: unknown;
  usage: ProviderTokenUsageV1;
};

export type CapabilityStreamEvent =
  | { type: "run"; runId: string; routeId: string; fallback: boolean }
  | { type: "tool"; event: ToolEventSummary }
  | { type: "confirmation_required"; runId: string; callId: string; event: ToolEventSummary }
  | { type: "assistant_delta"; text: string }
  | { type: "finish"; finishReason: string }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done" };

export type ToolApprovalDecision = "once" | "conversation" | "deny";

export type PublicSkill = {
  id: string;
  label: string;
  description: string;
  toolIds: string[];
};

export type PublicTool = {
  id: string;
  label: string;
  description: string;
  source: "builtin" | "mcp";
  confirmation: ToolConfirmation;
};

export type SelectedSkill = { id: string; skill: SkillConfig };

export type CapabilityRegistryConfig = {
  skills?: Record<string, SkillConfig>;
  tools?: Record<string, ToolConfig>;
  mcpServers?: Record<string, McpServerConfig>;
};

export type CapabilityAssignment = {
  allowedSkills?: string[];
  allowedTools?: string[];
};
