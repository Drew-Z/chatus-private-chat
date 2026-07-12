const adminLoginView = document.querySelector("#adminLoginView");
const adminView = document.querySelector("#adminView");
const adminLoginForm = document.querySelector("#adminLoginForm");
const adminToken = document.querySelector("#adminToken");
const adminLoginStatus = document.querySelector("#adminLoginStatus");
const adminStatus = document.querySelector("#adminStatus");
const adminSourceText = document.querySelector("#adminSourceText");
const configSourceText = document.querySelector("#configSourceText");
const accessSourceText = document.querySelector("#accessSourceText");
const refreshAdminButton = document.querySelector("#refreshAdminButton");
const adminLogoutButton = document.querySelector("#adminLogoutButton");
const statsDay = document.querySelector("#statsDay");
const statsList = document.querySelector("#statsList");
const metricsSummary = document.querySelector("#metricsSummary");
const metricsTrend = document.querySelector("#metricsTrend");
const routeMetrics = document.querySelector("#routeMetrics");
const userSystemPrompt = document.querySelector("#userSystemPrompt");
const userForm = document.querySelector("#userForm");
const userSelect = document.querySelector("#userSelect");
const newUserLabel = document.querySelector("#newUserLabel");
const userDefaultRoute = document.querySelector("#userDefaultRoute");
const userDailyLimit = document.querySelector("#userDailyLimit");
const userMinuteLimit = document.querySelector("#userMinuteLimit");
const userByok = document.querySelector("#userByok");
const allowedRoutesBox = document.querySelector("#allowedRoutesBox");
const deleteUserButton = document.querySelector("#deleteUserButton");
const routeForm = document.querySelector("#routeForm");
const routeAdminSelect = document.querySelector("#routeAdminSelect");
const routeIdInput = document.querySelector("#routeIdInput");
const routeLabelInput = document.querySelector("#routeLabelInput");
const routeTypeInput = document.querySelector("#routeTypeInput");
const routeBaseUrlInput = document.querySelector("#routeBaseUrlInput");
const routeModelInput = document.querySelector("#routeModelInput");
const routeKeyRefInput = document.querySelector("#routeKeyRefInput");
const routeFallbacksInput = document.querySelector("#routeFallbacksInput");
const routeImagesInput = document.querySelector("#routeImagesInput");
const routeRequiresKeyInput = document.querySelector("#routeRequiresKeyInput");
const deleteRouteButton = document.querySelector("#deleteRouteButton");
const accessCodesInput = document.querySelector("#accessCodesInput");
const saveAccessCodesButton = document.querySelector("#saveAccessCodesButton");
const resetAccessCodesButton = document.querySelector("#resetAccessCodesButton");
const configJsonInput = document.querySelector("#configJsonInput");
const saveConfigButton = document.querySelector("#saveConfigButton");
const resetConfigButton = document.querySelector("#resetConfigButton");
const memoryUserSelect = document.querySelector("#memoryUserSelect");
const adminMemoryInput = document.querySelector("#adminMemoryInput");
const loadMemoryButton = document.querySelector("#loadMemoryButton");
const saveMemoryAdminButton = document.querySelector("#saveMemoryAdminButton");
const clearMemoryAdminButton = document.querySelector("#clearMemoryAdminButton");
const newAccessLabel = document.querySelector("#newAccessLabel");
const generateAccessCodeButton = document.querySelector("#generateAccessCodeButton");
const healthRouteButton = document.querySelector("#healthRouteButton");
const routeHealthStatus = document.querySelector("#routeHealthStatus");

const DEFAULT_USER = "__defaults";

let config = { routes: {}, users: {}, defaults: {} };
let stats = null;
let accessLabels = [];
let selectedUser = DEFAULT_USER;
let selectedRoute = "";

generateAccessCodeButton?.addEventListener("click", () => {
  const label = (newAccessLabel?.value || "").trim() || "friend";
  if (!/^[A-Za-z0-9._-]+$/.test(label)) {
    setStatus("label 只能包含字母、数字、点、下划线和短横线", true);
    return;
  }
  const code = generateAccessCode();
  const entry = `${label}:${code}`;
  const current = accessCodesInput.value.trim();
  accessCodesInput.value = current ? `${current},${entry}` : entry;
  if (newAccessLabel) newAccessLabel.value = "";
  setStatus(`已生成 ${entry}，记得点击保存访问码`);
});

