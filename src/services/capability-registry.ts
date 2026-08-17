import type {
  CapabilityAssignment,
  CapabilityRegistryConfig,
  NormalizedToolDefinition,
  PublicCapabilityDisclosureV1,
  PublicCapabilityV1,
  PublicSkill,
  PublicTool,
  SelectedSkill,
  ToolConfig,
  ToolConfirmation,
} from "../contracts/capability";

const MAX_SELECTED_SKILLS = 3;
const CAPABILITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

type CapabilityFingerprint = (value: string) => Promise<string>;

export function getPublicCapabilities(
  config: CapabilityRegistryConfig,
  assignment: CapabilityAssignment,
): { capabilities: PublicCapabilityV1[]; skills: PublicSkill[]; tools: PublicTool[] } {
  const allowedSkillIds = getAllowedSkillIds(assignment);
  const allowedToolIds = new Set(assignment.allowedTools || []);
  const tools = Object.entries(config.tools || {})
    .filter(([id, tool]) => (
      tool.enabled === true
      && allowedToolIds.has(id)
      && isToolExecutorAvailable(tool, config)
    ))
    .map(([id, tool]): PublicTool => ({
      id,
      label: tool.label,
      description: tool.description || "",
      source: tool.executor.type,
      confirmation: normalizeToolConfirmation(tool),
    }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));

  const publicToolIds = new Set(tools.map((tool) => tool.id));
  const skills = Object.entries(config.skills || {})
    .filter(([id, skill]) => (
      skill.enabled === true
      && skill.activation !== "explicit_turn"
      && (!allowedSkillIds || allowedSkillIds.has(id))
    ))
    .sort(([leftId, left], [rightId, right]) => (
      (left.order || 0) - (right.order || 0) || leftId.localeCompare(rightId)
    ))
    .map(([id, skill]): PublicSkill => ({
      id,
      label: skill.label,
      description: skill.description || "",
      toolIds: (skill.toolIds || []).filter((toolId) => publicToolIds.has(toolId)),
    }));

  const capabilities = Object.entries(config.skills || {})
    .filter(([id, skill]) => skill.enabled === true && (!allowedSkillIds || allowedSkillIds.has(id)))
    .sort(([leftId, left], [rightId, right]) => (
      (left.order || 0) - (right.order || 0) || compareStableText(leftId, rightId)
    ))
    .map(([id, skill]): PublicCapabilityV1 => {
      const referencedTools = (skill.toolIds || [])
        .map((toolId) => config.tools?.[toolId])
        .filter((tool): tool is ToolConfig => Boolean(tool));
      const executable = (skill.toolIds || []).every((toolId) => publicToolIds.has(toolId));
      return {
        id,
        label: skill.label,
        description: skill.description || "",
        source: skill.origin || "administrator",
        activation: skill.activation === "explicit_turn" ? "explicit_turn" : "workflow",
        availability: executable ? "available" : "unavailable",
        disclosure: capabilityDisclosure(referencedTools),
        ...(executable ? {} : { unavailableReason: "tool_unavailable" as const }),
      };
    });

  if (assignment.allowedAugmentations?.includes("vision_assist")) {
    capabilities.push({
      id: "chatus:vision_assist",
      label: "视觉辅助",
      description: "通过管理员选择的原生视觉线路为文本模型生成受限图像证据。",
      source: "chatus",
      activation: "route_augmentation",
      availability: "requires_setup",
      unavailableReason: "helper_unavailable",
      disclosure: {
        execution: "auxiliary_provider",
        externalRequest: true,
        dataClasses: ["image"],
        latency: "variable",
        cost: "provider_request",
      },
    });
  }

  return { capabilities, skills, tools };
}

