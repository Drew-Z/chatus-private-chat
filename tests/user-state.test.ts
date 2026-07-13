import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
});