loadMemoryButton?.addEventListener("click", () => loadAdminMemory());
saveMemoryAdminButton?.addEventListener("click", () => saveAdminMemory());
clearMemoryAdminButton?.addEventListener("click", async () => {
  if (!confirm("确认清空该用户长期记忆？")) return;
  adminMemoryInput.value = "";
  await saveAdminMemory(true);
});
memoryUserSelect?.addEventListener("change", () => loadAdminMemory());
healthRouteButton?.addEventListener("click", () => checkRouteHealth());

bootAdmin();

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminLoginStatus.textContent = "";
  const token = adminToken.value.trim();
  if (!token) return;

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    adminToken.value = "";
    await showAdmin();
  } catch (error) {
    adminLoginStatus.textContent = error.message || "Token 不可用";
  }
});

refreshAdminButton.addEventListener("click", () => {
  loadDashboard();
});

adminLogoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  showLogin();
});

userSelect.addEventListener("change", () => {
  selectedUser = userSelect.value;
  populateUserForm();
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncConfigFromEditor();

  const target = newUserLabel.value.trim() || selectedUser;
  const userConfig = readUserForm();
  if (!userConfig) return;

  if (target === DEFAULT_USER) {
    config.defaults = userConfig;
  } else {
    config.users = config.users || {};
    config.users[target] = userConfig;
    selectedUser = target;
  }

  newUserLabel.value = "";
  await saveConfigObject("用户配置已保存");
});

deleteUserButton.addEventListener("click", async () => {
  if (selectedUser === DEFAULT_USER) {
    setStatus("默认配置不能删除");
    return;
  }

  syncConfigFromEditor();
  delete config.users?.[selectedUser];
  selectedUser = DEFAULT_USER;
  await saveConfigObject("用户配置已删除");
});

routeAdminSelect.addEventListener("change", () => {
  selectedRoute = routeAdminSelect.value;
  populateRouteForm();
});

routeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncConfigFromEditor();

  const routeId = routeIdInput.value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(routeId)) {
    setStatus("线路 ID 只能包含字母、数字、点、下划线和短横线", true);
    return;
  }

  const baseUrl = routeBaseUrlInput.value.trim();
  const model = routeModelInput.value.trim();
  if (!baseUrl || !model) {
    setStatus("Base URL 和模型名必填", true);
    return;
  }

  config.routes = config.routes || {};
  const previous = selectedRoute && selectedRoute !== "__new" ? selectedRoute : "";
  const existing = config.routes[previous] || config.routes[routeId] || {};
  if (previous && previous !== routeId) delete config.routes[previous];

  config.routes[routeId] = compactObject({
    ...existing,
    label: routeLabelInput.value.trim() || routeId,
    type: routeTypeInput.value,
    baseUrl,
    apiKeyRef: routeKeyRefInput.value.trim(),
    model,
    fallbacks: splitCsv(routeFallbacksInput.value),
    requiresUserKey: routeRequiresKeyInput.checked,
    supportsImages: routeImagesInput.checked,
  });
  selectedRoute = routeId;
  await saveConfigObject("线路配置已保存");
});

deleteRouteButton.addEventListener("click", async () => {
  if (!selectedRoute || selectedRoute === "__new") return;
  syncConfigFromEditor();
  const routeIds = Object.keys(config.routes || {});
  if (routeIds.length <= 1) {
    setStatus("至少需要保留一条线路", true);
    return;
  }

  delete config.routes[selectedRoute];
  const fallbackRoute = Object.keys(config.routes)[0] || "";
  pruneRouteFromUsers(selectedRoute, fallbackRoute);
  selectedRoute = fallbackRoute;
  await saveConfigObject("线路已删除");
});

saveAccessCodesButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/access-codes", {
      method: "PUT",
      body: JSON.stringify({ accessCodes: accessCodesInput.value }),
    });
    await loadDashboard("访问码已保存");
  } catch (error) {
    setStatus(error.message || "访问码保存失败", true);
  }
});

resetAccessCodesButton.addEventListener("click", async () => {
  await api("/api/admin/access-codes", { method: "DELETE" });
  await loadDashboard("已恢复 Secret 里的访问码");
});

