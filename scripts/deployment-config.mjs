const WORKER_SECRET_NAMES = [
  "ACCESS_CODES",
  "ROUTES_CONFIG",
  "UPSTREAM_API_KEY",
  "SYSTEM_PROMPT",
  "BLOCKED_PROMPTS",
  "ADMIN_TOKEN",
  "ROUTE_KEYS_MASTER_KEY",
];

const RESERVED_EXTRA_SECRET_NAMES = new Set([
  ...WORKER_SECRET_NAMES,
  "WORKER_SECRETS_JSON",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CHATUS_WORKER_NAME",
  "CHATUS_KV_NAMESPACE_ID",
  "CHATUS_PRODUCTION_URL",
]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireText(environment, name) {
  const value = environment[name];
  if (!hasText(value)) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function parseJsonObject(value, name) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed;
}

function isRecord(value) {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function validateRouteReferences(value, routeIds, context) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((routeId) => typeof routeId !== "string")) {
    throw new Error(`${context} must be an array of route IDs`);
  }
  if (value.some((routeId) => !routeIds.has(routeId))) {
    throw new Error(`${context} contains an unknown route ID`);
  }
}

export function validateRoutesConfiguration(config) {
  if (!isRecord(config.routes)) {
    throw new Error("ROUTES_CONFIG.routes must be a JSON object");
  }

  const routes = Object.entries(config.routes);
  if (!routes.length) {
    throw new Error("ROUTES_CONFIG must define at least one route");
  }
  const routeIds = new Set(routes.map(([routeId]) => routeId));
  const enabledRouteIds = new Set();

  for (const [routeId, route] of routes) {
    if (!routeId || !isRecord(route)) {
      throw new Error("ROUTES_CONFIG contains an invalid route entry");
    }
    if (route.type !== "openai-chat" && route.type !== "anthropic-messages") {
      throw new Error(`ROUTES_CONFIG route ${routeId} has an unsupported type`);
    }
    if (!hasText(route.baseUrl) || !hasText(route.model)) {
      throw new Error(`ROUTES_CONFIG route ${routeId} requires baseUrl and model`);
    }
    if (route.enabled !== false) enabledRouteIds.add(routeId);
    validateRouteReferences(route.fallbacks, routeIds, `ROUTES_CONFIG route ${routeId} fallbacks`);
  }

  if (!enabledRouteIds.size) {
    throw new Error("ROUTES_CONFIG must enable at least one route");
  }

  if (config.defaults !== undefined && !isRecord(config.defaults)) {
    throw new Error("ROUTES_CONFIG.defaults must be a JSON object");
  }
  if (isRecord(config.defaults)) {
    if (config.defaults.defaultRoute !== undefined && !routeIds.has(config.defaults.defaultRoute)) {
      throw new Error("ROUTES_CONFIG.defaults.defaultRoute must reference an existing route");
    }
    validateRouteReferences(config.defaults.allowedRoutes, routeIds, "ROUTES_CONFIG.defaults.allowedRoutes");
    const defaultAllowedRoutes = config.defaults.allowedRoutes?.length ? config.defaults.allowedRoutes : [...routeIds];
    if (!defaultAllowedRoutes.some((routeId) => enabledRouteIds.has(routeId))) {
      throw new Error("ROUTES_CONFIG.defaults.allowedRoutes must include an enabled route");
    }
  }

  if (config.users !== undefined && !isRecord(config.users)) {
    throw new Error("ROUTES_CONFIG.users must be a JSON object");
  }
  if (isRecord(config.users)) {
    for (const [label, user] of Object.entries(config.users)) {
      if (!isRecord(user)) {
        throw new Error(`ROUTES_CONFIG user ${label} must be a JSON object`);
      }
      if (user.defaultRoute !== undefined && !routeIds.has(user.defaultRoute)) {
        throw new Error(`ROUTES_CONFIG user ${label} defaultRoute must reference an existing route`);
      }
      validateRouteReferences(user.allowedRoutes, routeIds, `ROUTES_CONFIG user ${label} allowedRoutes`);
      const allowedRoutes = user.allowedRoutes?.length
        ? user.allowedRoutes
        : config.defaults?.allowedRoutes?.length
          ? config.defaults.allowedRoutes
          : [...routeIds];
      if (!allowedRoutes.some((routeId) => enabledRouteIds.has(routeId))) {
        throw new Error(`ROUTES_CONFIG user ${label} allowedRoutes must include an enabled route`);
      }
    }
  }
}

function validateAccessCodes(value) {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) {
    throw new Error("ACCESS_CODES must contain at least one access code");
  }
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator < 1) {
      throw new Error("Every ACCESS_CODES entry must use the label:code format");
    }
    const code = entry.slice(separator + 1).trim();
    if (code.length < 16) {
      throw new Error("Every ACCESS_CODES entry must contain an access code of at least 16 characters");
    }
  }
}

function isCanonicalBase64Key(value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return false;
  }
  try {
    const binary = atob(value);
    return binary.length === 32 && btoa(binary) === value;
  } catch {
    return false;
  }
}

function parseProductionUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CHATUS_PRODUCTION_URL must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("CHATUS_PRODUCTION_URL must use HTTPS");
  }
  if (url.username || url.password || url.port) {
    throw new Error("CHATUS_PRODUCTION_URL must be an HTTPS origin without credentials or a port");
  }
  const normalizedInput = value.endsWith("/") ? value.slice(0, -1) : value;
  if (normalizedInput !== url.origin) {
    throw new Error("CHATUS_PRODUCTION_URL must not include a path, query, or fragment");
  }
  return {
    productionUrl: url.origin,
    hostname: url.hostname,
    routeMode: url.hostname.endsWith(".workers.dev") ? "workers_dev" : "custom_domain",
  };
}

export function readInstanceConfiguration(environment) {
  const workerName = requireText(environment, "CHATUS_WORKER_NAME");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workerName)) {
    throw new Error("CHATUS_WORKER_NAME must be 1-63 lowercase letters, numbers, or hyphens");
  }

  const kvNamespaceId = requireText(environment, "CHATUS_KV_NAMESPACE_ID");
  if (!/^[a-f0-9]{32}$/i.test(kvNamespaceId)) {
    throw new Error("CHATUS_KV_NAMESPACE_ID must be a 32-character hexadecimal namespace ID");
  }

  const production = parseProductionUrl(requireText(environment, "CHATUS_PRODUCTION_URL"));
  if (production.routeMode === "workers_dev") {
    const labels = production.hostname.split(".");
    if (labels.length !== 4 || labels[0] !== workerName) {
      throw new Error("A workers.dev CHATUS_PRODUCTION_URL must be <worker>.<account-subdomain>.workers.dev");
    }
  }
  return { workerName, kvNamespaceId, ...production };
}

export function collectWorkerSecrets(environment) {
  const accessCodes = requireText(environment, "ACCESS_CODES");
  const adminToken = requireText(environment, "ADMIN_TOKEN");
  validateAccessCodes(accessCodes);
  if (adminToken.length < 24) {
    throw new Error("ADMIN_TOKEN must contain at least 24 characters");
  }

  const hasRoutesConfig = hasText(environment.ROUTES_CONFIG);
  const hasLegacyKey = hasText(environment.UPSTREAM_API_KEY);
  if (!hasRoutesConfig && !hasLegacyKey) {
    throw new Error("ROUTES_CONFIG or UPSTREAM_API_KEY is required");
  }
  if (hasRoutesConfig) {
    validateRoutesConfiguration(parseJsonObject(environment.ROUTES_CONFIG, "ROUTES_CONFIG"));
  }

  const secrets = Object.fromEntries(
    WORKER_SECRET_NAMES.filter((name) => hasText(environment[name])).map((name) => [name, environment[name]]),
  );
  secrets.ACCESS_CODES = accessCodes;
  secrets.ADMIN_TOKEN = adminToken;

  if (hasText(environment.ROUTE_KEYS_MASTER_KEY)) {
    const masterKey = environment.ROUTE_KEYS_MASTER_KEY.trim();
    if (!isCanonicalBase64Key(masterKey)) {
      throw new Error("ROUTE_KEYS_MASTER_KEY must be Base64-encoded 32 random bytes");
    }
    secrets.ROUTE_KEYS_MASTER_KEY = masterKey;
  }

  const extraSecrets = hasText(environment.WORKER_SECRETS_JSON)
    ? parseJsonObject(environment.WORKER_SECRETS_JSON, "WORKER_SECRETS_JSON")
    : {};
  for (const [name, value] of Object.entries(extraSecrets)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error(`WORKER_SECRETS_JSON contains an invalid secret name: ${name}`);
    }
    if (RESERVED_EXTRA_SECRET_NAMES.has(name)) {
      throw new Error(`WORKER_SECRETS_JSON must not override reserved secret ${name}`);
    }
    if (!hasText(value)) {
      throw new Error(`Worker secret ${name} must be a non-empty string`);
    }
    secrets[name] = value;
  }

  return secrets;
}

export function validateCloudflareCredentials(environment) {
  requireText(environment, "CLOUDFLARE_API_TOKEN");
  const accountId = requireText(environment, "CLOUDFLARE_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID");
  }
}

export function buildDeploymentConfig(baseConfig, instance) {
  if (baseConfig === null || Array.isArray(baseConfig) || typeof baseConfig !== "object") {
    throw new Error("wrangler.jsonc must contain a JSON object");
  }

  const config = structuredClone(baseConfig);
  const namespaces = Array.isArray(config.kv_namespaces) ? config.kv_namespaces : [];
  const chatStoreBindings = namespaces.filter((namespace) => namespace?.binding === "CHAT_STORE");
  if (chatStoreBindings.length !== 1) {
    throw new Error("wrangler.jsonc must define exactly one CHAT_STORE KV binding");
  }

  config.name = instance.workerName;
  config.kv_namespaces = namespaces.map((namespace) =>
    namespace?.binding === "CHAT_STORE" ? { ...namespace, id: instance.kvNamespaceId } : namespace,
  );
  delete config.route;
  delete config.routes;

  if (instance.routeMode === "workers_dev") {
    config.workers_dev = true;
  } else {
    config.workers_dev = false;
    config.routes = [{ pattern: instance.hostname, custom_domain: true }];
  }

  return config;
}
