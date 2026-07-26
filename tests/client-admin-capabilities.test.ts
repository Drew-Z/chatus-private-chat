import { describe, expect, it } from "vitest";
import type { AdminConfig, AdminMcpDiscoveryResponse } from "../client/src/lib/api";
import {
  applyMcpServerDraft,
  applySkillDraft,
  applyToolPolicyDraft,
  canDeleteTool,
  compareCapabilityText,
  createMcpServerDraft,
  createSkillDraft,
  createToolPolicyDraft,
  deleteMcpServer,
  deleteRemoteTool,
  deleteSkill,
  mergeMcpDiscovery,
  rebaseCapabilityConfigDraft,
  validateMcpServerDraft,
  validateSkillDraft,
  validateToolPolicyDraft,
} from "../client/src/lib/admin-capabilities";

function createConfig(): AdminConfig {
  return {
    routes: { primary: { label: "Primary", enabled: true, offerings: [] } },
    providers: {},
    users: {
      bill: { displayName: "Bill", allowedSkills: ["coding", "writing"], allowedTools: ["mcp:docs:search", "builtin:text_stats"] },
      alice: { displayName: "Alice", allowedSkills: ["coding"], allowedTools: ["mcp:docs:search"] },
    },
    defaults: { allowedSkills: ["coding", "coding"], allowedTools: ["mcp:docs:search", "builtin:text_stats"] },
    publicAccess: { enabled: false, routeId: "", sessionTtlSeconds: 3600, dailyMessageLimit: 20, minuteMessageLimit: 6, sourceDailyMessageLimit: 200, sourceMinuteMessageLimit: 30 },
    skills: {
      coding: { enabled: true, label: "Coding", instructions: "Code carefully.", toolIds: ["mcp:docs:search", "builtin:text_stats"], order: 1 },
      writing: { enabled: true, label: "Writing", instructions: "Write clearly.", toolIds: [], order: 2 },
    },
    tools: {
      "builtin:text_stats": { enabled: true, label: "Text stats", inputSchema: { type: "object" }, confirmation: "auto", executor: { type: "builtin", name: "text_stats" } },
      "mcp:docs:search": { enabled: true, label: "Search", inputSchema: { type: "object" }, confirmation: "always", executor: { type: "mcp", serverId: "docs", remoteName: "search" }, schemaFingerprint: "1".repeat(64) },
      "mcp:other:read": { enabled: true, label: "Read", inputSchema: { type: "object" }, confirmation: "first-per-conversation", executor: { type: "mcp", serverId: "other", remoteName: "read" }, schemaFingerprint: "2".repeat(64) },
    },
    mcpServers: {
      docs: { enabled: true, label: "Docs", endpoint: "https://docs.example/mcp", authType: "bearer", secretRef: "DOCS_MCP" },
      other: { enabled: true, label: "Other", endpoint: "https://other.example/mcp", authType: "none" },
    },
  };
}

