import { describe, expect, it } from "vitest";
import {
  buildCapabilityTurnSnapshot,
  capabilityRecoveryActions,
  classifyCapabilityFailure,
} from "../client/src/lib/capability-turn";

type SnapshotInput = Parameters<typeof buildCapabilityTurnSnapshot>[0];

function build(overrides: Partial<SnapshotInput> = {}) {
  const input: SnapshotInput = {
    selection: {
      conversationId: "conversation-fixture",
      workflowSelection: true,
      webResearch: false,
      imageUnderstanding: false,
    },
    phase: "idle",
    submissionPending: true,
    webResearchEvidence: false,
    toolActivity: "none",
    ...overrides,
  };
  return buildCapabilityTurnSnapshot(input);
}

describe("capability turn snapshots", () => {
  it.each([
    [undefined, "error"],
    ["request_cancelled", "cancelled"],
    ["upstream_timeout", "timed_out"],
    ["web_research_timeout", "timed_out"],
    ["tool_confirmation_timeout", "timed_out"],
    ["blocked_prompt", "denied"],
    ["tool_not_allowed", "denied"],
    ["image_not_supported", "unavailable"],
    ["mcp_oauth_reconnect_required", "unavailable"],
    ["web_research_not_available", "unavailable"],
    ["web_research_no_sources", "error"],
  ] as const)("classifies %s as %s", (code, status) => {
    expect(classifyCapabilityFailure(code)).toBe(status);
  });

  it("maps lifecycle phases without persisting payload data", () => {
    const cases = [
      [{ phase: "idle", submissionPending: true }, "selected"],
      [{ phase: "submitted", submissionPending: false }, "selected"],
      [{ phase: "waiting-first-output", submissionPending: false }, "waiting"],
      [{ phase: "streaming", submissionPending: false }, "running"],
      [{ phase: "tool-running", submissionPending: false }, "running"],
      [{ phase: "recovering", submissionPending: false }, "running"],
      [{ phase: "completed", submissionPending: false }, "succeeded"],
      [{ phase: "stopped", submissionPending: false }, "cancelled"],
    ] as const;

    for (const [overrides, status] of cases) {
      expect(build(overrides)?.items).toEqual([{
        kind: "workflow_selection",
        status,
        recovery: status === "cancelled" ? ["retry"] : [],
      }]);
    }
  });

  it("requires verified research evidence before reporting success", () => {
    const selection = {
      conversationId: "conversation-fixture",
      workflowSelection: false,
      webResearch: true,
      imageUnderstanding: false,
    };
    expect(build({ selection, phase: "completed", submissionPending: false })?.items).toEqual([{
      kind: "web_research",
      status: "error",
      recovery: ["retry"],
    }]);
    expect(build({
      selection,
      phase: "completed",
      submissionPending: false,
      webResearchEvidence: true,
    })?.items).toEqual([{
      kind: "web_research",
      status: "succeeded",
      recovery: [],
    }]);
  });

  it.each([
    ["waiting", "waiting", []],
    ["running", "running", []],
    ["succeeded", "succeeded", []],
    ["denied", "denied", []],
    ["error", "error", ["retry"]],
  ] as const)("maps %s tool activity to %s", (toolActivity, status, recovery) => {
    expect(build({
      selection: {
        conversationId: "conversation-fixture",
        workflowSelection: false,
        webResearch: false,
        imageUnderstanding: false,
      },
      phase: toolActivity === "error" ? "streaming" : "tool-running",
      submissionPending: false,
      toolActivity,
    })?.items).toEqual([{ kind: "tool_execution", status, recovery }]);
  });

  it("preserves specific tool failure status and recovery", () => {
    const selection = {
      conversationId: "conversation-fixture",
      workflowSelection: false,
      webResearch: false,
      imageUnderstanding: false,
    };
    expect(build({
      selection,
      phase: "failed",
      submissionPending: false,
      errorCode: "tool_confirmation_timeout",
      toolActivity: "error",
    })?.items).toEqual([{
      kind: "tool_execution",
      status: "timed_out",
      recovery: ["retry"],
    }]);
    expect(build({
      selection,
      phase: "failed",
      submissionPending: false,
      errorCode: "mcp_oauth_reconnect_required",
      toolActivity: "error",
    })?.items).toEqual([{
      kind: "tool_execution",
      status: "unavailable",
      recovery: ["connect_mcp"],
    }]);
  });

  it("builds bounded recovery choices in stable order", () => {
    expect(capabilityRecoveryActions("image_not_supported", "unavailable"))
      .toEqual(["remove_images", "switch_route"]);
    expect(capabilityRecoveryActions("mcp_oauth_reconnect_required", "unavailable"))
      .toEqual(["connect_mcp"]);
    expect(capabilityRecoveryActions("upstream_timeout", "timed_out"))
      .toEqual(["switch_route", "retry"]);
    expect(capabilityRecoveryActions("request_cancelled", "cancelled"))
      .toEqual(["retry"]);
  });

  it("returns null when no conversation capability participated", () => {
    expect(buildCapabilityTurnSnapshot({
      selection: null,
      phase: "idle",
      submissionPending: false,
      webResearchEvidence: false,
      toolActivity: "none",
    })).toBeNull();
    expect(build({
      selection: {
        conversationId: "conversation-fixture",
        workflowSelection: false,
        webResearch: false,
        imageUnderstanding: false,
      },
      submissionPending: false,
    })).toBeNull();
  });
});
