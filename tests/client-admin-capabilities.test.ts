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
      "mcp:docs:search": { enabled: true, label: "Search", inputSchema: { type: "object" }, confirmation: "always", executor: { type: "mcp", serverId: "docs", remoteName: "search" }, schemaFingerprint: "1".repeat(64), securityFingerprint: "a".repeat(64), sideEffect: "read", reviewRevision: "b".repeat(64), reviewRequired: false },
      "mcp:other:read": { enabled: true, label: "Read", inputSchema: { type: "object" }, confirmation: "first-per-conversation", executor: { type: "mcp", serverId: "other", remoteName: "read" }, schemaFingerprint: "2".repeat(64), securityFingerprint: "c".repeat(64), sideEffect: "read", reviewRevision: "d".repeat(64), reviewRequired: false },
    },
    mcpServers: {
      docs: { enabled: true, label: "Docs", endpoint: "https://docs.example/mcp", auth: { version: 1, type: "bearer", secretRef: "DOCS_MCP" } },
      other: { enabled: true, label: "Other", endpoint: "https://other.example/mcp", auth: { version: 1, type: "none" } },
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

  it("clears matching MCP review state only through explicit enablement", () => {
    const config = createConfig();
    config.tools["mcp:docs:search"] = { ...config.tools["mcp:docs:search"], enabled: false, reviewRequired: true };
    const original = config.tools["mcp:docs:search"];
    const next = applyToolPolicyDraft(config, "mcp:docs:search", { ...createToolPolicyDraft(original), enabled: true });
    expect(next.tools["mcp:docs:search"]).toMatchObject({ enabled: true, reviewRequired: false });
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

  it("round-trips versioned static, none, and OAuth MCP authentication", () => {
    const config = createConfig();
    expect(applyMcpServerDraft(config, "docs", createMcpServerDraft(config.mcpServers.docs, "docs")).mcpServers.docs.auth)
      .toEqual({ version: 1, type: "bearer", secretRef: "DOCS_MCP" });
    expect(applyMcpServerDraft(config, "other", createMcpServerDraft(config.mcpServers.other, "other")).mcpServers.other.auth)
      .toEqual({ version: 1, type: "none" });

    const oauthDraft = {
      ...createMcpServerDraft(undefined, "oauth"),
      enabled: true,
      label: "OAuth MCP",
      endpoint: "https://mcp.example/rpc",
      authType: "oauth2" as const,
      issuer: "https://identity.example/",
      clientId: "chatus-client",
      scopes: "tools.write tools.read tools.read",
      clientSecretRef: "MCP_OAUTH_CLIENT_SECRET",
    };
    expect(validateMcpServerDraft(oauthDraft, config, null)).toEqual({ ok: true });
    expect(applyMcpServerDraft(config, null, oauthDraft).mcpServers.oauth.auth).toEqual({
      version: 1,
      type: "oauth2",
      issuer: "https://identity.example",
      clientId: "chatus-client",
      scopes: ["tools.read", "tools.write"],
      callbackPath: "/api/mcp/oauth/callback",
      configRevision: "",
      clientSecretRef: "MCP_OAUTH_CLIENT_SECRET",
    });
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
    expect(unchanged.config.tools["mcp:docs:new"]).toMatchObject({ enabled: false, confirmation: "first-per-conversation", reviewRequired: true });
    expect(unchanged.config.tools["mcp:docs:search"]).toMatchObject({ enabled: true, confirmation: "always", reviewRequired: false });

    const changed = mergeMcpDiscovery(config, {
      ...discovery,
      tools: [discoveredTool("mcp:docs:search", "search", "4".repeat(64))],
    });
    expect(changed).toMatchObject({ added: 0, changed: 1, unchanged: 0 });
    expect(changed.config.tools["mcp:docs:search"]).toMatchObject({ enabled: false, confirmation: "first-per-conversation", schemaFingerprint: "4".repeat(64), reviewRequired: true });
    expect(changed.config.tools["mcp:other:read"]).toBeDefined();

    const destructive = mergeMcpDiscovery(config, {
      ...discovery,
      tools: [discoveredTool("mcp:docs:search", "search", "1".repeat(64), "destructive")],
    });
    expect(destructive.config.tools["mcp:docs:search"]).toMatchObject({ enabled: false, confirmation: "always", sideEffect: "destructive", reviewRequired: true });
  });

  it("recovers a legacy MCP tool through explicit delete or same-ID discovery", () => {
    const config = createConfig();
    config.tools["mcp:docs:search"] = {
      enabled: false,
      label: "Legacy search",
      inputSchema: { type: "object" },
      confirmation: "first-per-conversation",
      executor: { type: "mcp", serverId: "docs", remoteName: "search" },
      reviewRequired: true,
    };

    const removed = deleteRemoteTool(config, "mcp:docs:search");
    expect(removed.tools["mcp:docs:search"]).toBeUndefined();
    expect(removed.tools["mcp:other:read"]).toEqual(config.tools["mcp:other:read"]);
    expect(removed.providers).toEqual(config.providers);

    const recovered = mergeMcpDiscovery(config, {
      serverId: "docs",
      rejected: 0,
      tools: [discoveredTool("mcp:docs:search", "search", "4".repeat(64))],
    });
    expect(recovered).toMatchObject({ added: 0, changed: 1, unchanged: 0 });
    expect(recovered.config.tools["mcp:docs:search"]).toMatchObject({
      enabled: false,
      schemaFingerprint: "4".repeat(64),
      securityFingerprint: "a".repeat(64),
      sideEffect: "read",
      reviewRevision: "b".repeat(64),
      reviewRequired: true,
    });
    expect(recovered.config.tools["mcp:other:read"]).toEqual(config.tools["mcp:other:read"]);
    expect(recovered.config.providers).toEqual(config.providers);
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

function discoveredTool(
  id: string,
  remoteName: string,
  schemaFingerprint: string,
  sideEffect: "read" | "write" | "destructive" = "read",
): AdminMcpDiscoveryResponse["tools"][number] {
  return {
    id,
    label: remoteName,
    description: `${remoteName} description`,
    inputSchema: { type: "object", properties: {} },
    confirmation: sideEffect === "read" ? "first-per-conversation" : "always",
    executor: { type: "mcp", serverId: "docs", remoteName },
    schemaFingerprint,
    securityFingerprint: "a".repeat(64),
    sideEffect,
    reviewRevision: "b".repeat(64),
    reviewRequired: true,
  };
}
