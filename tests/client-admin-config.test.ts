import { describe, expect, it } from "vitest";
import {
  applyCapabilityAssignmentDraft,
  createCapabilityAssignmentDraft,
  DEFAULT_ADMIN_MEMBER,
  getCapabilityAssignmentDraftError,
  getMemberPolicyLimitError,
  rebaseCapabilityAssignmentDraft,
  setDefaultRoute,
  setRouteAllowed,
  setRouteInheritance,
  setMemberPolicyInheritance,
} from "../client/src/lib/admin-config";
import type { AdminConfig } from "../client/src/lib/api";

function configFixture(): AdminConfig {
  return {
    routes: {
      primary: { label: "Primary", enabled: true },
      secondary: { label: "Secondary", enabled: true },
      retired: { label: "Z Retired", enabled: false },
    },
    providers: {
      shared: {
        label: "Shared",
        type: "openai-chat",
        baseUrl: "https://provider.example/v1",
        hasLegacyKey: true,
      },
    },
    users: {
      bill: {
        displayName: "Bill",
        allowedSkills: ["writing"],
        timezone: "Asia/Shanghai",
        defaultRoute: "primary",
        allowedRoutes: ["primary", "secondary"],
      },
    },
    defaults: {
      enabled: true,
      defaultRoute: "primary",
      allowedRoutes: ["primary", "secondary"],
      allowedSkills: ["coding"],
      allowedTools: ["builtin:text_stats"],
      dailyMessageLimit: 500,
      minuteMessageLimit: 12,
    },
    skills: {
      coding: { enabled: true, label: "Coding", instructions: "code", toolIds: [], order: 1 },
      writing: { enabled: true, label: "Writing", instructions: "write", toolIds: [], order: 2 },
    },
    tools: {
      "builtin:text_stats": {
        enabled: true,
        label: "Text stats",
        inputSchema: { type: "object" },
        confirmation: "auto",
        executor: { type: "builtin", name: "text_stats" },
      },
    },
    mcpServers: {},
  };
}

