import { renderMarkdown } from "./markdown.js";

const loginView = document.querySelector("#loginView");
const chatView = document.querySelector("#chatView");
const loginForm = document.querySelector("#loginForm");
const loginStatus = document.querySelector("#loginStatus");
const accessCode = document.querySelector("#accessCode");
const loginSubmitButton = loginForm.querySelector("button[type='submit']");
const userLabel = document.querySelector("#userLabel");
const usageText = document.querySelector("#usageText");
const messageList = document.querySelector("#messageList");
const scrollBottomButton = document.querySelector("#scrollBottomButton");
const chatList = document.querySelector("#chatList");
const chatForm = document.querySelector("#chatForm");
const promptInput = document.querySelector("#promptInput");
const sendButton = document.querySelector("#sendButton");
const stopButton = document.querySelector("#stopButton");
const imageInput = document.querySelector("#imageInput");
const imageInputLabel = document.querySelector("label[for='imageInput']");
const attachmentRow = document.querySelector("#attachmentRow");
const connectionState = document.querySelector("#connectionState");
const routeSelect = document.querySelector("#routeSelect");
const userApiKeyInput = document.querySelector("#userApiKeyInput");
const userApiKeyLabel = document.querySelector("#userApiKeyLabel");
const userKeyField = document.querySelector(".user-key-field");
const toggleUserApiKey = document.querySelector("#toggleUserApiKey");
const modelPickerTrigger = document.querySelector("#modelPickerTrigger");
const modelPickerName = document.querySelector("#modelPickerName");
const modelPickerMenu = document.querySelector("#modelPickerMenu");
const memoryInput = document.querySelector("#memoryInput");
const saveMemoryButton = document.querySelector("#saveMemoryButton");
const suggestMemoryButton = document.querySelector("#suggestMemoryButton");
const memoryStatus = document.querySelector("#memoryStatus");
const memorySuggestBox = document.querySelector("#memorySuggestBox");
const memorySuggestText = document.querySelector("#memorySuggestText");
const applyMemorySuggestButton = document.querySelector("#applyMemorySuggestButton");
const dismissMemorySuggestButton = document.querySelector("#dismissMemorySuggestButton");
const sessionSearch = document.querySelector("#sessionSearch");
const sidePanel = document.querySelector("#sidePanel");
const sidebarBackdrop = document.querySelector("#sidebarBackdrop");
const openSidebarButton = document.querySelector("#openSidebarButton");
const closeSidebarButton = document.querySelector("#closeSidebarButton");
const chatTitle = document.querySelector("#chatTitle");
const mobileTitle = document.querySelector("#mobileTitle");
const dropHint = document.querySelector("#dropHint");
const composerCount = document.querySelector("#composerCount");
const composerHint = document.querySelector("#composerHint");
const newChatButton = document.querySelector("#newChatButton");
const mobileNewChatButton = document.querySelector("#mobileNewChatButton");
const clearButton = document.querySelector("#clearButton");
const appDialog = document.querySelector("#appDialog");
const appDialogForm = document.querySelector("#appDialogForm");
const appDialogTitle = document.querySelector("#appDialogTitle");
const appDialogDescription = document.querySelector("#appDialogDescription");
const appDialogInput = document.querySelector("#appDialogInput");
const appDialogConfirm = document.querySelector("#appDialogConfirm");
const statusToast = document.querySelector("#statusToast");
const settingsButton = document.querySelector("#settingsButton");
const settingsDialog = document.querySelector("#settingsDialog");
const themeOptions = document.querySelector("#themeOptions");
const themeSummary = document.querySelector("#themeSummary");
const exportAllButton = document.querySelector("#exportAllButton");
const importAllButton = document.querySelector("#importAllButton");
const importAllInput = document.querySelector("#importAllInput");
const clearOfflineDataButton = document.querySelector("#clearOfflineDataButton");
const logoutAllDevicesButton = document.querySelector("#logoutAllDevicesButton");
const deleteUserDataButton = document.querySelector("#deleteUserDataButton");
const feedbackDialog = document.querySelector("#feedbackDialog");
const feedbackForm = document.querySelector("#feedbackForm");

const LEGACY_STORAGE_KEY = "chatus.messages.v1";
const SESSIONS_STORAGE_PREFIX = "chatus.sessions.v3.";
const ACTIVE_SESSION_PREFIX = "chatus.activeSession.v3.";
const ROUTE_STORAGE_KEY = "chatus.route.v1";
const SESSION_SNAPSHOT_KEY = "chatus.sessionSnapshot.v1";
const MEMORY_STORAGE_PREFIX = "chatus.memory.v1.";
const MAX_ATTACHMENTS = 4;
const MAX_SESSIONS = 30;
const MAX_STORED_MESSAGES = 120;
const MAX_CONTEXT_MESSAGES = 40;
const CONTEXT_CHAR_BUDGET = 14000;
const MAX_IMAGE_SOURCE_BYTES = 20_000_000;
const MAX_IMAGE_OUTPUT_BYTES = 320_000;
const MAX_IMAGE_DIMENSION = 1600;
const MAX_REQUEST_BODY_BYTES = 6_500_000;
const SUMMARY_EVERY = 8;
const RENDER_THROTTLE_MS = 50;

let currentUser = "";
let currentDisplayName = "";
let sessions = [];
let activeSessionId = "";
let messages = [];
let attachments = [];
let abortController = null;
let routes = [];
let selectedRouteId = "";
let sessionFilter = "";
let isBusy = false;
let renderTimer = null;
let pendingSuggestion = "";
let lastRouteUsed = "";
let cloudSyncEnabled = true;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;
let syncStatusText = "";
let hasUserSystemPrompt = false;
let statusToastTimer = null;
let offlineMode = false;
let currentUsage = null;
let sessionExpired = false;
let lastRouteRefreshAt = 0;
let routeRefreshPromise = null;

boot();
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";
  const code = accessCode.value.trim();
  if (!code) return;
  setLoginBusy(true);
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      loginStatus.textContent = response.status === 429
        ? "尝试次数过多，请稍后再试"
        : response.status >= 500 ? "服务暂时不可用，请稍后重试" : "访问码不可用";
      return;
    }
    await response.json();
    accessCode.value = "";
    await showChat();
  } catch {
    loginStatus.textContent = navigator.onLine ? "连接失败，请稍后重试" : "当前网络已断开";
  } finally {
    setLoginBusy(false);
  }
});

settingsButton?.addEventListener("click", () => {
  syncThemeControls();
  settingsDialog?.showModal();
});
themeOptions?.addEventListener("change", (event) => {
  const value = event.target?.value;
  if (!value) return;
  window.ChatusTheme?.setPreference(value);
  syncThemeControls();
});
window.addEventListener("chatus:theme", () => syncThemeControls());
window.addEventListener("offline", () => {
  if (!chatView.hidden) {
    setOfflineMode(true);
    showStatusToast("网络已断开，已切换为本地只读模式");
  }
  else loginStatus.textContent = "当前网络已断开";
});
window.addEventListener("online", () => {
  if (!chatView.hidden && offlineMode) reconnectSession();
  else if (!chatView.hidden) showStatusToast("网络已恢复");
  else if (loginStatus.textContent === "当前网络已断开") loginStatus.textContent = "";
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  const previousUser = currentUser;
  await fetch("/api/logout", { method: "POST" }).catch(() => null);
  currentUser = "";
  currentDisplayName = "";
  sessions = [];
  activeSessionId = "";
  messages = [];
  attachments = [];
  renderMessages();
  renderAttachments();
  renderChatList();
  memoryInput.value = "";
  localStorage.removeItem(SESSION_SNAPSHOT_KEY);
  localStorage.removeItem(memoryStorageKey(previousUser));
  memoryStatus.textContent = "";
  hideMemorySuggest();
  showLogin();
});

newChatButton.addEventListener("click", () => {
  if (offlineMode) return showStatusToast("离线只读模式下不能新建会话");
  createNewSession();
  closeSidebar();
  promptInput.focus();
});

mobileNewChatButton?.addEventListener("click", () => {
  if (offlineMode) return showStatusToast("离线只读模式下不能新建会话");
  createNewSession();
  promptInput.focus();
});

clearButton.addEventListener("click", async () => {
  if (offlineMode) return showStatusToast("离线只读模式下不能清空会话");
  if (!messages.length) return;
  if (!(await confirmAction({ title: "清空当前会话？", description: "所有消息将被移除，此操作无法撤销。", confirmLabel: "清空", destructive: true }))) return;
  messages = [];
  const active = getActiveSession();
  active.summary = "";
  active.summaryUntil = 0;
  saveMessages();
  renderMessages();
  updateChatTitle();
});

document.querySelector("#exportButton")?.addEventListener("click", () => exportActiveSession());
exportAllButton?.addEventListener("click", () => exportAllSessions());
importAllButton?.addEventListener("click", () => importAllInput?.click());
importAllInput?.addEventListener("change", () => importSessionBackup());
clearOfflineDataButton?.addEventListener("click", () => clearOfflineData());
logoutAllDevicesButton?.addEventListener("click", () => logoutAllDevices());
deleteUserDataButton?.addEventListener("click", () => deleteAllUserData());
saveMemoryButton.addEventListener("click", () => saveMemory());
suggestMemoryButton?.addEventListener("click", () => suggestMemory());

