import type { AgentErrorCode } from "../../../src/contracts/agent-error";
import type { TurnPhase } from "./state";

export type CapabilityTurnKind =
  | "workflow_selection"
  | "web_research"
  | "image_understanding"
  | "tool_execution";

export type CapabilityTurnStatus =
  | "selected"
  | "waiting"
  | "running"
  | "succeeded"
  | "unavailable"
  | "denied"
  | "timed_out"
  | "cancelled"
  | "error";

export type CapabilityRecoveryAction =
  | "retry"
  | "remove_images"
  | "switch_route"
  | "connect_mcp";

export type CapabilityTurnItem = {
  kind: CapabilityTurnKind;
  status: CapabilityTurnStatus;
  recovery: CapabilityRecoveryAction[];
};

export type CapabilityTurnSnapshot = {
  conversationId: string;
  items: CapabilityTurnItem[];
};

export type CapabilityTurnSelection = {
  conversationId: string;
  workflowSelection: boolean;
  webResearch: boolean;
  imageUnderstanding: boolean;
};

export type CapabilityToolActivity = "none" | "waiting" | "running" | "succeeded" | "denied" | "error";

type CapabilityTurnInput = {
  selection: CapabilityTurnSelection | null;
  phase: TurnPhase;
  submissionPending: boolean;
  errorCode?: AgentErrorCode;
  webResearchEvidence: boolean;
  toolActivity: CapabilityToolActivity;
};

const TIMED_OUT_CODES = new Set<AgentErrorCode>([
  "upstream_timeout",
  "web_research_timeout",
  "tool_confirmation_timeout",
  "tool_budget_exceeded",
  "tool_time_budget_exceeded",
]);

const DENIED_CODES = new Set<AgentErrorCode>([
  "blocked_prompt",
  "conversation_action_denied",
  "public_access_disabled",
  "tool_not_allowed",
]);

const UNAVAILABLE_CODES = new Set<AgentErrorCode>([
  "image_not_supported",
  "mcp_auth_unavailable",
  "mcp_endpoint_invalid",
  "mcp_oauth_reconnect_required",
  "mcp_oauth_review_required",
  "mcp_runtime_closed",
  "mcp_tool_changed",
  "mcp_tool_unsupported",
  "no_routes_available",
  "route_not_allowed",
  "user_api_key_required",
  "vision_assist_unavailable",
  "web_research_connection_required",
  "web_research_not_available",
  "web_research_review_required",
]);

const IMAGE_CODES = new Set<AgentErrorCode>([
  "image_not_supported",
  "invalid_image_data",
  "invalid_image_type",
  "image_too_large",
  "images_too_large",
  "too_many_images",
  "vision_assist_invalid_response",
  "vision_assist_unavailable",
]);

const CONNECTION_CODES = new Set<AgentErrorCode>([
  "mcp_auth_unavailable",
  "mcp_oauth_reconnect_required",
  "mcp_oauth_review_required",
  "web_research_connection_required",
  "web_research_review_required",
]);

const ROUTE_CODES = new Set<AgentErrorCode>([
  "image_not_supported",
  "no_routes_available",
  "provider_busy",
  "provider_protocol_error",
  "route_not_allowed",
  "upstream_authentication_failed",
  "upstream_error",
  "upstream_rate_limited",
  "upstream_timeout",
  "upstream_unavailable",
  "user_api_key_required",
  "vision_assist_invalid_response",
  "vision_assist_unavailable",
]);

export function classifyCapabilityFailure(errorCode?: AgentErrorCode): CapabilityTurnStatus {
  if (!errorCode) return "error";
  if (errorCode === "request_cancelled") return "cancelled";
  if (TIMED_OUT_CODES.has(errorCode)) return "timed_out";
  if (DENIED_CODES.has(errorCode)) return "denied";
  if (UNAVAILABLE_CODES.has(errorCode)) return "unavailable";
  return "error";
}

export function capabilityRecoveryActions(
  errorCode: AgentErrorCode | undefined,
  status: CapabilityTurnStatus,
): CapabilityRecoveryAction[] {
  const actions: CapabilityRecoveryAction[] = [];
  if (errorCode && CONNECTION_CODES.has(errorCode)) actions.push("connect_mcp");
  if (errorCode && IMAGE_CODES.has(errorCode)) actions.push("remove_images");
  if (errorCode && ROUTE_CODES.has(errorCode)) actions.push("switch_route");
  if (status === "error" || status === "timed_out" || status === "cancelled") actions.push("retry");
  return [...new Set(actions)];
}

export function buildCapabilityTurnSnapshot(input: CapabilityTurnInput): CapabilityTurnSnapshot | null {
  const { selection } = input;
  if (!selection) return null;

  const baseStatus = resolveBaseStatus(input);
  const recovery = capabilityRecoveryActions(input.errorCode, baseStatus);
  const items: CapabilityTurnItem[] = [];
  if (selection.workflowSelection) {
    items.push({ kind: "workflow_selection", status: baseStatus, recovery });
  }
  if (selection.webResearch) {
    const status = baseStatus === "succeeded" && !input.webResearchEvidence ? "error" : baseStatus;
    items.push({
      kind: "web_research",
      status,
      recovery: status === "error" ? capabilityRecoveryActions(input.errorCode, status) : recovery,
    });
  }
  if (selection.imageUnderstanding) {
    items.push({ kind: "image_understanding", status: baseStatus, recovery });
  }
  if (input.toolActivity !== "none") {
    const toolStatus = input.toolActivity === "waiting"
      ? "waiting"
      : input.toolActivity === "running"
        ? "running"
        : input.toolActivity === "succeeded"
          ? "succeeded"
          : input.toolActivity === "denied"
            ? "denied"
            : input.errorCode || input.phase === "failed"
              ? baseStatus
              : "error";
    items.push({
      kind: "tool_execution",
      status: toolStatus,
      recovery: toolStatus === "error" || toolStatus === "timed_out" || toolStatus === "cancelled" || toolStatus === "unavailable"
        ? capabilityRecoveryActions(input.errorCode, toolStatus)
        : [],
    });
  }
  return items.length ? { conversationId: selection.conversationId, items } : null;
}

function resolveBaseStatus(input: CapabilityTurnInput): CapabilityTurnStatus {
  if (input.errorCode || input.phase === "failed") return classifyCapabilityFailure(input.errorCode);
  if (input.phase === "stopped") return "cancelled";
  if (input.submissionPending && (input.phase === "idle" || input.phase === "completed")) return "selected";
  if (input.phase === "submitted") return "selected";
  if (input.phase === "waiting-first-output") return "waiting";
  if (input.phase === "streaming" || input.phase === "tool-running" || input.phase === "recovering") return "running";
  if (input.phase === "completed") return "succeeded";
  return "selected";
}
