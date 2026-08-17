import { describe, expect, it } from "vitest";
import type { CapabilityRegistryConfig } from "../src/contracts/capability";
import {
  buildCapabilityToolDefinitions,
  getPublicCapabilities,
  getSelectedSkills,
  normalizeToolConfirmation,
} from "../src/services/capability-registry";

const config: CapabilityRegistryConfig = {
  skills: {
    writing: {
      enabled: true,
      label: "Writing",
      instructions: "Use concise prose.",
      toolIds: ["builtin:text_stats", "mcp:docs:search", "mcp:disabled:search"],
      order: 20,
    },
    coding: {
      enabled: true,
      label: "Coding",
      instructions: "Inspect code before editing.",
      toolIds: ["mcp:docs:search"],
      order: 10,
    },
    hidden: {
      enabled: false,
      label: "Hidden",
      instructions: "Do not expose.",
      toolIds: ["builtin:text_stats"],
    },
  },
  tools: {
    "builtin:text_stats": {
      enabled: true,
      label: "Text stats",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      executor: { type: "builtin", name: "text_stats" },
    },
    "mcp:docs:search": {
      enabled: true,
      label: "Docs search",
      description: "Search reviewed documentation.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      executor: { type: "mcp", serverId: "docs", remoteName: "search.docs" },
      schemaFingerprint: "a".repeat(64),
    },
    "mcp:disabled:search": {
      enabled: true,
      label: "Disabled search",
      inputSchema: { type: "object", properties: {} },
      executor: { type: "mcp", serverId: "disabled", remoteName: "search" },
      schemaFingerprint: "b".repeat(64),
    },
    "builtin:unassigned": {
      enabled: true,
      label: "Unassigned",
      inputSchema: { type: "object", properties: {} },
      executor: { type: "builtin", name: "text_stats" },
    },
  },
  mcpServers: {
    docs: {
      enabled: true,
      label: "Docs",
      endpoint: "https://docs.example/mcp",
      authType: "none",
    },
    disabled: {
      enabled: false,
      label: "Disabled",
      endpoint: "https://disabled.example/mcp",
      authType: "none",
    },
  },
};

