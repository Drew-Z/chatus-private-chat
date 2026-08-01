import type {
  AdminConfig,
  AdminMcpAuthConfig,
  AdminMcpDiscoveryResponse,
  AdminMcpServerConfig,
  AdminSkillConfig,
  AdminToolConfig,
} from "./api";

export const CAPABILITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
export const MCP_SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export const BUILTIN_TEXT_STATS_ID = "builtin:text_stats";
export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback" as const;

export type CapabilityValidation = { ok: true } | { ok: false; message: string };

export type SkillDraft = {
  id: string;
  enabled: boolean;
  label: string;
  description: string;
  instructions: string;
  toolIds: string[];
  order: number;
};

export type ToolPolicyDraft = {
  enabled: boolean;
  label: string;
  description: string;
  confirmation: AdminToolConfig["confirmation"];
};

export type McpServerDraft = Omit<AdminMcpServerConfig, "auth"> & {
  id: string;
  authType: AdminMcpAuthConfig["type"];
  secretRef: string;
  issuer: string;
  clientId: string;
  scopes: string;
  clientSecretRef: string;
  configRevision: string;
};

export function compareCapabilityText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function orderedSkillEntries(config: AdminConfig): Array<[string, AdminSkillConfig]> {
  return Object.entries(config.skills).sort(([leftId, left], [rightId, right]) => (
    (left.order ?? 0) - (right.order ?? 0)
    || compareCapabilityText(left.label, right.label)
    || compareCapabilityText(leftId, rightId)
  ));
}

export function orderedToolEntries(config: AdminConfig): Array<[string, AdminToolConfig]> {
  return Object.entries(config.tools).sort(([leftId, left], [rightId, right]) => (
    compareCapabilityText(left.label, right.label) || compareCapabilityText(leftId, rightId)
  ));
}

export function orderedMcpServerEntries(config: AdminConfig): Array<[string, AdminMcpServerConfig]> {
  return Object.entries(config.mcpServers).sort(([leftId, left], [rightId, right]) => (
    compareCapabilityText(left.label, right.label) || compareCapabilityText(leftId, rightId)
  ));
}

export function createSkillDraft(skill: AdminSkillConfig | undefined, id: string): SkillDraft {
  return {
    id,
    enabled: skill?.enabled ?? true,
    label: skill?.label || "",
    description: skill?.description || "",
    instructions: skill?.instructions || "",
    toolIds: [...(skill?.toolIds || [])],
    order: skill?.order ?? 0,
  };
}

export function createToolPolicyDraft(tool: AdminToolConfig): ToolPolicyDraft {
  return {
    enabled: tool.enabled,
    label: tool.label,
    description: tool.description || "",
    confirmation: tool.confirmation,
  };
}

export function createMcpServerDraft(server: AdminMcpServerConfig | undefined, id: string): McpServerDraft {
  const auth = server?.auth;
  return {
    id,
    enabled: server?.enabled ?? false,
    label: server?.label || "",
    endpoint: server?.endpoint || "https://",
    authType: auth?.type || "none",
    secretRef: auth?.type === "bearer" || auth?.type === "x-api-key" ? auth.secretRef : "",
    issuer: auth?.type === "oauth2" ? auth.issuer : "",
    clientId: auth?.type === "oauth2" ? auth.clientId : "",
    scopes: auth?.type === "oauth2" ? auth.scopes.join(" ") : "",
    clientSecretRef: auth?.type === "oauth2" ? auth.clientSecretRef || "" : "",
    configRevision: auth?.type === "oauth2" ? auth.configRevision : "",
  };
}

