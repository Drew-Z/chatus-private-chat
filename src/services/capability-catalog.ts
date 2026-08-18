import type {
  AdminCapabilityCatalogSnapshotV1,
  AdminCapabilityPackItemStatus,
  PublicCapabilityDisclosureV1,
  SkillConfig,
} from "../contracts/capability";

export const CAPABILITY_CATALOG_VERSION = 1 as const;
export const DEFAULT_CAPABILITY_PACK_ID = "chatus:starter-capabilities";

const WORKFLOW_DISCLOSURE: PublicCapabilityDisclosureV1 = {
  execution: "instructions",
  externalRequest: false,
  dataClasses: ["prompt_text"],
  latency: "none",
  cost: "none",
};

type WorkflowDefinition = {
  id: string;
  skill: SkillConfig;
};

const WORKFLOW_DEFINITIONS: readonly WorkflowDefinition[] = [
  {
    id: "chatus:writing",
    skill: {
      enabled: true,
      label: "写作与改写",
      description: "起草、改写并润色文本，同时保留原意和约束。",
      instructions: [
        "Follow the Chatus writing workflow for this turn.",
        "Draft, rewrite, or improve only the text the user asks you to work on.",
        "Preserve the user's intent, facts, terminology, formatting constraints, and requested tone.",
        "Do not claim current facts, external research, code execution, image inspection, or tool access.",
      ].join("\n"),
      toolIds: [],
      order: 100,
      activation: "automatic",
      origin: "chatus",
    },
  },
  {
    id: "chatus:summarize",
    skill: {
      enabled: true,
      label: "总结",
      description: "生成有边界的摘要、要点、结论和待确认问题。",
      instructions: [
        "Follow the Chatus summarization workflow for this turn.",
        "Summarize only information supplied in the conversation or attached text.",
        "Separate confirmed points, decisions, open questions, and omissions when useful.",
        "Do not add fresh facts or imply that you accessed an external source.",
      ].join("\n"),
      toolIds: [],
      order: 101,
      activation: "automatic",
      origin: "chatus",
    },
  },
  {
    id: "chatus:translate",
    skill: {
      enabled: true,
      label: "翻译",
      description: "忠实翻译文本，并保留术语、结构和格式。",
      instructions: [
        "Follow the Chatus translation workflow for this turn.",
        "Translate faithfully between the languages requested by the user.",
        "Preserve names, terminology, code, links, formatting, and ambiguity unless clarification is necessary.",
        "Do not invent missing context or claim external verification.",
      ].join("\n"),
      toolIds: [],
      order: 102,
      activation: "automatic",
      origin: "chatus",
    },
  },
  {
    id: "chatus:code_explanation",
    skill: {
      enabled: true,
      label: "代码解释",
      description: "解释提供的代码、数据流、边界和潜在风险，不声称已执行。",
      instructions: [
        "Follow the Chatus code-explanation workflow for this turn.",
        "Explain only the supplied code and clearly separate observed behavior from inference.",
        "Describe inputs, outputs, data flow, edge cases, and risks at the user's level of detail.",
        "Never claim that code, tests, tools, or external systems were executed unless the conversation provides that evidence.",
      ].join("\n"),
      toolIds: [],
      order: 103,
      activation: "automatic",
      origin: "chatus",
    },
  },
  {
    id: "chatus:structured_output",
    skill: {
      enabled: true,
      label: "结构化输出",
      description: "把已有信息整理成用户要求的列表、表格、JSON 或其他结构。",
      instructions: [
        "Follow the Chatus structured-output workflow for this turn.",
        "Transform supplied information into the exact structure requested by the user.",
        "Preserve values and uncertainty, use stable field names, and keep the result internally consistent.",
        "Do not fabricate values to fill missing fields; use an explicit null, omission, or limitation when appropriate.",
      ].join("\n"),
      toolIds: [],
      order: 104,
      activation: "automatic",
      origin: "chatus",
    },
  },
] as const;