applyMemorySuggestButton?.addEventListener("click", () => {
  if (!pendingSuggestion) return;
  const existing = memoryInput.value.trim();
  memoryInput.value = existing ? `${existing}\n${pendingSuggestion}` : pendingSuggestion;
  hideMemorySuggest();
  memoryStatus.textContent = "已追加，记得保存";
});
dismissMemorySuggestButton?.addEventListener("click", () => hideMemorySuggest());
sessionSearch?.addEventListener("input", () => {
  sessionFilter = sessionSearch.value.trim().toLowerCase();
  renderChatList();
});
openSidebarButton?.addEventListener("click", () => openSidebar());
closeSidebarButton?.addEventListener("click", () => closeSidebar());
sidebarBackdrop?.addEventListener("click", () => closeSidebar());
messageList.addEventListener("scroll", () => updateScrollButton(), { passive: true });
scrollBottomButton?.addEventListener("click", () => {
  const distance = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
  messageList.scrollTo({ top: messageList.scrollHeight, behavior: distance > 1600 ? "auto" : "smooth" });
  scrollBottomButton.classList.remove("has-new-content");
  requestAnimationFrame(() => updateScrollButton());
});
routeSelect.addEventListener("change", () => {
  selectRoute(routeSelect.value);
});
modelPickerTrigger?.addEventListener("click", () => toggleModelPicker());
modelPickerMenu?.addEventListener("keydown", (event) => {
  const options = [...modelPickerMenu.querySelectorAll(".model-option")];
  const current = options.indexOf(document.activeElement);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    options[(current + 1 + options.length) % options.length]?.focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    options[(current - 1 + options.length) % options.length]?.focus();
  } else if (event.key === "Home") {
    event.preventDefault();
    options[0]?.focus();
  } else if (event.key === "End") {
    event.preventDefault();
    options.at(-1)?.focus();
  }
});
toggleUserApiKey?.addEventListener("click", () => {
  const showing = userApiKeyInput.type === "text";
  userApiKeyInput.type = showing ? "password" : "text";
  toggleUserApiKey.title = showing ? "显示 API Key" : "隐藏 API Key";
  toggleUserApiKey.setAttribute("aria-label", toggleUserApiKey.title);
});
document.addEventListener("click", (event) => {
  if (!modelPickerMenu || modelPickerMenu.hidden) return;
  if (!event.target.closest(".model-picker")) closeModelPicker();
});
document.addEventListener("keydown", (event) => {
  if (chatView.hidden) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openSidebar();
    sessionSearch?.focus();
    sessionSearch?.select();
    return;
  }
  if (event.altKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    if (offlineMode) return showStatusToast("离线只读模式下不能新建会话");
    if (isBusy) return showStatusToast("请先停止当前生成");
    createNewSession();
    closeSidebar();
    promptInput.focus();
    return;
  }
  if (event.key === "Escape") {
    if (modelPickerMenu && !modelPickerMenu.hidden) {
      closeModelPicker();
      modelPickerTrigger?.focus();
      return;
    }
    if (document.activeElement === sessionSearch && sessionSearch.value) {
      sessionSearch.value = "";
      sessionFilter = "";
      renderChatList();
      promptInput.focus();
      return;
    }
    closeSidebar();
  }
});
imageInput.addEventListener("change", async () => {
  await addImageFiles(imageInput.files);
  imageInput.value = "";
});
promptInput.addEventListener("input", () => {
  autoResizePrompt();
  updateComposerMeta();
});
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});
promptInput.addEventListener("paste", async (event) => {
  const items = [...(event.clipboardData?.items || [])];
  const files = items.filter((item) => item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  await addImageFiles(files);
});
["dragenter", "dragover"].forEach((name) => {
  chatForm.addEventListener(name, (event) => {
    event.preventDefault();
    if (getSelectedRoute()?.supportsImages === false) return;
    dropHint.hidden = false;
  });
});
["dragleave", "drop"].forEach((name) => {
  chatForm.addEventListener(name, (event) => {
    event.preventDefault();
    dropHint.hidden = true;
  });
});
chatForm.addEventListener("drop", async (event) => {
  const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (files.length) await addImageFiles(files);
});
stopButton.addEventListener("click", () => abortController?.abort());
chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (offlineMode) {
    showStatusToast("当前为离线只读模式");
    return;
  }
  if (isBusy) return;
  if (currentUsage?.remaining === 0) {
    showStatusToast("今天的消息额度已用完，请明天再试");
    return;
  }
  const text = promptInput.value.trim();
  const route = getSelectedRoute();
  if (!text && !attachments.length) return;
  if (!route) { showInlineError("没有可用线路"); return; }
  if (route.requiresUserKey && !userApiKeyInput.value.trim()) {
    userApiKeyInput.focus();
    connectionState.textContent = "需要 API Key";
    return;
  }
  if (route.supportsImages === false && attachments.length) {
    showInlineError("当前线路不支持图片");
    return;
  }
  messages.push({ id: createId(), role: "user", content: buildUserContent(text, attachments), createdAt: Date.now() });
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages(true);
  promptInput.value = "";
  autoResizePrompt();
  attachments = [];
  renderAttachments();
  updateComposerMeta();
  await streamChat(assistantMessage);
  maybeRefreshSummary();
});
async function boot() {
  syncThemeControls();
  try {
    const response = await fetch("/api/session");
    if (response.ok) await showChat(await response.json());
    else showLogin();
  } catch {
    const snapshot = loadSessionSnapshot();
    if (snapshot) {
      await showChat(snapshot, true);
      showStatusToast("服务暂时不可用，正在查看本地内容");
    } else {
      showLogin();
      loginStatus.textContent = navigator.onLine ? "无法连接服务，请稍后重试" : "当前网络已断开";
    }
  }
}

function showLogin() {
  chatView.hidden = true;
  loginView.hidden = false;
  accessCode.focus();
}

function handleUnauthorizedResponse(response) {
  if (response.status !== 401) return false;
  expireUserSession();
  return true;
}

function expireUserSession() {
  if (sessionExpired) return;
  sessionExpired = true;
  localStorage.removeItem(SESSION_SNAPSHOT_KEY);
  userApiKeyInput.value = "";
  closeModelPicker();
  closeSidebar();
  showLogin();
  loginStatus.textContent = "登录已失效或已被管理员注销，请重新输入访问码";
}

async function showChat(existingSession, readOnlyOffline = false) {
  sessionExpired = false;
  loginView.hidden = true;
  chatView.hidden = false;
  setOfflineMode(readOnlyOffline);
  let session = existingSession;
  if (!session) {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error("session_unavailable");
    session = await response.json();
  }
  currentUser = session.user || "friend";
  currentDisplayName = session.displayName || currentUser;
  routes = Array.isArray(session.routes) ? session.routes : [];
  selectedRouteId = chooseRoute(session.defaultRoute);
  hasUserSystemPrompt = Boolean(session.hasUserSystemPrompt);
  if (!readOnlyOffline) lastRouteRefreshAt = Date.now();
  userLabel.textContent = currentDisplayName;
  userLabel.title = currentDisplayName === currentUser ? "" : `用户标识：${currentUser}`;
  const accountAvatar = document.querySelector(".account-avatar");
  if (accountAvatar) accountAvatar.textContent = currentDisplayName.slice(0, 1).toUpperCase() || "U";
  updateUsage(session.usage);
  renderRoutes();
  updateConnectionState("同步会话中");
  await loadUserSessions({ offline: offlineMode });
  if (sessionExpired) return;
  renderChatList();
  renderMessages(true);
  updateChatTitle();
  await loadMemory({ offline: offlineMode });
  if (sessionExpired) return;
  if (!offlineMode) cacheSessionSnapshot(session);
  updateConnectionState();
  updateComposerMeta();
  setOfflineMode(offlineMode);
  if (!offlineMode) promptInput.focus();
}

function cacheSessionSnapshot(session) {
  try {
    localStorage.setItem(
      SESSION_SNAPSHOT_KEY,
      JSON.stringify({
        user: session.user || currentUser,
        displayName: session.displayName || currentDisplayName,
        routes: Array.isArray(session.routes) ? session.routes : routes,
        defaultRoute: session.defaultRoute || selectedRouteId,
        usage: session.usage || null,
        hasUserSystemPrompt: Boolean(session.hasUserSystemPrompt),
        cachedAt: Date.now(),
      }),
    );
  } catch {}
}

function loadSessionSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(SESSION_SNAPSHOT_KEY) || "null");
    if (!snapshot?.user || !Array.isArray(snapshot.routes) || !snapshot.routes.length) return null;
    return snapshot;
  } catch {
    return null;
  }
}

async function reconnectSession() {
  showStatusToast("网络已恢复，正在重新验证会话");
  try {
    const response = await fetch("/api/session");
    if (!response.ok) {
      localStorage.removeItem(SESSION_SNAPSHOT_KEY);
      showLogin();
      loginStatus.textContent = "会话已失效，请重新输入访问码";
      return;
    }
    await showChat(await response.json(), false);
    showStatusToast("已恢复在线模式");
  } catch {
    setOfflineMode(true);
    showStatusToast("重新连接失败，继续使用本地只读模式");
  }
}

