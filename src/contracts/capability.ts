import type { ToolEventSummary } from "./chat";
import type { ProviderTokenUsageV1 } from "./provider-finance";

export type ToolConfirmation = "auto" | "first-per-conversation" | "always";
export type McpToolSideEffect = "read" | "write" | "destructive";
export type SkillActivation = "automatic" | "explicit_turn";
export type CapabilityOrigin = "chatus" | "administrator";
export type CapabilityAugmentation = "vision_assist";
export type CapabilityActivation = "workflow" | "explicit_turn" | "route_augmentation";
export type CapabilityAvailability = "available" | "unavailable" | "requires_setup" | "disabled";
export type CapabilityUnavailableReason = "not_assigned" | "route_incompatible" | "helper_unavailable"
  | "tool_unavailable" | "review_required" | "connection_required";

export type PublicCapabilityDisclosureV1 = {
  execution: "instructions" | "trusted_local" | "auxiliary_provider" | "reviewed_mcp";
  externalRequest: boolean;
  dataClasses: Array<"prompt_text" | "search_query" | "image">;
  latency: "none" | "small" | "variable";
  cost: "none" | "provider_request" | "external_service";
};

export type PublicCapabilityV1 = {
  id: string;
  label: string;
  description: string;
  source: CapabilityOrigin;
  activation: CapabilityActivation;
  availability: CapabilityAvailability;
  disclosure: PublicCapabilityDisclosureV1;
  unavailableReason?: CapabilityUnavailableReason;
};

export type AdminCapabilityPackItemStatus = "installed" | "missing" | "disabled" | "conflict" | "requires_setup";

export type AdminCapabilityPackItemV1 = {
  id: string;
  label: string;
  description: string;
  source: "chatus";
  activation: CapabilityActivation;
  status: AdminCapabilityPackItemStatus;
  installable: boolean;
  disclosure: PublicCapabilityDisclosureV1;
};

export type AdminCapabilityPackV1 = {
  id: string;
  version: number;
  label: string;
  description: string;
  items: AdminCapabilityPackItemV1[];
};

export type AdminCapabilityCatalogSnapshotV1 = {
  version: 1;
  packs: AdminCapabilityPackV1[];
};

export type AdminCapabilityPackInstallResultV1 = {
  ok: true;
  config: Record<string, unknown>;
  source: "kv";
  revision: string;
  installed: string[];
  skipped: string[];
};

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
  activation?: SkillActivation;
  origin?: CapabilityOrigin;
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
  capabilityRole?: "web_search";
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
  allowedAugmentations?: CapabilityAugmentation[];
};
