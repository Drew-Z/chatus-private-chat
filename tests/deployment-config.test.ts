import { describe, expect, it } from "vitest";
import {
  buildDeploymentConfig,
  collectWorkerSecrets,
  readInstanceConfiguration,
  validateCloudflareCredentials,
} from "../scripts/deployment-config.mjs";
import deployWorkflow from "../.github/workflows/deploy.yml?raw";
import acceptanceWorkflow from "../.github/workflows/production-acceptance.yml?raw";
import acceptanceProductionSource from "../scripts/acceptance-production.mjs?raw";
import localEnvironmentExample from "../.env.example?raw";
import packageSource from "../package.json?raw";
import wranglerSource from "../wrangler.jsonc?raw";
import selfHostingGuide from "../docs/self-hosting.md?raw";

const baseConfig = {
  name: "chatus",
  main: "src/index.ts",
  workers_dev: false,
  kv_namespaces: [{ binding: "CHAT_STORE" }],
  r2_buckets: [{ binding: "WORKSPACE_FILES" }],
  durable_objects: {
    bindings: [
      { name: "USER_STATE", class_name: "UserState" },
      { name: "TEAM_AGENT", class_name: "TeamAgent" },
      { name: "PROVIDER_COORDINATOR", class_name: "ProviderCoordinator" },
    ],
  },
  migrations: [
    { tag: "v1", new_sqlite_classes: ["UserState"] },
    { tag: "v2", new_sqlite_classes: ["TeamAgent"] },
    { tag: "v3", new_sqlite_classes: ["ProviderCoordinator"] },
  ],
};

const validEnvironment = {
  CHATUS_WORKER_NAME: "chatus-team",
  CHATUS_KV_NAMESPACE_ID: "0123456789abcdef0123456789abcdef",
  CHATUS_R2_BUCKET_NAME: "chatus-team-workspace-files",
  CHATUS_PRODUCTION_URL: "https://chat.example.test",
  CLOUDFLARE_API_TOKEN: "test-cloudflare-token",
  CLOUDFLARE_ACCOUNT_ID: "abcdef0123456789abcdef0123456789",
  ACCESS_CODES: "member:test-access-code",
  ADMIN_TOKEN: "test-admin-token-1234567890",
  ROUTES_CONFIG: JSON.stringify({
    routes: { main: { type: "openai-chat", baseUrl: "https://api.example.test/v1", model: "test-model" } },
  }),
};

describe("deployment configuration", () => {
  it("builds a custom-domain config without mutating the local config", () => {
    const instance = readInstanceConfiguration(validEnvironment);
    const config = buildDeploymentConfig(baseConfig, instance);

    expect(config).toMatchObject({
      name: "chatus-team",
      workers_dev: false,
      routes: [{ pattern: "chat.example.test", custom_domain: true }],
      kv_namespaces: [{ binding: "CHAT_STORE", id: "0123456789abcdef0123456789abcdef" }],
      r2_buckets: [{ binding: "WORKSPACE_FILES", bucket_name: "chatus-team-workspace-files" }],
      vars: { ACCESS_CODES_MODE: "managed" },
    });
    expect(baseConfig).toEqual(expect.objectContaining({ name: "chatus", kv_namespaces: [{ binding: "CHAT_STORE" }] }));
    expect(baseConfig.r2_buckets).toEqual([{ binding: "WORKSPACE_FILES" }]);
  });

  it("uses workers.dev without adding a custom-domain route", () => {
    const instance = readInstanceConfiguration({
      ...validEnvironment,
      CHATUS_PRODUCTION_URL: "https://chatus-team.example-account.workers.dev/",
    });
    const config = buildDeploymentConfig({ ...baseConfig, routes: ["stale.example.test/*"] }, instance);

    expect(instance.routeMode).toBe("workers_dev");
    expect(config.workers_dev).toBe(true);
    expect(config).not.toHaveProperty("route");
    expect(config).not.toHaveProperty("routes");
  });

  it("requires a workers.dev hostname to match the Worker name", () => {
    expect(() =>
      readInstanceConfiguration({
        ...validEnvironment,
        CHATUS_PRODUCTION_URL: "https://another-worker.example-account.workers.dev",
      }),
    ).toThrow(/<worker>\.<account-subdomain>\.workers\.dev/);
    expect(() =>
      readInstanceConfiguration({
        ...validEnvironment,
        CHATUS_PRODUCTION_URL: "https://chatus-team.extra.example-account.workers.dev",
      }),
    ).toThrow(/<worker>\.<account-subdomain>\.workers\.dev/);
  });

  it.each([
    ["CHATUS_WORKER_NAME", "Chatus Team", /CHATUS_WORKER_NAME/],
    ["CHATUS_KV_NAMESPACE_ID", "not-a-namespace", /CHATUS_KV_NAMESPACE_ID/],
    ["CHATUS_R2_BUCKET_NAME", "Bad_Bucket", /CHATUS_R2_BUCKET_NAME/],
    ["CHATUS_PRODUCTION_URL", "http://chat.example.test", /HTTPS/],
    ["CHATUS_PRODUCTION_URL", "https://chat.example.test/admin", /path/],
  ])("rejects invalid %s", (name, value, expected) => {
    expect(() => readInstanceConfiguration({ ...validEnvironment, [name]: value })).toThrow(expected);
  });

  it("requires exactly one CHAT_STORE binding", () => {
    const instance = readInstanceConfiguration(validEnvironment);
    expect(() => buildDeploymentConfig({ ...baseConfig, kv_namespaces: [] }, instance)).toThrow(/CHAT_STORE/);
  });

  it("requires exactly one WORKSPACE_FILES binding", () => {
    const instance = readInstanceConfiguration(validEnvironment);
    expect(() => buildDeploymentConfig({ ...baseConfig, r2_buckets: [] }, instance)).toThrow(/WORKSPACE_FILES/);
  });
});