export function validateSkillDraft(draft: SkillDraft, config: AdminConfig, previousId: string | null): CapabilityValidation {
  if (!isCapabilityId(draft.id, 80)) return invalid("Skill ID 格式无效，最多 80 个字符。");
  if (previousId !== draft.id && hasOwn(config.skills, draft.id)) return invalid("这个 Skill ID 已存在。");
  if (!draft.label.trim() || draft.label.trim().length > 80) return invalid("Skill 名称不能为空且最多 80 个字符。");
  if (draft.description.trim().length > 500) return invalid("Skill 说明最多 500 个字符。");
  if (!draft.instructions.trim() || draft.instructions.length > 8_000) return invalid("Skill instructions 必填且最多 8000 个字符。");
  if (!Number.isInteger(draft.order) || draft.order < -10_000 || draft.order > 10_000) return invalid("排序必须是 -10000 到 10000 的整数。");
  if (new Set(draft.toolIds).size !== draft.toolIds.length || draft.toolIds.some((id) => !hasOwn(config.tools, id))) {
    return invalid("Skill 工具引用包含重复项或不存在的工具。");
  }
  return { ok: true };
}

export function validateToolPolicyDraft(tool: AdminToolConfig, draft: ToolPolicyDraft): CapabilityValidation {
  if (!draft.label.trim() || draft.label.trim().length > 80) return invalid("工具名称不能为空且最多 80 个字符。");
  if (draft.description.trim().length > 1_000) return invalid("工具说明最多 1000 个字符。");
  if (tool.executor.type === "builtin" && draft.confirmation !== "auto" && draft.confirmation !== "always") {
    return invalid("内置工具只支持自动或每次确认。");
  }
  if (tool.executor.type === "mcp" && draft.confirmation !== "first-per-conversation" && draft.confirmation !== "always") {
    return invalid("MCP 工具只支持首次或每次确认。");
  }
  return { ok: true };
}

export function validateMcpServerDraft(
  draft: McpServerDraft,
  config: AdminConfig,
  previousId: string | null,
): CapabilityValidation {
  if (!isCapabilityId(draft.id, 80)) return invalid("MCP Server ID 格式无效，最多 80 个字符。");
  if (previousId !== draft.id && hasOwn(config.mcpServers, draft.id)) return invalid("这个 MCP Server ID 已存在。");
  if (!draft.label.trim() || draft.label.trim().length > 80) return invalid("MCP Server 名称不能为空且最多 80 个字符。");
  if (!isHttpsEndpoint(draft.endpoint)) return invalid("MCP endpoint 必须是有效的公开 HTTPS 地址。");
  if ((draft.authType === "bearer" || draft.authType === "x-api-key") && !MCP_SECRET_REF_PATTERN.test(draft.secretRef.trim())) {
    return invalid("静态认证必须填写有效的 Secret Ref。");
  }
  if (draft.authType === "oauth2") {
    if (!isHttpsOAuthIssuer(draft.issuer)) return invalid("OAuth issuer 必须是有效的公开 HTTPS 地址。");
    const clientId = draft.clientId.trim();
    if (!clientId || clientId.length > 256 || /[\u0000-\u001f\u007f]/.test(clientId)) {
      return invalid("OAuth Client ID 必填且最多 256 个字符。");
    }
    if (!parseMcpOAuthScopes(draft.scopes).length) return invalid("OAuth 至少需要一个有效 Scope。");
    if (draft.clientSecretRef.trim() && !MCP_SECRET_REF_PATTERN.test(draft.clientSecretRef.trim())) {
      return invalid("OAuth Client Secret Ref 格式无效。");
    }
  }
  return { ok: true };
}

export function applySkillDraft(config: AdminConfig, previousId: string | null, draft: SkillDraft): AdminConfig {
  const skills = { ...config.skills };
  if (previousId && previousId !== draft.id) delete skills[previousId];
  skills[draft.id] = {
    enabled: draft.enabled,
    label: draft.label.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    instructions: draft.instructions.trim(),
    toolIds: unique(draft.toolIds),
    order: draft.order,
  };
  if (!previousId || previousId === draft.id) return { ...config, skills };
  return replaceAssignmentReference({ ...config, skills }, "allowedSkills", previousId, draft.id);
}

export function deleteSkill(config: AdminConfig, skillId: string): AdminConfig {
  if (!hasOwn(config.skills, skillId)) return config;
  const skills = { ...config.skills };
  delete skills[skillId];
  return replaceAssignmentReference({ ...config, skills }, "allowedSkills", skillId);
}

