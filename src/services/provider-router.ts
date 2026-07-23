import type {
  ModelOffering,
  ProviderConfig,
  ProviderCredential,
  ResolvedProviderRoute,
  RouteConfig,
} from "../contracts/provider";

export const DEFAULT_PROVIDER_QUEUE_TIMEOUT_MS = 10_000;
export const MAX_PROVIDER_QUEUE_TIMEOUT_MS = 10_000;
export const MAX_PROVIDER_CONCURRENCY = 100;

type RoutePlanAccess = {
  defaultRoute: string;
  routes: Array<{ id: string }>;
};

type ProviderCredentialBindings = Record<string, unknown>;

type ResolveProviderCredentialArgs = {
  route: {
    allowUserKey?: boolean;
    requiresUserKey?: boolean;
    apiKey?: string;
    apiKeyRef?: string;
  };
  userApiKey: string;
  bindings: ProviderCredentialBindings;
  isManagedReference: (apiKeyRef: string) => boolean;
  loadManagedSecret: (apiKeyRef: string) => Promise<string | null>;
};

export type ProviderQuality = {
  attempts: number;
  successes: number;
  averageLatencyMs: number;
  observedAt: string;
};

export function buildProviderRoutePlan(
  selectedRoute: string,
  routes: Record<string, RouteConfig>,
  access: RoutePlanAccess,
): string[] {
  const allowed = new Set(access.routes.map((route) => route.id));
  const selected = allowed.has(selectedRoute) ? selectedRoute : access.defaultRoute;
  const route = routes[selected];
  const plan = [selected, ...(route?.fallbacks || [])].filter((routeId) => allowed.has(routeId));
  return [...new Set(plan)];
}

export function legacyProviderId(routeId: string): string {
  return `legacy:${routeId}`;
}

export function resolveProviderRouteCandidates(
  routeId: string,
  route: RouteConfig,
  providers: Record<string, ProviderConfig>,
): ResolvedProviderRoute[] {
  const offerings = route.offerings?.length
    ? route.offerings
    : legacyOffering(routeId, route);

  const candidates: ResolvedProviderRoute[] = [];
  for (const offering of offerings) {
    if (offering.enabled === false) continue;
    const provider = Object.prototype.hasOwnProperty.call(providers, offering.providerId)
      ? providers[offering.providerId]
      : legacyProvider(routeId, route, offering.providerId);
    if (!provider || provider.enabled === false) continue;
    candidates.push(resolveCandidate(routeId, route, provider, offering));
  }
  return candidates;
}

export function orderProviderRouteCandidates(
  candidates: ResolvedProviderRoute[],
  qualityByProvider: ReadonlyMap<string, ProviderQuality | null> = new Map(),
): ResolvedProviderRoute[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const priority = right.candidate.priority - left.candidate.priority;
      if (priority) return priority;

      const quality = compareProviderQuality(
        qualityByProvider.get(left.candidate.providerId) || null,
        qualityByProvider.get(right.candidate.providerId) || null,
      );
      if (quality) return quality;
      const provider = left.candidate.providerId.localeCompare(right.candidate.providerId);
      return provider || left.index - right.index;
    })
    .map(({ candidate }) => candidate);
}

export function buildResolvedProviderPlan(
  routeIds: string[],
  routes: Record<string, RouteConfig>,
  providers: Record<string, ProviderConfig>,
  qualityByRouteProvider: ReadonlyMap<string, ProviderQuality | null> = new Map(),
): ResolvedProviderRoute[] {
  const seenRouteProviders = new Set<string>();
  const plan: ResolvedProviderRoute[] = [];
  for (const routeId of routeIds) {
    const route = routes[routeId];
    if (!route || route.enabled === false) continue;
    const candidates = resolveProviderRouteCandidates(routeId, route, providers);
    const quality = new Map<string, ProviderQuality | null>();
    for (const candidate of candidates) {
      quality.set(candidate.providerId, qualityByRouteProvider.get(routeProviderKey(routeId, candidate.providerId)) || null);
    }
    for (const candidate of orderProviderRouteCandidates(
      candidates,
      quality,
    )) {
      const candidateKey = routeProviderKey(candidate.routeId, candidate.providerId);
      if (seenRouteProviders.has(candidateKey)) continue;
      seenRouteProviders.add(candidateKey);
      plan.push(candidate);
    }
  }
  return plan;
}

export function routeProviderKey(routeId: string, providerId: string): string {
  return `${routeId}\u0000${providerId}`;
}