function setOfflineMode(nextOffline) {
  offlineMode = Boolean(nextOffline);
  chatView.classList.toggle("offline-mode", offlineMode);
  promptInput.disabled = offlineMode || isBusy;
  sendButton.disabled = offlineMode || isBusy || currentUsage?.remaining === 0;
  imageInput.disabled = offlineMode || isBusy || getSelectedRoute()?.supportsImages === false;
  memoryInput.readOnly = offlineMode;
  saveMemoryButton.disabled = offlineMode;
  newChatButton.disabled = offlineMode;
  if (mobileNewChatButton) mobileNewChatButton.disabled = offlineMode;
  clearButton.disabled = offlineMode;
  if (suggestMemoryButton) suggestMemoryButton.disabled = offlineMode || isBusy;
  if (composerHint) {
    composerHint.textContent = offlineMode
      ? "离线只读，网络恢复后可继续发送"
      : getSelectedRoute()?.supportsImages === false
        ? "当前线路不支持图片"
        : "支持粘贴或拖拽图片";
  }
  updateConnectionState();
}

function setLoginBusy(busy) {
  loginForm.setAttribute("aria-busy", String(busy));
  loginSubmitButton.disabled = busy;
  loginSubmitButton.textContent = busy ? "正在进入…" : "进入 Chatus";
  accessCode.disabled = busy;
}

function syncThemeControls() {
  const preference = window.ChatusTheme?.getPreference?.() || "system";
  const labels = { system: "跟随系统", light: "浅色", dark: "深色" };
  if (themeSummary) themeSummary.textContent = labels[preference] || labels.system;
  for (const input of themeOptions?.querySelectorAll("input[name='theme']") || []) {
    input.checked = input.value === preference;
  }
}

function requestReference(response) {
  const requestId = response.headers.get("X-Request-ID") || "";
  return requestId ? ` · 请求 ${requestId.slice(0, 8)}` : "";
}

