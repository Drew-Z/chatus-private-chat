import { env, exports } from "cloudflare:workers";
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";

const ACCESS_CODES_KEY = "config:access_codes";
const ROUTES_CONFIG_KEY = "config:routes_config";
const ADMIN_AUDIT_KEY = "config:admin_audit";
const FEEDBACK_KEY = "feedback:recent";
const ROUTE_SECRET_PREFIX = "route-secret:";

async function clearRouteSecrets() {
  let cursor: string | undefined;
  do {
    const page = await env.CHAT_STORE.list({ prefix: ROUTE_SECRET_PREFIX, cursor, limit: 100 });
    await Promise.all(page.keys.map((key) => env.CHAT_STORE.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function login(label = `tester-${crypto.randomUUID()}`) {
  await env.CHAT_STORE.put(ACCESS_CODES_KEY, `${label}:test-access-code`);
  const response = await exports.default.fetch(
    new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test-access-code" }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  expect(cookie).toMatch(/^chatus_session=/);
  return { cookie: cookie!, label };
}

function apiRequest(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return exports.default.fetch(new Request(`https://example.test${path}`, { ...init, headers }));
}

async function adminLogin() {
  const response = await exports.default.fetch(
    new Request("https://example.test/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test-admin-token" }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  expect(cookie).toMatch(/^chatus_admin=/);
  return cookie!;
}

async function putRouteSecret(cookie: string, apiKeyRef: string, apiKey: string, expectedRevision?: string) {
  return apiRequest(`/api/admin/route-secrets/${encodeURIComponent(apiKeyRef)}`, cookie, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, expectedRevision }),
  });
}

describe("Worker API", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    await Promise.all([
      env.CHAT_STORE.delete(ACCESS_CODES_KEY),
      env.CHAT_STORE.delete(ROUTES_CONFIG_KEY),
      env.CHAT_STORE.delete("route-health:default"),
      env.CHAT_STORE.delete(ADMIN_AUDIT_KEY),
      env.CHAT_STORE.delete(FEEDBACK_KEY),
      clearRouteSecrets(),
    ]);
  });

  it("creates a cookie session and restores it", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://session.example/v1",
          model: "session-model",
          apiKey: "session-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
    }));
    const { cookie, label } = await login();
    await env.CHAT_STORE.put("route-health:default", JSON.stringify({ ok: false, checkedAt: new Date().toISOString() }));
    const response = await apiRequest("/api/session", cookie);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      user: label,
      routes: [{ id: "default", healthStatus: "unhealthy" }],
    });
  });

  it("reports core binding health without exposing configuration details", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "health-user:health-access-code");
    const response = await exports.default.fetch(new Request("https://example.test/healthz"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      status: "ok",
      checks: { kv: true, durableObject: true, configured: true },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("health-access-code");
    expect(serialized).not.toContain("baseUrl");
    expect(serialized).not.toContain("model");
  });

  it("returns a display name without changing the stable user label", async () => {
    const label = `named-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://named.example/v1",
          model: "named-model",
          apiKey: "named-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
      users: { [label]: { displayName: "小林" } },
    }));
    const { cookie } = await login(label);
    const response = await apiRequest("/api/session", cookie);
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      user: label,
      displayName: "小林",
      routes: [{ id: "default" }],
    });
  });

  it("blocks disabled users from new and existing sessions", async () => {
    const label = `paused-${crypto.randomUUID()}`;
    const { cookie } = await login(label);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://paused.example/v1",
          model: "paused-model",
          apiKey: "paused-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"] },
      users: { [label]: { enabled: false, displayName: "暂停用户" } },
    }));

    expect((await apiRequest("/api/session", cookie)).status).toBe(401);
    const relogin = await exports.default.fetch(new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "test-access-code" }),
    }));
    expect(relogin.status).toBe(403);
    await expect(relogin.json()).resolves.toMatchObject({ error: "user_disabled" });
  });

  it("rate limits repeated failed login attempts by client IP", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "friend:correct-access-code");
    const ip = `test-${crypto.randomUUID()}`;
    const attempt = () => exports.default.fetch(new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ code: "wrong-access-code" }),
    }));

    for (let index = 0; index < 8; index += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(blocked.json()).resolves.toMatchObject({ error: "login_rate_limited" });
  });

  it("rate limits failed admin logins independently from user access codes", async () => {
    const ip = `admin-${crypto.randomUUID()}`;
    const attempt = (token = "wrong-admin-token") => exports.default.fetch(new Request("https://example.test/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ token }),
    }));

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt("test-admin-token");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(blocked.json()).resolves.toMatchObject({ error: "admin_login_rate_limited" });

    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "friend:valid-user-code");
    const userLogin = await exports.default.fetch(new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ code: "valid-user-code" }),
    }));
    expect(userLogin.status).toBe(200);
  });

  it("lets a user revoke every active device session without deleting data", async () => {
    const label = `self-revoke-${crypto.randomUUID()}`;
    const first = await login(label);
    const second = await login(label);
    await env.CHAT_STORE.put(`memory:${encodeURIComponent(label)}`, "keep this memory");

    const revoked = await apiRequest("/api/sessions/revoke-all", first.cookie, { method: "POST" });
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get("Set-Cookie")).toContain("Max-Age=0");
    await expect(revoked.json()).resolves.toMatchObject({ ok: true, revoked: 2 });
    expect((await apiRequest("/api/session", first.cookie)).status).toBe(401);
    expect((await apiRequest("/api/session", second.cookie)).status).toBe(401);
    expect(await env.CHAT_STORE.get(`memory:${encodeURIComponent(label)}`)).toBe("keep this memory");
  });

  it("creates a configured user and access code in one admin operation", async () => {
    const cookie = await adminLogin();
    const label = `invite-${crypto.randomUUID()}`;
    const response = await apiRequest("/api/admin/users", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        user: { displayName: "新朋友", defaultRoute: "default", allowedRoutes: ["default"], dailyMessageLimit: 321 },
      }),
    });
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ label, config: { users: { [label]: { displayName: "新朋友", dailyMessageLimit: 321 } } } });
    expect(payload.accessCode).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const accessCodes = await env.CHAT_STORE.get(ACCESS_CODES_KEY);
    expect(accessCodes).toContain(`${label}:${payload.accessCode}`);
    const duplicate = await apiRequest("/api/admin/users", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, user: {} }),
    });
    expect(duplicate.status).toBe(409);

    const audit = JSON.parse((await env.CHAT_STORE.get(ADMIN_AUDIT_KEY)) || "[]");
    expect(audit[0]).toMatchObject({ action: "user.create", target: label });
    expect(JSON.stringify(audit)).not.toContain(payload.accessCode);
  });

  it("hides disabled routes from users and fallback plans", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        active: {
          label: "Active",
          type: "openai-chat",
          baseUrl: "https://active.example/v1",
          model: "active-model",
          apiKey: "active-key",
          fallbacks: ["disabled"],
        },
        disabled: {
          enabled: false,
          label: "Disabled",
          type: "openai-chat",
          baseUrl: "https://disabled.example/v1",
          model: "disabled-model",
          apiKey: "disabled-key",
        },
      },
      defaults: { defaultRoute: "disabled", allowedRoutes: ["active", "disabled"] },
    }));
    const { cookie } = await login();

    const session = await apiRequest("/api/session", cookie);
    await expect(session.json()).resolves.toMatchObject({
      defaultRoute: "active",
      routes: [{ id: "active" }],
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("upstream failed", { status: 502 }));
    const chat = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "active", messages: [{ role: "user", content: "计算 8 加 9，并解释步骤" }] }),
    });
    const chatPayload = await chat.clone().json();
    expect(chat.status, JSON.stringify(chatPayload)).toBe(502);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("active.example");
  });

  it("runs scheduled route health checks and persists results", async () => {
    const adminCookie = await adminLogin();
    expect((await putRouteSecret(adminCookie, "SCHEDULED_TEST_KEY", "scheduled-managed-test-key")).status).toBe(200);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        scheduled: {
          label: "Scheduled",
          type: "openai-chat",
          baseUrl: "https://scheduled.example/v1",
          model: "scheduled-model",
          apiKeyRef: "SCHEDULED_TEST_KEY",
        },
      },
      defaults: { defaultRoute: "scheduled", allowedRoutes: ["scheduled"] },
    }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "391" } }],
    }), { headers: { "Content-Type": "application/json" } }));
    const ctx = createExecutionContext();

    await worker.scheduled(createScheduledController({ cron: "17 */6 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer scheduled-managed-test-key");
    await expect(env.CHAT_STORE.get("route-health:scheduled", "json")).resolves.toMatchObject({
      ok: true,
      routeId: "scheduled",
      model: "scheduled-model",
    });
    fetchMock.mockRestore();
  });

  it("stores privacy-safe answer feedback and updates duplicate ratings", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        feedback: {
          label: "Feedback",
          type: "openai-chat",
          baseUrl: "https://feedback.example/v1",
          model: "feedback-model",
          apiKey: "feedback-key",
        },
      },
      defaults: { defaultRoute: "feedback", allowedRoutes: ["feedback"] },
    }));
    const { cookie, label } = await login();
    const metadata = { routeId: "feedback", chatId: "chat-1", messageId: "message-1" };

    const first = await apiRequest("/api/feedback", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...metadata, rating: "down", reason: "inaccurate", content: "private conversation text" }),
    });
    expect(first.status).toBe(200);
    await expect(env.CHAT_STORE.get(FEEDBACK_KEY, "json")).resolves.toMatchObject([
      { label, rating: "down", reason: "inaccurate", ...metadata },
    ]);
    const second = await apiRequest("/api/feedback", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...metadata, rating: "up" }),
    });
    expect(second.status).toBe(200);

    const adminCookie = await adminLogin();
    const response = await apiRequest("/api/admin/feedback", adminCookie);
    const payload = await response.json();
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toMatchObject({ label, rating: "up", ...metadata });
    expect(JSON.stringify(payload)).not.toContain("private conversation text");

    const deleted = await apiRequest("/api/user-data", cookie, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const afterDelete = await apiRequest("/api/admin/feedback", adminCookie);
    await expect(afterDelete.json()).resolves.toMatchObject({ entries: [] });
  });

  it("adds hardened security headers to assets and session cookies", async () => {
    const assetResponse = await exports.default.fetch(new Request("https://example.test/"));
    expect(assetResponse.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(assetResponse.headers.get("Content-Security-Policy")).not.toContain("'unsafe-inline'");
    expect(assetResponse.headers.get("X-Frame-Options")).toBe("DENY");
    expect(assetResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(assetResponse.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(assetResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(assetResponse.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(assetResponse.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(assetResponse.headers.get("Origin-Agent-Cluster")).toBe("?1");
    expect(assetResponse.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/i);

    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "security-user:test-access-code");
    const loginResponse = await exports.default.fetch(
      new Request("https://example.test/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "test-access-code" }),
      }),
    );
    const cookie = loginResponse.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(loginResponse.headers.get("Cache-Control")).toContain("no-store");
    expect(loginResponse.headers.get("Pragma")).toBe("no-cache");
    expect(loginResponse.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(loginResponse.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/i);

    const sessionResponse = await exports.default.fetch(new Request("https://example.test/api/session", {
      headers: { Cookie: cookie.split(";", 1)[0] },
    }));
    expect(sessionResponse.headers.get("Cache-Control")).toContain("private");
    expect(sessionResponse.headers.get("Expires")).toBe("0");
    expect(sessionResponse.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sessionResponse.headers.get("X-Request-ID")).not.toBe(loginResponse.headers.get("X-Request-ID"));
  });

  it("caches only fingerprinted JavaScript and CSS assets as immutable", async () => {
    const fingerprint = "a".repeat(40);
    const fingerprinted = await exports.default.fetch(new Request(`https://example.test/app.js?v=${fingerprint}`));
    expect(fingerprinted.headers.get("Cache-Control")).toContain("max-age=31536000");
    expect(fingerprinted.headers.get("Cache-Control")).toContain("immutable");

    const plain = await exports.default.fetch(new Request("https://example.test/app.js"));
    expect(plain.headers.get("Cache-Control") || "").not.toContain("immutable");

    const release = await exports.default.fetch(new Request(`https://example.test/release.json?v=${fingerprint}`));
    expect(release.headers.get("Cache-Control") || "").not.toContain("immutable");
  });

  it("invalidates an admin session when its token fingerprint no longer matches", async () => {
    const cookie = await adminLogin();
    const sessionToken = cookie.split("=", 2)[1];
    const key = `admin:${sessionToken}`;
    const session = await env.CHAT_STORE.get<Record<string, unknown>>(key, "json");
    expect(session?.tokenFingerprint).toMatch(/^[0-9a-f]{64}$/);
    await env.CHAT_STORE.put(key, JSON.stringify({ ...session, tokenFingerprint: "0".repeat(64) }));

    const response = await apiRequest("/api/admin/session", cookie);
    expect(response.status).toBe(401);
    await expect(env.CHAT_STORE.get(key)).resolves.toBeNull();
  });

  it("blocks trivial probe prompts before contacting an upstream", async () => {
    const { cookie, label } = await login();
    await env.CHAT_STORE.put(
      ROUTES_CONFIG_KEY,
      JSON.stringify({
        defaults: { defaultRoute: "test", allowedRoutes: ["test"], blockedPrompts: ["你好", "hi"] },
        users: { [label]: { allowedRoutes: ["test"] } },
        routes: {
          test: {
            label: "Test",
            type: "openai-chat",
            baseUrl: "https://upstream.invalid/v1",
            model: "test-model",
            apiKey: "test-key",
          },
        },
      }),
    );

    const response = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "test", messages: [{ role: "user", content: "你好！" }] }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "blocked_prompt" });
  });

  it("stores, restores and deletes an isolated cloud chat", async () => {
    const { cookie } = await login();
    const chat = {
      id: "chat-1",
      title: "测试会话",
      createdAt: 10,
      updatedAt: 20,
      summary: "",
      summaryUntil: 0,
      pinned: true,
      messages: [
        { role: "user", content: "完成一个小任务" },
        { role: "assistant", content: "已完成", routeId: "backup", fallback: true, createdAt: 123456 },
      ],
    };
    const put = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat }),
    });
    expect(put.status).toBe(200);

    const stale = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { ...chat, title: "旧设备版本", updatedAt: 19 } }),
    });
    expect(stale.status).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({
      accepted: false,
      currentChat: { id: "chat-1", title: "测试会话", updatedAt: 20 },
    });

    const list = await apiRequest("/api/chats", cookie);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      chats: [{ id: "chat-1", title: "测试会话", pinned: true, messages: [{ role: "user" }, { routeId: "backup", fallback: true, createdAt: 123456 }] }],
    });

    await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { ...chat, title: "其他设备更新", updatedAt: 21 } }),
    });
    const conflictedRemove = await apiRequest("/api/chats?id=chat-1&expectedUpdatedAt=20", cookie, { method: "DELETE" });
    expect(conflictedRemove.status).toBe(409);
    await expect(conflictedRemove.json()).resolves.toMatchObject({
      error: "chat_delete_conflict",
      currentChat: { id: "chat-1", title: "其他设备更新", updatedAt: 21 },
    });

    const remove = await apiRequest("/api/chats?id=chat-1&expectedUpdatedAt=21", cookie, { method: "DELETE" });
    expect(remove.status).toBe(200);
    await expect(remove.json()).resolves.toMatchObject({ deleted: true, chats: [] });

    const delayedSave = await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { ...chat, title: "延迟上传", updatedAt: 21 } }),
    });
    await expect(delayedSave.json()).resolves.toMatchObject({ accepted: false, currentChat: null, chats: [] });

    const staleMerge = await apiRequest("/api/chats/migrate", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "merge", chats: [{ ...chat, title: "旧设备迁移", updatedAt: 21 }] }),
    });
    await expect(staleMerge.json()).resolves.toMatchObject({ mode: "merge", chats: [] });
  });

  it("deletes all user conversations and long-term memory", async () => {
    const { cookie, label } = await login();
    await apiRequest("/api/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: "偏好简洁回答" }),
    });
    await apiRequest("/api/chats", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { id: "delete-me", title: "待删除", createdAt: 10, updatedAt: 20, messages: [] } }),
    });

    const remove = await apiRequest("/api/user-data", cookie, { method: "DELETE" });
    expect(remove.status).toBe(200);
    expect(remove.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await apiRequest("/api/chats", cookie)).status).toBe(401);
    expect((await apiRequest("/api/memory", cookie)).status).toBe(401);

    const next = await login(label);
    await expect(apiRequest("/api/chats", next.cookie).then((response) => response.json())).resolves.toMatchObject({ chats: [] });
    await expect(apiRequest("/api/memory", next.cookie).then((response) => response.json())).resolves.toMatchObject({ memory: "" });
    const staleUpload = await apiRequest("/api/chats", next.cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat: { id: "delete-me", title: "旧设备副本", createdAt: 10, updatedAt: 20, messages: [] } }),
    });
    await expect(staleUpload.json()).resolves.toMatchObject({ accepted: false, currentChat: null, chats: [] });

    const restored = await apiRequest("/api/chats/migrate", next.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "restore",
        chats: [{ id: "delete-me", title: "从备份恢复", createdAt: 10, updatedAt: 20, messages: [] }],
      }),
    }).then((response) => response.json());
    expect(restored).toMatchObject({ mode: "restore", chats: [{ id: "delete-me", title: "从备份恢复" }] });
    expect(restored.chats[0].updatedAt).toBeGreaterThan(20);

    const oldDeviceMerge = await apiRequest("/api/chats/migrate", next.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "merge",
        chats: [{ id: "other-old-chat", title: "旧设备残留", createdAt: 10, updatedAt: 20, messages: [] }],
      }),
    }).then((response) => response.json());
    expect(oldDeviceMerge.chats).toHaveLength(1);
    expect(oldDeviceMerge.chats[0]).toMatchObject({ id: "delete-me", title: "从备份恢复" });
  });

  it("rejects auxiliary model calls without the web client marker", async () => {
    const { cookie } = await login();
    const response = await apiRequest("/api/session-summary", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "请总结这个任务" }] }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "forbidden" });
  });

  it("does not charge the user message quota for automatic session summaries", async () => {
    const routeConfig = {
      routes: {
        default: {
          label: "Default",
          type: "openai-chat",
          baseUrl: "https://summary.example/v1",
          model: "summary-model",
          apiKey: "summary-key",
        },
      },
      defaults: { defaultRoute: "default", allowedRoutes: ["default"], dailyMessageLimit: 5 },
    };
    const adminCookie = await adminLogin();
    const currentConfig = await apiRequest("/api/admin/config", adminCookie).then((response) => response.json());
    const savedConfig = await apiRequest("/api/admin/config", adminCookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: routeConfig, expectedRevision: currentConfig.revision }),
    });
    expect(savedConfig.status).toBe(200);
    const { cookie } = await login();
    const before = await apiRequest("/api/session", cookie).then((response) => response.json());
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "用户正在测试长期会话摘要。" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await apiRequest("/api/session-summary", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ messages: [{ role: "user", content: "请持续记住这个测试任务" }] }),
    });
    const summaryPayload = await response.json();
    expect(response.status, JSON.stringify(summaryPayload)).toBe(200);
    expect(summaryPayload).toMatchObject({ summary: "用户正在测试长期会话摘要。" });
    const after = await apiRequest("/api/session", cookie).then((sessionResponse) => sessionResponse.json());
    expect(after.usage.remaining).toBe(before.usage.remaining);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("requires an admin session for managed route-secret APIs", async () => {
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/route-secrets"))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/route-secrets/PRIVATE_TEST_KEY", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "test-private-value" }),
    }))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://example.test/api/admin/route-secrets/PRIVATE_TEST_KEY", {
      method: "DELETE",
    }))).status).toBe(401);
  });

  it("encrypts, rotates and deletes managed route keys without exposing plaintext", async () => {
    const cookie = await adminLogin();
    const apiKeyRef = "MANAGED_TEST_KEY";
    const apiKey = "managed-test-route-key-value";

    const created = await putRouteSecret(cookie, apiKeyRef, apiKey);
    const createdPayload = await created.json() as any;
    expect(created.status, JSON.stringify(createdPayload)).toBe(200);
    expect(createdPayload.item).toMatchObject({
      apiKeyRef,
      source: "managed",
      status: "configured",
      managed: true,
    });
    expect(JSON.stringify(createdPayload)).not.toContain(apiKey);
    expect(JSON.stringify(createdPayload)).not.toContain("ciphertext");

    const storageKey = `${ROUTE_SECRET_PREFIX}${encodeURIComponent(apiKeyRef)}`;
    const firstRaw = await env.CHAT_STORE.get(storageKey);
    expect(firstRaw).toBeTruthy();
    expect(firstRaw).not.toContain(apiKey);
    const firstRecord = JSON.parse(firstRaw!);
    expect(firstRecord).toMatchObject({ version: 1, algorithm: "AES-GCM" });
    expect(firstRecord.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(firstRecord.ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);

    const listed = await apiRequest("/api/admin/route-secrets", cookie);
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).not.toContain(apiKey);
    expect(listedText).not.toContain("ciphertext");
    const listedPayload = JSON.parse(listedText);
    expect(listedPayload.masterKeyReady).toBe(true);
    expect(listedPayload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiKeyRef, source: "managed", status: "configured" }),
    ]));

    const replaced = await putRouteSecret(cookie, apiKeyRef, apiKey, createdPayload.item.revision);
    const replacedPayload = await replaced.json() as any;
    expect(replaced.status, JSON.stringify(replacedPayload)).toBe(200);
    const secondRaw = await env.CHAT_STORE.get(storageKey);
    expect(secondRaw).toBeTruthy();
    expect(secondRaw).not.toBe(firstRaw);
    const secondRecord = JSON.parse(secondRaw!);
    expect(secondRecord.iv).not.toBe(firstRecord.iv);
    expect(secondRecord.ciphertext).not.toBe(firstRecord.ciphertext);

    const stale = await putRouteSecret(cookie, apiKeyRef, "stale-test-value", createdPayload.item.revision);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "route_secret_conflict" });
    await expect(env.CHAT_STORE.get(storageKey)).resolves.toBe(secondRaw);

    const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    const decrypt = (keyBytes: Uint8Array, additionalData: string) => crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    ).then((key) => crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: fromBase64(secondRecord.iv),
      additionalData: new TextEncoder().encode(additionalData),
    }, key, fromBase64(secondRecord.ciphertext)));
    await expect(decrypt(new Uint8Array(32).fill(9), `chatus:route-secret:v1:${apiKeyRef}`)).rejects.toBeTruthy();
    await expect(decrypt(
      Uint8Array.from({ length: 32 }, (_, index) => index),
      "chatus:route-secret:v1:DIFFERENT_TEST_KEY",
    )).rejects.toBeTruthy();

    const removed = await apiRequest(`/api/admin/route-secrets/${apiKeyRef}`, cookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: replacedPayload.item.revision }),
    });
    expect(removed.status).toBe(200);
    await expect(env.CHAT_STORE.get(storageKey)).resolves.toBeNull();
    const audit = await apiRequest("/api/admin/audit", cookie).then((response) => response.json()) as any;
    expect(audit.entries.slice(0, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "route-secret.update", target: apiKeyRef }),
      expect.objectContaining({ action: "route-secret.delete", target: apiKeyRef }),
    ]));
    expect(JSON.stringify(audit)).not.toContain(apiKey);
  });

  it("rejects a managed ciphertext moved to a different key reference", async () => {
    const cookie = await adminLogin();
    const sourceRef = "SOURCE_TEST_KEY";
    const targetRef = "TARGET_TEST_KEY";
    expect((await putRouteSecret(cookie, sourceRef, "source-managed-test-value")).status).toBe(200);
    const raw = await env.CHAT_STORE.get(`${ROUTE_SECRET_PREFIX}${sourceRef}`);
    await env.CHAT_STORE.put(`${ROUTE_SECRET_PREFIX}${targetRef}`, raw!);

    const response = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "openai-chat",
        baseUrl: "https://moved.example/v1",
        apiKeyRef: targetRef,
      }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "decrypt_failed" });

    const listed = await apiRequest("/api/admin/route-secrets", cookie).then((item) => item.json()) as any;
    expect(listed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiKeyRef: targetRef, source: "managed", status: "unavailable" }),
    ]));
  });

  it("reports missing or changed master keys without breaking Worker Secret fallback", async () => {
    const cookie = await adminLogin();
    const apiKeyRef = "MASTER_MISMATCH_TEST_KEY";
    expect((await putRouteSecret(cookie, apiKeyRef, "master-mismatch-test-value")).status).toBe(200);
    const withMasterKey = (masterKey: string | undefined) => new Proxy(env, {
      get(target, property, receiver) {
        if (property === "ROUTE_KEYS_MASTER_KEY") return masterKey;
        return Reflect.get(target, property, receiver);
      },
    });
    const directAdminRequest = (path: string, customEnv: typeof env, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Cookie", cookie);
      if (init.body) headers.set("Content-Type", "application/json");
      return worker.fetch(new Request(`https://example.test${path}`, { ...init, headers }), customEnv);
    };

    const changedMaster = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    const unreadable = await directAdminRequest(
      "/api/admin/route-models",
      withMasterKey(changedMaster),
      {
        method: "POST",
        body: JSON.stringify({
          type: "openai-chat",
          baseUrl: "https://master-mismatch.example/v1",
          apiKeyRef,
        }),
      },
    );
    expect(unreadable.status).toBe(503);
    await expect(unreadable.json()).resolves.toMatchObject({ error: "decrypt_failed" });

    const missingMaster = withMasterKey(undefined);
    const cannotWrite = await directAdminRequest(
      "/api/admin/route-secrets/NEW_MASTER_TEST_KEY",
      missingMaster,
      { method: "PUT", body: JSON.stringify({ apiKey: "new-master-test-value" }) },
    );
    expect(cannotWrite.status).toBe(503);
    await expect(cannotWrite.json()).resolves.toMatchObject({ error: "master_key_unavailable" });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      data: [{ id: "fallback-model" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const fallback = await directAdminRequest(
      "/api/admin/route-models",
      missingMaster,
      {
        method: "POST",
        body: JSON.stringify({
          type: "openai-chat",
          baseUrl: "https://worker-fallback.example/v1",
          apiKeyRef: "TEST_ROUTE_KEY",
        }),
      },
    );
    expect(fallback.status).toBe(200);
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer test-route-key");
  });

  it("prefers managed route keys over Worker Secrets and legacy route keys over managed keys", async () => {
    const cookie = await adminLogin();
    const managedValue = "managed-model-list-test-key";
    expect((await putRouteSecret(cookie, "TEST_ROUTE_KEY", managedValue)).status).toBe(200);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        legacy: {
          label: "Legacy",
          type: "openai-chat",
          baseUrl: "https://legacy-models.example/v1",
          model: "legacy-model",
          apiKey: "legacy-model-list-test-key",
          apiKeyRef: "TEST_ROUTE_KEY",
        },
      },
      defaults: { defaultRoute: "legacy", allowedRoutes: ["legacy"] },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const managed = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "openai-chat",
        baseUrl: "https://managed-models.example/v1",
        apiKeyRef: "TEST_ROUTE_KEY",
      }),
    });
    expect(managed.status).toBe(200);
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(`Bearer ${managedValue}`);

    const legacy = await apiRequest("/api/admin/route-models", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId: "legacy",
        type: "openai-chat",
        baseUrl: "https://legacy-models.example/v1",
        apiKeyRef: "TEST_ROUTE_KEY",
      }),
    });
    expect(legacy.status).toBe(200);
    expect(new Headers(fetchSpy.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe("Bearer legacy-model-list-test-key");
  });

  it("fetches and normalizes models through the admin API", async () => {
    const cookie = await adminLogin();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      const response = await apiRequest("/api/admin/route-models", cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "openai-chat",
          baseUrl: "https://models.example/v1",
          apiKeyRef: "TEST_ROUTE_KEY",
        }),
      });
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(payload).toMatchObject({ models: ["model-a", "model-b"], count: 2 });
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://models.example/v1/models");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-route-key");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("uses managed route keys for route access, manual health checks and chat requests", async () => {
    const adminCookie = await adminLogin();
    const apiKeyRef = "END_TO_END_TEST_KEY";
    const managedKey = "managed-end-to-end-test-key";
    expect((await putRouteSecret(adminCookie, apiKeyRef, managedKey)).status).toBe(200);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        managed: {
          label: "Managed",
          type: "openai-chat",
          baseUrl: "https://managed-route.example/v1",
          model: "managed-model",
          apiKeyRef,
        },
      },
      defaults: { defaultRoute: "managed", allowedRoutes: ["managed"] },
    }));
    let fetchCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCount += 1;
      return fetchCount === 1
        ? new Response(JSON.stringify({ choices: [{ message: { content: "391" } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response('data: {"choices":[{"delta":{"content":"完成"}}]}\n\n', {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
    });

    const health = await apiRequest("/api/admin/route-health", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "managed" }),
    });
    expect(health.status).toBe(200);

    const { cookie } = await login();
    const session = await apiRequest("/api/session", cookie);
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ routes: [{ id: "managed" }], defaultRoute: "managed" });

    const chat = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "managed", messages: [{ role: "user", content: "完成一个简短任务" }] }),
    });
    expect(chat.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchSpy.mock.calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${managedKey}`);
    }
  });

  it("keeps user BYOK precedence and requiresUserKey blocking with a managed key present", async () => {
    const adminCookie = await adminLogin();
    const apiKeyRef = "BYOK_TEST_KEY";
    expect((await putRouteSecret(adminCookie, apiKeyRef, "managed-byok-test-key")).status).toBe(200);
    const label = `byok-${crypto.randomUUID()}`;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        byok: {
          label: "BYOK",
          type: "openai-chat",
          baseUrl: "https://byok.example/v1",
          model: "byok-model",
          apiKeyRef,
          requiresUserKey: true,
        },
      },
      defaults: {
        defaultRoute: "byok",
        allowedRoutes: ["byok"],
        allowBringYourOwnKey: true,
      },
      users: { [label]: { allowBringYourOwnKey: true } },
    }));
    const { cookie } = await login(label);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("data: done\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));

    const missing = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ routeId: "byok", messages: [{ role: "user", content: "执行 BYOK 测试" }] }),
    });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: "user_api_key_required", routeId: "byok" });
    expect(fetchSpy).not.toHaveBeenCalled();

    const supplied = await apiRequest("/api/chat", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({
        routeId: "byok",
        userApiKey: "user-supplied-test-key",
        messages: [{ role: "user", content: "执行 BYOK 测试" }],
      }),
    });
    expect(supplied.status).toBe(200);
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer user-supplied-test-key");
  });

  it("persists the latest route health result", async () => {
    const cookie = await adminLogin();
    const check = await apiRequest("/api/admin/route-health", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId: "default" }),
    });
    expect(check.status).toBe(400);
    await expect(check.json()).resolves.toMatchObject({ ok: false, routeId: "default", error: "missing_key" });

    const stored = await apiRequest("/api/admin/route-health", cookie);
    expect(stored.status).toBe(200);
    await expect(stored.json()).resolves.toMatchObject({
      routes: { default: { ok: false, routeId: "default", error: "missing_key" } },
    });
  });

  it("rejects configurations without an enabled route for every user", async () => {
    const cookie = await adminLogin();
    const route = {
      label: "Disabled",
      type: "openai-chat",
      baseUrl: "https://disabled.example/v1",
      model: "disabled-model",
      enabled: false,
    };
    const noEnabledRoute = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { routes: { disabled: route }, defaults: { allowedRoutes: ["disabled"] } } }),
    });
    expect(noEnabledRoute.status).toBe(400);
    await expect(noEnabledRoute.json()).resolves.toMatchObject({ message: "至少需要启用一条线路" });

    const userWithoutRoute = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          routes: {
            active: { ...route, label: "Active", enabled: true },
            disabled: route,
          },
          defaults: { defaultRoute: "active", allowedRoutes: ["active"] },
          users: { friend: { defaultRoute: "disabled", allowedRoutes: ["disabled"] } },
        },
      }),
    });
    expect(userWithoutRoute.status).toBe(400);
    await expect(userWithoutRoute.json()).resolves.toMatchObject({ message: "用户 friend 至少需要一条已启用的允许线路" });
  });

  it("rejects stale admin configuration updates", async () => {
    const cookie = await adminLogin();
    const initialResponse = await apiRequest("/api/admin/config", cookie);
    const initial = await initialResponse.json() as any;
    expect(initial.revision).toMatch(/^[0-9a-f]{64}$/);

    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      ...initial.config,
      users: { ...(initial.config.users || {}), concurrent: { displayName: "Concurrent edit" } },
    }));

    const stale = await apiRequest("/api/admin/config", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: initial.config, expectedRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "config_conflict" });
    const stored = await env.CHAT_STORE.get<any>(ROUTES_CONFIG_KEY, "json");
    expect(stored.users.concurrent.displayName).toBe("Concurrent edit");
  });

  it("rejects stale admin configuration resets", async () => {
    const cookie = await adminLogin();
    const initialResponse = await apiRequest("/api/admin/config", cookie);
    const initial = await initialResponse.json() as any;
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      ...initial.config,
      users: { ...(initial.config.users || {}), retained: { displayName: "Retained" } },
    }));

    const stale = await apiRequest("/api/admin/config", cookie, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(env.CHAT_STORE.get(ROUTES_CONFIG_KEY)).resolves.not.toBeNull();
  });

  it("rejects stale access-code updates", async () => {
    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "friend:original-code");
    const cookie = await adminLogin();
    const initialResponse = await apiRequest("/api/admin/access-codes", cookie);
    const initial = await initialResponse.json() as any;
    expect(initial.revision).toMatch(/^[0-9a-f]{64}$/);

    await env.CHAT_STORE.put(ACCESS_CODES_KEY, "friend:rotated-code");
    const stale = await apiRequest("/api/admin/access-codes", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCodes: "friend:stale-code", expectedRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "access_codes_conflict" });
    await expect(env.CHAT_STORE.get(ACCESS_CODES_KEY)).resolves.toBe("friend:rotated-code");
  });

  it("rejects stale long-term memory updates", async () => {
    const label = `memory-${crypto.randomUUID()}`;
    const key = `memory:${encodeURIComponent(label)}`;
    await env.CHAT_STORE.put(key, "original memory");
    const cookie = await adminLogin();
    const initialResponse = await apiRequest(`/api/admin/memory?label=${encodeURIComponent(label)}`, cookie);
    const initial = await initialResponse.json() as any;
    expect(initial.revision).toMatch(/^[0-9a-f]{64}$/);

    await env.CHAT_STORE.put(key, "newer memory");
    const stale = await apiRequest("/api/admin/memory", cookie, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, memory: "stale memory", expectedRevision: initial.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "memory_conflict" });
    await expect(env.CHAT_STORE.get(key)).resolves.toBe("newer memory");
  });

  it("requires the route health task to return the correct answer", async () => {
    const cookie = await adminLogin();
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        health: {
          label: "Health",
          type: "openai-chat",
          baseUrl: "https://health.example/v1",
          model: "health-model",
          apiKey: "health-key",
        },
      },
      defaults: { defaultRoute: "health", allowedRoutes: ["health"] },
    }));
    let answer = "391";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    try {
      const healthy = await apiRequest("/api/admin/route-health", cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId: "health" }),
      });
      const healthyPayload = await healthy.json();
      expect(healthy.status, JSON.stringify(healthyPayload)).toBe(200);
      expect(healthyPayload).toMatchObject({ ok: true, sample: "391" });

      answer = "392";
      const invalid = await apiRequest("/api/admin/route-health", cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId: "health" }),
      });
      expect(invalid.status).toBe(502);
      await expect(invalid.json()).resolves.toMatchObject({ ok: false, error: "task_validation_failed", sample: "392" });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("revokes every active session for a user label", async () => {
    const label = `revoke-${crypto.randomUUID()}`;
    const first = await login(label);
    const second = await login(label);
    const adminCookie = await adminLogin();

    const revoke = await apiRequest("/api/admin/sessions/revoke", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    expect(revoke.status).toBe(200);
    await expect(revoke.json()).resolves.toMatchObject({ ok: true, label, revoked: 2 });
    expect((await apiRequest("/api/session", first.cookie)).status).toBe(401);
    expect((await apiRequest("/api/session", second.cookie)).status).toBe(401);
    const audit = await apiRequest("/api/admin/audit", adminCookie);
    expect(audit.status).toBe(200);
    await expect(audit.json()).resolves.toMatchObject({ entries: [{ action: "sessions.revoke", target: label }] });
  });
});
