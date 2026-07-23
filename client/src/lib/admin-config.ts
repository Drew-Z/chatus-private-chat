import type { AdminConfig, AdminRouteConfig, AdminUserConfig } from "./api";

export const DEFAULT_ADMIN_MEMBER = "";

export type CapabilityAssignmentDraft = {
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
  draft: CapabilityAssignmentDraft,
): CapabilityAssignmentDraft {
  const defaults = createCapabilityAssignmentDraft(config, DEFAULT_ADMIN_MEMBER);
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
