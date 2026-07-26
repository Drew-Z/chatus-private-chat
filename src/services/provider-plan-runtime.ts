import type {
  ProviderConfig,
  ProviderCredential,
  ResolvedProviderRoute,
  RouteConfig,
} from "../contracts/provider";
import {
  buildResolvedProviderPlan,
  resolveProviderRouteCandidates,
  routeProviderKey,
  type ProviderQuality,
} from "./provider-router";

export type ProviderPlanAccessRoute = {
  id: string;
  allowUserKey: boolean;
  requiresUserKey: boolean;
};

export type PreparedProviderRoute = ResolvedProviderRoute & {
  credential: ProviderCredential;
  planIndex: number;
};

export type PreparedProviderPlan = {
  candidates: PreparedProviderRoute[];
  lastError: { routeId: string; message: string } | null;
  userKeyRequiredRouteId?: string;
};

export type ProviderPlanRuntime = {
  buildPlan: (routeIds: string[]) => Promise<ResolvedProviderRoute[]>;
  preparePlan: <T extends ProviderPlanAccessRoute>(args: {
    routeIds: string[];
    accessRoutes: readonly T[];
    userApiKey: string;
    accepts?: (route: ResolvedProviderRoute, accessRoute: T) => boolean;
  }) => Promise<PreparedProviderPlan>;
};

export function createProviderPlanRuntime(args: {
  routes: Record<string, RouteConfig>;
  providers: Record<string, ProviderConfig>;
  resolveCredential: (route: ResolvedProviderRoute, userApiKey: string) => Promise<ProviderCredential>;
  loadQuality: (route: ResolvedProviderRoute) => Promise<ProviderQuality | null>;
  credentialErrorMessage?: (error: unknown) => string;
}): ProviderPlanRuntime {
  const buildPlan = async (routeIds: string[]): Promise<ResolvedProviderRoute[]> => {
    const rawCandidates = routeIds.flatMap((routeId) => {
      const route = args.routes[routeId];
      return route ? resolveProviderRouteCandidates(routeId, route, args.providers) : [];
    });
    const qualityEntries = await Promise.all(rawCandidates.map(async (candidate) => [
      routeProviderKey(candidate.routeId, candidate.providerId),
      await args.loadQuality(candidate),
    ] as const));
    return buildResolvedProviderPlan(routeIds, args.routes, args.providers, new Map(qualityEntries));
  };

  const preparePlan = async <T extends ProviderPlanAccessRoute>(input: {
    routeIds: string[];
    accessRoutes: readonly T[];
    userApiKey: string;
    accepts?: (route: ResolvedProviderRoute, accessRoute: T) => boolean;
  }): Promise<PreparedProviderPlan> => {
    const accessByRoute = new Map(input.accessRoutes.map((route) => [route.id, route]));
    const providerPlan = (await buildPlan(input.routeIds)).filter((route) => {
      const accessRoute = accessByRoute.get(route.routeId);
      return Boolean(accessRoute && (!input.accepts || input.accepts(route, accessRoute)));
    });
    const candidates: PreparedProviderRoute[] = [];
    let lastError: PreparedProviderPlan["lastError"] = null;

    for (const [planIndex, route] of providerPlan.entries()) {
      const accessRoute = accessByRoute.get(route.routeId);
      if (!accessRoute) continue;
      let credential: ProviderCredential;
      try {
        credential = await args.resolveCredential(
          route,
          accessRoute.allowUserKey ? input.userApiKey : "",
        );
      } catch (error) {
        lastError = {
          routeId: route.routeId,
          message: args.credentialErrorMessage?.(error) || "route key is unavailable",
        };
        continue;
      }
      if (!credential.apiKey) {
        if (accessRoute.requiresUserKey) {
          return { candidates, lastError, userKeyRequiredRouteId: route.routeId };
        }
        lastError = { routeId: route.routeId, message: "route key is not configured" };
        continue;
      }
      candidates.push({ ...route, credential, planIndex });
    }

    return { candidates, lastError };
  };

  return { buildPlan, preparePlan };
}