async function streamChat(assistantMessage) {
  setBusy(true);
  updateConnectionState("生成中");
  abortController = new AbortController();
  let received = false;
  let usedRoute = selectedRouteId;
  try {
    const payload = {
      messages: buildRequestMessages(assistantMessage),
      routeId: selectedRouteId,
    };
    const summary = getActiveSession().summary || "";
    if (summary) payload.sessionSummary = summary;
    const userApiKey = userApiKeyInput.value.trim();
    if (userApiKey) payload.userApiKey = userApiKey;
    const requestBody = JSON.stringify(payload);
    if (new TextEncoder().encode(requestBody).byteLength > MAX_REQUEST_BODY_BYTES) {
      throw new Error("图片总量过大，请减少图片后重试");
    }
    const response = await fetch("/api/chat", {
      method: "POST",
      signal: abortController.signal,
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: requestBody,
    });
    if (handleUnauthorizedResponse(response)) {
      messages = messages.filter((message) => message !== assistantMessage);
      const active = getActiveSession();
      active.messages = messages;
      saveSessionsLocalOnly();
      renderMessages(false);
      return;
    }
    const remaining = response.headers.get("X-RateLimit-Remaining");
    if (remaining !== null) {
      updateUsage({ remaining: Number(remaining), limit: currentUsage?.limit });
    }
    usedRoute = response.headers.get("X-Chatus-Route") || selectedRouteId;
    lastRouteUsed = usedRoute;
    assistantMessage.routeId = usedRoute;
    assistantMessage.fallback = Boolean(usedRoute && usedRoute !== selectedRouteId);
    if (usedRoute && usedRoute !== selectedRouteId) {
      setSyncStatus(`已 fallback 到 ${routeLabelById(usedRoute)}`);
    }
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      const message = data.message || formatError(data.error || "request_failed");
      throw new Error(`${message}${requestReference(response)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const chunk = parseStreamLine(line);
        if (!chunk) continue;
        received = true;
        assistantMessage.content += chunk;
        scheduleRender();
      }
    }
    flushRender(true);
    saveMessages();
    saveSessions({ immediate: true });
  } catch (error) {
    flushRender(true);
    if (error.name === "AbortError") {
      if (!String(assistantMessage.content || "").trim()) {
        messages = messages.filter((message) => message !== assistantMessage);
        saveMessages();
        renderMessages(true);
      } else {
        saveMessages();
      }
    } else if (!received) {
      messages = messages.filter((message) => message !== assistantMessage);
      messages.push({ id: createId(), role: "error", content: error.message || "请求失败", createdAt: Date.now() });
      saveMessages();
      renderMessages(true);
    } else {
      messages.push({ id: createId(), role: "error", content: error.message || "请求失败", createdAt: Date.now() });
      saveMessages();
      renderMessages(true);
    }
  } finally {
    abortController = null;
    setBusy(false);
    updateConnectionState();
  }
}

async function loadMemory(options = {}) {
  if (options.offline) {
    memoryInput.value = localStorage.getItem(memoryStorageKey()) || "";
    memoryStatus.textContent = memoryInput.value ? "本地缓存" : "离线不可用";
    return;
  }
  memoryStatus.textContent = "读取中";
  saveMemoryButton.disabled = true;
  if (suggestMemoryButton) suggestMemoryButton.disabled = true;
  try {
    const response = await fetch("/api/memory");
    if (handleUnauthorizedResponse(response)) return;
    if (!response.ok) throw new Error("load_failed");
    const data = await response.json();
    memoryInput.maxLength = Number(data.maxChars) || 4000;
    memoryInput.value = data.memory || "";
    localStorage.setItem(memoryStorageKey(), memoryInput.value);
    memoryStatus.textContent = memoryInput.value ? "已加载" : "空";
  } catch {
    memoryStatus.textContent = "读取失败";
  } finally {
    saveMemoryButton.disabled = offlineMode;
    if (suggestMemoryButton) suggestMemoryButton.disabled = offlineMode;
  }
}

async function saveMemory() {
  memoryStatus.textContent = "保存中";
  saveMemoryButton.disabled = true;
  try {
    const response = await fetch("/api/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: memoryInput.value }),
    });
    if (handleUnauthorizedResponse(response)) return;
    if (!response.ok) throw new Error("save_failed");
    const data = await response.json();
    memoryInput.value = data.memory || "";
    localStorage.setItem(memoryStorageKey(), memoryInput.value);
    memoryStatus.textContent = "已保存";
  } catch {
    memoryStatus.textContent = "保存失败";
  } finally {
    saveMemoryButton.disabled = offlineMode;
  }
}

async function suggestMemory() {
  const source = messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-16);
  if (!source.length) {
    memoryStatus.textContent = "暂无对话可提炼";
    return;
  }
  memoryStatus.textContent = "生成建议中";
  if (suggestMemoryButton) suggestMemoryButton.disabled = true;
  saveMemoryButton.disabled = true;
  try {
    const payload = {
      messages: source.map(({ role, content }) => ({ role, content })),
      routeId: selectedRouteId,
    };
    const userApiKey = userApiKeyInput.value.trim();
    if (userApiKey) payload.userApiKey = userApiKey;
    const response = await fetch("/api/memory/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify(payload),
    });
    if (handleUnauthorizedResponse(response)) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || formatError(data.error || "request_failed"));
    pendingSuggestion = (data.suggestion || "").trim();
    if (!pendingSuggestion) {
      hideMemorySuggest();
      memoryStatus.textContent = "没有可写入的记忆";
      return;
    }
    memorySuggestText.textContent = pendingSuggestion;
    memorySuggestBox.hidden = false;
    memoryStatus.textContent = "已生成建议";
  } catch (error) {
    memoryStatus.textContent = error.message || "建议失败";
  } finally {
    if (suggestMemoryButton) suggestMemoryButton.disabled = false;
    saveMemoryButton.disabled = false;
  }
}

function hideMemorySuggest() {
  pendingSuggestion = "";
  if (memorySuggestBox) memorySuggestBox.hidden = true;
  if (memorySuggestText) memorySuggestText.textContent = "";
}
async function loadUserSessions(options = {}) {
  const local = loadLocalSessions();
  sessions = local;
  activeSessionId = chooseActiveSessionId();
  messages = getActiveSession().messages;

  if (!cloudSyncEnabled || options.offline) return;

  try {
    const response = await fetch("/api/chats");
    if (handleUnauthorizedResponse(response)) throw new Error("session_expired");
    if (!response.ok) throw new Error("cloud_list_failed");
    const data = await response.json();
    const remote = normalizeSessions(data.chats || []);

    if (!remote.length && local.length) {
      const migrate = await fetch("/api/chats/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chats: local, mode: "merge" }),
      });
      if (migrate.ok) {
        const migrated = await migrate.json();
        sessions = normalizeSessions(migrated.chats || local);
        setSyncStatus(`已上传 ${sessions.length} 个本地会话到云端`);
      } else {
        sessions = local;
        setSyncStatus("云端同步暂不可用，仍使用本地会话");
      }
    } else if (remote.length) {
      // Prefer newer session version per id between local cache and remote.
      const byId = new Map();
      for (const chat of remote) byId.set(chat.id, chat);
      const localNewer = [];
      for (const chat of local) {
        const prev = byId.get(chat.id);
        if (!prev || chat.updatedAt > prev.updatedAt) {
          byId.set(chat.id, chat);
          localNewer.push(chat);
        }
      }
      sessions = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
      if (localNewer.length) {
        await fetch("/api/chats/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chats: localNewer, mode: "merge" }),
        }).catch(() => null);
      }
      setSyncStatus(`已同步 ${sessions.length} 个会话`);
    } else {
      sessions = local.length ? local : [createSession()];
      setSyncStatus("暂无云端会话");
    }

    activeSessionId = chooseActiveSessionId();
    messages = getActiveSession().messages;
    saveSessionsLocalOnly();
  } catch {
    sessions = local.length ? local : [createSession()];
    activeSessionId = chooseActiveSessionId();
    messages = getActiveSession().messages;
    setSyncStatus("云端同步失败，使用本地缓存");
  }
}

function loadLocalSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionsStorageKey()) || "[]");
    if (Array.isArray(parsed) && parsed.length) return normalizeSessions(parsed);
  } catch {}
  try {
    const legacyKey = `chatus.sessions.v2.${encodeURIComponent(currentUser || "friend")}`;
    const parsed = JSON.parse(localStorage.getItem(legacyKey) || "[]");
    if (Array.isArray(parsed) && parsed.length) return normalizeSessions(parsed);
  } catch {}
  const legacy = loadLegacyMessages();
  return legacy.length ? [createSession(legacy)] : [];
}

function loadSessions() {
  return loadLocalSessions();
}

function normalizeSessions(input) {
  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : createId(),
      title: typeof item.title === "string" && item.title.trim() ? item.title : "新会话",
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
      summary: typeof item.summary === "string" ? item.summary : "",
      summaryUntil: Number.isFinite(item.summaryUntil) ? item.summaryUntil : 0,
      pinned: item.pinned === true,
      messages: Array.isArray(item.messages) ? item.messages.slice(-MAX_STORED_MESSAGES).map(normalizeMessage) : [],
    }))
    .sort(compareSessions)
    .slice(0, MAX_SESSIONS);
}

function normalizeMessage(item) {
  if (!item || typeof item !== "object") return { id: createId(), role: "error", content: "无效消息", createdAt: Date.now() };
  return {
    id: typeof item.id === "string" ? item.id : createId(),
    role: item.role === "user" || item.role === "assistant" || item.role === "error" ? item.role : "error",
    content: item.content,
    routeId: typeof item.routeId === "string" ? item.routeId : "",
    fallback: item.fallback === true,
    rating: item.rating === "up" || item.rating === "down" ? item.rating : "",
    ratingReason: typeof item.ratingReason === "string" ? item.ratingReason : "",
    createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
  };
}

function loadLegacyMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeMessage) : [];
  } catch {
    return [];
  }
}

function createSession(initialMessages = []) {
  const now = Date.now();
  const trimmedMessages = initialMessages.slice(-MAX_STORED_MESSAGES).map(normalizeMessage);
  return {
    id: createId(),
    title: deriveSessionTitle(trimmedMessages),
    createdAt: now,
    updatedAt: now,
    summary: "",
    summaryUntil: 0,
    pinned: false,
    messages: trimmedMessages,
  };
}

function createNewSession() {
  const session = createSession();
  sessions = [session, ...sessions].slice(0, MAX_SESSIONS);
  activeSessionId = session.id;
  messages = session.messages;
  attachments = [];
  hideMemorySuggest();
  saveSessions();
  renderChatList();
  renderMessages(true);
  renderAttachments();
  updateChatTitle();
}

function chooseActiveSessionId() {
  const stored = localStorage.getItem(activeSessionStorageKey());
  if (sessions.some((session) => session.id === stored)) return stored;
  if (!sessions.length) sessions = [createSession()];
  return sessions[0].id;
}

function getActiveSession() {
  let session = sessions.find((item) => item.id === activeSessionId);
  if (!session) {
    session = createSession();
    sessions = [session, ...sessions].slice(0, MAX_SESSIONS);
    activeSessionId = session.id;
    saveSessions();
  }
  return session;
}

function activateSession(id, searchQuery = "") {
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  const targetMessageId = searchQuery ? findSearchMessageId(session, searchQuery) : "";
  activeSessionId = id;
  messages = session.messages;
  attachments = [];
  hideMemorySuggest();
  localStorage.setItem(activeSessionStorageKey(), id);
  renderAttachments();
  renderChatList();
  renderMessages(true);
  updateChatTitle();
  closeSidebar();
  if (targetMessageId) {
    requestAnimationFrame(() => focusSearchMessage(targetMessageId));
  } else {
    promptInput.focus();
  }
}

function findSearchMessageId(session, query) {
  const match = session.messages.find((message) => extractText(message.content).toLowerCase().includes(query));
  return match?.id || "";
}

function focusSearchMessage(messageId) {
  const target = [...messageList.querySelectorAll(".message")].find((node) => node.dataset.messageId === messageId);
  if (!target) return;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  target.classList.add("search-hit");
  setTimeout(() => target.classList.remove("search-hit"), 1800);
}

async function deleteSession(id) {
  if (offlineMode) return showStatusToast("离线只读模式下不能删除会话");
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  if (!(await confirmAction({ title: "删除这个会话？", description: `“${session.title || "新会话"}”将从本地和云端移除。`, confirmLabel: "删除", destructive: true }))) return;
  sessions = sessions.filter((session) => session.id !== id);
  if (!sessions.length) sessions = [createSession()];
  if (activeSessionId === id) {
    activeSessionId = sessions[0].id;
    messages = sessions[0].messages;
  }
  saveSessionsLocalOnly();
  if (cloudSyncEnabled) {
    fetch(`/api/chats?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(async (response) => {
        if (handleUnauthorizedResponse(response)) return;
        if (!response.ok) setSyncStatus("云端删除失败，本地已删除");
        else setSyncStatus("会话已删除");
      })
      .catch(() => setSyncStatus("云端删除失败，本地已删除"));
  }
  // Ensure remaining active chat still synced.
  saveSessions({ immediate: true });
  renderChatList();
  renderMessages(true);
  updateChatTitle();
}

function saveMessages() {
  const active = getActiveSession();
  active.messages = messages.slice(-MAX_STORED_MESSAGES);
  if (!active.title || active.title === "新会话") active.title = deriveSessionTitle(active.messages);
  active.updatedAt = Date.now();
  sessions = [active, ...sessions.filter((session) => session.id !== active.id)]
    .sort(compareSessions)
    .slice(0, MAX_SESSIONS);
  messages = active.messages;
  activeSessionId = active.id;
  saveSessions();
  renderChatList();
  updateChatTitle();
}

function saveSessionsLocalOnly() {
  try {
    localStorage.setItem(sessionsStorageKey(), JSON.stringify(sessions));
    if (activeSessionId) localStorage.setItem(activeSessionStorageKey(), activeSessionId);
    return true;
  } catch {
    setSyncStatus("本地缓存空间不足，发送和云端同步仍可继续");
    return false;
  }
}

function saveSessions(options = {}) {
  saveSessionsLocalOnly();
  const active = getActiveSession();
  if (options.immediate) {
    queueCloudSave(active, true);
  } else if (options.skipCloud) {
    return;
  } else {
    queueCloudSave(active, false);
  }
}

function queueCloudSave(chat, immediate = false) {
  if (!cloudSyncEnabled || !chat) return;
  const run = async () => {
    if (cloudSaveInFlight) {
      cloudSaveQueued = true;
      return;
    }
    cloudSaveInFlight = true;
    try {
      const response = await fetch("/api/chats", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat }),
      });
      if (handleUnauthorizedResponse(response)) return;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSyncStatus(data.message || "云端保存失败，已保留本地");
      } else {
        setSyncStatus("已同步到云端");
      }
    } catch {
      setSyncStatus("云端保存失败，已保留本地");
    } finally {
      cloudSaveInFlight = false;
      if (cloudSaveQueued) {
        cloudSaveQueued = false;
        const latest = getActiveSession();
        queueCloudSave(latest, true);
      }
    }
  };

  if (immediate) {
    if (cloudSaveTimer) {
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer = null;
    }
    run();
    return;
  }

  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    cloudSaveTimer = null;
    run();
  }, 500);
}

function setSyncStatus(text) {
  syncStatusText = text || "";
  if (!syncStatusText) {
    updateConnectionState();
    return;
  }
  connectionState.textContent = syncStatusText;
  showStatusToast(syncStatusText);
  setTimeout(() => {
    if (connectionState.textContent === syncStatusText) updateConnectionState();
  }, 2200);
}

function showStatusToast(text) {
  if (!statusToast || !text) return;
  if (statusToastTimer) clearTimeout(statusToastTimer);
  statusToast.textContent = text;
  statusToast.hidden = false;
  statusToastTimer = setTimeout(() => {
    statusToast.hidden = true;
    statusToastTimer = null;
  }, 2200);
}