saveConfigButton.addEventListener("click", async () => {
  try {
    syncConfigFromEditor();
    await saveConfigObject("JSON 配置已保存");
  } catch (error) {
    setStatus(error.message || "JSON 格式错误", true);
  }
});

resetConfigButton.addEventListener("click", async () => {
  await api("/api/admin/config", { method: "DELETE" });
  selectedUser = DEFAULT_USER;
  selectedRoute = "";
  await loadDashboard("已恢复 Secret 里的配置");
});

async function bootAdmin() {
  const response = await fetch("/api/admin/session");
  if (response.ok) {
    await showAdmin();
  } else {
    showLogin();
  }
}

function showLogin() {
  adminView.hidden = true;
  adminLoginView.hidden = false;
  adminToken.focus();
}

async function showAdmin() {
  adminLoginView.hidden = true;
  adminView.hidden = false;
  await loadDashboard();
}

async function loadDashboard(message = "") {
  setStatus("读取中");
  const [configData, accessData, statsData] = await Promise.all([
    api("/api/admin/config"),
    api("/api/admin/access-codes"),
    api("/api/admin/stats"),
  ]);

  config = normalizeClientConfig(configData.config);
  stats = statsData;
  accessLabels = Array.isArray(accessData.entries)
    ? accessData.entries.map((entry) => entry?.label).filter(Boolean)
    : [];
  configJsonInput.value = JSON.stringify(config, null, 2);
  accessCodesInput.value = accessData.accessCodes || "";

  configSourceText.textContent = sourceLabel(configData.source);
  accessSourceText.textContent = sourceLabel(accessData.source);
  adminSourceText.textContent = `配置：${sourceLabel(configData.source)} · 访问码：${sourceLabel(accessData.source)}`;

  if (!selectedRoute || !config.routes[selectedRoute]) selectedRoute = Object.keys(config.routes)[0] || "__new";
  if (!getUserLabels().includes(selectedUser)) selectedUser = DEFAULT_USER;

  renderStats();
  renderUserPicker();
  renderRoutePicker();
  setStatus(message || "已同步");
}

async function api(path, options = {}) {
  const headers = options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && path !== "/api/admin/login") {
    showLogin();
    throw new Error("需要重新登录");
  }

  if (!response.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }

  return data;
}

