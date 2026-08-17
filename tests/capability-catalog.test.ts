import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPABILITY_PACK_ID,
  capabilityCatalogSnapshot,
  catalogWorkflowSkill,
  defaultWorkflowSkillIds,
  defaultWorkflowSkillRegistry,
  sameCatalogWorkflowDefinition,
} from "../src/services/capability-catalog";

const WORKFLOW_IDS = [
  "chatus:writing",
  "chatus:summarize",
  "chatus:translate",
  "chatus:code_explanation",
  "chatus:structured_output",
];

describe("capability catalog", () => {
  it("owns exactly five bounded instruction-only default workflows", () => {
    expect(defaultWorkflowSkillIds()).toEqual(WORKFLOW_IDS);
    const registry = defaultWorkflowSkillRegistry();
    expect(Object.keys(registry)).toEqual(WORKFLOW_IDS);
    for (const [id, skill] of Object.entries(registry)) {
      expect(skill).toMatchObject({ enabled: true, activation: "automatic", origin: "chatus", toolIds: [] });
      expect(skill.label.length).toBeLessThanOrEqual(80);
      expect(skill.description?.length).toBeLessThanOrEqual(500);
      expect(skill.instructions.length).toBeGreaterThan(0);
      expect(skill.instructions.length).toBeLessThanOrEqual(8_000);
      expect(skill.instructions).not.toMatch(/https?:\/\//u);
      expect(catalogWorkflowSkill(id)).not.toBe(skill);
    }
  });

  it("returns cloned definitions instead of mutable catalog state", () => {
    const first = defaultWorkflowSkillRegistry();
    first[WORKFLOW_IDS[0]].label = "Changed";
    first[WORKFLOW_IDS[0]].toolIds?.push("builtin:text_stats");
    const second = defaultWorkflowSkillRegistry();
    expect(second[WORKFLOW_IDS[0]].label).toBe("写作与改写");
    expect(second[WORKFLOW_IDS[0]].toolIds).toEqual([]);
  });

  it("projects install, disabled, conflict, and setup-required states", () => {
    const canonical = defaultWorkflowSkillRegistry();
    const disabled = { ...canonical[WORKFLOW_IDS[1]], enabled: false };
    const conflict = { ...canonical[WORKFLOW_IDS[2]], instructions: "Administrator-owned instructions." };
    const snapshot = capabilityCatalogSnapshot({
      [WORKFLOW_IDS[0]]: canonical[WORKFLOW_IDS[0]],
      [WORKFLOW_IDS[1]]: disabled,
      [WORKFLOW_IDS[2]]: conflict,
    });

    expect(snapshot).toMatchObject({
      version: 1,
      packs: [{ id: DEFAULT_CAPABILITY_PACK_ID, version: 1 }],
    });
    const statuses = Object.fromEntries(snapshot.packs[0].items.map((item) => [item.id, item.status]));
    expect(statuses).toMatchObject({
      [WORKFLOW_IDS[0]]: "installed",
      [WORKFLOW_IDS[1]]: "disabled",
      [WORKFLOW_IDS[2]]: "conflict",
      [WORKFLOW_IDS[3]]: "missing",
      [WORKFLOW_IDS[4]]: "missing",
      "chatus:web_research": "requires_setup",
      "chatus:vision_assist": "requires_setup",
    });
    expect(snapshot.packs[0].items.filter((item) => item.installable).map((item) => item.id))
      .toEqual([WORKFLOW_IDS[3], WORKFLOW_IDS[4]]);
    expect(sameCatalogWorkflowDefinition(canonical[WORKFLOW_IDS[1]], disabled)).toBe(true);
    expect(sameCatalogWorkflowDefinition(canonical[WORKFLOW_IDS[2]], conflict)).toBe(false);
  });
});