function renderChatList() {
  chatList.textContent = "";
  if (!sessions.length) return;
  const filtered = sessionFilter
    ? sessions.filter((session) => sessionSearchText(session).includes(sessionFilter))
    : sessions;
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "chat-list-empty";
    empty.textContent = "无匹配会话";
    chatList.append(empty);
    return;
  }
  let previousGroup = "";
  for (const session of [...filtered].sort(compareSessions)) {
    if (!sessionFilter) {
      const group = sessionDateGroup(session);
      if (group !== previousGroup) {
        const heading = document.createElement("div");
        heading.className = "chat-list-group-label";
        heading.textContent = group;
        chatList.append(heading);
        previousGroup = group;
      }
    }
    const item = document.createElement("div");
    item.className = `chat-list-item${session.id === activeSessionId ? " active" : ""}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "chat-list-main";
    const copy = document.createElement("span");
    copy.className = "chat-list-copy";
    const title = document.createElement("span");
    title.className = "chat-list-title";
    appendHighlightedText(title, session.title || "新会话", sessionFilter);
    copy.append(title);
    if (sessionFilter) {
      const snippetText = sessionSearchSnippet(session, sessionFilter);
      if (snippetText) {
        open.classList.add("has-snippet");
        const snippet = document.createElement("small");
        snippet.className = "chat-list-snippet";
        appendHighlightedText(snippet, snippetText, sessionFilter);
        copy.append(snippet);
      }
    }
    open.append(copy);
    if (session.pinned) {
      const pinMark = document.createElement("span");
      pinMark.className = "chat-pin-mark";
      pinMark.textContent = "置顶";
      open.append(pinMark);
    }
    open.title = session.summary ? `${session.title}\n${session.summary}` : session.title || "新会话";
    open.addEventListener("click", () => activateSession(session.id, sessionFilter));
    const menu = document.createElement("details");
    menu.className = "chat-list-menu";
    const summary = document.createElement("summary");
    summary.title = "会话操作";
    summary.setAttribute("aria-label", "会话操作");
    summary.textContent = "···";
    const actions = document.createElement("div");
    actions.className = "chat-list-menu-popover";
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "重命名";
    rename.addEventListener("click", async () => {
      menu.removeAttribute("open");
      await renameSession(session.id);
    });
    const pin = document.createElement("button");
    pin.type = "button";
    pin.textContent = session.pinned ? "取消置顶" : "置顶";
    pin.addEventListener("click", () => {
      menu.removeAttribute("open");
      toggleSessionPin(session.id);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-action";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      menu.removeAttribute("open");
      await deleteSession(session.id);
    });
    actions.append(pin, rename, remove);
    menu.append(summary, actions);
    item.append(open, menu);
    chatList.append(item);
  }
}

function sessionDateGroup(session) {
  if (session.pinned) return "置顶";
  const updated = new Date(session.updatedAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const updatedDay = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate()).getTime();
  if (updatedDay >= today) return "今天";
  if (updatedDay >= today - 6 * 86_400_000) return "最近 7 天";
  return "更早";
}

function toggleSessionPin(id) {
  if (offlineMode) return showStatusToast("离线只读模式下不能修改置顶");
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  session.pinned = !session.pinned;
  session.updatedAt = Date.now();
  sessions.sort(compareSessions);
  saveSessionsLocalOnly();
  queueCloudSave(session, true);
  renderChatList();
  setSyncStatus(session.pinned ? "会话已置顶" : "已取消置顶");
}

function compareSessions(a, b) {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

function sessionSearchText(session) {
  const messageText = session.messages.map((message) => extractText(message.content)).join("\n");
  return `${session.title}\n${session.summary || ""}\n${messageText}`.toLowerCase();
}

function sessionSearchSnippet(session, query) {
  const source = [session.summary || "", ...session.messages.map((message) => extractText(message.content))]
    .filter(Boolean)
    .join(" · ")
    .replace(/\s+/g, " ")
    .trim();
  const index = source.toLowerCase().indexOf(query);
  if (index < 0) return "";
  const start = Math.max(0, index - 30);
  const end = Math.min(source.length, index + query.length + 38);
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

function appendHighlightedText(parent, text, query) {
  if (!query) return parent.append(document.createTextNode(text));
  const lower = text.toLowerCase();
  let cursor = 0;
  let index = lower.indexOf(query, cursor);
  while (index !== -1) {
    if (index > cursor) parent.append(document.createTextNode(text.slice(cursor, index)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(index, index + query.length);
    parent.append(mark);
    cursor = index + query.length;
    index = lower.indexOf(query, cursor);
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

async function renameSession(id) {
  if (offlineMode) return showStatusToast("离线只读模式下不能重命名会话");
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  const next = await promptAction({
    title: "重命名会话",
    description: "使用一个简短、容易识别的名称。",
    value: session.title || "新会话",
    confirmLabel: "保存",
    rows: 1,
  });
  if (next === null || !next.trim()) return;
  session.title = next.trim().slice(0, 60);
  session.updatedAt = Date.now();
  saveSessionsLocalOnly();
  if (session.id === activeSessionId) queueCloudSave(session, true);
  else queueCloudSave(session, false);
  renderChatList();
  updateChatTitle();
  setSyncStatus("会话已重命名");
}

function sessionsStorageKey() {
  return `${SESSIONS_STORAGE_PREFIX}${encodeURIComponent(currentUser || "friend")}`;
}
function memoryStorageKey(user = currentUser) {
  return `${MEMORY_STORAGE_PREFIX}${encodeURIComponent(user || "friend")}`;
}
function activeSessionStorageKey() {
  return `${ACTIVE_SESSION_PREFIX}${encodeURIComponent(currentUser || "friend")}`;
}
function createId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function deriveSessionTitle(inputMessages) {
  const firstUser = inputMessages.find((message) => message.role === "user");
  const text = firstUser ? extractText(firstUser.content).replace(/\s+/g, " ").trim() : "";
  if (!text) return "新会话";
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}
function chooseRoute(defaultRoute) {
  const stored = localStorage.getItem(ROUTE_STORAGE_KEY);
  if (routes.some((route) => route.id === stored)) return stored;
  if (routes.some((route) => route.id === defaultRoute)) return defaultRoute;
  return routes[0]?.id || "";
}

function renderRoutes() {
  routeSelect.textContent = "";
  modelPickerMenu.textContent = "";
  for (const route of routes) {
    const option = document.createElement("option");
    option.value = route.id;
    const label = route.label || route.id;
    option.textContent = route.model && route.model !== label ? `${label} · ${route.model}` : label;
    routeSelect.append(option);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `model-option${route.id === selectedRouteId ? " selected" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(route.id === selectedRouteId));
    const icon = document.createElement("span");
    icon.className = "model-option-icon";
    icon.textContent = route.type === "anthropic-messages" ? "A" : "AI";
    const copy = document.createElement("span");
    copy.className = "model-option-copy";
    const name = document.createElement("strong");
    name.textContent = route.model || label;
    const meta = document.createElement("span");
    meta.textContent = label;
    copy.append(name, meta);
    const badges = document.createElement("span");
    badges.className = "model-option-badges";
    if (route.supportsImages !== false) badges.append(modelBadge("图片"));
    if (route.allowUserKey || route.requiresUserKey) badges.append(modelBadge(route.requiresUserKey ? "需 Key" : "可用 Key"));
    const healthLabel = route.healthStatus === "healthy" ? "近期正常" : route.healthStatus === "unhealthy" ? "近期异常" : "未检查";
    badges.append(modelBadge(healthLabel, `health-${route.healthStatus || "unknown"}`));
    button.append(icon, copy, badges);
    button.addEventListener("click", () => {
      selectRoute(route.id);
      closeModelPicker();
      promptInput.focus();
    });
    modelPickerMenu.append(button);
  }
  routeSelect.value = selectedRouteId;
  routeSelect.disabled = routes.length <= 1;
  modelPickerTrigger.disabled = routes.length <= 1;
  updateRouteControls();
}

function modelBadge(text, className = "") {
  const badge = document.createElement("small");
  if (className) badge.classList.add(className);
  badge.textContent = text;
  return badge;
}

function selectRoute(routeId) {
  if (!routes.some((route) => route.id === routeId)) return;
  selectedRouteId = routeId;
  routeSelect.value = routeId;
  localStorage.setItem(ROUTE_STORAGE_KEY, selectedRouteId);
  renderRoutes();
  updateConnectionState();
  if (!messages.length) renderMessages(false);
  showStatusToast(`已切换到 ${routeLabelById(routeId)}`);
}

function toggleModelPicker() {
  if (!modelPickerMenu || modelPickerTrigger.disabled) return;
  if (modelPickerMenu.hidden) openModelPicker();
  else closeModelPicker();
}

function openModelPicker() {
  modelPickerMenu.hidden = false;
  modelPickerTrigger.setAttribute("aria-expanded", "true");
  modelPickerMenu.querySelector(".model-option.selected")?.focus();
  refreshRouteState();
}

