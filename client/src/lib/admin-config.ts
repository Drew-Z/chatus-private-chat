import type { AdminConfig, AdminRouteConfig, AdminUserConfig } from "./api";

export const DEFAULT_ADMIN_MEMBER = "";

export type CapabilityAssignmentDraft = {
  inheritEnabled: boolean;
  enabled: boolean;
  enabledDirty: boolean;
  inheritDailyMessageLimit: boolean;
  dailyMessageLimit: number | null;
  dailyMessageLimitDirty: boolean;
  inheritMinuteMessageLimit: boolean;
  minuteMessageLimit: number | null;
  minuteMessageLimitDirty: boolean;
  inheritSkills: boolean;
  allowedSkills: string[];
  inheritTools: boolean;
  allowedTools: string[];
  inheritRoutes: boolean;
  allowedRoutes: string[];
  routeSelectionMode: "all" | "selected";
  inheritDefaultRoute: boolean;
  defaultRoute: string;
  routesDirty: boolean;
};

export function createCapabilityAssignmentDraft(
  config: AdminConfig,
  memberLabel: string,
): CapabilityAssignmentDraft {
  const isDefault = memberLabel === DEFAULT_ADMIN_MEMBER;
  const own = isDefault ? config.defaults : config.users[memberLabel] || {};
  const effective = isDefault ? own : { ...config.defaults, ...own };
  const skillIds = orderedSkillIds(config);
  const toolIds = orderedToolIds(config);
  const routeIds = orderedRouteIds(config);
  const allowedRoutes = resolveAllowedRouteIds(routeIds, effective.allowedRoutes);

  return {
    inheritEnabled: !isDefault && own.enabled === undefined,
    enabled: effective.enabled !== false,
    enabledDirty: false,
    inheritDailyMessageLimit: !isDefault && own.dailyMessageLimit === undefined,
    dailyMessageLimit: positiveIntegerOrNull(effective.dailyMessageLimit),
    dailyMessageLimitDirty: false,
    inheritMinuteMessageLimit: !isDefault && own.minuteMessageLimit === undefined,
    minuteMessageLimit: positiveIntegerOrNull(effective.minuteMessageLimit),
    minuteMessageLimitDirty: false,
    inheritSkills: !isDefault && own.allowedSkills === undefined,
    allowedSkills: orderSelection(skillIds, effective.allowedSkills ?? skillIds),
    inheritTools: !isDefault && own.allowedTools === undefined,
    allowedTools: orderSelection(toolIds, effective.allowedTools ?? []),
    inheritRoutes: !isDefault && own.allowedRoutes === undefined,
    allowedRoutes,
    routeSelectionMode: effective.allowedRoutes?.length ? "selected" : "all",
    inheritDefaultRoute: !isDefault && own.defaultRoute === undefined,
    defaultRoute: resolveDefaultRoute(config, effective.defaultRoute, allowedRoutes),
    routesDirty: false,
  };
}

export function applyCapabilityAssignmentDraft(
  config: AdminConfig,
  memberLabel: string,
  draft: CapabilityAssignmentDraft,
): AdminConfig {
  if (memberLabel === DEFAULT_ADMIN_MEMBER) {
    return {
      ...config,
      defaults: applyDraftToUser(config.defaults, draft, false, config),
    };
  }

  const users = { ...config.users };
  const nextUser = applyDraftToUser(users[memberLabel] || {}, draft, true, config);
  if (Object.keys(nextUser).length) users[memberLabel] = nextUser;
  else delete users[memberLabel];
  return { ...config, users };
}

export function orderedRouteIds(config: AdminConfig): string[] {
  return Object.entries(config.routes)
    .sort(([leftId, left], [rightId, right]) => (
      left.label.localeCompare(right.label) || leftId.localeCompare(rightId)
    ))
    .map(([id]) => id);
}

