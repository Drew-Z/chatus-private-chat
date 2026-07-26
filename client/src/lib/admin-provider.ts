import type {
  AdminConfig,
  AdminLogicalModel,
  AdminModelOffering,
  AdminProvider,
  AdminProviderConfig,
  AdminRouteConfig,
  AdminRouteSecretMetadata,
} from "./api";

export const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const ROUTE_SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export const MAX_PROVIDER_CONCURRENCY = 100;
export const MAX_PROVIDER_QUEUE_TIMEOUT_MS = 10_000;

export type ProviderDraft = AdminProviderConfig & { id: string };

export type LogicalModelDraft = AdminRouteConfig & { id: string };

export type ValidationResult = { ok: true } | { ok: false; message: string };

export function createProviderDraft(provider: AdminProviderConfig | undefined, id: string): ProviderDraft {
  return {
    ...(provider || {}),
    id,
    label: provider?.label || "",
    type: provider?.type || "openai-chat",
    baseUrl: provider?.baseUrl || "https://api.openai.com/v1",
    enabled: provider?.enabled !== false,
    directEndpoint: provider?.directEndpoint === true,
    allowUserKey: provider?.allowUserKey !== false,
    requiresUserKey: provider?.requiresUserKey === true,
    supportsImages: provider?.supportsImages !== false,
    supportsTools: provider?.supportsTools === true,
    concurrency: provider?.concurrency || "unlimited",
    queueTimeoutMs: provider?.queueTimeoutMs || 0,
    priority: provider?.priority || 0,
  };
}

export function createLogicalModelDraft(
  route: AdminRouteConfig | undefined,
  id: string,
  providerId = "",
): LogicalModelDraft {
  return {
    ...(route || {}),
    id,
    label: route?.label || "",
    enabled: route?.enabled !== false,
    offerings: route?.offerings?.map((offering) => ({ ...offering }))
      || (providerId ? [{ providerId, model: "", enabled: true, priority: 0 }] : []),
    fallbacks: [...(route?.fallbacks || [])],
    supportsImages: route?.supportsImages !== false,
    supportsTools: route?.supportsTools === true,
  };
}

export function projectAdminProviders(
  config: AdminConfig,
  secrets: AdminRouteSecretMetadata[] = [],
): AdminProvider[] {
  const secretByRef = new Map(secrets.map((item) => [item.apiKeyRef, item]));
  const referencedBy = new Map<string, string[]>();
  for (const [routeId, route] of Object.entries(config.routes)) {
    for (const offering of route.offerings || []) {
      const routes = referencedBy.get(offering.providerId) || [];
      routes.push(routeId);
      referencedBy.set(offering.providerId, routes);
    }
  }

  return Object.entries(config.providers)
    .map(([id, provider]) => {
      const metadata = provider.apiKeyRef ? secretByRef.get(provider.apiKeyRef) : undefined;
      const credentialStatus = provider.requiresUserKey
        ? "user_key_required"
        : metadata?.status === "configured"
          ? "configured"
          : metadata?.status === "unavailable"
            ? "unavailable"
            : provider.hasLegacyKey
              ? "configured"
              : "missing";
      return {
        id,
        label: provider.label,
        type: provider.type,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled !== false,
        apiKeyRef: provider.apiKeyRef,
        credentialStatus,
        hasLegacyKey: provider.hasLegacyKey === true,
        hasCustomHeaders: provider.hasCustomHeaders === true,
        directEndpoint: provider.directEndpoint === true,
        allowUserKey: provider.allowUserKey !== false,
        requiresUserKey: provider.requiresUserKey === true,
        supportsImages: provider.supportsImages !== false,
        supportsTools: provider.supportsTools === true,
        concurrency: provider.concurrency || "unlimited",
        ...(provider.maxConcurrent === undefined ? {} : { maxConcurrent: provider.maxConcurrent }),
        queueTimeoutMs: provider.queueTimeoutMs || 0,
        priority: provider.priority || 0,
        referencedBy: [...new Set(referencedBy.get(id) || [])].sort(compareStableText),
      } satisfies AdminProvider;
    })
    .sort(compareProviders);
}

