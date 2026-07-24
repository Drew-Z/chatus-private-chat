import { describe, expect, it, vi } from "vitest";
import {
  exportUserData,
  isAdminConfigSnapshot,
  isAdminMemberCredentialResponse,
  isAdminMemberConfigRemovalResponse,
  isAdminMemberListResponse,
  isAdminMemberRevokeResponse,
  isAdminMemberSessionsResponse,
  isAdminSessionProjection,
  isAgentConversation,
  isAgentConversationBranchResult,
  isAgentMemory,
  isSessionProjection,
  submitFeedback,
  isUserDataExport,
  isUserDataMutationResponse,
} from "../client/src/lib/api";

const validAdminConfig = {
  routes: {
    primary: {
      label: "Primary",
      enabled: true,
      offerings: [{ providerId: "shared", model: "model-a" }],
    },
  },
  providers: {
    shared: {
      label: "Shared",
      type: "openai-chat",
      baseUrl: "https://provider.example/v1",
      hasLegacyKey: true,
    },
  },
  users: {
    bill: { allowedSkills: ["coding"], allowedTools: ["builtin:text_stats"] },
  },
  defaults: { allowedSkills: ["coding"], allowedTools: ["builtin:text_stats"] },
  skills: {
    coding: {
      enabled: true,
      label: "Coding",
      instructions: "Use the coding workflow.",
      toolIds: ["builtin:text_stats"],
    },
  },
  tools: {
    "builtin:text_stats": {
      enabled: true,
      label: "Text stats",
      inputSchema: { type: "object" },
      confirmation: "auto",
      executor: { type: "builtin", name: "text_stats" },
    },
  },
  mcpServers: {},
};

const validSession = {
  user: "bill",
  displayName: "Bill",
  usage: { used: 2, limit: 20, remaining: 18 },
  routes: [{
    id: "primary",
    label: "Primary",
    model: "model-a",
    type: "openai-chat",
    supportsTools: true,
    healthStatus: "unknown",
  }],
  defaultRoute: "primary",
  allowBringYourOwnKey: false,
  hasUserSystemPrompt: true,
  skills: [{ id: "coding", label: "Coding", toolIds: ["builtin:text_stats"] }],
  tools: [{
    id: "builtin:text_stats",
    label: "Text stats",
    source: "builtin",
    confirmation: "auto",
  }],
  agent: { transport: "cloudflare-ai-chat", basePath: "agent", instance: "member-1" },
};