function renderStats() {
  statsDay.textContent = stats?.day || "--";
  statsList.textContent = "";
  if (metricsSummary) metricsSummary.textContent = "";
  if (metricsTrend) metricsTrend.textContent = "";
  if (routeMetrics) routeMetrics.textContent = "";

  const totals = stats?.totals || {};
  if (metricsSummary) {
    const cards = [
      ["7日请求", totals.requests ?? 0],
      ["7日错误", totals.errors ?? 0],
      ["错误率", `${totals.errorRate ?? 0}%`],
      ["Fallback", totals.fallbacks ?? 0],
      ["限流", totals.rateLimited ?? 0],
    ];
    for (const [label, value] of cards) {
      const card = document.createElement("div");
      card.className = "metric-card";
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      const span = document.createElement("span");
      span.textContent = label;
      card.append(strong, span);
      metricsSummary.append(card);
    }
  }

  const trend = Array.isArray(stats?.trend) ? stats.trend : [];
  if (metricsTrend && trend.length) {
    const maxReq = Math.max(1, ...trend.map((item) => Number(item.requests) || 0));
    for (const item of [...trend].reverse()) {
      const row = document.createElement("div");
      row.className = "trend-row";
      const label = document.createElement("span");
      label.className = "trend-day";
      label.textContent = String(item.day || "").slice(5);
      const bar = document.createElement("div");
      bar.className = "trend-bar";
      const fill = document.createElement("div");
      fill.className = "trend-fill";
      fill.style.width = `${Math.max(4, Math.round(((Number(item.requests) || 0) / maxReq) * 100))}%`;
      bar.append(fill);
      const meta = document.createElement("span");
      meta.className = "trend-meta";
      meta.textContent = `${item.requests || 0} / 错${item.errors || 0} / ${item.errorRate || 0}%`;
      row.append(label, bar, meta);
      metricsTrend.append(row);
    }
  }

  const routeStats = Array.isArray(stats?.routeStats) ? stats.routeStats : [];
  if (routeMetrics) {
    if (!routeStats.length) {
      routeMetrics.append(textNode("暂无线路统计"));
    } else {
      for (const route of routeStats) {
        const row = document.createElement("div");
        row.className = "route-metric-row";
        const title = document.createElement("strong");
        title.textContent = route.label || route.id;
        const detail = document.createElement("span");
        detail.textContent = `成功 ${route.ok7d || 0} · 失败 ${route.error7d || 0} · 错误率 ${route.errorRate7d || 0}% · ${route.model || ""}`;
        row.append(title, detail);
        routeMetrics.append(row);
      }
    }
  }

  const users = Array.isArray(stats?.users) ? stats.users : [];
  if (!users.length) {
    statsList.append(textNode("暂无用户"));
    renderMemoryUserPicker();
    return;
  }

  for (const user of users) {
    const row = document.createElement("div");
    row.className = "stat-row";

    const meta = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = user.label;
    const detail = document.createElement("span");
    detail.textContent = [
      user.defaultRoute ? `默认 ${user.defaultRoute}` : "无默认线路",
      `${(user.allowedRoutes || []).length} 条线路`,
      user.allowBringYourOwnKey ? "BYOK 开" : "BYOK 关",
      user.hasSystemPrompt ? `Prompt ${user.systemPromptChars || 0}字` : "无专属 Prompt",
      `${user.activeSessions || 0} 个会话`,
      `${user.memoryChars || 0} 字记忆`,
      `7日 ${user.requests7d || 0} 请求`,
      `错率 ${user.errorRate7d || 0}%`,
    ].join(" · ");
    meta.append(title, detail);

    if (Array.isArray(user.usageByDay) && user.usageByDay.length) {
      const spark = document.createElement("div");
      spark.className = "usage-spark";
      const maxUsed = Math.max(1, ...user.usageByDay.map((d) => Number(d.used) || 0));
      for (const day of [...user.usageByDay].reverse()) {
        const bar = document.createElement("div");
        bar.className = "usage-spark-bar";
        bar.style.height = `${Math.max(3, Math.round(((Number(day.used) || 0) / maxUsed) * 28))}px`;
        bar.title = `${day.day}: ${day.used || 0}`;
        spark.append(bar);
      }
      meta.append(spark);
    }

    const usage = document.createElement("div");
    usage.className = "stat-usage";
    const number = document.createElement("strong");
    number.textContent = `${user.used}/${user.dailyLimit}`;
    const remaining = document.createElement("span");
    remaining.textContent = `剩余 ${user.remaining}`;
    usage.append(number, remaining);

    const actions = document.createElement("div");
    actions.className = "stat-actions";
    const memoryBtn = document.createElement("button");
    memoryBtn.type = "button";
    memoryBtn.className = "ghost-button compact";
    memoryBtn.textContent = "记忆";
    memoryBtn.addEventListener("click", () => {
      if (memoryUserSelect) {
        memoryUserSelect.value = user.label;
        loadAdminMemory();
      }
    });
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "plain-button compact";
    resetBtn.textContent = "重置今日";
    resetBtn.addEventListener("click", async () => {
      if (!confirm(`重置 ${user.label} 今日用量？`)) return;
      try {
        await api("/api/admin/usage", {
          method: "POST",
          body: JSON.stringify({ label: user.label }),
        });
        await loadDashboard(`已重置 ${user.label} 今日用量`);
      } catch (error) {
        setStatus(error.message || "重置失败", true);
      }
    });
    actions.append(memoryBtn, resetBtn);
    meta.append(actions);

    row.append(meta, usage);
    statsList.append(row);
  }

  renderMemoryUserPicker();
}
function renderUserPicker() {
  const labels = getUserLabels();
  userSelect.textContent = "";
  for (const label of labels) {
    const option = document.createElement("option");
    option.value = label;
    option.textContent =
      label === DEFAULT_USER
        ? "默认配置"
        : config.users?.[label]
          ? label
          : `${label}（使用默认配置）`;
    userSelect.append(option);
  }
  userSelect.value = labels.includes(selectedUser) ? selectedUser : DEFAULT_USER;
  selectedUser = userSelect.value;

  userDefaultRoute.textContent = "";
  for (const routeId of Object.keys(config.routes || {})) {
    const option = document.createElement("option");
    option.value = routeId;
    option.textContent = routeLabel(routeId);
    userDefaultRoute.append(option);
  }

  renderAllowedRouteChecks();
  populateUserForm();
}

