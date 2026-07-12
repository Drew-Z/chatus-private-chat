(function () {
  const STORAGE_KEY = "chatus.theme.v1";
  const VALID_THEMES = new Set(["system", "light", "dark"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function getPreference() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.has(stored) ? stored : "system";
  }

  function resolvedTheme(preference = getPreference()) {
    return preference === "system" ? (media.matches ? "dark" : "light") : preference;
  }

  function applyTheme(preference = getPreference()) {
    const normalized = VALID_THEMES.has(preference) ? preference : "system";
    document.documentElement.dataset.theme = resolvedTheme(normalized);
    document.documentElement.dataset.themePreference = normalized;
    document.documentElement.style.colorScheme = resolvedTheme(normalized);
    const themeMeta = document.querySelector("meta[name='theme-color']");
    if (themeMeta) themeMeta.content = resolvedTheme(normalized) === "dark" ? "#151719" : "#f7f8fa";
    return normalized;
  }

  function setPreference(preference) {
    const normalized = VALID_THEMES.has(preference) ? preference : "system";
    localStorage.setItem(STORAGE_KEY, normalized);
    applyTheme(normalized);
    window.dispatchEvent(new CustomEvent("chatus:theme", { detail: { preference: normalized } }));
  }

  media.addEventListener?.("change", () => {
    if (getPreference() === "system") applyTheme("system");
  });

  window.ChatusTheme = { applyTheme, getPreference, setPreference, resolvedTheme };
  applyTheme();
})();