export function getSelectedSkills(
  config: CapabilityRegistryConfig,
  value: unknown,
  assignment?: CapabilityAssignment,
): SelectedSkill[] {
  const allowedSkillIds = getAllowedSkillIds(assignment);
  const requested = new Set(normalizeSelectedSkillIds(value));
  return Object.entries(config.skills || {})
    .filter(([id, skill]) => (
      requested.has(id)
      && skill.enabled === true
      && skill.activation !== "explicit_turn"
      && (!allowedSkillIds || allowedSkillIds.has(id))
    ))
    .sort(([leftId, left], [rightId, right]) => (
      (left.order || 0) - (right.order || 0) || leftId.localeCompare(rightId)
    ))
    .slice(0, MAX_SELECTED_SKILLS)
    .map(([id, skill]) => ({ id, skill }));
}

export async function buildCapabilityToolDefinitions(
  config: CapabilityRegistryConfig,
  assignment: CapabilityAssignment,
  selectedSkills: SelectedSkill[],
  fingerprint: CapabilityFingerprint,
): Promise<NormalizedToolDefinition[]> {
  const allowed = new Set(assignment.allowedTools || []);
  const referenced = new Set(selectedSkills.flatMap(({ skill }) => skill.toolIds || []));
  const definitions: NormalizedToolDefinition[] = [];

  for (const toolId of referenced) {
    const tool = config.tools?.[toolId];
    if (!tool || tool.enabled !== true || !allowed.has(toolId) || !isToolExecutorAvailable(tool, config)) {
      continue;
    }
    definitions.push({
      id: toolId,
      providerName: await providerToolName(toolId, tool, fingerprint),
      label: tool.label,
      description: tool.description || tool.label,
      inputSchema: tool.inputSchema,
      config: tool,
    });
  }

  return definitions.sort((left, right) => left.id.localeCompare(right.id));
}

export function isToolExecutorAvailable(tool: ToolConfig, config: CapabilityRegistryConfig): boolean {
  if (tool.executor.type === "builtin") return tool.executor.name === "text_stats";
  return config.mcpServers?.[tool.executor.serverId]?.enabled === true;
}

export function normalizeToolConfirmation(tool: ToolConfig): ToolConfirmation {
  if (tool.executor.type === "builtin") return tool.confirmation === "always" ? "always" : "auto";
  if (tool.sideEffect === "write" || tool.sideEffect === "destructive") return "always";
  return tool.confirmation === "always" ? "always" : "first-per-conversation";
}

async function providerToolName(
  toolId: string,
  tool: ToolConfig,
  fingerprint: CapabilityFingerprint,
): Promise<string> {
  const sourceName = tool.executor.type === "builtin" ? tool.executor.name : tool.executor.remoteName;
  const normalized = sourceName.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "tool";
  const digest = (await fingerprint(toolId)).slice(0, 10);
  return `${normalized}_${digest}`.slice(0, 64);
}

function normalizeSelectedSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const id = normalizeCapabilityId(item, 80);
    if (!id || output.includes(id)) continue;
    output.push(id);
    if (output.length >= MAX_SELECTED_SKILLS) break;
  }
  return output;
}

function getAllowedSkillIds(assignment?: CapabilityAssignment): Set<string> | null {
  return assignment?.allowedSkills === undefined ? null : new Set(assignment.allowedSkills);
}

function normalizeCapabilityId(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id.length > 0 && id.length <= maxChars && CAPABILITY_ID_PATTERN.test(id) ? id : "";
}

function capabilityDisclosure(tools: ToolConfig[]): PublicCapabilityDisclosureV1 {
  const hasMcp = tools.some((tool) => tool.executor.type === "mcp");
  const hasBuiltin = tools.some((tool) => tool.executor.type === "builtin");
  const hasWebSearch = tools.some((tool) => tool.capabilityRole === "web_search");
  return {
    execution: hasMcp ? "reviewed_mcp" : hasBuiltin ? "trusted_local" : "instructions",
    externalRequest: hasMcp,
    dataClasses: hasWebSearch ? ["search_query"] : ["prompt_text"],
    latency: hasMcp ? "variable" : hasBuiltin ? "small" : "none",
    cost: hasMcp ? "external_service" : "none",
  };
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