export async function resolveProviderCredential(
  args: ResolveProviderCredentialArgs,
): Promise<ProviderCredential> {
  const { route } = args;
  if (args.userApiKey && route.allowUserKey !== false) {
    return { apiKey: args.userApiKey, source: "user", usedUserKey: true };
  }
  if (route.requiresUserKey) return missingCredential();
  if (route.apiKey) return { apiKey: route.apiKey, source: "legacy", usedUserKey: false };

  const apiKeyRef = route.apiKeyRef?.trim() || "";
  if (apiKeyRef && args.isManagedReference(apiKeyRef)) {
    const managed = await args.loadManagedSecret(apiKeyRef);
    if (managed !== null) return { apiKey: managed, source: "managed", usedUserKey: false };
  }
  if (apiKeyRef && typeof args.bindings[apiKeyRef] === "string") {
    return { apiKey: String(args.bindings[apiKeyRef]), source: "worker", usedUserKey: false };
  }
  return missingCredential();
}

export function isTerminalProviderFailure(status: number, usedUserKey: boolean): boolean {
  return status === 400
    || status === 422
    || (usedUserKey && (status === 401 || status === 403));
}

function missingCredential(): ProviderCredential {
  return { apiKey: "", source: "missing", usedUserKey: false };
}

function legacyOffering(routeId: string, route: RouteConfig): ModelOffering[] {
  if (!route.type || !route.baseUrl || !route.model) return [];
  return [{
    providerId: legacyProviderId(routeId),
    model: route.model,
    supportsImages: route.supportsImages,
    supportsTools: route.supportsTools,
  }];
}

function legacyProvider(
  routeId: string,
  route: RouteConfig,
  providerId: string,
): ProviderConfig | null {
  if (
    providerId !== legacyProviderId(routeId)
    || !route.type
    || !route.baseUrl
  ) return null;
  return {
    label: route.label,
    type: route.type,
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    apiKeyRef: route.apiKeyRef,
    authHeader: route.authHeader,
    authPrefix: route.authPrefix,
    directEndpoint: route.directEndpoint,
    headers: route.headers,
    allowUserKey: route.allowUserKey,
    requiresUserKey: route.requiresUserKey,
    supportsImages: route.supportsImages,
    supportsTools: route.supportsTools,
    concurrency: "unlimited",
  };
}

function resolveCandidate(
  routeId: string,
  route: RouteConfig,
  provider: ProviderConfig,
  offering: ModelOffering,
): ResolvedProviderRoute {
  const concurrency = provider.concurrency || "unlimited";
  const maxConcurrent = concurrency === "exclusive"
    ? 1
    : concurrency === "bounded"
      ? clampInteger(provider.maxConcurrent, 1, MAX_PROVIDER_CONCURRENCY, 1)
      : MAX_PROVIDER_CONCURRENCY;
  const supportsImages = route.supportsImages === false
    ? false
    : offering.supportsImages ?? provider.supportsImages ?? route.supportsImages ?? true;
  const supportsTools = route.supportsTools === false
    ? false
    : offering.supportsTools ?? provider.supportsTools ?? route.supportsTools ?? false;

  return {
    routeId,
    providerId: offering.providerId,
    label: route.label,
    type: provider.type,
    baseUrl: provider.baseUrl,
    model: offering.model,
    apiKey: provider.apiKey,
    apiKeyRef: provider.apiKeyRef,
    authHeader: provider.authHeader,
    authPrefix: provider.authPrefix,
    directEndpoint: provider.directEndpoint,
    headers: provider.headers,
    maxTokens: route.maxTokens,
    temperature: route.temperature,
    allowUserKey: route.allowUserKey !== false && provider.allowUserKey !== false,
    requiresUserKey: route.requiresUserKey === true || provider.requiresUserKey === true,
    supportsImages,
    supportsTools,
    concurrency,
    maxConcurrent,
    queueTimeoutMs: clampInteger(
      provider.queueTimeoutMs,
      0,
      MAX_PROVIDER_QUEUE_TIMEOUT_MS,
      DEFAULT_PROVIDER_QUEUE_TIMEOUT_MS,
    ),
    priority: finiteNumber(offering.priority, finiteNumber(provider.priority, 0)),
  };
}

function compareProviderQuality(left: ProviderQuality | null, right: ProviderQuality | null): number {
  const leftBucket = qualityBucket(left);
  const rightBucket = qualityBucket(right);
  if (leftBucket !== rightBucket) return rightBucket - leftBucket;
  if (!left || !right) return 0;
  const leftRate = left.attempts > 0 ? left.successes / left.attempts : 0;
  const rightRate = right.attempts > 0 ? right.successes / right.attempts : 0;
  if (leftRate !== rightRate) return rightRate - leftRate;
  return left.averageLatencyMs - right.averageLatencyMs;
}

function qualityBucket(value: ProviderQuality | null): number {
  if (!value || value.attempts <= 0) return 1;
  return value.successes > 0 ? 2 : 0;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