export function rebaseCapabilityAssignmentDraft(
  config: AdminConfig,
  memberLabel: string,
  draft: CapabilityAssignmentDraft,
): CapabilityAssignmentDraft {
  const defaults = createCapabilityAssignmentDraft(config, DEFAULT_ADMIN_MEMBER);
  const latest = createCapabilityAssignmentDraft(config, memberLabel);
  const routeIds = orderedRouteIds(config);
  const skillIds = orderedSkillIds(config);
  const toolIds = orderedToolIds(config);
  const allowedRoutes = draft.inheritRoutes
    ? defaults.allowedRoutes
    : draft.routeSelectionMode === "all"
      ? routeIds
      : orderSelection(routeIds, draft.allowedRoutes);
  const normalizedRoutes = ensureEnabledRoute(config, allowedRoutes);
  return {
    ...draft,
    inheritEnabled: draft.enabledDirty ? draft.inheritEnabled : latest.inheritEnabled,
    enabled: draft.enabledDirty
      ? (draft.inheritEnabled ? defaults.enabled : draft.enabled)
      : latest.enabled,
    inheritDailyMessageLimit: draft.dailyMessageLimitDirty
      ? draft.inheritDailyMessageLimit
      : latest.inheritDailyMessageLimit,
    dailyMessageLimit: draft.dailyMessageLimitDirty
      ? (draft.inheritDailyMessageLimit ? defaults.dailyMessageLimit : draft.dailyMessageLimit)
      : latest.dailyMessageLimit,
    inheritMinuteMessageLimit: draft.minuteMessageLimitDirty
      ? draft.inheritMinuteMessageLimit
      : latest.inheritMinuteMessageLimit,
    minuteMessageLimit: draft.minuteMessageLimitDirty
      ? (draft.inheritMinuteMessageLimit ? defaults.minuteMessageLimit : draft.minuteMessageLimit)
      : latest.minuteMessageLimit,
    allowedSkills: draft.inheritSkills ? defaults.allowedSkills : orderSelection(skillIds, draft.allowedSkills),
    allowedTools: draft.inheritTools ? defaults.allowedTools : orderSelection(toolIds, draft.allowedTools),
    allowedRoutes: normalizedRoutes,
    routeSelectionMode: draft.inheritRoutes ? defaults.routeSelectionMode : draft.routeSelectionMode,
    defaultRoute: resolveDefaultRoute(
      config,
      draft.inheritDefaultRoute ? defaults.defaultRoute : draft.defaultRoute,
      normalizedRoutes,
    ),
  };
}

export type MemberPolicyField = "enabled" | "dailyMessageLimit" | "minuteMessageLimit";

export function setMemberPolicyInheritance(
  config: AdminConfig,
  draft: CapabilityAssignmentDraft,
  field: MemberPolicyField,
  inherit: boolean,
): CapabilityAssignmentDraft {
  const defaults = createCapabilityAssignmentDraft(config, DEFAULT_ADMIN_MEMBER);
  switch (field) {
    case "enabled":
      return {
        ...draft,
        inheritEnabled: inherit,
        enabled: inherit ? defaults.enabled : draft.enabled,
        enabledDirty: true,
      };
    case "dailyMessageLimit":
      return {
        ...draft,
        inheritDailyMessageLimit: inherit,
        dailyMessageLimit: inherit ? defaults.dailyMessageLimit : draft.dailyMessageLimit,
        dailyMessageLimitDirty: true,
      };
    case "minuteMessageLimit":
      return {
        ...draft,
        inheritMinuteMessageLimit: inherit,
        minuteMessageLimit: inherit ? defaults.minuteMessageLimit : draft.minuteMessageLimit,
        minuteMessageLimitDirty: true,
      };
  }
}

export function getCapabilityAssignmentDraftError(draft: CapabilityAssignmentDraft): string | null {
  return getMemberPolicyLimitError(draft, "dailyMessageLimit")
    ?? getMemberPolicyLimitError(draft, "minuteMessageLimit");
}