function renderAllowedRouteChecks() {
  allowedRoutesBox.textContent = "";
  for (const routeId of Object.keys(config.routes || {})) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = routeId;
    label.append(input, document.createTextNode(routeLabel(routeId)));
    allowedRoutesBox.append(label);
  }
}

function populateUserForm() {
  const user =
    selectedUser === DEFAULT_USER
      ? config.defaults || {}
      : { ...(config.defaults || {}), ...(config.users?.[selectedUser] || {}) };
  const routeIds = Object.keys(config.routes || {});
  userDefaultRoute.value = user.defaultRoute || routeIds[0] || "";
  userDailyLimit.value = user.dailyMessageLimit || 500;
  userMinuteLimit.value = user.minuteMessageLimit || 12;
  userByok.checked = Boolean(user.allowBringYourOwnKey);
  if (userSystemPrompt) userSystemPrompt.value = user.systemPrompt || "";
  deleteUserButton.disabled = selectedUser === DEFAULT_USER || !config.users?.[selectedUser];

  const allowed = new Set(user.allowedRoutes?.length ? user.allowedRoutes : routeIds);
  for (const input of allowedRoutesBox.querySelectorAll("input[type='checkbox']")) {
    input.checked = allowed.has(input.value);
  }
}

function getUserLabels() {
  const labels = new Set([...accessLabels, ...Object.keys(config.users || {})]);
  return [DEFAULT_USER, ...[...labels].sort()];
}

function readUserForm() {
  const allowedRoutes = [...allowedRoutesBox.querySelectorAll("input[type='checkbox']:checked")].map(
    (input) => input.value,
  );
  if (!allowedRoutes.length) {
    setStatus("至少选择一条允许线路", true);
    return null;
  }

  const systemPrompt = (userSystemPrompt?.value || "").trim();
  return {
    defaultRoute: userDefaultRoute.value,
    allowedRoutes,
    allowBringYourOwnKey: userByok.checked,
    dailyMessageLimit: positiveNumber(userDailyLimit.value),
    minuteMessageLimit: positiveNumber(userMinuteLimit.value),
    ...(systemPrompt ? { systemPrompt: systemPrompt.slice(0, 2000) } : {}),
  };
}

function renderRoutePicker() {
  routeAdminSelect.textContent = "";
  const routeIds = Object.keys(config.routes || {});
  for (const routeId of routeIds) {
    const option = document.createElement("option");
    option.value = routeId;
    option.textContent = routeLabel(routeId);
    routeAdminSelect.append(option);
  }

  const newOption = document.createElement("option");
  newOption.value = "__new";
  newOption.textContent = "新增线路";
  routeAdminSelect.append(newOption);

  routeAdminSelect.value = routeIds.includes(selectedRoute) ? selectedRoute : routeIds[0] || "__new";
  selectedRoute = routeAdminSelect.value;
  populateRouteForm();
}

function populateRouteForm() {
  const route = selectedRoute === "__new" ? {} : config.routes?.[selectedRoute] || {};
  routeIdInput.value = selectedRoute === "__new" ? "" : selectedRoute;
  routeLabelInput.value = route.label || "";
  routeTypeInput.value = route.type || "openai-chat";
  routeBaseUrlInput.value = route.baseUrl || "";
  routeModelInput.value = route.model || "";
  routeKeyRefInput.value = route.apiKeyRef || "";
  routeFallbacksInput.value = Array.isArray(route.fallbacks) ? route.fallbacks.join(",") : "";
  routeImagesInput.checked = route.supportsImages !== false;
  routeRequiresKeyInput.checked = Boolean(route.requiresUserKey);
  deleteRouteButton.disabled = selectedRoute === "__new";
}

function syncConfigFromEditor() {
  const parsed = JSON.parse(configJsonInput.value);
  config = normalizeClientConfig(parsed);
}

async function saveConfigObject(message) {
  const data = await api("/api/admin/config", {
    method: "PUT",
    body: JSON.stringify({ config }),
  });
  config = normalizeClientConfig(data.config);
  configJsonInput.value = JSON.stringify(config, null, 2);
  await loadDashboard(message);
}