function refreshRouteState() {
  if (offlineMode || sessionExpired || Date.now() - lastRouteRefreshAt < 60_000) return routeRefreshPromise;
  if (routeRefreshPromise) return routeRefreshPromise;
  routeRefreshPromise = fetch("/api/session", { cache: "no-store" })
    .then(async (response) => {
      if (handleUnauthorizedResponse(response)) return;
      if (!response.ok) return;
      const session = await response.json();
      const nextRoutes = Array.isArray(session.routes) ? session.routes : [];
      routes = nextRoutes;
      if (!routes.some((route) => route.id === selectedRouteId)) selectedRouteId = chooseRoute(session.defaultRoute);
      hasUserSystemPrompt = Boolean(session.hasUserSystemPrompt);
      updateUsage(session.usage);
      renderRoutes();
      if (routes.length <= 1) closeModelPicker();
      updateConnectionState();
      cacheSessionSnapshot(session);
      lastRouteRefreshAt = Date.now();
      if (!modelPickerMenu.hidden) modelPickerMenu.querySelector(".model-option.selected")?.focus();
    })
    .catch(() => null)
    .finally(() => {
      routeRefreshPromise = null;
    });
  return routeRefreshPromise;
}

function closeModelPicker() {
  if (!modelPickerMenu) return;
  modelPickerMenu.hidden = true;
  modelPickerTrigger?.setAttribute("aria-expanded", "false");
}

function updateRouteControls() {
  const route = getSelectedRoute();
  if (modelPickerName) modelPickerName.textContent = route?.model || route?.label || "选择模型";
  const canUseOwnKey = Boolean(route?.allowUserKey || route?.requiresUserKey);
  userApiKeyLabel.hidden = !canUseOwnKey;
  userKeyField.hidden = !canUseOwnKey;
  userApiKeyInput.required = Boolean(route?.requiresUserKey);
  if (!canUseOwnKey) {
    userApiKeyInput.value = "";
    userApiKeyInput.type = "password";
  }
  const supportsImages = route?.supportsImages !== false;
  imageInput.disabled = offlineMode || !supportsImages || isBusy;
  imageInputLabel.classList.toggle("disabled", offlineMode || !supportsImages);
  imageInputLabel.title = offlineMode ? "离线模式下不能添加图片" : supportsImages ? "添加图片" : "当前线路不支持图片";
  if (composerHint) {
    composerHint.textContent = offlineMode
      ? "离线只读，网络恢复后可继续发送"
      : supportsImages
        ? "支持粘贴或拖拽图片"
        : "当前线路不支持图片";
  }
  if (!supportsImages && attachments.length) {
    attachments = [];
    renderAttachments();
  }
}

function getSelectedRoute() {
  return routes.find((route) => route.id === selectedRouteId) || null;
}
function routeLabelById(id) {
  return routes.find((route) => route.id === id)?.label || id;
}
function updateConnectionState(prefix) {
  const route = getSelectedRoute();
  if (prefix) {
    connectionState.textContent = prefix;
    return;
  }
  if (offlineMode) {
    connectionState.textContent = "离线 · 本地只读";
    return;
  }
  const label = lastRouteUsed ? routeLabelById(lastRouteUsed) : route?.label;
  const promptMark = hasUserSystemPrompt ? " · 专属提示词" : "";
  connectionState.textContent = label ? `已连接 · ${label}${promptMark}` : `已连接${promptMark}`;
}
function parseStreamLine(line) {
  if (!line.startsWith("data:")) return "";
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  try {
    const json = JSON.parse(data);
    return json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
  } catch {
    return "";
  }
}
function buildUserContent(text, files) {
  if (!files.length) return text;
  const content = [];
  if (text) content.push({ type: "text", text });
  for (const file of files) content.push({ type: "image_url", image_url: { url: file.url } });
  return content;
}
function buildRequestMessages(pendingAssistantMessage) {
  const cleaned = messages.filter((message) => {
    if (message === pendingAssistantMessage || message.role === "error") return false;
    if (typeof message.content === "string") return Boolean(message.content.trim());
    return Array.isArray(message.content) && message.content.length > 0;
  });
  const recent = cleaned.slice(-MAX_CONTEXT_MESSAGES);
  while (recent[0]?.role === "assistant") recent.shift();
  let total = 0;
  const kept = [];
  let userTurnsWithImages = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    let content = message.content;
    if (Array.isArray(content) && content.some((part) => part.type === "image_url")) {
      if (message.role === "user") {
        userTurnsWithImages += 1;
        if (userTurnsWithImages > 2) {
          content = content.filter((part) => part.type !== "image_url");
          if (!content.length) continue;
          if (content.length === 1 && content[0].type === "text") content = content[0].text;
        }
      }
    }
    const cost = estimateChars(content);
    if (kept.length && total + cost > CONTEXT_CHAR_BUDGET) break;
    kept.push({ role: message.role, content });
    total += cost;
  }
  kept.reverse();
  while (kept[0]?.role === "assistant") kept.shift();
  return kept;
}
function estimateChars(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, part) => {
    if (part.type === "text") return sum + (part.text?.length || 0);
    if (part.type === "image_url") return sum + 800;
    return sum;
  }, 0);
}
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderMessages(false);
  }, RENDER_THROTTLE_MS);
}
function flushRender(forceScroll) {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  renderMessages(forceScroll);
}
function renderMessages(forceScroll = true) {
  const nearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 120;
  messageList.textContent = "";
  if (!messages.length) {
    renderEmptyChat();
    updateScrollButton();
    return;
  }
  messages.forEach((message, index) => {
    const node = document.createElement("article");
    node.className = `message ${message.role}`;
    node.dataset.messageId = message.id || String(index);
    if (message.role === "assistant") {
      const body = document.createElement("div");
      body.className = "message-body";
      const text = extractText(message.content);
      if (!text.trim()) body.append(document.createTextNode(isBusy && index === messages.length - 1 ? "…" : ""));
      else body.append(renderMarkdown(text));
      node.append(body);
    } else if (message.role === "error") {
      node.append(document.createTextNode(extractText(message.content) || "错误"));
    } else {
      const body = document.createElement("div");
      body.className = "message-body";
      const text = extractText(message.content);
      if (text) body.append(document.createTextNode(text));
      node.append(body);
    }
    for (const image of extractImages(message.content)) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      node.append(img);
    }
    if (message.role === "assistant" || message.role === "user") {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      if (message.role === "assistant" && message.routeId) {
        const routeMeta = document.createElement("span");
        routeMeta.className = `message-route${message.fallback ? " fallback" : ""}`;
        routeMeta.textContent = message.fallback
          ? `备用线路 · ${routeLabelById(message.routeId)}`
          : routeLabelById(message.routeId);
        meta.append(routeMeta);
      }
      const time = document.createElement("time");
      time.dateTime = new Date(message.createdAt).toISOString();
      time.textContent = formatMessageTime(message.createdAt);
      time.title = new Date(message.createdAt).toLocaleString("zh-CN", { hour12: false });
      meta.append(time);
      node.append(meta);
    }
    const actions = document.createElement("div");
    actions.className = "message-actions";
    if (message.role === "assistant" || message.role === "user") actions.append(actionButton("复制", () => copyMessage(message)));
    if (message.role === "user" && !isBusy && !offlineMode) {
      actions.append(actionButton("编辑", () => editUserMessage(index)));
      actions.append(actionButton("重发", () => resendFromUser(index)));
    }
    if (message.role === "assistant" && !isBusy && !offlineMode) {
      actions.append(actionButton("有帮助", () => rateAssistant(message, "up"), message.rating === "up"));
      actions.append(actionButton("需改进", () => rateAssistant(message, "down"), message.rating === "down"));
      actions.append(actionButton("重新生成", () => regenerateAssistant(index)));
    }
    if (message.role === "error" && !isBusy && !offlineMode) actions.append(actionButton("重试", () => retryLastFailed()));
    if (actions.childNodes.length) node.append(actions);
    messageList.append(node);
  });
  if (forceScroll || nearBottom) messageList.scrollTop = messageList.scrollHeight;
  updateScrollButton(!nearBottom && isBusy);
}

function updateScrollButton(markNewContent = false) {
  if (!scrollBottomButton) return;
  const distance = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
  const shouldShow = Boolean(messageList.querySelector(".message")) && distance > 180;
  scrollBottomButton.hidden = !shouldShow;
  if (!shouldShow) scrollBottomButton.classList.remove("has-new-content");
  else if (markNewContent) scrollBottomButton.classList.add("has-new-content");
}

function renderEmptyChat() {
  const route = getSelectedRoute();
  const empty = document.createElement("section");
  empty.className = "empty-chat";
  const mark = document.createElement("div");
  mark.className = "empty-chat-mark";
  mark.textContent = "C";
  const title = document.createElement("h2");
  title.textContent = `你好，${currentDisplayName || currentUser || "朋友"}`;
  const copy = document.createElement("p");
  copy.textContent = route ? `正在使用 ${route.label || route.model || route.id}，从一个具体任务开始吧。` : "从一个具体任务开始吧。";
  const suggestions = document.createElement("div");
  suggestions.className = "empty-suggestions";
  const prompts = [
    "帮我梳理一个复杂问题，并列出下一步行动",
    "阅读一段内容，提炼重点并给出改进建议",
    "为一个想法设计三种可执行的实现方案",
    "检查一段代码或文字，找出问题并优化",
  ];
  for (const prompt of prompts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "empty-suggestion";
    button.textContent = prompt;
    button.addEventListener("click", () => {
      promptInput.value = prompt;
      autoResizePrompt();
      updateComposerMeta();
      promptInput.focus();
    });
    suggestions.append(button);
  }
  empty.append(mark, title, copy, suggestions);
  messageList.append(empty);
}