export function getMemberPolicyLimitError(
  draft: CapabilityAssignmentDraft,
  field: Exclude<MemberPolicyField, "enabled">,
): string | null {
  const daily = field === "dailyMessageLimit";
  const dirty = daily ? draft.dailyMessageLimitDirty : draft.minuteMessageLimitDirty;
  const inherit = daily ? draft.inheritDailyMessageLimit : draft.inheritMinuteMessageLimit;
  const value = daily ? draft.dailyMessageLimit : draft.minuteMessageLimit;
  if (!dirty || inherit || isPositiveInteger(value)) return null;
  return daily ? "每日消息额度必须是正整数。" : "每分钟消息额度必须是正整数。";
}

export function orderedSkillIds(config: AdminConfig): string[] {
  return Object.entries(config.skills)
    .sort(([leftId, left], [rightId, right]) => (
      (left.order || 0) - (right.order || 0) || leftId.localeCompare(rightId)
    ))
    .map(([id]) => id);
}

export function orderedToolIds(config: AdminConfig): string[] {
  return Object.entries(config.tools)
    .sort(([leftId, left], [rightId, right]) => (
      left.label.localeCompare(right.label) || leftId.localeCompare(rightId)
    ))
    .map(([id]) => id);
}

export function isRouteEnabled(route: AdminRouteConfig | undefined): boolean {
  return route !== undefined && route.enabled !== false;
}

export function setRouteAllowed(
  config: AdminConfig,
  draft: CapabilityAssignmentDraft,
  routeId: string,
  allowed: boolean,
): CapabilityAssignmentDraft {
  if (draft.inheritRoutes || !Object.prototype.hasOwnProperty.call(config.routes, routeId)) return draft;
  const route = config.routes[routeId];
  const selected = new Set(draft.allowedRoutes);
  if (allowed) {
    if (!isRouteEnabled(route)) return draft;
    selected.add(routeId);
  } else {
    if (!selected.has(routeId)) return draft;
    if (isRouteEnabled(route) && countEnabledRoutes(config, selected) <= 1) return draft;
    selected.delete(routeId);
  }

  return repairRouteDraft(config, {
    ...draft,
    allowedRoutes: [...selected],
    routeSelectionMode: selected.size === orderedRouteIds(config).length ? "all" : "selected",
    routesDirty: true,
  });
}

export function setRouteInheritance(
  config: AdminConfig,
  draft: CapabilityAssignmentDraft,
  inherit: boolean,
): CapabilityAssignmentDraft {
  const defaults = createCapabilityAssignmentDraft(config, DEFAULT_ADMIN_MEMBER);
  return repairRouteDraft(config, {
    ...draft,
    inheritRoutes: inherit,
    allowedRoutes: inherit ? defaults.allowedRoutes : draft.allowedRoutes,
    routeSelectionMode: inherit ? defaults.routeSelectionMode : draft.routeSelectionMode,
    routesDirty: true,
  });
}

export function setDefaultRouteInheritance(
  config: AdminConfig,
  draft: CapabilityAssignmentDraft,
  inherit: boolean,
): CapabilityAssignmentDraft {
  const defaults = createCapabilityAssignmentDraft(config, DEFAULT_ADMIN_MEMBER);
  return repairRouteDraft(config, {
    ...draft,
    inheritDefaultRoute: inherit,
    defaultRoute: inherit ? defaults.defaultRoute : draft.defaultRoute,
    routesDirty: true,
  });
}

export function setDefaultRoute(
  config: AdminConfig,
  draft: CapabilityAssignmentDraft,
  routeId: string,
): CapabilityAssignmentDraft {
  if (draft.inheritDefaultRoute || !draft.allowedRoutes.includes(routeId) || !isRouteEnabled(config.routes[routeId])) {
    return draft;
  }
  return { ...draft, defaultRoute: routeId, routesDirty: true };
}

