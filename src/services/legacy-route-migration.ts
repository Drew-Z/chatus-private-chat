import type { ProviderConfig, RouteConfig } from "../contracts/provider";
import { DEFAULT_PROVIDER_QUEUE_TIMEOUT_MS } from "./provider-router";

const MAX_PROVIDER_ID_CHARS = 80;
const LEGACY_ROUTE_FIELDS = [
  "type",
  "baseUrl",
  "model",
  "apiKey",
  "apiKeyRef",
  "authHeader",
  "authPrefix",
  "directEndpoint",
  "headers",
] as const satisfies ReadonlyArray<keyof RouteConfig>;

export type LegacyRouteMigrationSelection = {
  routeId: string;
  apiKeyRef?: string;
};

export type LegacyRouteMigrationRecord = {
  routeId: string;
  providerId?: string;
};

type ProviderPoolConfig = {
  routes: Record<string, RouteConfig>;
  providers: Record<string, ProviderConfig>;
};

export function isLegacyRouteConfig(route: RouteConfig): boolean {
  return Boolean(
    (route.type === "openai-chat" || route.type === "anthropic-messages")
    && route.baseUrl?.trim()
    && route.model?.trim(),
  );
}

export function hasLegacyRouteShadow(route: RouteConfig): boolean {
  return LEGACY_ROUTE_FIELDS.some((field) => route[field] !== undefined);
}

export function migrateLegacyRouteConfiguration<T extends ProviderPoolConfig>(
  config: T,
  selections: LegacyRouteMigrationSelection[],
): { config: T; migrated: LegacyRouteMigrationRecord[] } {
  const routes = { ...config.routes };
  const providers = { ...config.providers };
  const migrated: LegacyRouteMigrationRecord[] = [];

  for (const selection of selections) {
    const route = routes[selection.routeId];
    if (!route || !hasLegacyRouteShadow(route)) continue;

    if (route.offerings?.length) {
      routes[selection.routeId] = withoutLegacyRouteShadow(route);
      migrated.push({ routeId: selection.routeId });
      continue;
    }
    if (!isLegacyRouteConfig(route)) continue;

    const providerId = allocateProviderId(selection.routeId, providers);
    providers[providerId] = legacyRouteProvider(route, selection.apiKeyRef);
    routes[selection.routeId] = {
      ...withoutLegacyRouteShadow(route),
      offerings: [{ providerId, model: route.model!.trim() }],
    };
    migrated.push({ routeId: selection.routeId, providerId });
  }

  return { config: { ...config, routes, providers }, migrated };
}

function legacyRouteProvider(route: RouteConfig, apiKeyRef: string | undefined): ProviderConfig {
  const resolvedRef = apiKeyRef?.trim() || route.apiKeyRef?.trim() || "";
  return {
    enabled: true,
    label: route.label,
    type: route.type!,
    baseUrl: route.baseUrl!.trim(),
    ...(resolvedRef ? { apiKeyRef: resolvedRef } : {}),
    ...(route.authHeader?.trim() ? { authHeader: route.authHeader.trim() } : {}),
    ...(route.authPrefix === undefined ? {} : { authPrefix: route.authPrefix }),
    ...(route.directEndpoint === undefined ? {} : { directEndpoint: route.directEndpoint }),
    ...(route.headers ? { headers: { ...route.headers } } : {}),
    allowUserKey: route.allowUserKey !== false,
    requiresUserKey: route.requiresUserKey === true,
    supportsImages: route.supportsImages !== false,
    supportsTools: route.supportsTools === true,
    concurrency: "unlimited",
    queueTimeoutMs: DEFAULT_PROVIDER_QUEUE_TIMEOUT_MS,
    priority: 0,
  };
}

function withoutLegacyRouteShadow(route: RouteConfig): RouteConfig {
  const next = { ...route };
  for (const field of LEGACY_ROUTE_FIELDS) delete next[field];
  return next;
}

function allocateProviderId(routeId: string, providers: Record<string, ProviderConfig>): string {
  const safeRouteId = routeId
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/-+$/g, "")
    || "legacy";
  const base = `${safeRouteId}-provider`.slice(0, MAX_PROVIDER_ID_CHARS);
  if (!Object.prototype.hasOwnProperty.call(providers, base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_PROVIDER_ID_CHARS - tail.length)}${tail}`;
    if (!Object.prototype.hasOwnProperty.call(providers, candidate)) return candidate;
  }
  throw new Error("provider_id_exhausted");
}
