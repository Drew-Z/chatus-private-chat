import { describe, expect, it } from "vitest";
import {
  decodeThemePreference,
  deviceBooleanPreferenceKey,
  readDeviceBoolean,
  readThemePreference,
  resolveTheme,
  themePreferenceKey,
  writeDeviceBoolean,
  writeThemePreference,
} from "../client/src/lib/device-preferences";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

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