function actionButton(label, onClick, active = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "msg-action";
  button.classList.toggle("active", active);
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function rateAssistant(message, rating) {
  if (!activeSessionId || !message.id || !message.routeId) return showStatusToast("这条回答缺少线路信息，暂时无法评价");
  const reason = rating === "down" ? await chooseFeedbackReason() : "";
  if (rating === "down" && !reason) return;
  const previous = message.rating || "";
  const previousReason = message.ratingReason || "";
  message.rating = rating;
  message.ratingReason = reason;
  saveMessages();
  renderMessages(false);
  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, reason, routeId: message.routeId, chatId: activeSessionId, messageId: message.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "反馈失败");
    showStatusToast(rating === "up" ? "感谢你的反馈" : "已记录，后续会继续改进");
  } catch (error) {
    message.rating = previous;
    message.ratingReason = previousReason;
    saveMessages();
    renderMessages(false);
    showStatusToast(error.message || "反馈失败");
  }
}

function chooseFeedbackReason() {
  if (!feedbackDialog || !feedbackForm || typeof feedbackDialog.showModal !== "function") return Promise.resolve("other");
  feedbackForm.reset();
  feedbackDialog.showModal();
  return new Promise((resolve) => {
    feedbackDialog.addEventListener("close", () => {
      if (feedbackDialog.returnValue !== "confirm") return resolve("");
      resolve(new FormData(feedbackForm).get("feedbackReason")?.toString() || "");
    }, { once: true });
  });
}

async function copyMessage(message) {
  try {
    await navigator.clipboard.writeText(extractText(message.content));
    updateConnectionState("已复制");
    setTimeout(() => updateConnectionState(), 1000);
  } catch {
    updateConnectionState("复制失败");
  }
}

async function editUserMessage(index) {
  if (offlineMode) return;
  const message = messages[index];
  if (!message || message.role !== "user") return;
  const next = await promptAction({
    title: "编辑消息",
    description: "保存后将从这条消息重新生成后续回答。",
    value: extractText(message.content),
    confirmLabel: "保存并重发",
    rows: 5,
  });
  if (next === null) return;
  const images = extractImages(message.content).map((url, i) => ({ name: `image-${i + 1}`, url }));
  messages = messages.slice(0, index);
  messages.push({ id: createId(), role: "user", content: buildUserContent(next.trim(), images), createdAt: Date.now() });
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages(true);
  streamChat(assistantMessage).then(() => maybeRefreshSummary());
}

function openActionDialog({ title, description = "", value = null, confirmLabel = "确认", destructive = false, rows = 4 }) {
  if (!appDialog || !appDialogForm) return Promise.resolve(null);
  appDialogTitle.textContent = title;
  appDialogDescription.textContent = description;
  appDialogDescription.hidden = !description;
  appDialogInput.hidden = value === null;
  appDialogInput.rows = rows;
  appDialogInput.value = value ?? "";
  appDialogConfirm.textContent = confirmLabel;
  appDialogConfirm.classList.toggle("destructive", destructive);
  appDialog.returnValue = "";
  appDialog.showModal();
  if (value !== null) {
    requestAnimationFrame(() => {
      appDialogInput.focus();
      appDialogInput.select();
    });
  }
  return new Promise((resolve) => {
    appDialog.addEventListener("close", () => {
      if (appDialog.returnValue !== "confirm") resolve(null);
      else resolve(value === null ? true : appDialogInput.value);
    }, { once: true });
  });
}

function confirmAction(options) {
  return openActionDialog({ ...options, value: null }).then(Boolean);
}

function promptAction(options) {
  return openActionDialog(options);
}

function resendFromUser(index) {
  if (offlineMode) return;
  const message = messages[index];
  if (!message || message.role !== "user") return;
  messages = messages.slice(0, index + 1);
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages(true);
  streamChat(assistantMessage).then(() => maybeRefreshSummary());
}

function regenerateAssistant(index) {
  if (offlineMode) return;
  const message = messages[index];
  if (!message || message.role !== "assistant") return;
  let userIndex = index - 1;
  while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex -= 1;
  if (userIndex < 0) return;
  messages = messages.slice(0, userIndex + 1);
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages(true);
  streamChat(assistantMessage).then(() => maybeRefreshSummary());
}

function retryLastFailed() {
  if (offlineMode) return;
  const lastErrorIndex = [...messages].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === "error")?.i;
  if (lastErrorIndex == null) return;
  messages = messages.slice(0, lastErrorIndex);
  let userIndex = messages.length - 1;
  while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex -= 1;
  if (userIndex < 0) { renderMessages(true); return; }
  messages = messages.slice(0, userIndex + 1);
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages(true);
  streamChat(assistantMessage).then(() => maybeRefreshSummary());
}

function renderAttachments() {
  attachmentRow.textContent = "";
  attachments.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "attachment";
    const img = document.createElement("img");
    img.src = file.url;
    img.alt = "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      attachments.splice(index, 1);
      renderAttachments();
      updateComposerMeta();
    });
    item.append(img, remove);
    attachmentRow.append(item);
  });
}

async function addImageFiles(fileList) {
  const route = getSelectedRoute();
  if (route?.supportsImages === false) return;
  const files = [...fileList].slice(0, MAX_ATTACHMENTS - attachments.length);
  for (const file of files) {
    try {
      const url = await prepareImage(file);
      attachments.push({ name: file.name, url });
    } catch (error) {
      setSyncStatus(error.message || "图片处理失败");
    }
  }
  renderAttachments();
  updateComposerMeta();
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}
function extractImages(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part.type === "image_url").map((part) => part.image_url.url);
}
function setBusy(nextBusy) {
  isBusy = nextBusy;
  sendButton.hidden = nextBusy;
  stopButton.hidden = !nextBusy;
  promptInput.disabled = offlineMode || nextBusy;
  sendButton.disabled = offlineMode || nextBusy || currentUsage?.remaining === 0;
  routeSelect.disabled = nextBusy || routes.length <= 1;
  modelPickerTrigger.disabled = nextBusy || routes.length <= 1;
  if (nextBusy) closeModelPicker();
  userApiKeyInput.disabled = offlineMode || nextBusy;
  imageInput.disabled = offlineMode || nextBusy || getSelectedRoute()?.supportsImages === false;
  if (suggestMemoryButton) suggestMemoryButton.disabled = offlineMode || nextBusy;
}
function updateUsage(usage) {
  const accountRow = document.querySelector(".account-row");
  if (!usage || !Number.isFinite(Number(usage.remaining))) {
    currentUsage = null;
    usageText.textContent = "--";
    accountRow?.classList.remove("usage-low", "usage-empty");
    return;
  }
  const remaining = Math.max(0, Number(usage.remaining));
  const limit = Number.isFinite(Number(usage.limit)) ? Number(usage.limit) : currentUsage?.limit;
  currentUsage = { remaining, limit };
  usageText.textContent = Number.isFinite(limit) ? `${remaining}/${limit}` : String(remaining);
  const low = Number.isFinite(limit) && limit > 0 && remaining > 0 && remaining / limit <= 0.1;
  accountRow?.classList.toggle("usage-low", low);
  accountRow?.classList.toggle("usage-empty", remaining === 0);
  accountRow?.setAttribute("title", remaining === 0 ? "今日消息额度已用完" : low ? "今日消息额度即将用完" : "");
  if (!isBusy) sendButton.disabled = offlineMode || remaining === 0;
}
function showInlineError(message) {
  messages.push({ id: createId(), role: "error", content: message, createdAt: Date.now() });
  saveMessages();
  renderMessages(true);
}
function formatError(code) {
  const map = {
    blocked_prompt: "不要用这种方式测活，必须使用一个小任务之类的",
    empty_messages: "消息为空",
    forbidden: "请求被拒绝",
    no_routes_available: "没有可用线路",
    rate_limited: "今天或当前分钟额度已用完",
    route_does_not_support_images: "当前线路不支持图片",
    route_not_allowed: "这条线路不可用",
    request_failed: "请求失败",
    request_too_large: "请求内容太大",
    upstream_error: "上游线路暂时不可用",
    user_api_key_required: "需要填写 API Key",
  };
  return map[code] || code || "请求失败";
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file) {
  const supported = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!supported.has(file.type)) throw new Error("仅支持 PNG、JPEG、WebP 或 GIF 图片");
  if (file.size > MAX_IMAGE_SOURCE_BYTES) throw new Error("单张原图不能超过 20 MB");
  if (file.type === "image/gif" && file.size <= MAX_IMAGE_OUTPUT_BYTES) return readFileAsDataUrl(file);

  const bitmap = await createImageBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;
  const initialScale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  width = Math.max(1, Math.round(width * initialScale));
  height = Math.max(1, Math.round(height * initialScale));
  let quality = 0.82;
  let blob = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) break;
    context.drawImage(bitmap, 0, 0, width, height);
    blob = await canvasToBlob(canvas, "image/webp", quality);
    if (blob && blob.size <= MAX_IMAGE_OUTPUT_BYTES) break;
    quality = Math.max(0.5, quality - 0.08);
    width = Math.max(1, Math.round(width * 0.88));
    height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
  }
  bitmap.close();
  if (!blob || blob.size > MAX_IMAGE_OUTPUT_BYTES) throw new Error("图片压缩后仍然过大，请换一张较小的图片");
  return readFileAsDataUrl(blob);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