describe("deployment secret preflight", () => {
  it("collects Worker secrets without deployment credentials", () => {
    const secrets = collectWorkerSecrets({
      ...validEnvironment,
      ROUTE_KEYS_MASTER_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
      WORKER_SECRETS_JSON: JSON.stringify({ TEST_ROUTE_KEY: "test-route-key" }),
    });

    expect(secrets).toMatchObject({
      ACCESS_CODES: validEnvironment.ACCESS_CODES,
      ADMIN_TOKEN: validEnvironment.ADMIN_TOKEN,
      ROUTES_CONFIG: validEnvironment.ROUTES_CONFIG,
      TEST_ROUTE_KEY: "test-route-key",
    });
    expect(secrets).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    expect(secrets).not.toHaveProperty("CHATUS_KV_NAMESPACE_ID");
  });

  it("accepts the legacy upstream-key mode", () => {
    const secrets = collectWorkerSecrets({
      ACCESS_CODES: "member:test-access-code",
      ADMIN_TOKEN: "test-admin-token-1234567890",
      UPSTREAM_API_KEY: "test-upstream-key",
    });
    expect(secrets).toEqual({
      ACCESS_CODES: "member:test-access-code",
      UPSTREAM_API_KEY: "test-upstream-key",
      ADMIN_TOKEN: "test-admin-token-1234567890",
    });
  });

  it("omits deployment access codes in managed mode", () => {
    const secrets = collectWorkerSecrets({
      ...validEnvironment,
      ACCESS_CODES_MODE: "managed",
      ACCESS_CODES: "forgotten-short-code",
    });

    expect(secrets).not.toHaveProperty("ACCESS_CODES");
    expect(secrets).toMatchObject({
      ADMIN_TOKEN: validEnvironment.ADMIN_TOKEN,
      ROUTES_CONFIG: validEnvironment.ROUTES_CONFIG,
    });
  });

  it("accepts provider-pool routes and shared provider credentials", () => {
    const routesConfig = {
      providers: {
        shared: {
          label: "Shared provider",
          type: "openai-chat",
          baseUrl: "https://provider.example.test/v1",
          apiKeyRef: "SHARED_PROVIDER_KEY",
          concurrency: "exclusive",
          queueTimeoutMs: 10_000,
          priority: 20,
        },
      },
      routes: {
        fast: { label: "Fast", offerings: [{ providerId: "shared", model: "fast-model" }] },
        deep: { label: "Deep", offerings: [{ providerId: "shared", model: "deep-model" }] },
      },
      defaults: { defaultRoute: "fast", allowedRoutes: ["fast", "deep"] },
    };

    const secrets = collectWorkerSecrets({
      ...validEnvironment,
      ROUTES_CONFIG: JSON.stringify(routesConfig),
    });

    expect(JSON.parse(secrets.ROUTES_CONFIG)).toEqual(routesConfig);
  });

  it.each([
    [{ ...validEnvironment, ACCESS_CODES: "" }, /ACCESS_CODES/],
    [{ ...validEnvironment, ACCESS_CODES: "test-access-code-without-label" }, /label:code/],
    [{ ...validEnvironment, ACCESS_CODES: "member:short" }, /at least 16 characters/],
    [{ ...validEnvironment, ACCESS_CODES_MODE: "unknown" }, /ACCESS_CODES_MODE/],
    [{ ...validEnvironment, ADMIN_TOKEN: "" }, /ADMIN_TOKEN/],
    [{ ...validEnvironment, ADMIN_TOKEN: "short-admin-token" }, /at least 24 characters/],
    [{ ...validEnvironment, ROUTES_CONFIG: "[]" }, /JSON object/],
    [{ ...validEnvironment, ROUTES_CONFIG: "{}" }, /ROUTES_CONFIG\.routes/],
    [
      { ...validEnvironment, ROUTES_CONFIG: JSON.stringify({ routes: { main: { type: "openai-chat" } } }) },
      /requires baseUrl and model or provider offerings/,
    ],
    [
      {
        ...validEnvironment,
        ROUTES_CONFIG: JSON.stringify({
          providers: {
            shared: {
              type: "openai-chat",
              baseUrl: "https://provider.example.test/v1",
              concurrency: "exclusive",
              queueTimeoutMs: 10_001,
            },
          },
          routes: { main: { offerings: [{ providerId: "shared", model: "test" }] } },
        }),
      },
      /queueTimeoutMs/,
    ],
    [
      {
        ...validEnvironment,
        ROUTES_CONFIG: JSON.stringify({
          providers: {},
          routes: { main: { offerings: [{ providerId: "missing", model: "test" }] } },
        }),
      },
      /unknown provider missing/,
    ],
    [
      {
        ...validEnvironment,
        ROUTES_CONFIG: JSON.stringify({
          routes: {
            main: { type: "openai-chat", baseUrl: "https://api.example.test/v1", model: "test" },
          },
          defaults: { defaultRoute: "missing" },
        }),
      },
      /defaultRoute must reference an existing route/,
    ],
    [{ ...validEnvironment, ROUTE_KEYS_MASTER_KEY: "not-a-key" }, /32 random bytes/],
    [
      { ...validEnvironment, WORKER_SECRETS_JSON: JSON.stringify({ ADMIN_TOKEN: "replacement" }) },
      /must not override reserved secret ADMIN_TOKEN/,
    ],
  ])("rejects an unsafe secret configuration", (environment, expected) => {
    expect(() => collectWorkerSecrets(environment)).toThrow(expected);
  });

  it("validates Cloudflare deployment credentials without returning them", () => {
    expect(validateCloudflareCredentials(validEnvironment)).toBeUndefined();
    expect(() => validateCloudflareCredentials({ ...validEnvironment, CLOUDFLARE_API_TOKEN: "" })).toThrow(
      /CLOUDFLARE_API_TOKEN/,
    );
    expect(() => validateCloudflareCredentials({ ...validEnvironment, CLOUDFLARE_ACCOUNT_ID: "bad" })).toThrow(
      /CLOUDFLARE_ACCOUNT_ID/,
    );
  });
});

