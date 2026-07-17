import { describe, expect, it } from "vitest";
import {
  isAgentConversation,
  isAgentMemory,
  isSessionProjection,
} from "../client/src/lib/api";

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
  skills: [{ id: "coding", label: "Coding", toolIds: ["builtin:text_stats"] }],
  agent: { transport: "cloudflare-ai-chat", basePath: "agent", instance: "member-1" },
};

describe("React client runtime validation", () => {
  it("accepts a complete authenticated session projection", () => {
    expect(isSessionProjection(validSession)).toBe(true);
  });

  it("accepts an authenticated degraded state with no configured route", () => {
    expect(isSessionProjection({ ...validSession, routes: [], defaultRoute: "" })).toBe(true);
  });

  it.each([
    ["malformed usage", { ...validSession, usage: { used: -1, limit: 20, remaining: 21 } }],
    ["fractional usage", { ...validSession, usage: { used: 0.5, limit: 20, remaining: 19.5 } }],
    ["malformed route", { ...validSession, routes: [{ ...validSession.routes[0], supportsTools: "yes" }] }],
    ["missing default route", { ...validSession, defaultRoute: "missing" }],
    ["malformed Skill", { ...validSession, skills: [{ id: "coding", label: "Coding", toolIds: [1] }] }],
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

  it("validates memory revision and size metadata", () => {
    expect(isAgentMemory({ memory: "prefers concise answers", revision: "abc", updatedAt: 10, maxChars: 100 })).toBe(true);
    expect(isAgentMemory({ memory: "too long", revision: "abc", updatedAt: 10, maxChars: 2 })).toBe(false);
    expect(isAgentMemory({ memory: "ok", revision: "", updatedAt: 10, maxChars: 100 })).toBe(true);
    expect(isAgentMemory({ memory: "ok", revision: "abc", updatedAt: 10, maxChars: 1.5 })).toBe(false);
  });
});
