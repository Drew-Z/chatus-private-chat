import type { ProviderCredential, RouteConfig } from "../contracts/provider";

type RoutePlanAccess = {
  defaultRoute: string;
  routes: Array<{ id: string }>;
};

type ProviderCredentialBindings = Record<string, unknown>;

type ResolveProviderCredentialArgs = {
  route: RouteConfig;
  userApiKey: string;
  bindings: ProviderCredentialBindings;
  isManagedReference: (apiKeyRef: string) => boolean;
  loadManagedSecret: (apiKeyRef: string) => Promise<string | null>;
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