describe("typed admin capability assignment", () => {
  it("keeps undefined member fields as inherited defaults", () => {
    const config = configFixture();
    const draft = createCapabilityAssignmentDraft(config, "new-member");
    expect(draft.inheritSkills).toBe(true);
    expect(draft.allowedSkills).toEqual(["coding"]);
    expect(draft.inheritTools).toBe(true);
    expect(draft.allowedTools).toEqual(["builtin:text_stats"]);
    expect(draft.inheritAugmentations).toBe(true);
    expect(draft.allowedAugmentations).toEqual([]);
    expect(draft.inheritRoutes).toBe(true);
    expect(draft.allowedRoutes).toEqual(["primary", "secondary"]);
    expect(draft.routeSelectionMode).toBe("selected");
    expect(draft.inheritDefaultRoute).toBe(true);
    expect(draft.defaultRoute).toBe("primary");
    expect(draft.routesDirty).toBe(false);
    expect(draft.inheritEnabled).toBe(true);
    expect(draft.enabled).toBe(true);
    expect(draft.inheritDailyMessageLimit).toBe(true);
    expect(draft.dailyMessageLimit).toBe(500);
    expect(draft.inheritMinuteMessageLimit).toBe(true);
    expect(draft.minuteMessageLimit).toBe(12);
  });

  it("writes explicit empty lists without changing unrelated configuration", () => {
    const config = configFixture();
    const draft = createCapabilityAssignmentDraft(config, "bill");
    const next = applyCapabilityAssignmentDraft(config, "bill", {
      ...draft,
      inheritSkills: false,
      allowedSkills: [],
      inheritTools: true,
      inheritAugmentations: false,
      allowedAugmentations: [],
    });
    expect(next.users.bill).toMatchObject({ displayName: "Bill", timezone: "Asia/Shanghai", allowedSkills: [] });
    expect(next.users.bill.allowedTools).toBeUndefined();
    expect(next.users.bill.allowedAugmentations).toEqual([]);
    expect(next.providers.shared).toEqual(config.providers.shared);
    expect(next.routes).toEqual(config.routes);
    expect(next.users.bill.defaultRoute).toBe("primary");
    expect(next.users.bill.allowedRoutes).toEqual(["primary", "secondary"]);
    expect(next.users.bill.enabled).toBeUndefined();
    expect(next.users.bill.dailyMessageLimit).toBeUndefined();
    expect(next.users.bill.minuteMessageLimit).toBeUndefined();
  });

  it("inherits, denies, and rebases vision augmentation independently", () => {
    const config = configFixture();
    config.defaults.allowedAugmentations = ["vision_assist"];
    const inherited = createCapabilityAssignmentDraft(config, "bill");
    expect(inherited.inheritAugmentations).toBe(true);
    expect(inherited.allowedAugmentations).toEqual(["vision_assist"]);
    expect(applyCapabilityAssignmentDraft(config, "bill", inherited).users.bill.allowedAugmentations).toBeUndefined();

    const denied = { ...inherited, inheritAugmentations: false, allowedAugmentations: [] as [] };
    expect(applyCapabilityAssignmentDraft(config, "bill", denied).users.bill.allowedAugmentations).toEqual([]);

    const latest = configFixture();
    latest.defaults.allowedAugmentations = [];
    const rebased = rebaseCapabilityAssignmentDraft(latest, "bill", inherited);
    expect(rebased.inheritAugmentations).toBe(true);
    expect(rebased.allowedAugmentations).toEqual([]);
  });

  it("writes member status and quotas atomically while preserving unrelated fields", () => {
    const config = configFixture();
    const draft = createCapabilityAssignmentDraft(config, "bill");
    const next = applyCapabilityAssignmentDraft(config, "bill", {
      ...draft,
      inheritEnabled: false,
      enabled: false,
      enabledDirty: true,
      inheritDailyMessageLimit: false,
      dailyMessageLimit: 250,
      dailyMessageLimitDirty: true,
      inheritMinuteMessageLimit: false,
      minuteMessageLimit: 8,
      minuteMessageLimitDirty: true,
    });
    expect(next.users.bill).toMatchObject({
      enabled: false,
      dailyMessageLimit: 250,
      minuteMessageLimit: 8,
      timezone: "Asia/Shanghai",
    });
    expect(next.routes).toEqual(config.routes);
    expect(next.providers).toEqual(config.providers);
  });

  it("restores independent member policy fields to inheritance", () => {
    const config = configFixture();
    config.users.bill = {
      ...config.users.bill,
      enabled: false,
      dailyMessageLimit: 100,
      minuteMessageLimit: 2,
    };
    let draft = createCapabilityAssignmentDraft(config, "bill");
    draft = setMemberPolicyInheritance(config, draft, "enabled", true);
    draft = setMemberPolicyInheritance(config, draft, "dailyMessageLimit", true);
    draft = setMemberPolicyInheritance(config, draft, "minuteMessageLimit", true);
    const next = applyCapabilityAssignmentDraft(config, "bill", draft);
    expect(next.users.bill.enabled).toBeUndefined();
    expect(next.users.bill.dailyMessageLimit).toBeUndefined();
    expect(next.users.bill.minuteMessageLimit).toBeUndefined();
    expect(next.users.bill.timezone).toBe("Asia/Shanghai");
  });

  it("rejects an explicit empty or fractional quota draft", () => {
    const config = configFixture();
    const draft = createCapabilityAssignmentDraft(config, "bill");
    const emptyDaily = {
      ...draft,
      inheritDailyMessageLimit: false,
      dailyMessageLimit: null,
      dailyMessageLimitDirty: true,
    };
    expect(getCapabilityAssignmentDraftError(emptyDaily)).toBe("每日消息额度必须是正整数。");
    expect(() => applyCapabilityAssignmentDraft(config, "bill", emptyDaily)).toThrow("invalid_dailyMessageLimit");

    const fractionalMinute = {
      ...draft,
      inheritMinuteMessageLimit: false,
      minuteMessageLimit: 1.5,
      minuteMessageLimitDirty: true,
    };
    expect(getCapabilityAssignmentDraftError(fractionalMinute)).toBe("每分钟消息额度必须是正整数。");
    expect(getMemberPolicyLimitError(emptyDaily, "dailyMessageLimit")).toBe("每日消息额度必须是正整数。");
    expect(getMemberPolicyLimitError(fractionalMinute, "minuteMessageLimit")).toBe("每分钟消息额度必须是正整数。");
  });

  it("updates defaults without enabling inheritance controls", () => {
    const config = configFixture();
    const draft = createCapabilityAssignmentDraft(config, DEFAULT_ADMIN_MEMBER);
    const next = applyCapabilityAssignmentDraft(config, DEFAULT_ADMIN_MEMBER, {
      ...draft,
      inheritSkills: true,
      allowedSkills: ["writing"],
      inheritTools: true,
      allowedTools: [],
    });
    expect(next.defaults.allowedSkills).toEqual(["writing"]);
    expect(next.defaults.allowedTools).toEqual([]);
    expect(next.defaults.defaultRoute).toBe("primary");
    expect(next.defaults.allowedRoutes).toEqual(["primary", "secondary"]);
  });

  it("treats an explicit empty route list as all routes and preserves it until edited", () => {
    const config = configFixture();
    config.users.bill = { ...config.users.bill, allowedRoutes: [], defaultRoute: "primary" };
    const draft = createCapabilityAssignmentDraft(config, "bill");
    expect(draft.inheritRoutes).toBe(false);
    expect(draft.allowedRoutes).toEqual(["primary", "secondary", "retired"]);
    expect(draft.routeSelectionMode).toBe("all");
    const next = applyCapabilityAssignmentDraft(config, "bill", draft);
    expect(next.users.bill.allowedRoutes).toEqual([]);
  });

  it("keeps a valid default route while editing explicit route access", () => {
    const config = configFixture();
    const inherited = createCapabilityAssignmentDraft(config, "bill");
    const explicit = setRouteInheritance(config, inherited, false);
    const reduced = setRouteAllowed(config, explicit, "primary", false);
    expect(reduced.allowedRoutes).toEqual(["secondary"]);
    expect(reduced.defaultRoute).toBe("secondary");
    const next = applyCapabilityAssignmentDraft(config, "bill", reduced);
    expect(next.users.bill.allowedRoutes).toEqual(["secondary"]);
    expect(next.users.bill.defaultRoute).toBe("secondary");
  });

  it("serializes all selected routes as the backend's all-routes representation", () => {
    const config = configFixture();
    config.users.bill = { ...config.users.bill, allowedRoutes: [] };
    const all = setRouteInheritance(config, createCapabilityAssignmentDraft(config, "bill"), false);
    expect(all.allowedRoutes).toEqual(["primary", "secondary", "retired"]);
    const next = applyCapabilityAssignmentDraft(config, "bill", all);
    expect(next.users.bill.allowedRoutes).toEqual([]);
  });

  it("does not add disabled routes and cannot remove the last enabled route", () => {
    const config = configFixture();
    const draft = setRouteInheritance(config, createCapabilityAssignmentDraft(config, "bill"), false);
    expect(setRouteAllowed(config, draft, "retired", false).allowedRoutes).toEqual(["primary", "secondary"]);
    const onlyPrimary = setRouteAllowed(config, draft, "secondary", false);
    expect(setRouteAllowed(config, onlyPrimary, "primary", false).allowedRoutes).toEqual(["primary"]);
    expect(setRouteAllowed(config, onlyPrimary, "retired", true).allowedRoutes).toEqual(["primary"]);
  });

  it("preserves a member entry's unrelated fields when all assignments inherit", () => {
    const config = configFixture();
    const draft = createCapabilityAssignmentDraft(config, "new-member");
    const next = applyCapabilityAssignmentDraft(config, "new-member", draft);
    expect(next.users["new-member"]).toBeUndefined();
  });

  it("allows choosing a different explicit default route", () => {
    const config = configFixture();
    config.users.bill = {
      ...config.users.bill,
      allowedRoutes: ["primary", "secondary", "retired"],
    };
    const draft = setRouteInheritance(config, createCapabilityAssignmentDraft(config, "bill"), false);
    const changed = setDefaultRoute(config, draft, "secondary");
    expect(changed.defaultRoute).toBe("secondary");
    expect(changed.routesDirty).toBe(true);
    const next = applyCapabilityAssignmentDraft(config, "bill", changed);
    expect(next.users.bill.allowedRoutes).toEqual(["primary", "secondary", "retired"]);
  });

  it("rebases all-route intent across a revision conflict without overwriting newer fields", () => {
    const config = configFixture();
    config.users.bill = { ...config.users.bill, allowedRoutes: [] };
    const draft = setDefaultRoute(config, createCapabilityAssignmentDraft(config, "bill"), "secondary");
    const latest: AdminConfig = {
      ...config,
      routes: {
        ...config.routes,
        tertiary: { label: "Tertiary", enabled: true },
      },
      users: {
        ...config.users,
        bill: { ...config.users.bill, timezone: "UTC" },
      },
    };
    const rebased = rebaseCapabilityAssignmentDraft(latest, "bill", draft);
    expect(rebased.routeSelectionMode).toBe("all");
    expect(rebased.allowedRoutes).toContain("tertiary");
    const next = applyCapabilityAssignmentDraft(latest, "bill", rebased);
    expect(next.users.bill.allowedRoutes).toEqual([]);
    expect(next.users.bill.defaultRoute).toBe("secondary");
    expect(next.users.bill.timezone).toBe("UTC");
  });

  it("does not expand an explicit full route list after a revision conflict", () => {
    const config = configFixture();
    config.users.bill = {
      ...config.users.bill,
      allowedRoutes: ["primary", "secondary", "retired"],
    };
    const draft = setDefaultRoute(config, createCapabilityAssignmentDraft(config, "bill"), "secondary");
    const latest: AdminConfig = {
      ...config,
      routes: {
        ...config.routes,
        tertiary: { label: "Tertiary", enabled: true },
      },
    };
    const rebased = rebaseCapabilityAssignmentDraft(latest, "bill", draft);
    expect(rebased.routeSelectionMode).toBe("selected");
    expect(rebased.allowedRoutes).not.toContain("tertiary");
    const next = applyCapabilityAssignmentDraft(latest, "bill", rebased);
    expect(next.users.bill.allowedRoutes).toEqual(["primary", "secondary", "retired"]);
  });

  it("keeps dirty quota intent but adopts untouched policy fields after a conflict", () => {
    const config = configFixture();
    const draft = {
      ...createCapabilityAssignmentDraft(config, "bill"),
      inheritDailyMessageLimit: false,
      dailyMessageLimit: 250,
      dailyMessageLimitDirty: true,
    };
    const latest: AdminConfig = {
      ...config,
      defaults: { ...config.defaults, dailyMessageLimit: 600 },
      users: {
        ...config.users,
        bill: {
          ...config.users.bill,
          enabled: false,
          dailyMessageLimit: 300,
          minuteMessageLimit: 3,
          timezone: "UTC",
        },
      },
    };
    const rebased = rebaseCapabilityAssignmentDraft(latest, "bill", draft);
    expect(rebased.dailyMessageLimit).toBe(250);
    expect(rebased.inheritDailyMessageLimit).toBe(false);
    expect(rebased.enabled).toBe(false);
    expect(rebased.inheritEnabled).toBe(false);
    expect(rebased.minuteMessageLimit).toBe(3);
    expect(rebased.inheritMinuteMessageLimit).toBe(false);
    const next = applyCapabilityAssignmentDraft(latest, "bill", rebased);
    expect(next.users.bill).toMatchObject({
      enabled: false,
      dailyMessageLimit: 250,
      minuteMessageLimit: 3,
      timezone: "UTC",
    });
  });
});