describe("capability registry", () => {
  it("projects only assigned Skills and executable tools without exposing schemas", () => {
    const capabilities = getPublicCapabilities(config, {
      allowedSkills: ["writing"],
      allowedTools: ["builtin:text_stats", "mcp:docs:search", "mcp:disabled:search"],
    });

    expect(capabilities.tools).toEqual([
      {
        id: "mcp:docs:search",
        label: "Docs search",
        description: "Search reviewed documentation.",
        source: "mcp",
        confirmation: "first-per-conversation",
      },
      {
        id: "builtin:text_stats",
        label: "Text stats",
        description: "",
        source: "builtin",
        confirmation: "auto",
      },
    ]);
    expect(capabilities.skills).toEqual([
      {
        id: "writing",
        label: "Writing",
        description: "",
        toolIds: ["builtin:text_stats", "mcp:docs:search"],
      },
    ]);
    expect(JSON.stringify(capabilities)).not.toContain("inputSchema");
    expect(JSON.stringify(capabilities)).not.toContain("instructions");
  });

  it("selects at most three valid enabled skills in configured order", () => {
    const selected = getSelectedSkills(config, ["writing", "coding", "writing", "bad id", "hidden"]);
    expect(selected.map(({ id }) => id)).toEqual(["coding", "writing"]);
    expect(getSelectedSkills(config, ["writing", "coding"], { allowedSkills: ["writing"] }).map(({ id }) => id))
      .toEqual(["writing"]);
  });

  it("keeps missing Skill assignments backward compatible while an empty list denies all", () => {
    expect(getPublicCapabilities(config, { allowedTools: [] }).skills.map(({ id }) => id))
      .toEqual(["coding", "writing"]);
    expect(getPublicCapabilities(config, { allowedSkills: [], allowedTools: [] }).skills).toEqual([]);
    expect(getSelectedSkills(config, ["coding", "writing"], { allowedSkills: [] })).toEqual([]);
  });

  it("keeps explicit-turn Skills out of ordinary selection while disclosing them safely", () => {
    const explicitConfig: CapabilityRegistryConfig = {
      ...config,
      skills: {
        ...config.skills,
        research: {
          enabled: true,
          label: "Research",
          description: "Search current sources.",
          instructions: "Use reviewed search sources.",
          toolIds: ["mcp:docs:search"],
          activation: "explicit_turn",
          origin: "chatus",
          order: 1,
        },
      },
    };
    const projection = getPublicCapabilities(explicitConfig, {
      allowedSkills: ["research"],
      allowedTools: ["mcp:docs:search"],
    });
    expect(projection.skills).toEqual([]);
    expect(getSelectedSkills(explicitConfig, ["research"])).toEqual([]);
    expect(projection.capabilities).toEqual([expect.objectContaining({
      id: "research",
      activation: "explicit_turn",
      source: "chatus",
      availability: "available",
      disclosure: expect.objectContaining({ execution: "reviewed_mcp", externalRequest: true }),
    })]);
  });

  it("preserves omitted and explicit-empty augmentation assignment semantics", () => {
    expect(getPublicCapabilities(config, {}).capabilities.map(({ id }) => id)).not.toContain("chatus:vision_assist");
    expect(getPublicCapabilities(config, { allowedAugmentations: [] }).capabilities.map(({ id }) => id))
      .not.toContain("chatus:vision_assist");
    expect(getPublicCapabilities(config, { allowedAugmentations: ["vision_assist"] }).capabilities)
      .toContainEqual(expect.objectContaining({
        id: "chatus:vision_assist",
        activation: "route_augmentation",
        availability: "requires_setup",
        unavailableReason: "helper_unavailable",
        disclosure: expect.objectContaining({ execution: "auxiliary_provider", dataClasses: ["image"] }),
      }));
  });

  it("marks an assigned Skill unavailable when one of its tools is not executable", () => {
    const projection = getPublicCapabilities(config, {
      allowedSkills: ["writing"],
      allowedTools: ["builtin:text_stats"],
    });
    expect(projection.capabilities).toEqual([expect.objectContaining({
      id: "writing",
      availability: "unavailable",
      unavailableReason: "tool_unavailable",
    })]);
  });

  it("builds provider-safe definitions from the intersection of skill references and assignment", async () => {
    const selected = getSelectedSkills(config, ["writing"]);
    const definitions = await buildCapabilityToolDefinitions(
      config,
      { allowedTools: ["builtin:text_stats", "mcp:docs:search", "mcp:disabled:search"] },
      selected,
      async (value) => value === "builtin:text_stats" ? "1".repeat(64) : "2".repeat(64),
    );

    expect(definitions.map(({ id, providerName }) => ({ id, providerName }))).toEqual([
      { id: "builtin:text_stats", providerName: "text_stats_1111111111" },
      { id: "mcp:docs:search", providerName: "search_docs_2222222222" },
    ]);
    expect(definitions[1]).toMatchObject({
      label: "Docs search",
      description: "Search reviewed documentation.",
      inputSchema: config.tools?.["mcp:docs:search"]?.inputSchema,
    });
  });

  it("normalizes approval policy by executor boundary", () => {
    expect(normalizeToolConfirmation(config.tools!["builtin:text_stats"])).toBe("auto");
    expect(normalizeToolConfirmation(config.tools!["mcp:docs:search"])).toBe("first-per-conversation");
    expect(normalizeToolConfirmation({
      ...config.tools!["mcp:docs:search"],
      confirmation: "always",
    })).toBe("always");
    expect(normalizeToolConfirmation({
      ...config.tools!["mcp:docs:search"],
      confirmation: "first-per-conversation",
      sideEffect: "write",
    })).toBe("always");
    expect(normalizeToolConfirmation({
      ...config.tools!["mcp:docs:search"],
      confirmation: "first-per-conversation",
      sideEffect: "destructive",
    })).toBe("always");
  });
});