describe("typed capability administration helpers", () => {
  it("renames and deletes Skills while repairing every explicit assignment", () => {
    const source = createConfig();
    const draft = { ...createSkillDraft(source.skills.coding, "coding-v2"), label: "Coding V2" };
    expect(validateSkillDraft(draft, source, "coding")).toEqual({ ok: true });

    const renamed = applySkillDraft(source, "coding", draft);
    expect(renamed.skills.coding).toBeUndefined();
    expect(renamed.skills["coding-v2"].label).toBe("Coding V2");
    expect(renamed.defaults.allowedSkills).toEqual(["coding-v2"]);
    expect(renamed.users.bill.allowedSkills).toEqual(["coding-v2", "writing"]);
    expect(renamed.users.alice.allowedSkills).toEqual(["coding-v2"]);
    expect(source.skills.coding).toBeDefined();

    const removed = deleteSkill(renamed, "coding-v2");
    expect(removed.defaults.allowedSkills).toEqual([]);
    expect(removed.users.bill.allowedSkills).toEqual(["writing"]);
    expect(removed.users.alice.allowedSkills).toEqual([]);
  });

  it("rejects Skill collisions and missing tool references", () => {
    const config = createConfig();
    expect(validateSkillDraft(createSkillDraft(config.skills.coding, "writing"), config, "coding")).toMatchObject({ ok: false });
    expect(validateSkillDraft({ ...createSkillDraft(config.skills.coding, "coding"), toolIds: ["missing"] }, config, "coding")).toMatchObject({ ok: false });
  });

  it("updates tool policy without replacing schema or executor", () => {
    const config = createConfig();
    const original = config.tools["mcp:docs:search"];
    const draft = { ...createToolPolicyDraft(original), enabled: false, label: "Docs search" };
    expect(validateToolPolicyDraft(original, draft)).toEqual({ ok: true });
    const next = applyToolPolicyDraft(config, "mcp:docs:search", draft);
    expect(next.tools["mcp:docs:search"]).toMatchObject({
      enabled: false,
      label: "Docs search",
      executor: original.executor,
      inputSchema: original.inputSchema,
      schemaFingerprint: original.schemaFingerprint,
    });
  });

  it("forbids builtin deletion and removes remote tool references", () => {
    const config = createConfig();
    expect(canDeleteTool(config.tools["builtin:text_stats"])).toBe(false);
    expect(deleteRemoteTool(config, "builtin:text_stats")).toBe(config);

    const next = deleteRemoteTool(config, "mcp:docs:search");
    expect(next.tools["mcp:docs:search"]).toBeUndefined();
    expect(next.skills.coding.toolIds).toEqual(["builtin:text_stats"]);
    expect(next.defaults.allowedTools).toEqual(["builtin:text_stats"]);
    expect(next.users.bill.allowedTools).toEqual(["builtin:text_stats"]);
    expect(next.users.alice.allowedTools).toEqual([]);
  });

  it("renames an MCP server by removing its reviewed tools and references", () => {
    const config = createConfig();
    const draft = { ...createMcpServerDraft(config.mcpServers.docs, "docs-v2"), label: "Docs V2" };
    expect(validateMcpServerDraft(draft, config, "docs")).toEqual({ ok: true });
    const next = applyMcpServerDraft(config, "docs", draft);
    expect(next.mcpServers.docs).toBeUndefined();
    expect(next.mcpServers["docs-v2"].label).toBe("Docs V2");
    expect(next.tools["mcp:docs:search"]).toBeUndefined();
    expect(next.tools["mcp:other:read"]).toBeDefined();
    expect(next.skills.coding.toolIds).toEqual(["builtin:text_stats"]);
    expect(next.users.bill.allowedTools).toEqual(["builtin:text_stats"]);
  });

  it("deletes only tools owned by the selected MCP server", () => {
    const next = deleteMcpServer(createConfig(), "docs");
    expect(next.mcpServers.docs).toBeUndefined();
    expect(next.mcpServers.other).toBeDefined();
    expect(next.tools["mcp:docs:search"]).toBeUndefined();
    expect(next.tools["mcp:other:read"]).toBeDefined();
  });

  it("merges discovery with review-safe enablement", () => {
    const config = createConfig();
    const discovery: AdminMcpDiscoveryResponse = {
      serverId: "docs",
      rejected: 2,
      tools: [
        discoveredTool("mcp:docs:new", "new", "3".repeat(64)),
        discoveredTool("mcp:docs:search", "search", "1".repeat(64)),
      ],
    };
    const unchanged = mergeMcpDiscovery(config, discovery);
    expect(unchanged).toMatchObject({ added: 1, changed: 0, unchanged: 1 });
    expect(unchanged.config.tools["mcp:docs:new"]).toMatchObject({ enabled: false, confirmation: "first-per-conversation" });
    expect(unchanged.config.tools["mcp:docs:search"]).toMatchObject({ enabled: true, confirmation: "always" });

    const changed = mergeMcpDiscovery(config, {
      ...discovery,
      tools: [discoveredTool("mcp:docs:search", "search", "4".repeat(64))],
    });
    expect(changed).toMatchObject({ added: 0, changed: 1, unchanged: 0 });
    expect(changed.config.tools["mcp:docs:search"]).toMatchObject({ enabled: false, confirmation: "first-per-conversation", schemaFingerprint: "4".repeat(64) });
    expect(changed.config.tools["mcp:other:read"]).toBeDefined();
  });

  it("rebases only locally changed capability registries and assignment fields", () => {
    const base = createConfig();
    const local = deleteRemoteTool(base, "mcp:docs:search");
    const latest = createConfig();
    latest.users.bill = { ...latest.users.bill, displayName: "Bill Latest", dailyMessageLimit: 99 };
    latest.users.alice = { ...latest.users.alice, allowedSkills: ["writing"] };
    latest.skills.extra = { enabled: true, label: "Extra", instructions: "Extra.", toolIds: [] };

    const rebased = rebaseCapabilityConfigDraft(latest, local, base);
    expect(rebased.users.bill).toMatchObject({ displayName: "Bill Latest", dailyMessageLimit: 99, allowedTools: ["builtin:text_stats"] });
    expect(rebased.users.alice.allowedSkills).toEqual(["writing"]);
    expect(rebased.users.alice.allowedTools).toEqual([]);
    expect(rebased.skills.extra).toBeDefined();
    expect(rebased.tools["mcp:docs:search"]).toBeUndefined();
  });

  it("uses stable UTF-16 code-unit ordering", () => {
    expect(["中文", "a", "A", "é"].sort(compareCapabilityText)).toEqual(["A", "a", "é", "中文"]);
  });
});

function discoveredTool(id: string, remoteName: string, schemaFingerprint: string): AdminMcpDiscoveryResponse["tools"][number] {
  return {
    id,
    label: remoteName,
    description: `${remoteName} description`,
    inputSchema: { type: "object", properties: {} },
    confirmation: "first-per-conversation",
    executor: { type: "mcp", serverId: "docs", remoteName },
    schemaFingerprint,
  };
}
