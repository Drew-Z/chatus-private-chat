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

const DEFAULT_USER = "__defaults";

let config = { routes: {}, users: {}, defaults: {} };
let stats = null;
let selectedUser = DEFAULT_USER;
let selectedRoute = "";

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
  configJsonInput.value = JSON.stringify(config, null, 2);
  accessCodesInput.value = accessData.accessCodes || "";

  configSourceText.textContent = sourceLabel(configData.source);
  accessSourceText.textContent = sourceLabel(accessData.source);
  adminSourceText.textContent = `配置：${sourceLabel(configData.source)} · 访问码：${sourceLabel(accessData.source)}`;

  if (!selectedRoute || !config.routes[selectedRoute]) selectedRoute = Object.keys(config.routes)[0] || "__new";
  if (selectedUser !== DEFAULT_USER && !config.users?.[selectedUser]) selectedUser = DEFAULT_USER;

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

  const users = Array.isArray(stats?.users) ? stats.users : [];
  if (!users.length) {
    statsList.append(textNode("暂无用户"));
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
      `${user.activeSessions || 0} 个会话`,
      `${user.memoryChars || 0} 字记忆`,
    ].join(" · ");
    meta.append(title, detail);

    const usage = document.createElement("div");
    usage.className = "stat-usage";
    const number = document.createElement("strong");
    number.textContent = `${user.used}/${user.dailyLimit}`;
    const remaining = document.createElement("span");
    remaining.textContent = `剩余 ${user.remaining}`;
    usage.append(number, remaining);

    row.append(meta, usage);
    statsList.append(row);
  }
}

function renderUserPicker() {
  const labels = [DEFAULT_USER, ...Object.keys(config.users || {}).sort()];
  userSelect.textContent = "";
  for (const label of labels) {
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label === DEFAULT_USER ? "默认配置" : label;
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
  const user = selectedUser === DEFAULT_USER ? config.defaults || {} : config.users?.[selectedUser] || {};
  const routeIds = Object.keys(config.routes || {});
  userDefaultRoute.value = user.defaultRoute || routeIds[0] || "";
  userDailyLimit.value = user.dailyMessageLimit || 500;
  userMinuteLimit.value = user.minuteMessageLimit || 12;
  userByok.checked = Boolean(user.allowBringYourOwnKey);
  deleteUserButton.disabled = selectedUser === DEFAULT_USER;

  const allowed = new Set(user.allowedRoutes?.length ? user.allowedRoutes : routeIds);
  for (const input of allowedRoutesBox.querySelectorAll("input[type='checkbox']")) {
    input.checked = allowed.has(input.value);
  }
}

function readUserForm() {
  const allowedRoutes = [...allowedRoutesBox.querySelectorAll("input[type='checkbox']:checked")].map(
    (input) => input.value,
  );
  if (!allowedRoutes.length) {
    setStatus("至少选择一条允许线路", true);
    return null;
  }

  return {
    defaultRoute: userDefaultRoute.value,
    allowedRoutes,
    allowBringYourOwnKey: userByok.checked,
    dailyMessageLimit: positiveNumber(userDailyLimit.value),
    minuteMessageLimit: positiveNumber(userMinuteLimit.value),
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