function normalizeClientConfig(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    defaults: input.defaults && typeof input.defaults === "object" ? input.defaults : {},
    users: input.users && typeof input.users === "object" ? input.users : {},
    routes: input.routes && typeof input.routes === "object" ? input.routes : {},
  };
}

function pruneRouteFromUsers(routeId, fallbackRoute) {
  const entries = [config.defaults, ...Object.values(config.users || {})].filter(Boolean);
  for (const user of entries) {
    if (Array.isArray(user.allowedRoutes)) {
      user.allowedRoutes = user.allowedRoutes.filter((id) => id !== routeId);
      if (!user.allowedRoutes.length && fallbackRoute) user.allowedRoutes = [fallbackRoute];
    }
    if (user.defaultRoute === routeId) user.defaultRoute = fallbackRoute;
  }
}

function routeLabel(routeId) {
  const route = config.routes?.[routeId];
  return route ? `${route.label || routeId} · ${route.model || routeId}` : routeId;
}

function splitCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === "") return false;
      if (Array.isArray(value) && !value.length) return false;
      return true;
    }),
  );
}

function sourceLabel(source) {
  const labels = {
    kv: "后台 KV",
    secret: "Secret",
    default: "默认值",
  };
  return labels[source] || source || "--";
}

function setStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.style.color = isError ? "var(--warn)" : "var(--muted)";
}

function textNode(text) {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
}

function renderMemoryUserPicker() {
  if (!memoryUserSelect) return;
  const labels = (Array.isArray(stats?.users) ? stats.users.map((u) => u.label) : Object.keys(config.users || {})).sort();
  const previous = memoryUserSelect.value;
  memoryUserSelect.textContent = "";
  for (const label of labels) {
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    memoryUserSelect.append(option);
  }
  if (!labels.length) {
    adminMemoryInput.value = "";
    return;
  }
  memoryUserSelect.value = labels.includes(previous) ? previous : labels[0];
}

async function loadAdminMemory() {
  if (!memoryUserSelect?.value) return;
  setStatus("读取记忆中");
  try {
    const data = await api(`/api/admin/memory?label=${encodeURIComponent(memoryUserSelect.value)}`);
    adminMemoryInput.maxLength = Number(data.maxChars) || 4000;
    adminMemoryInput.value = data.memory || "";
    setStatus(`已读取 ${memoryUserSelect.value} 的记忆`);
  } catch (error) {
    setStatus(error.message || "读取记忆失败", true);
  }
}

async function saveAdminMemory(isClear = false) {
  if (!memoryUserSelect?.value) return;
  setStatus("保存记忆中");
  try {
    await api("/api/admin/memory", {
      method: "PUT",
      body: JSON.stringify({
        label: memoryUserSelect.value,
        memory: adminMemoryInput.value,
      }),
    });
    setStatus(isClear ? `已清空 ${memoryUserSelect.value} 的记忆` : `已保存 ${memoryUserSelect.value} 的记忆`);
    await loadDashboard();
  } catch (error) {
    setStatus(error.message || "保存记忆失败", true);
  }
}

function generateAccessCode() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkRouteHealth() {
  const routeId = selectedRoute === "__new" ? routeIdInput.value.trim() : selectedRoute;
  if (!routeId) {
    setRouteHealth("请先选择或填写线路 ID", true);
    return;
  }
  setRouteHealth("检查中…");
  healthRouteButton.disabled = true;
  try {
    const data = await api("/api/admin/route-health", {
      method: "POST",
      body: JSON.stringify({ routeId }),
    });
    if (data.ok) {
      setRouteHealth(`健康 · ${data.latencyMs}ms · ${data.model || routeId} · 样本: ${data.sample || "ok"}`);
    } else {
      setRouteHealth(data.message || "检查失败", true);
    }
  } catch (error) {
    setRouteHealth(error.message || "检查失败", true);
  } finally {
    healthRouteButton.disabled = false;
  }
}

function setRouteHealth(message, isError = false) {
  if (!routeHealthStatus) {
    setStatus(message, isError);
    return;
  }
  routeHealthStatus.textContent = message;
  routeHealthStatus.style.color = isError ? "var(--warn)" : "var(--muted)";
}