export function projectAdminLogicalModels(config: AdminConfig): AdminLogicalModel[] {
  const referencedBy = new Map<string, string[]>();
  const recordReference = (routeId: string, label: string) => {
    const refs = referencedBy.get(routeId) || [];
    if (!refs.includes(label)) refs.push(label);
    referencedBy.set(routeId, refs);
  };
  for (const [label, user] of Object.entries(config.users)) {
    if (user.defaultRoute) recordReference(user.defaultRoute, label);
    for (const routeId of user.allowedRoutes || []) recordReference(routeId, label);
  }
  if (config.defaults.defaultRoute) recordReference(config.defaults.defaultRoute, "defaults");
  for (const routeId of config.defaults.allowedRoutes || []) recordReference(routeId, "defaults");
  if (config.publicAccess.routeId) recordReference(config.publicAccess.routeId, "公开访问");
  for (const [routeId, route] of Object.entries(config.routes)) {
    for (const fallbackId of route.fallbacks || []) recordReference(fallbackId, `fallback:${routeId}`);
  }

  return Object.entries(config.routes)
    .map(([id, route]) => ({
      id,
      label: route.label,
      enabled: route.enabled !== false,
      fallbacks: [...(route.fallbacks || [])],
      supportsImages: route.supportsImages !== false,
      supportsTools: route.supportsTools === true,
      offerings: (route.offerings || []).map((offering) => ({ ...offering })),
      referencedBy: [...(referencedBy.get(id) || [])].sort(compareStableText),
    }))
    .sort(compareLogicalModels);
}

export function compareProviders(left: Pick<AdminProvider, "label" | "id">, right: Pick<AdminProvider, "label" | "id">): number {
  return compareStableText(left.label, right.label) || compareStableText(left.id, right.id);
}

export function compareLogicalModels(
  left: Pick<AdminLogicalModel, "label" | "id">,
  right: Pick<AdminLogicalModel, "label" | "id">,
): number {
  return compareStableText(left.label, right.label) || compareStableText(left.id, right.id);
}