describe("React client runtime validation", () => {
  it("validates the admin session and capability configuration boundary", () => {
    expect(isAdminSessionProjection({ authenticated: true })).toBe(true);
    expect(isAdminSessionProjection({ authenticated: "true" })).toBe(false);
    expect(isAdminConfigSnapshot({ config: validAdminConfig, source: "kv", revision: "a".repeat(64) })).toBe(true);
    expect(isAdminConfigSnapshot({ config: { ...validAdminConfig, routes: [] }, source: "kv", revision: "a" })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        providers: { shared: { ...validAdminConfig.providers.shared, apiKey: "secret" } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        providers: { shared: { ...validAdminConfig.providers.shared, headers: { Authorization: "secret" } } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        users: { bill: { allowedSkills: ["missing"] } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        users: { bill: { allowedRoutes: ["missing"] } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
    expect(isAdminConfigSnapshot({
      config: {
        ...validAdminConfig,
        routes: { primary: { ...validAdminConfig.routes.primary, enabled: false } },
      },
      source: "kv",
      revision: "a",
    })).toBe(false);
  });

  it("validates a secret-free member projection with unique labels", () => {
    expect(isAdminMemberListResponse({
      members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }],
      accessRevision: "a".repeat(64),
      accessSource: "kv",
    })).toBe(true);
    expect(isAdminMemberListResponse({
      members: [],
      accessRevision: "b".repeat(64),
      accessSource: "managed",
    })).toBe(true);
    expect(isAdminMemberListResponse({
      members: [
        { label: "bill", displayName: "Bill", configured: true, hasAccessCode: true },
        { label: "bill", displayName: "Bill", configured: false, hasAccessCode: false },
      ],
      accessRevision: "a".repeat(64),
      accessSource: "kv",
    })).toBe(false);
    expect(isAdminMemberListResponse({
      members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true, code: "secret" }],
      accessRevision: "a".repeat(64),
      accessSource: "kv",
    })).toBe(false);
    expect(isAdminMemberListResponse({
      members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }],
      accessRevision: "a".repeat(64),
      accessSource: "kv",
      accessCode: "secret",
    })).toBe(false);
    expect(isAdminMemberListResponse({
      members: [{ label: "bill", displayName: "Bill", configured: true, hasAccessCode: true }],
      accessRevision: "a".repeat(64),
      accessSource: "default",
    })).toBe(false);
  });

  it("accepts access codes only in exact one-time credential responses", () => {
    const member = { label: "bill", displayName: "Bill", configured: true, hasAccessCode: true };
    const credential = {
      member,
      accessCode: "generated-access-code",
      accessRevision: "b".repeat(64),
      sessionRevocation: { revoked: 2, complete: true },
    };
    expect(isAdminMemberCredentialResponse(credential)).toBe(true);
    expect(isAdminMemberCredentialResponse({ ...credential, accessCode: "" })).toBe(false);
    expect(isAdminMemberCredentialResponse({ ...credential, secret: "extra" })).toBe(false);
    expect(isAdminMemberCredentialResponse({
      ...credential,
      member: { ...member, token: "extra" },
    })).toBe(false);
    expect(isAdminMemberCredentialResponse({
      ...credential,
      sessionRevocation: { revoked: 2, complete: true, token: "extra" },
    })).toBe(false);

    const revoked = {
      member: null,
      accessRevision: "c".repeat(64),
      sessionRevocation: { revoked: 1, complete: true },
    };
    expect(isAdminMemberRevokeResponse(revoked)).toBe(true);
    expect(isAdminMemberRevokeResponse({ ...revoked, accessCode: "must-not-appear" })).toBe(false);
    expect(isAdminMemberRevokeResponse({ ...revoked, sessionRevocation: { revoked: -1, complete: true } })).toBe(false);
  });

  it("validates member configuration removal and session revocation responses", () => {
    const member = { label: "bill", displayName: "Bill", configured: false, hasAccessCode: true };
    const removal = {
      member,
      config: validAdminConfig,
      source: "kv",
      revision: "d".repeat(64),
    };
    expect(isAdminMemberConfigRemovalResponse(removal)).toBe(true);
    expect(isAdminMemberConfigRemovalResponse({ ...removal, member: null, accessCode: "secret" })).toBe(false);
    expect(isAdminMemberConfigRemovalResponse({
      ...removal,
      config: { ...validAdminConfig, providers: { shared: { ...validAdminConfig.providers.shared, apiKey: "secret" } } },
    })).toBe(false);
    expect(isAdminMemberConfigRemovalResponse({ ...removal, source: "secret" })).toBe(false);

    const sessions = { ok: true, label: "bill", revoked: 3, complete: true };
    expect(isAdminMemberSessionsResponse(sessions)).toBe(true);
    expect(isAdminMemberSessionsResponse({ ...sessions, token: "secret" })).toBe(false);
    expect(isAdminMemberSessionsResponse({ ...sessions, revoked: -1 })).toBe(false);
  });

  it("accepts only the secret-free user data mutation envelope", () => {
    expect(isUserDataMutationResponse({ ok: true, revoked: 2 })).toBe(true);
    expect(isUserDataMutationResponse({ ok: true, revoked: 0, accessCode: "secret" })).toBe(false);
    expect(isUserDataMutationResponse({ ok: false, revoked: 0 })).toBe(false);
    expect(isUserDataMutationResponse({ ok: true, revoked: -1 })).toBe(false);
  });

  it("accepts only the exact bounded user data export schema", () => {
    const exported = {
      schema: "chatus-user-data",
      version: 1,
      exportedAt: "2026-07-23T00:00:00.000Z",
      account: { label: "bill" },
      memory: { text: "prefers concise answers", updatedAt: 10 },
      conversations: [{
        id: "chat-1",
        title: "Release notes",
        createdAt: 10,
        updatedAt: 20,
        summary: "",
        pinned: false,
        routeId: "primary",
        skillIds: ["coding"],
        messageCount: 2,
        messages: [
          { id: "message-1", role: "user", parts: [{ type: "text", text: "Draft release notes" }] },
          { id: "message-2", role: "assistant", parts: [{ type: "file", mediaType: "text/plain", name: "notes.txt" }] },
        ],
        messagesTruncated: false,
      }],
      truncated: false,
    };
    expect(isUserDataExport(exported)).toBe(true);
    expect(isUserDataExport({ ...exported, accessCode: "secret" })).toBe(false);
    expect(isUserDataExport({ ...exported, account: { label: "bill", token: "secret" } })).toBe(false);
    expect(isUserDataExport({
      ...exported,
      conversations: [{ ...exported.conversations[0], providerCredential: "secret" }],
    })).toBe(false);
    expect(isUserDataExport({
      ...exported,
      conversations: [{
        ...exported.conversations[0],
        messages: [{ id: "message-1", role: "user", parts: [{ type: "file", mediaType: "text/plain", url: "private" }] }],
      }],
    })).toBe(false);
    expect(isUserDataExport({ ...exported, truncated: "false" })).toBe(false);
  });

  it("parses and validates the export response before returning a download", async () => {
    const valid = {
      schema: "chatus-user-data",
      version: 1,
      exportedAt: "2026-07-23T00:00:00.000Z",
      account: { label: "bill" },
      memory: { text: "", updatedAt: 0 },
      conversations: [],
      truncated: false,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(valid), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }));
    const result = await exportUserData();
    expect(result.truncated).toBe(false);
    await expect(result.blob.text()).resolves.toContain('"schema":"chatus-user-data"');

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ...valid, accessCode: "secret" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(exportUserData()).rejects.toMatchObject({ code: "invalid_user_data_export_response", status: 502 });
    fetchSpy.mockRestore();
  });

  it("accepts a complete authenticated session projection", () => {
    expect(isSessionProjection(validSession)).toBe(true);
  });

  it("accepts an authenticated degraded state with no configured route", () => {
    expect(isSessionProjection({ ...validSession, routes: [], defaultRoute: "" })).toBe(true);
  });

  it("requires the complete session policy projection", () => {
    expect(isSessionProjection({ ...validSession, allowBringYourOwnKey: undefined })).toBe(false);
    expect(isSessionProjection({ ...validSession, hasUserSystemPrompt: undefined })).toBe(false);
    expect(isSessionProjection({ ...validSession, allowBringYourOwnKey: "no" })).toBe(false);
    expect(isSessionProjection({ ...validSession, hasUserSystemPrompt: 1 })).toBe(false);
  });

  it.each([
    ["malformed usage", { ...validSession, usage: { used: -1, limit: 20, remaining: 21 } }],
    ["fractional usage", { ...validSession, usage: { used: 0.5, limit: 20, remaining: 19.5 } }],
    ["malformed route", { ...validSession, routes: [{ ...validSession.routes[0], supportsTools: "yes" }] }],
    ["missing default route", { ...validSession, defaultRoute: "missing" }],
    ["malformed Skill", { ...validSession, skills: [{ id: "coding", label: "Coding", toolIds: [1] }] }],
    ["unknown Skill tool", { ...validSession, skills: [{ id: "coding", label: "Coding", toolIds: ["missing"] }] }],
    ["malformed tool", { ...validSession, tools: [{ ...validSession.tools[0], source: "remote" }] }],
    ["malformed Agent transport", { ...validSession, agent: { ...validSession.agent, basePath: "" } }],
  ])("rejects %s", (_label, value) => {
    expect(isSessionProjection(value)).toBe(false);
  });

  it("validates conversation timestamps, counts, and selected Skills", () => {
    const conversation = {
      id: "chat-1",
      title: "Release notes",
      createdAt: 10,
      updatedAt: 20,
      summary: "",
      pinned: false,
      routeId: "primary",
      skillIds: ["coding"],
      messageCount: 2,
    };
    expect(isAgentConversation(conversation)).toBe(true);
    expect(isAgentConversation({ ...conversation, updatedAt: 9 })).toBe(false);
    expect(isAgentConversation({ ...conversation, messageCount: -1 })).toBe(false);
    expect(isAgentConversation({ ...conversation, skillIds: ["coding", "coding"] })).toBe(false);
  });

  it("validates secret-free branch responses and feedback envelopes", async () => {
    const conversation = {
      id: "branch-1",
      title: "Release notes · 分支",
      createdAt: 10,
      updatedAt: 20,
      summary: "",
      pinned: false,
      parentChatId: "chat-1",
      routeId: "primary",
      skillIds: ["coding"],
      messageCount: 2,
    };
    const branch = {
      ok: true,
      requestId: "branch-request-1",
      conversation,
      launch: "respond",
      anchorMessageId: "message-1",
    };
    expect(isAgentConversationBranchResult(branch)).toBe(true);
    expect(isAgentConversationBranchResult({ ...branch, accessCode: "secret" })).toBe(false);
    expect(isAgentConversationBranchResult({ ...branch, conversation: { ...conversation, messageCount: -1 } })).toBe(false);
    expect(isAgentConversationBranchResult({ ...branch, launch: "background" })).toBe(false);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, rating: "up" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(submitFeedback({ rating: "up", routeId: "primary", chatId: "chat-1", messageId: "message-2" })).resolves.toBe("up");
    expect(fetchSpy).toHaveBeenCalledWith("/api/feedback", expect.objectContaining({ method: "POST" }));
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, rating: "up", accessCode: "secret" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(submitFeedback({ rating: "up", routeId: "primary", chatId: "chat-1", messageId: "message-2" })).rejects.toMatchObject({ code: "invalid_feedback_response" });
    fetchSpy.mockRestore();
  });

  it("validates memory revision and size metadata", () => {
    expect(isAgentMemory({ memory: "prefers concise answers", revision: "abc", updatedAt: 10, maxChars: 100 })).toBe(true);
    expect(isAgentMemory({ memory: "too long", revision: "abc", updatedAt: 10, maxChars: 2 })).toBe(false);
    expect(isAgentMemory({ memory: "ok", revision: "", updatedAt: 10, maxChars: 100 })).toBe(true);
    expect(isAgentMemory({ memory: "ok", revision: "abc", updatedAt: 10, maxChars: 1.5 })).toBe(false);
  });
});
