export const THEME_PREFERENCES = ["follow-system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

const STORAGE_PREFIX = "chatus:react";

export type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export type DebouncedDeviceWriter = {
  schedule: (key: string, value: string | null) => void;
  flush: () => boolean;
  cancel: () => void;
  removeNow: (key: string) => boolean;
  removeByPrefix: (prefix: string) => number;
};

export function getDeviceStorage(): DeviceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDeviceString(
  storage: Pick<Storage, "getItem"> | null,
  key: string,
  maxLength = Number.POSITIVE_INFINITY,
): string | null {
  if (!storage) return null;
  try {
    const value: unknown = storage.getItem(key);
    return typeof value === "string" && value.length <= maxLength ? value : null;
  } catch {
    return null;
  }
}

export function writeDeviceString(
  storage: Pick<Storage, "setItem"> | null,
  key: string,
  value: string,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeDeviceValue(
  storage: Pick<Storage, "removeItem"> | null,
  key: string,
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function removeDeviceValuesByPrefix(storage: DeviceStorage | null, prefix: string): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      storage.removeItem(key);
      removed += 1;
    }
  } catch {
    // Device persistence is optional; a partial best-effort cleanup is acceptable.
  }
  return removed;
}

export function createDebouncedDeviceWriter(
  storage: DeviceStorage | null,
  delayMs = 250,
): DebouncedDeviceWriter {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError("delayMs must be a non-negative finite number");
  }
  const pending = new Map<string, string | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = (): boolean => {
    clearTimer();
    let succeeded = true;
    for (const [key, value] of pending) {
      succeeded = (value === null
        ? removeDeviceValue(storage, key)
        : writeDeviceString(storage, key, value)) && succeeded;
    }
    pending.clear();
    return succeeded;
  };
  const scheduleFlush = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, delayMs);
  };

  return {
    schedule(key, value) {
      pending.set(key, value);
      scheduleFlush();
    },
    flush,
    cancel() {
      clearTimer();
      pending.clear();
    },
    removeNow(key) {
      pending.delete(key);
      if (!pending.size) clearTimer();
      return removeDeviceValue(storage, key);
    },
    removeByPrefix(prefix) {
      for (const key of pending.keys()) {
        if (key.startsWith(prefix)) pending.delete(key);
      }
      if (!pending.size) clearTimer();
      return removeDeviceValuesByPrefix(storage, prefix);
    },
  };
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