export function validateProviderDraft(draft: ProviderDraft): ValidationResult {
  if (!PROVIDER_ID_PATTERN.test(draft.id)) {
    return { ok: false, message: "服务商 ID 只能包含字母、数字、点、下划线和短横线，且不超过 80 个字符。" };
  }
  if (!draft.label.trim()) return { ok: false, message: "请填写服务商名称。" };
  if (draft.type !== "openai-chat" && draft.type !== "anthropic-messages") {
    return { ok: false, message: "服务商协议无效。" };
  }
  try {
    const url = new URL(draft.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
  } catch {
    return { ok: false, message: "Base URL 必须是有效的 http(s) 地址。" };
  }
  if (draft.apiKeyRef !== undefined && !ROUTE_SECRET_REF_PATTERN.test(draft.apiKeyRef)) {
    return { ok: false, message: "API Key Ref 格式无效。" };
  }
  if (draft.concurrency === "bounded" && (!Number.isInteger(draft.maxConcurrent) || !draft.maxConcurrent || draft.maxConcurrent < 1 || draft.maxConcurrent > MAX_PROVIDER_CONCURRENCY)) {
    return { ok: false, message: `并发上限必须是 1 到 ${MAX_PROVIDER_CONCURRENCY} 的整数。` };
  }
  if (draft.queueTimeoutMs !== undefined && (!Number.isInteger(draft.queueTimeoutMs) || draft.queueTimeoutMs < 0 || draft.queueTimeoutMs > MAX_PROVIDER_QUEUE_TIMEOUT_MS)) {
    return { ok: false, message: `等待时间必须是 0 到 ${MAX_PROVIDER_QUEUE_TIMEOUT_MS} 毫秒。` };
  }
  if (draft.priority !== undefined && (!Number.isFinite(draft.priority) || draft.priority < -1_000_000 || draft.priority > 1_000_000)) {
    return { ok: false, message: "服务商优先级无效。" };
  }
  return { ok: true };
}

export function hasProviderIdConflict(config: AdminConfig, previousId: string | null, nextId: string): boolean {
  return Boolean(previousId && previousId !== nextId && Object.prototype.hasOwnProperty.call(config.providers, nextId));
}

export function validateLogicalModelDraft(draft: LogicalModelDraft, config: AdminConfig): ValidationResult {
  if (!draft.id.trim()) return { ok: false, message: "请填写逻辑模型 ID。" };
  if (!draft.label.trim()) return { ok: false, message: "请填写逻辑模型名称。" };
  if (draft.fallbacks?.some((id) => id === draft.id || !Object.prototype.hasOwnProperty.call(config.routes, id))) {
    return { ok: false, message: "fallback 必须引用其他已存在的逻辑模型。" };
  }
  const offerings = draft.offerings || [];
  if (!offerings.length && !isLegacyRoute(draft)) return { ok: false, message: "逻辑模型至少需要一个服务商映射。" };
  const seen = new Set<string>();
  for (const offering of offerings) {
    if (!Object.prototype.hasOwnProperty.call(config.providers, offering.providerId)) {
      return { ok: false, message: `服务商 ${offering.providerId} 不存在。` };
    }
    if (seen.has(offering.providerId)) return { ok: false, message: "同一个逻辑模型不能重复引用同一服务商。" };
    if (!offering.model.trim()) return { ok: false, message: "上游模型名不能为空。" };
    seen.add(offering.providerId);
  }
  return { ok: true };
}

export function hasLogicalModelIdConflict(config: AdminConfig, previousId: string | null, nextId: string): boolean {
  return Boolean(previousId && previousId !== nextId && Object.prototype.hasOwnProperty.call(config.routes, nextId));
}

export function canDeleteProvider(config: AdminConfig, providerId: string): { ok: true } | { ok: false; referencedBy: string[] } {
  const referencedBy = Object.entries(config.routes)
    .filter(([, route]) => route.offerings?.some((offering) => offering.providerId === providerId))
    .map(([routeId]) => routeId)
    .sort(compareStableText);
  return referencedBy.length ? { ok: false, referencedBy } : { ok: true };
}

export function mergeDiscoveredOfferings(
  config: AdminConfig,
  routeId: string,
  providerId: string,
  models: string[],
  defaults: Pick<AdminModelOffering, "enabled" | "priority"> = { enabled: true, priority: 0 },
): { config: AdminConfig; added: string[] } {
  const route = config.routes[routeId];
  if (!route || !Object.prototype.hasOwnProperty.call(config.providers, providerId)) {
    return { config, added: [] };
  }
  const offerings = [...(route.offerings || [])];
  if (offerings.some((offering) => offering.providerId === providerId)) return { config, added: [] };
  const uniqueModels = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  if (!uniqueModels.length) return { config, added: [] };
  // A logical model may reference a provider only once. Discovery can return
  // many upstream IDs, so the caller can use the remaining IDs to create
  // additional logical models without producing an invalid duplicate offering.
  const added = uniqueModels.slice(0, 1);
  offerings.push({ providerId, model: added[0], ...defaults });
  return {
    config: {
      ...config,
      routes: { ...config.routes, [routeId]: { ...route, offerings } },
    },
    added,
  };
}

export function rebaseAdminConfigDraft(
  latest: AdminConfig,
  local: AdminConfig,
  touchedProviderIds: Iterable<string>,
  touchedRouteIds: Iterable<string>,
): AdminConfig {
  const providers = { ...latest.providers };
  for (const id of touchedProviderIds) {
    if (Object.prototype.hasOwnProperty.call(local.providers, id)) providers[id] = local.providers[id];
    else delete providers[id];
  }
  const routes = { ...latest.routes };
  for (const id of touchedRouteIds) {
    if (Object.prototype.hasOwnProperty.call(local.routes, id)) routes[id] = local.routes[id];
    else delete routes[id];
  }
  return { ...latest, providers, routes };
}

export function applyProviderDraft(
  config: AdminConfig,
  previousId: string | null,
  draft: ProviderDraft,
): AdminConfig {
  const providers = { ...config.providers };
  const provider: AdminProviderConfig = {
    enabled: draft.enabled !== false,
    label: draft.label.trim(),
    type: draft.type,
    baseUrl: draft.baseUrl.trim(),
    ...(draft.apiKeyRef?.trim() ? { apiKeyRef: draft.apiKeyRef.trim() } : {}),
    ...(draft.authHeader?.trim() ? { authHeader: draft.authHeader.trim() } : {}),
    ...(draft.authPrefix === undefined ? {} : { authPrefix: draft.authPrefix }),
    directEndpoint: draft.directEndpoint === true,
    allowUserKey: draft.allowUserKey !== false,
    requiresUserKey: draft.requiresUserKey === true,
    supportsImages: draft.supportsImages !== false,
    supportsTools: draft.supportsTools === true,
    concurrency: draft.concurrency || "unlimited",
    ...(draft.concurrency === "bounded" && draft.maxConcurrent !== undefined ? { maxConcurrent: draft.maxConcurrent } : {}),
    queueTimeoutMs: draft.queueTimeoutMs || 0,
    priority: draft.priority || 0,
    ...(draft.hasLegacyKey ? { hasLegacyKey: true } : {}),
    ...(draft.hasCustomHeaders ? { hasCustomHeaders: true } : {}),
    ...(draft.headerSourceRouteId ? { headerSourceRouteId: draft.headerSourceRouteId } : {}),
  };
  if (previousId && previousId !== draft.id) delete providers[previousId];
  providers[draft.id] = provider;
  if (!previousId || previousId === draft.id) return { ...config, providers };
  const routes = Object.fromEntries(Object.entries(config.routes).map(([routeId, route]) => [
    routeId,
    route.offerings
      ? {
          ...route,
          offerings: route.offerings.map((offering) => (
            offering.providerId === previousId ? { ...offering, providerId: draft.id } : offering
          )),
        }
      : route,
  ]));
  return { ...config, providers, routes };
}

export function applyLogicalModelDraft(
  config: AdminConfig,
  previousId: string | null,
  draft: LogicalModelDraft,
): AdminConfig {
  const routes = { ...config.routes };
  const route: AdminRouteConfig = {
    ...draft,
    label: draft.label.trim(),
    enabled: draft.enabled !== false,
    fallbacks: [...(draft.fallbacks || [])],
    offerings: (draft.offerings || []).map((offering) => ({ ...offering, model: offering.model.trim() })),
  };
  delete route.id;
  if (previousId && previousId !== draft.id) delete routes[previousId];
  routes[draft.id] = route;
  if (!previousId || previousId === draft.id) return { ...config, routes };

  const replace = (value: string | undefined) => value === previousId ? draft.id : value;
  const replaceMany = (values: string[] | undefined) => values?.map((value) => value === previousId ? draft.id : value);
  for (const [routeId, candidate] of Object.entries(routes)) {
    if (!candidate.fallbacks?.includes(previousId)) continue;
    routes[routeId] = { ...candidate, fallbacks: replaceMany(candidate.fallbacks) };
  }
  const users = Object.fromEntries(Object.entries(config.users).map(([label, user]) => [label, {
    ...user,
    ...(user.defaultRoute === undefined ? {} : { defaultRoute: replace(user.defaultRoute) }),
    ...(user.allowedRoutes === undefined ? {} : { allowedRoutes: replaceMany(user.allowedRoutes) }),
  }]));
  const defaults = {
    ...config.defaults,
    ...(config.defaults.defaultRoute === undefined ? {} : { defaultRoute: replace(config.defaults.defaultRoute) }),
    ...(config.defaults.allowedRoutes === undefined ? {} : { allowedRoutes: replaceMany(config.defaults.allowedRoutes) }),
  };
  const publicAccess = {
    ...config.publicAccess,
    routeId: replace(config.publicAccess.routeId) || "",
  };
  return { ...config, routes, users, defaults, publicAccess };
}

export function migrateLegacyLogicalModel(config: AdminConfig, routeId: string): { config: AdminConfig; providerId?: string } {
  const route = config.routes[routeId];
  if (!route || !isLegacyRoute(route) || !route.apiKeyRef) return { config };
  const providerId = uniqueConfigId(config.providers, `${routeId}-provider`);
  const provider: AdminProviderConfig = {
    enabled: true,
    label: route.label,
    type: route.type!,
    baseUrl: route.baseUrl!,
    apiKeyRef: route.apiKeyRef,
    ...(route.authHeader ? { authHeader: route.authHeader } : {}),
    ...(route.authPrefix === undefined ? {} : { authPrefix: route.authPrefix }),
    directEndpoint: route.directEndpoint === true,
    allowUserKey: route.allowUserKey !== false,
    requiresUserKey: route.requiresUserKey === true,
    supportsImages: route.supportsImages !== false,
    supportsTools: route.supportsTools === true,
    concurrency: "unlimited",
    queueTimeoutMs: 0,
    priority: 0,
    ...(route.hasLegacyKey ? { hasLegacyKey: true } : {}),
    ...(route.hasCustomHeaders ? { hasCustomHeaders: true, headerSourceRouteId: routeId } : {}),
  };
  const migrated: AdminRouteConfig = { ...route, offerings: [{ providerId, model: route.model! }] };
  for (const field of [
    "type",
    "baseUrl",
    "model",
    "apiKeyRef",
    "authHeader",
    "authPrefix",
    "directEndpoint",
    "hasLegacyKey",
    "hasCustomHeaders",
  ]) delete migrated[field];
  return {
    config: {
      ...config,
      providers: { ...config.providers, [providerId]: provider },
      routes: { ...config.routes, [routeId]: migrated },
    },
    providerId,
  };
}

export function addDiscoveredModels(
  config: AdminConfig,
  providerId: string,
  models: string[],
  targetRouteId?: string,
): { config: AdminConfig; routeIds: string[] } {
  if (!Object.prototype.hasOwnProperty.call(config.providers, providerId)) return { config, routeIds: [] };
  let next = config;
  const routeIds: string[] = [];
  const selected = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  for (const [index, model] of selected.entries()) {
    const requestedTarget = index === 0 ? targetRouteId : undefined;
    const target = requestedTarget && next.routes[requestedTarget];
    if (target && !(target.offerings || []).some((offering) => offering.providerId === providerId)) {
      next = {
        ...next,
        routes: {
          ...next.routes,
          [requestedTarget!]: {
            ...target,
            offerings: [...(target.offerings || []), { providerId, model, enabled: true, priority: 0 }],
          },
        },
      };
      routeIds.push(requestedTarget!);
      continue;
    }
    const routeId = uniqueConfigId(next.routes, slugifyModelId(model));
    next = {
      ...next,
      routes: {
        ...next.routes,
        [routeId]: {
          label: model,
          enabled: true,
          offerings: [{ providerId, model, enabled: true, priority: 0 }],
          supportsImages: next.providers[providerId].supportsImages !== false,
          supportsTools: next.providers[providerId].supportsTools === true,
        },
      },
    };
    routeIds.push(routeId);
  }
  return { config: next, routeIds };
}

function uniqueConfigId(registry: Record<string, unknown>, preferred: string): string {
  const base = preferred && /^[A-Za-z0-9]/.test(preferred) ? preferred.slice(0, 80) : "model";
  if (!Object.prototype.hasOwnProperty.call(registry, base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`;
    if (!Object.prototype.hasOwnProperty.call(registry, candidate)) return candidate;
  }
  return `${base.slice(0, 67)}-${Date.now()}`;
}

function slugifyModelId(model: string): string {
  const value = model
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 80);
  return value || "model";
}

function isLegacyRoute(route: AdminRouteConfig): boolean {
  return (route.type === "openai-chat" || route.type === "anthropic-messages")
    && typeof route.baseUrl === "string"
    && Boolean(route.baseUrl.trim())
    && typeof route.model === "string"
    && Boolean(route.model.trim());
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