function applyDraftToUser(
  user: AdminUserConfig,
  draft: CapabilityAssignmentDraft,
  allowInheritance: boolean,
  config: AdminConfig,
): AdminUserConfig {
  const next = { ...user };
  if (draft.enabledDirty) {
    if (allowInheritance && draft.inheritEnabled) delete next.enabled;
    else next.enabled = draft.enabled;
  }
  if (draft.dailyMessageLimitDirty) {
    if (allowInheritance && draft.inheritDailyMessageLimit) delete next.dailyMessageLimit;
    else next.dailyMessageLimit = requirePositiveInteger(draft.dailyMessageLimit, "dailyMessageLimit");
  }
  if (draft.minuteMessageLimitDirty) {
    if (allowInheritance && draft.inheritMinuteMessageLimit) delete next.minuteMessageLimit;
    else next.minuteMessageLimit = requirePositiveInteger(draft.minuteMessageLimit, "minuteMessageLimit");
  }
  if (allowInheritance && draft.inheritSkills) delete next.allowedSkills;
  else next.allowedSkills = [...draft.allowedSkills];
  if (allowInheritance && draft.inheritTools) delete next.allowedTools;
  else next.allowedTools = [...draft.allowedTools];

  if (draft.routesDirty) {
    const routeIds = orderedRouteIds(config);
    const inheritedRoutes = resolveAllowedRouteIds(routeIds, config.defaults.allowedRoutes);
    const selectedRoutes = allowInheritance && draft.inheritRoutes
      ? inheritedRoutes
      : draft.routeSelectionMode === "all"
        ? routeIds
        : orderSelection(routeIds, draft.allowedRoutes);
    const normalizedRoutes = ensureEnabledRoute(config, selectedRoutes);
    if (allowInheritance && draft.inheritRoutes) delete next.allowedRoutes;
    else next.allowedRoutes = draft.routeSelectionMode === "all" ? [] : [...normalizedRoutes];

    if (allowInheritance && draft.inheritDefaultRoute) delete next.defaultRoute;
    else next.defaultRoute = resolveDefaultRoute(config, draft.defaultRoute, normalizedRoutes);
  }
  return next;
}

function repairRouteDraft(config: AdminConfig, draft: CapabilityAssignmentDraft): CapabilityAssignmentDraft {
  const routeIds = orderedRouteIds(config);
  const selectedRoutes = draft.routeSelectionMode === "all"
    ? routeIds
    : orderSelection(routeIds, draft.allowedRoutes);
  const allowedRoutes = ensureEnabledRoute(config, selectedRoutes);
  return {
    ...draft,
    allowedRoutes,
    defaultRoute: resolveDefaultRoute(config, draft.defaultRoute, allowedRoutes),
  };
}

function resolveAllowedRouteIds(routeIds: string[], selected: string[] | undefined): string[] {
  return selected?.length ? orderSelection(routeIds, selected) : [...routeIds];
}

function ensureEnabledRoute(config: AdminConfig, selected: string[]): string[] {
  const routeIds = orderedRouteIds(config);
  const ordered = orderSelection(routeIds, selected);
  if (ordered.some((id) => isRouteEnabled(config.routes[id]))) return ordered;
  const fallback = routeIds.find((id) => isRouteEnabled(config.routes[id]));
  return fallback ? [...ordered, fallback] : ordered;
}

function resolveDefaultRoute(config: AdminConfig, requested: string | undefined, allowedRoutes: string[]): string {
  const routeIds = orderedRouteIds(config);
  const allowed = new Set(allowedRoutes);
  if (requested && allowed.has(requested) && isRouteEnabled(config.routes[requested])) return requested;
  return routeIds.find((id) => allowed.has(id) && isRouteEnabled(config.routes[id]))
    || routeIds.find((id) => allowed.has(id))
    || routeIds[0]
    || "";
}

function countEnabledRoutes(config: AdminConfig, selected: Set<string>): number {
  return [...selected].filter((id) => isRouteEnabled(config.routes[id])).length;
}

function orderSelection(available: string[], selected: string[]): string[] {
  const selectedIds = new Set(selected);
  return available.filter((id) => selectedIds.has(id));
}

function positiveIntegerOrNull(value: unknown): number | null {
  return isPositiveInteger(value) ? value : null;
}

function requirePositiveInteger(value: number | null, field: string): number {
  if (!isPositiveInteger(value)) throw new Error(`invalid_${field}`);
  return value;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
