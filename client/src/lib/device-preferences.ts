export const THEME_PREFERENCES = ["follow-system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

const STORAGE_PREFIX = "chatus:react";

export function getDeviceStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function decodeThemePreference(value: unknown): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference) ? value as ThemePreference : "follow-system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "follow-system" ? (systemDark ? "dark" : "light") : preference;
}

export function themePreferenceKey(user: string): string {
  return `${STORAGE_PREFIX}:${user}:theme`;
}

export function deviceBooleanPreferenceKey(user: string, name: string): string {
  return `${STORAGE_PREFIX}:${user}:ui:${name}`;
}

export function readThemePreference(storage: Pick<Storage, "getItem"> | null, user: string): ThemePreference {
  if (!storage) return "follow-system";
  try {
    return decodeThemePreference(storage.getItem(themePreferenceKey(user)));
  } catch {
    return "follow-system";
  }
}

export function writeThemePreference(
  storage: Pick<Storage, "setItem"> | null,
  user: string,
  preference: ThemePreference,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(themePreferenceKey(user), preference);
    return true;
  } catch {
    return false;
  }
}

export function readDeviceBoolean(
  storage: Pick<Storage, "getItem"> | null,
  user: string,
  name: string,
  fallback = false,
): boolean {
  if (!storage) return fallback;
  try {
    const value = storage.getItem(deviceBooleanPreferenceKey(user, name));
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // Device preferences remain optional when browser storage is unavailable.
  }
  return fallback;
}

export function writeDeviceBoolean(
  storage: Pick<Storage, "setItem"> | null,
  user: string,
  name: string,
  value: boolean,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(deviceBooleanPreferenceKey(user, name), String(value));
    return true;
  } catch {
    return false;
  }
}