function autoResizePrompt() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 170)}px`;
}
function updateComposerMeta() {
  if (!composerCount) return;
  const textLen = promptInput.value.length;
  const attach = attachments.length;
  composerCount.textContent = attach ? `${textLen} 字 · ${attach} 图` : textLen ? `${textLen} 字` : "";
}
function updateChatTitle() {
  const title = getActiveSession().title || "聊天";
  if (chatTitle) chatTitle.textContent = title;
  if (mobileTitle) mobileTitle.textContent = title;
}
function formatMessageTime(value) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
function openSidebar() {
  sidePanel?.classList.add("open");
  if (sidebarBackdrop) sidebarBackdrop.hidden = false;
  document.body.classList.add("sidebar-open");
}
function closeSidebar() {
  sidePanel?.classList.remove("open");
  if (sidebarBackdrop) sidebarBackdrop.hidden = true;
  document.body.classList.remove("sidebar-open");
}
function exportActiveSession() {
  const active = getActiveSession();
  const lines = [`# ${active.title || "会话"}`, ""];
  if (active.summary) lines.push(`> 摘要：${active.summary}`, "");
  for (const message of active.messages) {
    if (message.role === "error") continue;
    lines.push(`## ${message.role === "user" ? "用户" : "助手"}`, "", extractText(message.content) || "(空)", "");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(active.title || "chat").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
function exportAllSessions() {
  const payload = {
    product: "Chatus",
    exportedAt: new Date().toISOString(),
    user: currentUser,
    displayName: currentDisplayName,
    conversations: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
      summary: session.summary || "",
      pinned: Boolean(session.pinned),
      messages: session.messages.filter((message) => message.role !== "error"),
    })),
  };
  downloadBlob(JSON.stringify(payload, null, 2), `chatus-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
  showStatusToast(`已导出 ${sessions.length} 个会话`);
}
async function importSessionBackup() {
  const file = importAllInput.files?.[0];
  importAllInput.value = "";
  if (!file) return;
  if (offlineMode) return showStatusToast("需要联网才能导入并同步备份");
  if (file.size > 15_000_000) return showStatusToast("备份文件过大，无法导入");
  importAllButton.disabled = true;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.product !== "Chatus" || !Array.isArray(payload.conversations)) throw new Error("invalid_backup");
    const imported = normalizeImportedSessions(payload.conversations);
    if (!imported.length) throw new Error("empty_backup");
    if (!(await confirmAction({
      title: `导入 ${imported.length} 个会话？`,
      description: "备份会与当前会话合并；ID 相同的会话保留更新时间较新的版本，并同步到云端。",
      confirmLabel: "导入",
    }))) return;
    const byId = new Map(sessions.map((session) => [session.id, session]));
    for (const session of imported) {
      const existing = byId.get(session.id);
      if (!existing || session.updatedAt >= existing.updatedAt) byId.set(session.id, session);
    }
    const merged = [...byId.values()].sort(compareSessions).slice(0, MAX_SESSIONS);
    const response = await fetch("/api/chats/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chats: imported, mode: "merge" }),
    });
    if (handleUnauthorizedResponse(response)) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "cloud_import_failed");
    sessions = merged;
    activeSessionId = sessions[0].id;
    messages = sessions[0].messages;
    saveSessionsLocalOnly();
    renderChatList();
    renderMessages(true);
    updateChatTitle();
    settingsDialog?.close();
    showStatusToast(`已导入 ${imported.length} 个会话`);
  } catch (error) {
    const known = error.message === "invalid_backup" || error.message === "empty_backup";
    showStatusToast(known ? "这不是有效的 Chatus 对话备份" : error.message || "导入失败");
  } finally {
    importAllButton.disabled = false;
  }
}
function normalizeImportedSessions(input) {
  const prepared = input.slice(0, MAX_SESSIONS).map((item) => {
    if (!item || typeof item !== "object") return null;
    const createdAt = parseBackupTime(item.createdAt);
    const updatedAt = parseBackupTime(item.updatedAt);
    return {
      ...item,
      id: typeof item.id === "string" && item.id ? item.id : createId(),
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Number.isFinite(createdAt) ? createdAt : Date.now(),
    };
  }).filter(Boolean);
  return normalizeSessions(prepared);
}
function parseBackupTime(value) {
  if (Number.isFinite(value)) return Number(value);
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}
async function clearOfflineData() {
  if (!(await confirmAction({ title: "清除本机缓存？", description: "将移除当前设备保存的会话副本和离线页面缓存。重新联网后仍可从云端同步。", confirmLabel: "清除" }))) return;
  localStorage.removeItem(sessionsStorageKey());
  localStorage.removeItem(activeSessionStorageKey());
  localStorage.removeItem(SESSION_SNAPSHOT_KEY);
  if ("caches" in window) await caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => null);
  settingsDialog?.close();
  showStatusToast("本机缓存已清理，当前会话仍保留在页面中");
}
async function logoutAllDevices() {
  if (offlineMode) return showStatusToast("需要联网才能退出所有设备");
  if (!(await confirmAction({ title: "退出所有设备？", description: "当前用户在所有浏览器和设备上的登录都会失效，对话和记忆不会被删除。", confirmLabel: "全部退出", destructive: true }))) return;
  logoutAllDevicesButton.disabled = true;
  try {
    const response = await fetch("/api/sessions/revoke-all", { method: "POST" });
    if (!response.ok) throw new Error("revoke_failed");
    localStorage.removeItem(SESSION_SNAPSHOT_KEY);
    settingsDialog?.close();
    currentUser = "";
    currentDisplayName = "";
    showLogin();
    loginStatus.textContent = "所有设备已退出，请重新输入访问码";
  } catch {
    showStatusToast("退出所有设备失败，请稍后重试");
  } finally {
    logoutAllDevicesButton.disabled = false;
  }
}
async function deleteAllUserData() {
  if (offlineMode) return showStatusToast("需要联网才能删除云端数据");
  if (!(await confirmAction({ title: "永久删除全部数据？", description: "所有云端与本地对话、会话摘要和长期记忆都将被删除。此操作无法撤销。", confirmLabel: "永久删除", destructive: true }))) return;
  deleteUserDataButton.disabled = true;
  try {
    const response = await fetch("/api/user-data", { method: "DELETE" });
    if (handleUnauthorizedResponse(response)) return;
    if (!response.ok) throw new Error("delete_failed");
    localStorage.removeItem(sessionsStorageKey());
    localStorage.removeItem(activeSessionStorageKey());
    localStorage.removeItem(memoryStorageKey());
    localStorage.removeItem(SESSION_SNAPSHOT_KEY);
    sessions = [createSession()];
    activeSessionId = sessions[0].id;
    messages = sessions[0].messages;
    memoryInput.value = "";
    memoryStatus.textContent = "暂无长期记忆";
    saveSessionsLocalOnly();
    renderChatList();
    renderMessages(true);
    updateChatTitle();
    settingsDialog?.close();
    showStatusToast("全部对话与长期记忆已删除");
  } catch {
    showStatusToast("删除失败，请稍后重试");
  } finally {
    deleteUserDataButton.disabled = false;
  }
}
function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
async function maybeRefreshSummary() {
  const active = getActiveSession();
  const chatMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  if (chatMessages.length < 6) return;
  if (chatMessages.length - (active.summaryUntil || 0) < SUMMARY_EVERY) return;
  const sliceStart = Math.max(0, (active.summaryUntil || 0) - 2);
  const batch = chatMessages.slice(sliceStart);
  if (batch.length < 4) return;
  try {
    const payload = {
      messages: batch.map(({ role, content }) => ({ role, content })),
      previousSummary: active.summary || "",
      routeId: selectedRouteId,
    };
    const userApiKey = userApiKeyInput.value.trim();
    if (userApiKey) payload.userApiKey = userApiKey;
    const response = await fetch("/api/session-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify(payload),
    });
    if (handleUnauthorizedResponse(response)) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.summary) {
      setSyncStatus(data.message || "摘要更新失败，将继续使用现有上下文");
      return;
    }
    active.summary = String(data.summary).trim();
    active.summaryUntil = chatMessages.length;
    saveSessions();
    renderChatList();
    setSyncStatus("会话摘要已更新");
  } catch {
    setSyncStatus("摘要更新失败，将继续使用现有上下文");
  }
}