export function defaultWorkflowSkillIds(): string[] {
  return WORKFLOW_DEFINITIONS.map(({ id }) => id);
}

export function defaultWorkflowSkillRegistry(): Record<string, SkillConfig> {
  return Object.fromEntries(WORKFLOW_DEFINITIONS.map(({ id, skill }) => [id, cloneSkill(skill)]));
}

export function catalogWorkflowSkill(id: string): SkillConfig | null {
  const definition = WORKFLOW_DEFINITIONS.find((item) => item.id === id);
  return definition ? cloneSkill(definition.skill) : null;
}

export function isCatalogWorkflowSkillId(id: string): boolean {
  return WORKFLOW_DEFINITIONS.some((item) => item.id === id);
}

export function capabilityCatalogSnapshot(
  skills: Record<string, SkillConfig> | undefined,
  visionAssistStatus: Extract<AdminCapabilityPackItemStatus, "installed" | "disabled" | "requires_setup"> = "requires_setup",
  webResearchStatus: Extract<AdminCapabilityPackItemStatus, "installed" | "disabled" | "requires_setup"> = "requires_setup",
): AdminCapabilityCatalogSnapshotV1 {
  const workflowItems = WORKFLOW_DEFINITIONS.map(({ id, skill }) => ({
    id,
    label: skill.label,
    description: skill.description || "",
    source: "chatus" as const,
    activation: "workflow" as const,
    status: catalogWorkflowStatus(skill, skills?.[id]),
    installable: skills?.[id] === undefined,
    disclosure: cloneDisclosure(WORKFLOW_DISCLOSURE),
  }));
  return {
    version: CAPABILITY_CATALOG_VERSION,
    packs: [{
      id: DEFAULT_CAPABILITY_PACK_ID,
      version: 1,
      label: "Chatus 默认能力",
      description: "低风险语言工作流，以及需要管理员完成外部配置的可选能力。",
      items: [
        ...workflowItems,
        {
          id: "chatus:web_research",
          label: "联网研究",
          description: "通过管理员审核的只读 MCP 搜索工具获取当前来源。",
          source: "chatus",
          activation: "explicit_turn",
          status: webResearchStatus,
          installable: false,
          disclosure: {
            execution: "reviewed_mcp",
            externalRequest: true,
            dataClasses: ["search_query"],
            latency: "variable",
            cost: "external_service",
          },
        },
        {
          id: "chatus:vision_assist",
          label: "视觉辅助",
          description: "通过管理员选择的原生视觉线路为文本模型生成受限图像证据。",
          source: "chatus",
          activation: "route_augmentation",
          status: visionAssistStatus,
          installable: false,
          disclosure: {
            execution: "auxiliary_provider",
            externalRequest: true,
            dataClasses: ["image"],
            latency: "variable",
            cost: "provider_request",
          },
        },
      ],
    }],
  };
}

export function catalogWorkflowStatus(
  definition: SkillConfig,
  current: SkillConfig | undefined,
): AdminCapabilityPackItemStatus {
  if (!current) return "missing";
  if (!sameCatalogWorkflowDefinition(definition, current)) return "conflict";
  return current.enabled === true ? "installed" : "disabled";
}

export function sameCatalogWorkflowDefinition(definition: SkillConfig, current: SkillConfig): boolean {
  return current.label === definition.label
    && (current.description || "") === (definition.description || "")
    && current.instructions === definition.instructions
    && JSON.stringify(current.toolIds || []) === JSON.stringify(definition.toolIds || [])
    && (current.order ?? 0) === (definition.order ?? 0)
    && (current.activation || "automatic") === (definition.activation || "automatic")
    && current.origin === "chatus";
}

function cloneSkill(skill: SkillConfig): SkillConfig {
  return { ...skill, toolIds: [...(skill.toolIds || [])] };
}

function cloneDisclosure(disclosure: PublicCapabilityDisclosureV1): PublicCapabilityDisclosureV1 {
  return { ...disclosure, dataClasses: [...disclosure.dataClasses] };
}