export function applyToolPolicyDraft(config: AdminConfig, toolId: string, draft: ToolPolicyDraft): AdminConfig {
  const tool = config.tools[toolId];
  if (!tool) return config;
  return {
    ...config,
    tools: {
      ...config.tools,
      [toolId]: {
        ...tool,
        enabled: draft.enabled,
        label: draft.label.trim(),
        ...(draft.description.trim() ? { description: draft.description.trim() } : { description: undefined }),
        confirmation: draft.confirmation,
        ...(tool.executor.type === "mcp" && draft.enabled ? { reviewRequired: false } : {}),
      },
    },
  };
}

export function canDeleteTool(tool: AdminToolConfig | undefined): boolean {
  return tool?.executor.type === "mcp";
}

export function deleteRemoteTool(config: AdminConfig, toolId: string): AdminConfig {
  if (!canDeleteTool(config.tools[toolId])) return config;
  return removeToolsAndReferences(config, new Set([toolId]));
}

export function applyMcpServerDraft(config: AdminConfig, previousId: string | null, draft: McpServerDraft): AdminConfig {
  let next = config;
  if (previousId && previousId !== draft.id) next = deleteMcpServer(next, previousId);
  const mcpServers = { ...next.mcpServers };
  mcpServers[draft.id] = {
    enabled: draft.enabled,
    label: draft.label.trim(),
    endpoint: draft.endpoint.trim(),
    auth: createMcpAuthConfig(draft),
  };
  return { ...next, mcpServers };
}

export function deleteMcpServer(config: AdminConfig, serverId: string): AdminConfig {
  if (!hasOwn(config.mcpServers, serverId)) return config;
  const mcpServers = { ...config.mcpServers };
  delete mcpServers[serverId];
  const toolIds = new Set(Object.entries(config.tools)
    .filter(([, tool]) => tool.executor.type === "mcp" && tool.executor.serverId === serverId)
    .map(([id]) => id));
  return removeToolsAndReferences({ ...config, mcpServers }, toolIds);
}

export function mergeMcpDiscovery(
  config: AdminConfig,
  result: AdminMcpDiscoveryResponse,
): { config: AdminConfig; added: number; changed: number; unchanged: number } {
  if (!hasOwn(config.mcpServers, result.serverId)) return { config, added: 0, changed: 0, unchanged: 0 };
  const tools = { ...config.tools };
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  const candidates = [...result.tools].sort((left, right) => compareCapabilityText(left.id, right.id));
  for (const candidate of candidates) {
    const { id, ...toolConfig } = candidate;
    const existing = tools[id];
    const sameReview = existing?.executor.type === "mcp"
      && existing.executor.serverId === result.serverId
      && existing.executor.remoteName === candidate.executor.remoteName
      && existing.schemaFingerprint === candidate.schemaFingerprint
      && existing.securityFingerprint === candidate.securityFingerprint
      && existing.sideEffect === candidate.sideEffect
      && existing.reviewRevision === candidate.reviewRevision;
    if (!existing) added += 1;
    else if (sameReview) unchanged += 1;
    else changed += 1;
    tools[id] = {
      ...toolConfig,
      enabled: sameReview ? existing.enabled : false,
      confirmation: candidate.sideEffect === "read"
        ? sameReview && existing.confirmation === "always" ? "always" : "first-per-conversation"
        : "always",
      reviewRequired: sameReview ? existing.reviewRequired === true : true,
    };
  }
  return { config: { ...config, tools }, added, changed, unchanged };
}

export function rebaseCapabilityConfigDraft(latest: AdminConfig, local: AdminConfig, base: AdminConfig): AdminConfig {
  const skills = rebaseRegistry(latest.skills, local.skills, base.skills);
  const tools = rebaseRegistry(latest.tools, local.tools, base.tools);
  const mcpServers = rebaseRegistry(latest.mcpServers, local.mcpServers, base.mcpServers);
  const defaults = rebaseAssignment(latest.defaults, local.defaults, base.defaults);
  const users = { ...latest.users };
  for (const label of Object.keys(base.users)) {
    if (!users[label] || !local.users[label]) continue;
    users[label] = rebaseAssignment(users[label], local.users[label], base.users[label]);
  }
  return { ...latest, skills, tools, mcpServers, defaults, users };
}

