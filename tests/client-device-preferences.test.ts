import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDebouncedDeviceWriter,
  decodeThemePreference,
  deviceBooleanPreferenceKey,
  readDeviceBoolean,
  readDeviceString,
  readThemePreference,
  removeDeviceValue,
  removeDeviceValuesByPrefix,
  resolveTheme,
  themePreferenceKey,
  writeDeviceString,
  writeDeviceBoolean,
  writeThemePreference,
} from "../client/src/lib/device-preferences";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

afterEach(() => vi.useRealTimers());

describe("device theme preferences", () => {
  it("decodes only the supported values and falls back to follow-system", () => {
    expect(decodeThemePreference("light")).toBe("light");
    expect(decodeThemePreference("dark")).toBe("dark");
    expect(decodeThemePreference("unexpected")).toBe("follow-system");
    expect(decodeThemePreference(null)).toBe("follow-system");
  });

  it("resolves system preference without changing explicit choices", () => {
    expect(resolveTheme("follow-system", true)).toBe("dark");
    expect(resolveTheme("follow-system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("scopes theme and inspector preferences by member", () => {
    const store = storage();
    expect(themePreferenceKey("member-a")).not.toBe(themePreferenceKey("member-b"));
    expect(deviceBooleanPreferenceKey("member-a", "conversation-inspector-open")).not.toBe(
      deviceBooleanPreferenceKey("member-b", "conversation-inspector-open"),
    );
    expect(writeThemePreference(store, "member-a", "dark")).toBe(true);
    expect(readThemePreference(store, "member-a")).toBe("dark");
    expect(readThemePreference(store, "member-b")).toBe("follow-system");
    expect(writeDeviceBoolean(store, "member-a", "conversation-inspector-open", true)).toBe(true);
    expect(readDeviceBoolean(store, "member-a", "conversation-inspector-open")).toBe(true);
    expect(readDeviceBoolean(store, "member-b", "conversation-inspector-open")).toBe(false);
  });

  it("ignores storage failures and retains safe defaults", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readThemePreference(broken, "member")).toBe("follow-system");
    expect(readDeviceBoolean(broken, "member", "inspector")).toBe(false);
    expect(writeThemePreference(broken, "member", "dark")).toBe(false);
    expect(writeDeviceBoolean(broken, "member", "inspector", true)).toBe(false);
  });
});

describe("best-effort device storage", () => {
  it("reads, writes, removes, and filters values without trusting malformed reads", () => {
    const store = storage({ "member:draft:1": "hello", "member:theme": "dark", "other:draft": "keep" });
    expect(readDeviceString(store, "member:draft:1", 10)).toBe("hello");
    expect(readDeviceString(store, "member:draft:1", 3)).toBeNull();
    expect(readDeviceString({ getItem: () => 42 } as unknown as Pick<Storage, "getItem">, "broken")).toBeNull();
    expect(writeDeviceString(store, "member:draft:2", "world")).toBe(true);
    expect(removeDeviceValue(store, "member:theme")).toBe(true);
    expect(removeDeviceValuesByPrefix(store, "member:draft:")).toBe(2);
    expect(store.getItem("member:draft:1")).toBeNull();
    expect(store.getItem("member:draft:2")).toBeNull();
    expect(store.getItem("other:draft")).toBe("keep");
  });

  it("debounces draft writes, flushes the newest value, and cancels deleted keys", async () => {
    vi.useFakeTimers();
    const store = storage();
    const writer = createDebouncedDeviceWriter(store, 50);

    writer.schedule("draft", "h");
    writer.schedule("draft", "hello");
    await vi.advanceTimersByTimeAsync(49);
    expect(store.getItem("draft")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getItem("draft")).toBe("hello");

    writer.schedule("draft", "latest");
    expect(writer.flush()).toBe(true);
    expect(store.getItem("draft")).toBe("latest");
    writer.schedule("draft", "stale");
    expect(writer.removeNow("draft")).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(store.getItem("draft")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("contains get, set, remove, and enumeration failures", () => {
    const broken = {
      get length() { throw new Error("blocked"); },
      key: () => { throw new Error("blocked"); },
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(readDeviceString(broken, "draft")).toBeNull();
    expect(writeDeviceString(broken, "draft", "text")).toBe(false);
    expect(removeDeviceValue(broken, "draft")).toBe(false);
    expect(removeDeviceValuesByPrefix(broken, "draft:")).toBe(0);
    const writer = createDebouncedDeviceWriter(broken, 0);
    writer.schedule("draft", "text");
    expect(writer.flush()).toBe(false);
  });
});