describe("repository deployment contract", () => {
  it("keeps instance identifiers out of the local Wrangler config", () => {
    const config = JSON.parse(wranglerSource);
    expect(config.name).toBe("chatus");
    expect(config.kv_namespaces).toEqual([{ binding: "CHAT_STORE" }]);
    expect(config.r2_buckets).toEqual([{ binding: "WORKSPACE_FILES" }]);
  });

  it("keeps the local ROUTES_CONFIG example parseable after dotenv quote removal", () => {
    const line = localEnvironmentExample.split(/\r?\n/u).find((entry) => entry.startsWith("ROUTES_CONFIG="));
    expect(line).toMatch(/^ROUTES_CONFIG='\{.*\}'$/u);
    const value = line?.slice("ROUTES_CONFIG='".length, -1) || "";
    const config = JSON.parse(value);
    expect(Object.keys(config.providers)).not.toHaveLength(0);
    expect(Object.keys(config.routes)).not.toHaveLength(0);
  });

  it("uses free-plan-compatible SQLite migrations for Durable Objects", () => {
    const config = JSON.parse(wranglerSource);
    expect(config.migrations).toContainEqual({
      tag: "v3",
      new_sqlite_classes: ["ProviderCoordinator"],
    });
    expect(config.migrations.some((migration: Record<string, unknown>) => "new_classes" in migration)).toBe(false);
  });

  it("prepares and deploys only with the generated Wrangler config", () => {
    expect(deployWorkflow).toContain("vars.CHATUS_WORKER_NAME");
    expect(deployWorkflow).toContain("vars.CHATUS_KV_NAMESPACE_ID");
    expect(deployWorkflow).toContain("vars.CHATUS_R2_BUCKET_NAME");
    expect(deployWorkflow).toContain("vars.CHATUS_PRODUCTION_URL");
    expect(deployWorkflow).toContain("group: chatus-production-mutation");
    expect(acceptanceWorkflow).toContain("group: chatus-production-mutation");
    expect(deployWorkflow).toContain("cancel-in-progress: false");
    expect(acceptanceWorkflow).toContain("cancel-in-progress: false");
    expect(deployWorkflow).not.toContain("cancel-in-progress: true");
    expect(acceptanceWorkflow).not.toContain("cancel-in-progress: true");
    expect(deployWorkflow).toContain("npm run prepare:deployment");
    expect(deployWorkflow).toContain("--config .wrangler.deploy.jsonc --secrets-file .prod.secrets.json");
    expect(deployWorkflow).toContain("git ls-remote origin refs/heads/main");
    expect(deployWorkflow.match(/git ls-remote origin refs\/heads\/main/g)).toHaveLength(2);
    expect(deployWorkflow.indexOf("Refuse a stale main revision before deploy")).toBeGreaterThan(
      deployWorkflow.indexOf("Prepare release metadata"),
    );
    expect(deployWorkflow.indexOf("Refuse a stale main revision before deploy")).toBeLessThan(
      deployWorkflow.indexOf("npx wrangler deploy --config .wrangler.deploy.jsonc --secrets-file .prod.secrets.json"),
    );
    expect(deployWorkflow).toContain("ACCESS_CODES_MODE: managed");
    expect(deployWorkflow).not.toContain("secrets.ACCESS_CODES");
    expect(deployWorkflow).not.toMatch(/PRODUCTION_URL:\s*https:/);
    expect(acceptanceWorkflow).toContain("vars.CHATUS_PRODUCTION_URL");
    expect(acceptanceWorkflow).toContain("Verify deployed revision before acceptance");
    expect(acceptanceWorkflow).not.toMatch(/PRODUCTION_URL:\s*https:/);
  });

  it("checks release revision and logout cleanup during production acceptance", () => {
    expect(acceptanceProductionSource).toContain("expectedReleaseSha");
    expect(acceptanceProductionSource).toContain("pre-acceptance release verification");
    expect(acceptanceProductionSource).toContain("post-cleanup release verification");
    expect(acceptanceProductionSource).toContain("await expectStatus(logout, 200, \"admin logout\")");
  });

  it("allows KV access updates to propagate without tripping the shared login throttle", () => {
    expect(acceptanceProductionSource).toContain("const loginAttempts = 5");
    expect(acceptanceProductionSource).toContain("const loginRetryDelayMs = 15_000");
    expect(acceptanceProductionSource).toContain("for (const member of members) await loginMember(member)");
    expect(acceptanceProductionSource).toContain("for (const member of members) await purgeMember(member)");
    expect(acceptanceProductionSource).not.toContain("Promise.all(members.map(loginMember))");
    expect(acceptanceProductionSource).not.toContain("Promise.all(members.map(purgeMember))");
  });

  it("does not expose a local production deploy script", () => {
    const packageJson = JSON.parse(packageSource);
    expect(packageJson.scripts).not.toHaveProperty("deploy");
    expect(packageJson.scripts["deploy:dry-run"]).toBe("wrangler deploy --dry-run");
  });

  it("documents the additive Worker Secret deletion boundary", () => {
    expect(selfHostingGuide).toContain("不会从 Cloudflare Worker 删除");
    expect(selfHostingGuide).toContain("CHATUS_R2_BUCKET_NAME");
    expect(selfHostingGuide).toContain("R2 bucket");
  });
});