function removeToolsAndReferences(config: AdminConfig, toolIds: Set<string>): AdminConfig {
  if (!toolIds.size) return config;
  const tools = { ...config.tools };
  for (const toolId of toolIds) delete tools[toolId];
  const skills = Object.fromEntries(Object.entries(config.skills).map(([id, skill]) => [id, {
    ...skill,
    toolIds: skill.toolIds.filter((toolId) => !toolIds.has(toolId)),
  }]));
  let next: AdminConfig = { ...config, skills, tools };
  for (const toolId of toolIds) next = replaceAssignmentReference(next, "allowedTools", toolId);
  return next;
}

function replaceAssignmentReference(
  config: AdminConfig,
  field: "allowedSkills" | "allowedTools",
  previousId: string,
  nextId?: string,
): AdminConfig {
  const replace = (values: string[] | undefined) => values === undefined
    ? undefined
    : unique(values.flatMap((value) => value === previousId ? nextId ? [nextId] : [] : [value]));
  const defaults = { ...config.defaults };
  if (defaults[field] !== undefined) defaults[field] = replace(defaults[field]);
  const users = Object.fromEntries(Object.entries(config.users).map(([label, user]) => {
    if (user[field] === undefined) return [label, user];
    return [label, { ...user, [field]: replace(user[field]) }];
  }));
  return { ...config, defaults, users };
}

function rebaseRegistry<T>(latest: Record<string, T>, local: Record<string, T>, base: Record<string, T>): Record<string, T> {
  const next = { ...latest };
  for (const id of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (sameValue(base[id], local[id])) continue;
    if (hasOwn(local, id)) next[id] = local[id];
    else delete next[id];
  }
  return next;
}

function rebaseAssignment<T extends { allowedSkills?: string[]; allowedTools?: string[] }>(latest: T, local: T, base: T): T {
  const next = { ...latest };
  for (const field of ["allowedSkills", "allowedTools"] as const) {
    if (sameValue(base[field], local[field])) continue;
    if (local[field] === undefined) delete next[field];
    else next[field] = [...local[field]];
  }
  return next;
}

function isCapabilityId(value: string, maxLength: number): boolean {
  return value.length <= maxLength && CAPABILITY_ID_PATTERN.test(value);
}

function isHttpsEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isHttpsOAuthIssuer(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return url.protocol === "https:"
      && Boolean(hostname)
      && hostname !== "localhost"
      && !hostname.endsWith(".localhost")
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function createMcpAuthConfig(draft: McpServerDraft): AdminMcpAuthConfig {
  if (draft.authType === "none") return { version: 1, type: "none" };
  if (draft.authType === "bearer" || draft.authType === "x-api-key") {
    return { version: 1, type: draft.authType, secretRef: draft.secretRef.trim() };
  }
  return {
    version: 1,
    type: "oauth2",
    issuer: draft.issuer.trim().replace(/\/$/, ""),
    clientId: draft.clientId.trim(),
    scopes: parseMcpOAuthScopes(draft.scopes),
    callbackPath: MCP_OAUTH_CALLBACK_PATH,
    configRevision: draft.configRevision,
    ...(draft.clientSecretRef.trim() ? { clientSecretRef: draft.clientSecretRef.trim() } : {}),
  };
}

function parseMcpOAuthScopes(value: string): string[] {
  return [...new Set(value.split(/\s+/).map((scope) => scope.trim()).filter((scope) => (
    scope.length > 0 && scope.length <= 120 && !/\s/.test(scope)
  )))].slice(0, 32).sort(compareCapabilityText);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalid(message: string): CapabilityValidation {
  return { ok: false, message };
}
