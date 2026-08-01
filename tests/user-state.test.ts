import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpOAuth2AuthConfig } from "../src/contracts/capability";
import type { McpDiscoveryResult } from "../src/services/mcp-runtime";

const oauthAuth: McpOAuth2AuthConfig = {
  version: 1,
  type: "oauth2",
  issuer: "https://issuer.example",
  clientId: "chatus-test",
  scopes: ["profile", "tools.read"],
  callbackPath: "/api/mcp/oauth/callback",
  configRevision: "a".repeat(64),
};

const oauthDiscovery: McpDiscoveryResult = {
  serverId: "fixture",
  rejected: 1,
  tools: [{
    id: "mcp:fixture:lookup",
    label: "Lookup",
    description: "Find public information",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    confirmation: "first-per-conversation",
    executor: { type: "mcp", serverId: "fixture", remoteName: "lookup" },
    schemaFingerprint: "b".repeat(64),
    securityFingerprint: "c".repeat(64),
    sideEffect: "read",
    reviewRevision: "d".repeat(64),
    reviewRequired: true,
  }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UserState", () => {
  it("enforces minute and daily limits atomically", async () => {
    const state = env.USER_STATE.getByName(`quota-${crypto.randomUUID()}`);
    const now = Date.UTC(2026, 6, 12, 8, 30, 0);

    expect(await state.consumeLimits(3, 1, now, 0)).toEqual({ ok: true, remaining: 2 });
    expect(await state.consumeLimits(3, 1, now + 1_000, 0)).toMatchObject({ ok: false, reset: "minute" });
    expect(await state.consumeLimits(3, 1, now + 60_000, 0)).toEqual({ ok: true, remaining: 1 });
    expect(await state.consumeLimits(3, 1, now + 120_000, 0)).toEqual({ ok: true, remaining: 0 });
    expect(await state.consumeLimits(3, 1, now + 180_000, 0)).toMatchObject({ ok: false, reset: "daily" });
  });

  it("keeps the newest version of a cloud chat", async () => {
    const state = env.USER_STATE.getByName(`chat-${crypto.randomUUID()}`);
    const base = {
      id: "chat-1",
      title: "first",
      createdAt: 1,
      summary: "",
      summaryUntil: 0,
      routeId: "line-a",
      parentChatId: "chat-parent",
      messages: [{ role: "user" as const, content: "hello" }],
      serializedBytes: 200,
    };

    expect(await state.upsertChat({ ...base, updatedAt: 20 })).toEqual({ accepted: true });
    expect(await state.upsertChat({ ...base, title: "older", updatedAt: 10 })).toEqual({ accepted: false });
    expect(await state.listChats()).toMatchObject([{ id: "chat-1", title: "first", updatedAt: 20, routeId: "line-a", parentChatId: "chat-parent" }]);
  });

  it("binds PKCE state to one member session and consumes it once before TTL", async () => {
    const state = env.USER_STATE.getByName(`oauth-state-${crypto.randomUUID()}`);
    const now = Date.UTC(2026, 7, 1, 12, 0, 0);
    const input = {
      ownerLabel: "member-a",
      state: "s".repeat(43),
      sessionFingerprint: "b".repeat(64),
      serverId: "fixture",
      configRevision: oauthAuth.configRevision,
      verifier: "v".repeat(43),
      callbackUrl: "https://chat.example/api/mcp/oauth/callback",
      expiresAt: now + 60_000,
      nowMs: now,
    };
    await state.storeMcpOAuthState(input);

    await expect(state.consumeMcpOAuthState({
      ownerLabel: input.ownerLabel,
      state: input.state,
      sessionFingerprint: "c".repeat(64),
      nowMs: now + 1,
    })).resolves.toBeNull();
    await expect(state.consumeMcpOAuthState({
      ownerLabel: input.ownerLabel,
      state: input.state,
      sessionFingerprint: input.sessionFingerprint,
      nowMs: now + 2,
    })).resolves.toEqual({
      serverId: "fixture",
      configRevision: oauthAuth.configRevision,
      verifier: input.verifier,
      callbackUrl: input.callbackUrl,
    });
    await expect(state.consumeMcpOAuthState({
      ownerLabel: input.ownerLabel,
      state: input.state,
      sessionFingerprint: input.sessionFingerprint,
      nowMs: now + 3,
    })).resolves.toBeNull();

    await state.storeMcpOAuthState({ ...input, state: "t".repeat(43), expiresAt: now + 10, nowMs: now });
    await expect(state.consumeMcpOAuthState({
      ownerLabel: input.ownerLabel,
      state: "t".repeat(43),
      sessionFingerprint: input.sessionFingerprint,
      nowMs: now + 11,
    })).resolves.toBeNull();
  });

  it("stores only encrypted member/server tokens and supports review, revoke, and purge", async () => {
    const state = env.USER_STATE.getByName(`oauth-token-${crypto.randomUUID()}`);
    const now = Date.UTC(2026, 7, 1, 12, 0, 0);
    const token = {
      accessToken: "member-access-token",
      refreshToken: "member-refresh-token",
      expiresAt: now + 60 * 60_000,
      grantedScopes: [...oauthAuth.scopes],
      issuer: oauthAuth.issuer,
      clientId: oauthAuth.clientId,
      configRevision: oauthAuth.configRevision,
    };
    await expect(state.storeMcpOAuthToken({
      ownerLabel: "member-a",
      serverId: "fixture",
      auth: oauthAuth,
      token,
      nowMs: now,
    })).resolves.toMatchObject({ connected: true, status: "connected", reviewRequired: false });
    await expect(state.resolveMcpOAuthAccessToken({
      ownerLabel: "member-a",
      serverId: "fixture",
      auth: oauthAuth,
      nowMs: now,
    })).resolves.toBe("member-access-token");

    await runInDurableObject(state, async (_instance, durableState) => {
      const stored = durableState.storage.sql.exec<{ encrypted_record: string }>(
        "SELECT encrypted_record FROM mcp_oauth_tokens WHERE server_id = 'fixture'",
      ).one().encrypted_record;
      expect(stored).not.toContain("member-access-token");
      expect(stored).not.toContain("member-refresh-token");
    });

    const candidate = await state.storeMcpOAuthDiscoveryCandidate({
      ownerLabel: "member-a",
      serverId: "fixture",
      configRevision: oauthAuth.configRevision,
      discovery: oauthDiscovery,
      nowMs: now,
    });
    expect(candidate).toMatchObject({ serverId: "fixture", tools: 1, rejected: 1, createdAt: now });
    expect(candidate.candidateId).toMatch(/^[a-f0-9-]{36}$/);
    const storedCandidate = await state.getMcpOAuthDiscoveryCandidate({
      ownerLabel: "member-a",
      serverId: "fixture",
      configRevision: oauthAuth.configRevision,
      nowMs: now + 1,
    });
    expect(storedCandidate && JSON.parse(storedCandidate.discoveryJson)).toEqual(oauthDiscovery);
    await runInDurableObject(state, async (_instance, durableState) => {
      const stored = durableState.storage.sql.exec<{ discovery_json: string }>(
        "SELECT discovery_json FROM mcp_oauth_discovery_candidates WHERE server_id = 'fixture'",
      ).one().discovery_json;
      expect(stored).not.toContain("member-access-token");
      expect(stored).not.toContain("member-refresh-token");
      expect(stored).not.toContain("issuer.example");
    });

    await state.markMcpOAuthReviewRequired("member-a", "fixture");
    await expect(state.getMcpOAuthConnection({
      ownerLabel: "member-a",
      serverId: "fixture",
      auth: oauthAuth,
      nowMs: now,
    })).resolves.toMatchObject({ connected: false, reviewRequired: true, status: "review_required" });
    await expect(state.getMcpOAuthDiscoveryCandidate({
      ownerLabel: "member-a",
      serverId: "fixture",
      configRevision: oauthAuth.configRevision,
      nowMs: now + 2,
    })).resolves.toBeNull();

    await state.revokeMcpOAuthConnection("member-a", "fixture");
    await expect(state.getMcpOAuthConnection({ ownerLabel: "member-a", serverId: "fixture", nowMs: now }))
      .resolves.toMatchObject({ connected: false, status: "disconnected" });

    await state.storeMcpOAuthState({
      ownerLabel: "member-a",
      state: "p".repeat(43),
      sessionFingerprint: "b".repeat(64),
      serverId: "fixture",
      configRevision: oauthAuth.configRevision,
      verifier: "v".repeat(43),
      callbackUrl: "https://chat.example/api/mcp/oauth/callback",
      expiresAt: now + 60_000,
      nowMs: now,
    });
    await state.storeMcpOAuthToken({ ownerLabel: "member-a", serverId: "fixture", auth: oauthAuth, token, nowMs: now });
    await state.purgeUserData(now + 1);
    await runInDurableObject(state, async (_instance, durableState) => {
      expect(durableState.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM mcp_oauth_states").one().count).toBe(0);
      expect(durableState.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM mcp_oauth_tokens").one().count).toBe(0);
      expect(durableState.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM mcp_oauth_discovery_candidates").one().count).toBe(0);
      expect(durableState.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM mcp_oauth_owner").one().count).toBe(0);
    });
  });

  it("single-flights local refresh and atomically rotates the encrypted token", async () => {
    const state = env.USER_STATE.getByName(`oauth-refresh-${crypto.randomUUID()}`);
    const now = Date.UTC(2026, 7, 1, 12, 0, 0);
    await state.storeMcpOAuthToken({
      ownerLabel: "member-a",
      serverId: "fixture",
      auth: oauthAuth,
      token: {
        accessToken: "expired-access",
        refreshToken: "old-refresh",
        expiresAt: now - 1,
        grantedScopes: [...oauthAuth.scopes],
        issuer: oauthAuth.issuer,
        clientId: oauthAuth.clientId,
        configRevision: oauthAuth.configRevision,
      },
      nowMs: now - 60_000,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/.well-known/")) {
        return new Response(JSON.stringify({
          issuer: oauthAuth.issuer,
          authorization_endpoint: `${oauthAuth.issuer}/authorize`,
          token_endpoint: `${oauthAuth.issuer}/token`,
          code_challenge_methods_supported: ["S256"],
        }), { headers: { "Content-Type": "application/json" } });
      }
      expect(url.toString()).toBe(`${oauthAuth.issuer}/token`);
      expect(String(init?.body)).toContain("refresh_token=old-refresh");
      return new Response(JSON.stringify({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        scope: oauthAuth.scopes.join(" "),
      }), { headers: { "Content-Type": "application/json" } });
    });

    await expect(Promise.all([
      state.resolveMcpOAuthAccessToken({ ownerLabel: "member-a", serverId: "fixture", auth: oauthAuth, nowMs: now }),
      state.resolveMcpOAuthAccessToken({ ownerLabel: "member-a", serverId: "fixture", auth: oauthAuth, nowMs: now }),
    ])).resolves.toEqual(["rotated-access", "rotated-access"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await runInDurableObject(state, async (_instance, durableState) => {
      const stored = durableState.storage.sql.exec<{ encrypted_record: string; revision: number }>(
        "SELECT encrypted_record, revision FROM mcp_oauth_tokens WHERE server_id = 'fixture'",
      ).one();
      expect(stored.revision).toBe(2);
      expect(stored.encrypted_record).not.toContain("rotated-access");
      expect(stored.encrypted_record).not.toContain("rotated-refresh");
    });
  });
});
