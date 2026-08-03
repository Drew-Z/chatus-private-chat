import { renderMarkdown } from "./markdown.js?v=development";

const ICON_SPRITE = "/icons.svg?v=development";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function createIcon(name, className = "ui-icon") {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("class", className);
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NAMESPACE, "use");
  use.setAttribute("href", `${ICON_SPRITE}#${name}`);
  icon.append(use);
  return icon;
}

function setControlIcon(control, name) {
  control?.querySelector("use")?.setAttribute("href", `${ICON_SPRITE}#${name}`);
}

const loginView = document.querySelector("#loginView");
const chatView = document.querySelector("#chatView");
const bootView = document.querySelector("#bootView");
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
const branchOriginButton = document.querySelector("#branchOriginButton");
const mobileTitle = document.querySelector("#mobileTitle");
const dropHint = document.querySelector("#dropHint");
const composerCount = document.querySelector("#composerCount");
const composerHint = document.querySelector("#composerHint");
const capabilityButton = document.querySelector("#capabilityButton");
const capabilityPopover = document.querySelector("#capabilityPopover");
const skillSelectorList = document.querySelector("#skillSelectorList");
const selectedSkills = document.querySelector("#selectedSkills");
const capabilitySelectionCount = document.querySelector("#capabilitySelectionCount");
const capabilityToolContext = document.querySelector("#capabilityToolContext");
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
const appVersion = document.querySelector("#appVersion");
const copyDiagnosticsButton = document.querySelector("#copyDiagnosticsButton");
const feedbackDialog = document.querySelector("#feedbackDialog");
const feedbackForm = document.querySelector("#feedbackForm");

const LEGACY_STORAGE_KEY = "chatus.messages.v1";
const SESSIONS_STORAGE_PREFIX = "chatus.sessions.v3.";
const ACTIVE_SESSION_PREFIX = "chatus.activeSession.v3.";
const ROUTE_STORAGE_KEY = "chatus.route.v1";
const SESSION_SNAPSHOT_KEY = "chatus.sessionSnapshot.v1";
const MEMORY_STORAGE_PREFIX = "chatus.memory.v1.";
const MEMORY_DRAFT_PREFIX = "chatus.memoryDraft.v1.";
const DRAFT_STORAGE_PREFIX = "chatus.draft.v1.";
const MAX_ATTACHMENTS = 4;
const MAX_SESSIONS = 30;
const MAX_STORED_MESSAGES = 120;
const MAX_CONTEXT_MESSAGES = 40;
const CONTEXT_CHAR_BUDGET = 14000;
const MAX_SELECTED_SKILLS = 3;
const MAX_TOOL_EVENTS = 16;
const MAX_TOOL_ARGUMENT_SUMMARY_CHARS = 500;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 2000;
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
let skills = [];
let tools = [];
let selectedRouteId = "";
let sessionFilter = "";
let isBusy = false;
let renderTimer = null;
const summaryInFlight = new Set();
let pendingSuggestion = "";
let memoryRevision = "";
let lastRouteUsed = "";
let cloudSyncEnabled = true;
const cloudSaveTimers = new Map();
let cloudSaveInFlight = false;
const cloudSaveQueue = new Map();
const deletedSessionIds = new Set();
let syncStatusText = "";
let hasUserSystemPrompt = false;
let statusToastTimer = null;
let pendingSessionDeletion = null;
let offlineMode = false;
let currentUsage = null;
let sessionExpired = false;
let lastRouteRefreshAt = 0;
let routeRefreshPromise = null;
let loginRetryTimer = null;
let clientRelease = null;
const pendingToolApprovals = new Map();

boot();
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";
  const code = accessCode.value.trim();
  if (!code) return;
  let retryAfter = 0;
  setLoginBusy(true);
  try {
    const response = await fetchWithTimeout("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      retryAfter = response.status === 429 ? readRetryAfter(response) : 0;
      loginStatus.textContent = retryAfter
        ? `尝试次数过多，请在 ${formatWaitTime(retryAfter)}后重试`
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
    if (retryAfter) startLoginRetryCountdown(retryAfter);
  }
});

settingsButton?.addEventListener("click", () => {
  syncThemeControls();
  loadClientRelease();
  settingsDialog?.showModal();
});
copyDiagnosticsButton?.addEventListener("click", () => copyDiagnostics());
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
promptInput.addEventListener("input", () => saveActiveDraft());
memoryInput.addEventListener("input", () => saveMemoryDraft());

document.querySelector("#logoutButton").addEventListener("click", async () => {
  if (isBusy) return showStatusToast("请先停止当前生成");
  const previousUser = currentUser;
  clearUserDrafts(previousUser);
  localStorage.removeItem(memoryStorageKey(previousUser));
  await fetchWithTimeout("/api/logout", { method: "POST" }).catch(() => null);
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
  if (offlineMode) return showStatusToast("离线只读模式下不能开始空白会话");
  if (isBusy) return showStatusToast("请先停止当前生成");
  if (!messages.length) return;
  if (!(await confirmAction({
    title: "开始空白会话？",
    description: "当前会话和全部消息会保留在历史记录中。",
    confirmLabel: "开始新会话",
  }))) return;
  const before = activeSessionId;
  createNewSession();
  if (activeSessionId !== before) showStatusToast("已开始空白会话，原会话保持不变");
});

document.querySelector("#exportButton")?.addEventListener("click", () => exportActiveSession());
exportAllButton?.addEventListener("click", () => exportAllSessions());
branchOriginButton?.addEventListener("click", () => {
  const parentId = getActiveSession().parentChatId;
  if (!parentId || !sessions.some((session) => session.id === parentId)) {
    return showStatusToast("原会话已删除或不在当前会话列表中");
  }
  activateSession(parentId);
});
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
  saveMemoryDraft();
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
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  messageList.scrollTo({ top: messageList.scrollHeight, behavior: reducedMotion || distance > 1600 ? "auto" : "smooth" });
  scrollBottomButton.classList.remove("has-new-content");
  requestAnimationFrame(() => updateScrollButton());
});
routeSelect.addEventListener("change", () => {
  selectRoute(routeSelect.value);
});
modelPickerTrigger?.addEventListener("click", () => toggleModelPicker());
modelPickerTrigger?.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  openModelPicker(event.key === "ArrowUp" ? "last" : "selected");
});
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
  } else if (event.key === "Tab") {
    closeModelPicker();
  }
});
toggleUserApiKey?.addEventListener("click", () => {
  const showing = userApiKeyInput.type === "text";
  userApiKeyInput.type = showing ? "password" : "text";
  toggleUserApiKey.title = showing ? "显示 API Key" : "隐藏 API Key";
  toggleUserApiKey.setAttribute("aria-label", toggleUserApiKey.title);
  setControlIcon(toggleUserApiKey, showing ? "eye" : "eye-off");
});
document.addEventListener("click", (event) => {
  if (modelPickerMenu && !modelPickerMenu.hidden && !event.target.closest(".model-picker")) closeModelPicker();
  if (capabilityPopover && !capabilityPopover.hidden && !event.target.closest(".composer-inner")) closeCapabilityPopover();
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
    if (capabilityPopover && !capabilityPopover.hidden) {
      closeCapabilityPopover();
      capabilityButton?.focus();
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
capabilityButton?.addEventListener("click", () => {
  if (capabilityPopover.hidden) openCapabilityPopover();
  else closeCapabilityPopover();
});
skillSelectorList?.addEventListener("change", (event) => {
  const input = event.target.closest("input[type='checkbox'][data-skill-id]");
  if (!input) return;
  updateSelectedSkills(input.dataset.skillId, input.checked);
});
selectedSkills?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-skill]");
  if (!button) return;
  updateSelectedSkills(button.dataset.removeSkill, false);
});
imageInput.addEventListener("change", async () => {
  await addImageFiles(imageInput.files);
  imageInput.value = "";
});
imageInputLabel?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (imageInput.disabled) return;
  imageInput.click();
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
  clearActiveDraft();
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
    const response = await fetchWithTimeout("/api/session");
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
  bootView.hidden = true;
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
  bootView.hidden = true;
  loginView.hidden = true;
  chatView.hidden = false;
  setOfflineMode(readOnlyOffline);
  let session = existingSession;
  if (!session) {
    const response = await fetchWithTimeout("/api/session");
    if (!response.ok) throw new Error("session_unavailable");
    session = await response.json();
  }
  currentUser = session.user || "friend";
  currentDisplayName = session.displayName || currentUser;
  routes = Array.isArray(session.routes) ? session.routes : [];
  skills = normalizePublicSkills(session.skills);
  tools = normalizePublicTools(session.tools);
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
  restoreSessionRoute(getActiveSession());
  renderCapabilitySelector();
  renderChatList();
  renderMessages(true);
  updateChatTitle();
  restoreActiveDraft();
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
        skills: normalizePublicSkills(session.skills ?? skills),
        tools: normalizePublicTools(session.tools ?? tools),
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
    const response = await fetchWithTimeout("/api/session");
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
  if (capabilityButton) capabilityButton.disabled = offlineMode || isBusy || !skills.length;
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

async function fetchWithTimeout(input, init = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  const forwardAbort = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) forwardAbort();
  else sourceSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !sourceSignal?.aborted) throw new Error("请求超时，请检查网络后重试");
    throw error;
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", forwardAbort);
  }
}

function readRetryAfter(response) {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

function formatWaitTime(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  return `约 ${Math.ceil(seconds / 3600)} 小时`;
}

function startLoginRetryCountdown(seconds) {
  if (loginRetryTimer) clearInterval(loginRetryTimer);
  const retryAt = Date.now() + seconds * 1000;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    if (!remaining) {
      clearInterval(loginRetryTimer);
      loginRetryTimer = null;
      setLoginBusy(false);
      loginStatus.textContent = "现在可以重新尝试";
      return;
    }
    setLoginBusy(true);
    loginSubmitButton.textContent = `请等待 ${remaining}s`;
  };
  tick();
  loginRetryTimer = setInterval(tick, 1000);
}

function syncThemeControls() {
  const preference = window.ChatusTheme?.getPreference?.() || "system";
  const labels = { system: "跟随系统", light: "浅色", dark: "深色" };
  if (themeSummary) themeSummary.textContent = labels[preference] || labels.system;
  for (const input of themeOptions?.querySelectorAll("input[name='theme']") || []) {
    input.checked = input.value === preference;
  }
}

async function loadClientRelease() {
  if (clientRelease) return renderClientRelease();
  try {
    const response = await fetchWithTimeout(`/release.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("release_unavailable");
    clientRelease = await response.json();
    renderClientRelease();
  } catch {
    if (appVersion) appVersion.textContent = "版本信息暂时不可用";
  }
}

function renderClientRelease() {
  if (!appVersion || !clientRelease) return;
  const commit = typeof clientRelease.commit === "string" ? clientRelease.commit.slice(0, 8) : "未知";
  const deployedAt = Date.parse(clientRelease.deployedAt || "");
  const time = Number.isFinite(deployedAt)
    ? new Date(deployedAt).toLocaleString("zh-CN", { hour12: false })
    : "时间未知";
  appVersion.textContent = `版本 ${commit} · ${time}`;
}

async function copyDiagnostics() {
  await loadClientRelease();
  const route = getSelectedRoute();
  const commit = typeof clientRelease?.commit === "string" ? clientRelease.commit.slice(0, 8) : "unknown";
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ? "yes" : "no";
  const lines = [
    "Chatus 诊断信息",
    `版本: ${commit}`,
    `用户: ${currentUser || "unknown"}`,
    `线路: ${route?.id || "none"} / ${route?.model || "unknown"}`,
    `线路状态: ${route?.healthStatus || "unknown"}`,
    `网络: ${navigator.onLine ? "online" : "offline"}${offlineMode ? " / read-only" : ""}`,
    `PWA: ${standalone} / worker-${navigator.serviceWorker?.controller ? "active" : "inactive"}`,
    `会话数: ${sessions.length}`,
    `视口: ${window.innerWidth}x${window.innerHeight}`,
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showStatusToast("诊断信息已复制");
  } catch {
    showStatusToast("复制失败，请检查浏览器剪贴板权限");
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
      chatId: getActiveSession().id,
      skillIds: getActiveSession().skillIds,
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
    usedRoute = response.headers.get("X-Chatus-Route") || selectedRouteId;
    lastRouteUsed = usedRoute;
    assistantMessage.routeId = usedRoute;
    assistantMessage.fallback = Boolean(usedRoute && usedRoute !== selectedRouteId);
    if (usedRoute && usedRoute !== selectedRouteId) {
      setSyncStatus(`已 fallback 到 ${routeLabelById(usedRoute)}`);
    }
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      if (data.reset === "daily" && remaining !== null) updateUsage({ remaining: 0, limit: currentUsage?.limit });
      const retryAfter = readRetryAfter(response);
      const message = response.status === 429 && retryAfter
        ? data.reset === "daily"
          ? "今日额度已用完，请在明日额度重置后重试"
          : `请求过于频繁，请在 ${formatWaitTime(retryAfter)}后重试`
        : data.message || formatError(data.error || "request_failed");
      throw new Error(`${message}${requestReference(response)}`);
    }
    if (remaining !== null) updateUsage({ remaining: Number(remaining), limit: currentUsage?.limit });
    const capabilityStream = response.headers.get("X-Chatus-Stream") === "capability-v1";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let capabilityError = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (capabilityStream) {
          const event = parseCapabilityStreamLine(line);
          if (!event) continue;
          const result = applyCapabilityStreamEvent(event, assistantMessage);
          received = received || result.received;
          capabilityError = result.error || capabilityError;
          continue;
        }
        const chunk = parseStreamLine(line);
        if (chunk.finishReason) assistantMessage.finishReason = chunk.finishReason;
        if (!chunk.text) continue;
        received = true;
        assistantMessage.content += chunk.text;
        scheduleRender();
      }
    }
    if (capabilityStream && buffer.trim()) {
      const event = parseCapabilityStreamLine(buffer);
      if (event) {
        const result = applyCapabilityStreamEvent(event, assistantMessage);
        received = received || result.received;
        capabilityError = result.error || capabilityError;
      }
    }
    flushRender(true);
    saveMessages();
    saveSessions({ immediate: true });
    if (capabilityError) throw capabilityError;
  } catch (error) {
    flushRender(true);
    if (error.name === "AbortError") {
      if (!String(assistantMessage.content || "").trim() && !assistantMessage.toolEvents?.length) {
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
    finalizePendingToolEvents(assistantMessage);
    saveMessages();
    abortController = null;
    setBusy(false);
    updateConnectionState();
  }
}

async function loadMemory(options = {}) {
  if (options.offline) {
    const draft = localStorage.getItem(memoryDraftStorageKey());
    memoryInput.value = draft ?? localStorage.getItem(memoryStorageKey()) ?? "";
    memoryStatus.textContent = draft !== null ? "已恢复未保存修改" : memoryInput.value ? "本地缓存" : "离线不可用";
    return;
  }
  memoryStatus.textContent = "读取中";
  saveMemoryButton.disabled = true;
  if (suggestMemoryButton) suggestMemoryButton.disabled = true;
  try {
    const response = await fetchWithTimeout("/api/memory");
    if (handleUnauthorizedResponse(response)) return;
    if (!response.ok) throw new Error("load_failed");
    const data = await response.json();
    memoryRevision = data.revision || "";
    memoryInput.maxLength = Number(data.maxChars) || 4000;
    const savedMemory = data.memory || "";
    localStorage.setItem(memoryStorageKey(), savedMemory);
    const draft = localStorage.getItem(memoryDraftStorageKey());
    if (draft !== null && draft !== savedMemory) {
      memoryInput.value = draft;
      memoryStatus.textContent = "已恢复未保存修改";
    } else {
      memoryInput.value = savedMemory;
      localStorage.removeItem(memoryDraftStorageKey());
      memoryStatus.textContent = memoryInput.value ? "已加载" : "空";
    }
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
    const response = await fetchWithTimeout("/api/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory: memoryInput.value, expectedRevision: memoryRevision }),
    });
    if (handleUnauthorizedResponse(response)) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "保存失败");
    memoryRevision = data.revision || memoryRevision;
    memoryInput.value = data.memory || "";
    localStorage.setItem(memoryStorageKey(), memoryInput.value);
    localStorage.removeItem(memoryDraftStorageKey());
    memoryStatus.textContent = "已保存";
  } catch (error) {
    memoryStatus.textContent = error.message || "保存失败";
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
    const response = await fetchWithTimeout("/api/memory/suggest", {
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
    const response = await fetchWithTimeout("/api/chats");
    if (handleUnauthorizedResponse(response)) throw new Error("session_expired");
    if (!response.ok) throw new Error("cloud_list_failed");
    const data = await response.json();
    const remote = normalizeSessions(data.chats || []);

    if (!remote.length && local.length) {
      const migrate = await fetchWithTimeout("/api/chats/migrate", {
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
        await fetchWithTimeout("/api/chats/migrate", {
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
      routeId: typeof item.routeId === "string" ? item.routeId : "",
      parentChatId: typeof item.parentChatId === "string" ? item.parentChatId : "",
      skillIds: normalizeSelectedSkillIds(item.skillIds),
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
    finishReason: typeof item.finishReason === "string" ? item.finishReason : "",
    toolEvents: item.role === "assistant" ? normalizeToolEvents(item.toolEvents) : [],
    createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
  };
}

function normalizeSelectedSkillIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item && item.length <= 80))]
    .slice(0, MAX_SELECTED_SKILLS);
}

function normalizeToolEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_TOOL_EVENTS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item.source === "builtin" || item.source === "mcp" ? item.source : "";
    const status = ["pending", "approved", "running", "completed", "failed", "denied"].includes(item.status)
      ? item.status
      : "";
    const id = boundedIdentifier(item.id, 100);
    const toolId = boundedIdentifier(item.toolId, 160);
    const label = boundedText(item.label, 80);
    if (!id || !toolId || !label || !source || !status) return [];
    const interrupted = status === "pending" || status === "approved" || status === "running";
    const createdAt = Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now();
    const argumentSummary = boundedText(item.argumentSummary, MAX_TOOL_ARGUMENT_SUMMARY_CHARS);
    const resultPreview = boundedText(item.resultPreview, MAX_TOOL_RESULT_PREVIEW_CHARS);
    const contentTruncated =
      (typeof item.argumentSummary === "string" && item.argumentSummary.trim().length > argumentSummary.length) ||
      (typeof item.resultPreview === "string" && item.resultPreview.trim().length > resultPreview.length);
    return [{
      id,
      toolId,
      label,
      source,
      status: interrupted ? "failed" : status,
      argumentSummary,
      resultPreview,
      confirmation: item.confirmation === "once" || item.confirmation === "conversation" ? item.confirmation : "",
      errorCode: interrupted ? "interrupted" : boundedIdentifier(item.errorCode, 80),
      createdAt,
      updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : createdAt,
      truncated: item.truncated === true || contentTruncated,
    }];
  });
}

function normalizePublicSkills(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = boundedIdentifier(item.id, 80);
    const label = boundedText(item.label, 80);
    if (!id || !label) return [];
    return [{
      id,
      label,
      description: boundedText(item.description, 500),
      toolIds: Array.isArray(item.toolIds)
        ? [...new Set(item.toolIds.map((toolId) => boundedIdentifier(toolId, 160)).filter(Boolean))].slice(0, 200)
        : [],
    }];
  });
}

function normalizePublicTools(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = boundedIdentifier(item.id, 160);
    const label = boundedText(item.label, 80);
    const source = item.source === "builtin" || item.source === "mcp" ? item.source : "";
    const confirmation = ["auto", "first-per-conversation", "always"].includes(item.confirmation)
      ? item.confirmation
      : "first-per-conversation";
    if (!id || !label || !source) return [];
    return [{ id, label, description: boundedText(item.description, 1000), source, confirmation }];
  });
}

function renderCapabilitySelector() {
  const active = getActiveSession();
  const requestedIds = new Set(normalizeSelectedSkillIds(active.skillIds));
  const normalized = skills.map((skill) => skill.id).filter((skillId) => requestedIds.has(skillId)).slice(0, MAX_SELECTED_SKILLS);
  if (normalized.length !== active.skillIds.length || normalized.some((skillId, index) => active.skillIds[index] !== skillId)) {
    active.skillIds = normalized;
    active.updatedAt = Date.now();
    saveSessions({ skipCloud: offlineMode });
  }
  renderSelectedSkillLabels();
  renderSkillSelectorList();
  if (capabilityButton) {
    capabilityButton.disabled = offlineMode || isBusy || !skills.length;
    capabilityButton.classList.toggle("active", normalized.length > 0);
    capabilityButton.title = skills.length ? "选择 Skills" : "当前没有可用 Skills";
    capabilityButton.setAttribute("aria-label", capabilityButton.title);
  }
}

function renderSelectedSkillLabels() {
  if (!selectedSkills) return;
  selectedSkills.textContent = "";
  const activeIds = getActiveSession().skillIds || [];
  selectedSkills.hidden = !activeIds.length;
  for (const skillId of activeIds) {
    const skill = skills.find((item) => item.id === skillId);
    if (!skill) continue;
    const label = document.createElement("span");
    label.className = "selected-skill-label";
    label.append(document.createTextNode(skill.label));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.removeSkill = skillId;
    remove.title = `移除 ${skill.label}`;
    remove.setAttribute("aria-label", remove.title);
    remove.append(createIcon("x"));
    label.append(remove);
    selectedSkills.append(label);
  }
}

function renderSkillSelectorList() {
  if (!skillSelectorList) return;
  const activeIds = new Set(getActiveSession().skillIds || []);
  skillSelectorList.textContent = "";
  if (!skills.length) {
    const empty = document.createElement("p");
    empty.className = "skill-selector-empty";
    empty.textContent = "当前没有管理员启用的 Skill";
    skillSelectorList.append(empty);
  }
  for (const skill of skills) {
    const label = document.createElement("label");
    label.className = "skill-selector-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.skillId = skill.id;
    input.checked = activeIds.has(skill.id);
    input.disabled = !input.checked && activeIds.size >= MAX_SELECTED_SKILLS;
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = skill.label;
    const description = document.createElement("small");
    description.textContent = skill.description || "会将该 Skill 的工作方式加入本会话";
    copy.append(title, description);
    label.append(input, copy);
    skillSelectorList.append(label);
  }
  if (capabilitySelectionCount) capabilitySelectionCount.textContent = `${activeIds.size}/${MAX_SELECTED_SKILLS}`;
  renderCapabilityToolContext();
}

function renderCapabilityToolContext() {
  if (!capabilityToolContext) return;
  const selected = new Set(getActiveSession().skillIds || []);
  const toolIds = new Set(skills.filter((skill) => selected.has(skill.id)).flatMap((skill) => skill.toolIds));
  const activeTools = tools.filter((tool) => toolIds.has(tool.id));
  capabilityToolContext.textContent = activeTools.length
    ? `可用工具：${activeTools.map((tool) => tool.label).join("、")}`
    : selected.size ? "所选 Skill 不会启用额外工具" : "选择 Skill 后可查看它会使用的工具";
}

function updateSelectedSkills(skillId, checked) {
  const active = getActiveSession();
  const current = new Set(active.skillIds || []);
  if (checked && current.size >= MAX_SELECTED_SKILLS && !current.has(skillId)) {
    showStatusToast(`每个会话最多选择 ${MAX_SELECTED_SKILLS} 个 Skill`);
    return renderCapabilitySelector();
  }
  if (checked) current.add(skillId);
  else current.delete(skillId);
  active.skillIds = skills.map((skill) => skill.id).filter((id) => current.has(id)).slice(0, MAX_SELECTED_SKILLS);
  active.updatedAt = Date.now();
  saveSessions();
  renderCapabilitySelector();
}

function openCapabilityPopover() {
  if (!capabilityPopover || capabilityButton?.disabled) return;
  renderCapabilitySelector();
  capabilityPopover.hidden = false;
  capabilityButton.setAttribute("aria-expanded", "true");
  skillSelectorList.querySelector("input:not(:disabled)")?.focus();
}

function closeCapabilityPopover() {
  if (!capabilityPopover) return;
  capabilityPopover.hidden = true;
  capabilityButton?.setAttribute("aria-expanded", "false");
}

function boundedIdentifier(value, maxChars) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length <= maxChars && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(normalized) ? normalized : "";
}

function boundedText(value, maxChars) {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
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
    routeId: selectedRouteId,
    parentChatId: "",
    skillIds: [],
    messages: trimmedMessages,
  };
}

function createNewSession() {
  if (isBusy) return showStatusToast("请先停止当前生成");
  const reusable = sessions.find((session) => session.messages.length === 0 && !session.pinned);
  if (reusable) {
    activateSession(reusable.id);
    showStatusToast("已切换到空白会话");
    return;
  }
  if (sessions.length >= MAX_SESSIONS) {
    showStatusToast(`最多保留 ${MAX_SESSIONS} 个会话，请先删除不需要的会话`);
    return;
  }
  const session = createSession();
  sessions = [session, ...sessions];
  activeSessionId = session.id;
  messages = session.messages;
  restoreSessionRoute(session);
  attachments = [];
  restoreActiveDraft();
  hideMemorySuggest();
  saveSessions();
  renderChatList();
  renderMessages(true);
  renderAttachments();
  renderCapabilitySelector();
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
  if (isBusy && id !== activeSessionId) return showStatusToast("请先停止当前生成");
  const targetMessageId = searchQuery ? findSearchMessageId(session, searchQuery) : "";
  activeSessionId = id;
  messages = session.messages;
  restoreSessionRoute(session);
  attachments = [];
  restoreActiveDraft();
  hideMemorySuggest();
  localStorage.setItem(activeSessionStorageKey(), id);
  renderAttachments();
  renderCapabilitySelector();
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
  if (isBusy && id === activeSessionId) return showStatusToast("请先停止当前生成");
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  if (!(await confirmAction({ title: "删除这个会话？", description: `“${session.title || "新会话"}”将从本地和云端移除。`, confirmLabel: "删除", destructive: true }))) return;
  if (pendingSessionDeletion) await commitPendingSessionDeletion();
  const wasActive = activeSessionId === id;
  deletedSessionIds.add(id);
  cancelQueuedCloudSave(id);
  sessions = sessions.filter((session) => session.id !== id);
  if (!sessions.length) sessions = [createSession()];
  if (wasActive) {
    activeSessionId = sessions[0].id;
    messages = sessions[0].messages;
    restoreSessionRoute(sessions[0]);
    restoreActiveDraft();
  }
  saveSessionsLocalOnly();
  renderChatList();
  renderMessages(true);
  updateChatTitle();
  const timer = setTimeout(() => commitPendingSessionDeletion(), 6000);
  pendingSessionDeletion = { session, wasActive, timer };
  showUndoToast(`已删除“${session.title || "新会话"}”`, undoPendingSessionDeletion);
}

async function commitPendingSessionDeletion() {
  const pending = pendingSessionDeletion;
  if (!pending) return;
  pendingSessionDeletion = null;
  clearTimeout(pending.timer);
  removeDraft(currentUser, pending.session.id);
  if (!cloudSyncEnabled) return;
  try {
    const response = await fetchWithTimeout(
      `/api/chats?id=${encodeURIComponent(pending.session.id)}&expectedUpdatedAt=${encodeURIComponent(pending.session.updatedAt)}`,
      { method: "DELETE" },
    );
    if (handleUnauthorizedResponse(response)) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) restoreFailedSessionDeletion(pending, data.currentChat);
    else setSyncStatus("会话已删除");
  } catch {
    restoreFailedSessionDeletion(pending);
  }
}

function restoreFailedSessionDeletion(pending, currentChat = null) {
  deletedSessionIds.delete(pending.session.id);
  const restored = currentChat ? normalizeSessions([currentChat])[0] || pending.session : pending.session;
  sessions = [restored, ...sessions.filter((session) => session.id !== pending.session.id)]
    .sort(compareSessions)
    .slice(0, MAX_SESSIONS);
  saveSessionsLocalOnly();
  renderChatList();
  setSyncStatus(currentChat ? "会话已在其他设备更新，已恢复较新版本" : "云端删除失败，会话已恢复，请稍后重试");
}

function undoPendingSessionDeletion() {
  const pending = pendingSessionDeletion;
  if (!pending) return;
  pendingSessionDeletion = null;
  clearTimeout(pending.timer);
  deletedSessionIds.delete(pending.session.id);
  sessions = [pending.session, ...sessions.filter((session) => session.id !== pending.session.id)]
    .sort(compareSessions)
    .slice(0, MAX_SESSIONS);
  if (pending.wasActive) {
    activeSessionId = pending.session.id;
    messages = pending.session.messages;
    restoreSessionRoute(pending.session);
    renderCapabilitySelector();
    restoreActiveDraft();
  }
  saveSessionsLocalOnly();
  renderChatList();
  renderMessages(true);
  updateChatTitle();
  showStatusToast("删除已撤销");
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
  if (!cloudSyncEnabled || !chat || deletedSessionIds.has(chat.id)) return;
  const run = async () => {
    if (cloudSaveInFlight) {
      cloudSaveQueue.set(chat.id, chat);
      return;
    }
    cloudSaveInFlight = true;
    try {
      const response = await fetchWithTimeout("/api/chats", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat }),
      });
      if (handleUnauthorizedResponse(response)) return;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSyncStatus(data.message || "云端保存失败，已保留本地");
      } else {
        const data = await response.json().catch(() => ({}));
        if (data.accepted === false && data.currentChat) await preserveCloudConflict(chat, data.currentChat);
        else setSyncStatus("已同步到云端");
      }
    } catch {
      setSyncStatus("云端保存失败，已保留本地");
    } finally {
      cloudSaveInFlight = false;
      if (cloudSaveQueue.size) {
        const [nextId, nextChat] = cloudSaveQueue.entries().next().value;
        cloudSaveQueue.delete(nextId);
        queueCloudSave(nextChat, true);
      }
    }
  };

  if (immediate) {
    const timer = cloudSaveTimers.get(chat.id);
    if (timer) {
      clearTimeout(timer);
      cloudSaveTimers.delete(chat.id);
    }
    run();
    return;
  }

  const existingTimer = cloudSaveTimers.get(chat.id);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    cloudSaveTimers.delete(chat.id);
    run();
  }, 500);
  cloudSaveTimers.set(chat.id, timer);
}

function cancelQueuedCloudSave(chatId) {
  const timer = cloudSaveTimers.get(chatId);
  if (timer) clearTimeout(timer);
  cloudSaveTimers.delete(chatId);
  cloudSaveQueue.delete(chatId);
}

async function preserveCloudConflict(localChat, remoteValue) {
  const remoteChat = normalizeSessions([remoteValue])[0];
  if (!remoteChat) {
    setSyncStatus("其他设备已有更新，本次未覆盖云端版本");
    return;
  }
  const copy = normalizeSessions([{
    ...localChat,
    id: createId(),
    title: `${localChat.title || "新会话"}（此设备副本）`.slice(0, 60),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }])[0];
  if (!copy) return;

  sessions = [copy, remoteChat, ...sessions.filter((item) => item.id !== localChat.id)]
    .sort(compareSessions)
    .slice(0, MAX_SESSIONS);
  if (activeSessionId === localChat.id) {
    activeSessionId = copy.id;
    messages = copy.messages;
  }
  saveSessionsLocalOnly();
  renderChatList();
  renderMessages(false);
  updateChatTitle();

  const response = await fetchWithTimeout("/api/chats", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat: copy }),
  }).catch(() => null);
  if (response && handleUnauthorizedResponse(response)) return;
  setSyncStatus(response?.ok
    ? "检测到多设备更新，已保留云端版本并创建此设备副本"
    : "检测到多设备更新，此设备副本已保留在本机");
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

function showUndoToast(text, onUndo) {
  if (!statusToast) return;
  if (statusToastTimer) clearTimeout(statusToastTimer);
  statusToast.textContent = "";
  const label = document.createElement("span");
  label.textContent = text;
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "撤销";
  undo.addEventListener("click", onUndo, { once: true });
  statusToast.append(label, undo);
  statusToast.hidden = false;
  statusToastTimer = setTimeout(() => {
    statusToast.hidden = true;
    statusToastTimer = null;
  }, 6000);
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
function memoryDraftStorageKey(user = currentUser) {
  return `${MEMORY_DRAFT_PREFIX}${encodeURIComponent(user || "friend")}`;
}
function activeSessionStorageKey() {
  return `${ACTIVE_SESSION_PREFIX}${encodeURIComponent(currentUser || "friend")}`;
}
function draftStorageKey(user = currentUser, sessionId = activeSessionId) {
  return `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(user || "friend")}.${encodeURIComponent(sessionId || "new")}`;
}
function saveActiveDraft() {
  if (!currentUser || !activeSessionId) return;
  const value = promptInput.value.slice(0, 12000);
  try {
    if (value) localStorage.setItem(draftStorageKey(), value);
    else localStorage.removeItem(draftStorageKey());
  } catch {}
}
function saveMemoryDraft() {
  if (!currentUser) return;
  const maxChars = Number(memoryInput.maxLength) > 0 ? Number(memoryInput.maxLength) : 4000;
  const value = memoryInput.value.slice(0, maxChars);
  try {
    if (value) localStorage.setItem(memoryDraftStorageKey(), value);
    else localStorage.removeItem(memoryDraftStorageKey());
  } catch {}
}
function restoreActiveDraft() {
  try {
    promptInput.value = localStorage.getItem(draftStorageKey()) || "";
  } catch {
    promptInput.value = "";
  }
  autoResizePrompt();
  updateComposerMeta();
}
function clearActiveDraft() {
  removeDraft(currentUser, activeSessionId);
}
function removeDraft(user, sessionId) {
  if (!user || !sessionId) return;
  try {
    localStorage.removeItem(draftStorageKey(user, sessionId));
  } catch {}
}
function clearUserDrafts(user) {
  if (!user) return;
  const prefix = `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(user)}.`;
  try {
    localStorage.removeItem(memoryDraftStorageKey(user));
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {}
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
  const providerGroups = new Map();
  for (const route of routes) {
    const label = route.label || route.id;
    if (!providerGroups.has(label)) providerGroups.set(label, []);
    providerGroups.get(label).push(route);
  }

  let groupIndex = 0;
  for (const [label, providerRoutes] of providerGroups) {
    const nativeGroup = document.createElement("optgroup");
    nativeGroup.label = label;
    const group = document.createElement("div");
    group.className = "model-provider-group";
    group.setAttribute("role", "group");
    const heading = document.createElement("span");
    heading.className = "model-provider-heading";
    heading.id = `model-provider-${groupIndex++}`;
    heading.textContent = label;
    group.setAttribute("aria-labelledby", heading.id);
    group.append(heading);

    for (const route of providerRoutes) {
      const option = document.createElement("option");
      option.value = route.id;
      option.textContent = route.model || route.id;
      nativeGroup.append(option);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `model-option${route.id === selectedRouteId ? " selected" : ""}`;
      button.id = `model-option-${encodeURIComponent(route.id).replace(/%/g, "-")}`;
      button.tabIndex = -1;
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
      meta.textContent = route.id;
      copy.append(name, meta);
      const badges = document.createElement("span");
      badges.className = "model-option-badges";
      if (route.supportsImages !== false) badges.append(modelBadge("图片"));
      if (route.supportsTools === true) badges.append(modelBadge("工具"));
      if (route.allowUserKey || route.requiresUserKey) badges.append(modelBadge(route.requiresUserKey ? "需 Key" : "可用 Key"));
      const healthLabel = route.healthStatus === "healthy"
        ? "近期真实任务正常"
        : route.healthStatus === "unhealthy"
          ? "近期真实任务异常"
          : "暂无真实任务记录";
      button.setAttribute("aria-label", `${route.model || label}，${label}，${healthLabel}`);
      badges.append(modelBadge(healthLabel, `health-${route.healthStatus || "unknown"}`));
      button.append(icon, copy, badges);
      button.addEventListener("click", () => {
        selectRoute(route.id);
        closeModelPicker();
        promptInput.focus();
      });
      group.append(button);
    }
    routeSelect.append(nativeGroup);
    modelPickerMenu.append(group);
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
  const route = routes.find((item) => item.id === routeId);
  if (!route) return;
  selectedRouteId = routeId;
  lastRouteUsed = "";
  routeSelect.value = routeId;
  localStorage.setItem(ROUTE_STORAGE_KEY, selectedRouteId);
  const active = sessions.find((session) => session.id === activeSessionId);
  if (active && active.routeId !== routeId) {
    active.routeId = routeId;
    active.updatedAt = Date.now();
    saveSessions();
  }
  renderRoutes();
  updateConnectionState();
  if (!messages.length) renderMessages(false);
  showStatusToast(route.healthStatus === "unhealthy"
    ? `已切换到 ${routeLabelById(routeId)} · 近期真实任务异常，失败时会尝试备用线路`
    : `已切换到 ${routeLabelById(routeId)}`);
}

function restoreSessionRoute(session) {
  const routeId = routes.some((route) => route.id === session?.routeId)
    ? session.routeId
    : chooseRoute(session?.routeId || "");
  if (!routeId) return;
  if (session && session.routeId !== routeId) session.routeId = routeId;
  if (routeId === selectedRouteId) return;
  selectedRouteId = routeId;
  lastRouteUsed = "";
  routeSelect.value = routeId;
  localStorage.setItem(ROUTE_STORAGE_KEY, routeId);
  renderRoutes();
  updateConnectionState();
}

function toggleModelPicker() {
  if (!modelPickerMenu || modelPickerTrigger.disabled) return;
  if (modelPickerMenu.hidden) openModelPicker();
  else closeModelPicker();
}

function openModelPicker(focusTarget = "selected") {
  if (!modelPickerMenu || modelPickerTrigger.disabled) return;
  modelPickerMenu.hidden = false;
  modelPickerTrigger.setAttribute("aria-expanded", "true");
  const options = [...modelPickerMenu.querySelectorAll(".model-option")];
  const target = focusTarget === "last"
    ? options.at(-1)
    : options.find((option) => option.classList.contains("selected")) || options[0];
  target?.focus();
  refreshRouteState();
}

function refreshRouteState() {
  if (offlineMode || sessionExpired || Date.now() - lastRouteRefreshAt < 60_000) return routeRefreshPromise;
  if (routeRefreshPromise) return routeRefreshPromise;
  routeRefreshPromise = fetchWithTimeout("/api/session", { cache: "no-store" })
    .then(async (response) => {
      if (handleUnauthorizedResponse(response)) return;
      if (!response.ok) return;
      const session = await response.json();
      const nextRoutes = Array.isArray(session.routes) ? session.routes : [];
      routes = nextRoutes;
      skills = normalizePublicSkills(session.skills);
      tools = normalizePublicTools(session.tools);
      if (!routes.some((route) => route.id === selectedRouteId)) selectedRouteId = chooseRoute(session.defaultRoute);
      hasUserSystemPrompt = Boolean(session.hasUserSystemPrompt);
      updateUsage(session.usage);
      renderRoutes();
      renderCapabilitySelector();
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
  updateImageInputState();
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
  if (capabilityButton) {
    capabilityButton.disabled = offlineMode || isBusy || !skills.length;
    capabilityButton.classList.toggle("route-unsupported", route?.supportsTools !== true);
    capabilityButton.title = !skills.length
      ? "当前没有可用 Skills"
      : route?.supportsTools === true
        ? "选择 Skills"
        : "选择 Skills；当前模型不会执行工具";
    capabilityButton.setAttribute("aria-label", capabilityButton.title);
  }
}

function updateImageInputState() {
  const supportsImages = getSelectedRoute()?.supportsImages !== false;
  const disabled = offlineMode || !supportsImages || isBusy;
  const label = offlineMode
    ? "离线模式下不能添加图片"
    : isBusy
      ? "生成中不能添加图片"
      : supportsImages
        ? "添加图片"
        : "当前线路不支持图片";
  imageInput.disabled = disabled;
  imageInputLabel.classList.toggle("disabled", disabled);
  imageInputLabel.title = label;
  imageInputLabel.setAttribute("aria-label", label);
  imageInputLabel.setAttribute("aria-disabled", String(disabled));
}

function getSelectedRoute() {
  return routes.find((route) => route.id === selectedRouteId) || null;
}
function routeLabelById(id) {
  return routes.find((route) => route.id === id)?.label || id;
}
function updateConnectionState(prefix) {
  const route = getSelectedRoute();
  connectionState.classList.remove("route-unhealthy", "route-unknown");
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
  if (route?.healthStatus === "unhealthy" && !lastRouteUsed) {
    connectionState.classList.add("route-unhealthy");
    connectionState.textContent = `近期任务异常 · ${label || route.id}${promptMark}`;
    return;
  }
  if (route?.healthStatus === "unknown" && !lastRouteUsed) {
    connectionState.classList.add("route-unknown");
    connectionState.textContent = label ? `暂无任务记录 · ${label}${promptMark}` : `暂无任务记录${promptMark}`;
    return;
  }
  connectionState.textContent = label ? `已连接 · ${label}${promptMark}` : `已连接${promptMark}`;
}
function parseStreamLine(line) {
  if (!line.startsWith("data:")) return { text: "", finishReason: "" };
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return { text: "", finishReason: "" };
  try {
    const json = JSON.parse(data);
    const choice = json.choices?.[0] || {};
    return {
      text: choice.delta?.content || choice.message?.content || "",
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
    };
  } catch {
    return { text: "", finishReason: "" };
  }
}
function parseCapabilityStreamLine(line) {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data) return null;
  try {
    const event = JSON.parse(data);
    return event && typeof event === "object" && typeof event.type === "string" ? event : null;
  } catch {
    return null;
  }
}
function applyCapabilityStreamEvent(event, assistantMessage) {
  if (event.type === "run") {
    if (typeof event.routeId === "string" && event.routeId) {
      assistantMessage.routeId = event.routeId;
      assistantMessage.fallback = event.fallback === true;
    }
    return { received: false, error: null };
  }
  if (event.type === "assistant_delta") {
    const text = typeof event.text === "string" ? event.text : "";
    if (text) {
      assistantMessage.content += text;
      scheduleRender();
    }
    return { received: Boolean(text), error: null };
  }
  if (event.type === "finish") {
    assistantMessage.finishReason = typeof event.finishReason === "string" ? event.finishReason : "";
    return { received: false, error: null };
  }
  if (event.type === "tool" || event.type === "confirmation_required") {
    const normalized = normalizeActiveToolEvent(event.event);
    if (!normalized) return { received: false, error: null };
    upsertAssistantToolEvent(assistantMessage, normalized);
    if (event.type === "confirmation_required" && typeof event.runId === "string" && typeof event.callId === "string") {
      pendingToolApprovals.set(normalized.id, {
        runId: event.runId,
        callId: event.callId,
        messageId: assistantMessage.id,
        inFlight: false,
      });
    } else if (normalized.status !== "pending") {
      pendingToolApprovals.delete(normalized.id);
    }
    scheduleRender();
    return { received: true, error: null };
  }
  if (event.type === "error") {
    const activeEvent = [...(assistantMessage.toolEvents || [])].reverse().find((item) => ["pending", "approved", "running"].includes(item.status));
    if (activeEvent) {
      activeEvent.status = "failed";
      activeEvent.errorCode = boundedIdentifier(event.code, 80) || "tool_execution_failed";
      activeEvent.updatedAt = Date.now();
      pendingToolApprovals.delete(activeEvent.id);
      scheduleRender();
    }
    const error = new Error(typeof event.message === "string" ? event.message : "工具调用失败");
    error.code = typeof event.code === "string" ? event.code : "capability_failed";
    return { received: false, error };
  }
  return { received: false, error: null };
}
function normalizeActiveToolEvent(item) {
  if (!item || typeof item !== "object") return null;
  const source = item.source === "builtin" || item.source === "mcp" ? item.source : "";
  const status = ["pending", "approved", "running", "completed", "failed", "denied"].includes(item.status) ? item.status : "";
  const id = boundedIdentifier(item.id, 100);
  const toolId = boundedIdentifier(item.toolId, 160);
  const label = boundedText(item.label, 80);
  if (!id || !toolId || !label || !source || !status) return null;
  const createdAt = Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now();
  return {
    id,
    toolId,
    label,
    source,
    status,
    argumentSummary: boundedText(item.argumentSummary, MAX_TOOL_ARGUMENT_SUMMARY_CHARS),
    resultPreview: boundedText(item.resultPreview, MAX_TOOL_RESULT_PREVIEW_CHARS),
    confirmation: item.confirmation === "once" || item.confirmation === "conversation" ? item.confirmation : "",
    errorCode: boundedIdentifier(item.errorCode, 80),
    createdAt,
    updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : createdAt,
    truncated: item.truncated === true,
  };
}
function upsertAssistantToolEvent(message, event) {
  const current = Array.isArray(message.toolEvents) ? message.toolEvents : [];
  const index = current.findIndex((item) => item.id === event.id);
  if (index >= 0) current[index] = event;
  else current.push(event);
  message.toolEvents = current.slice(-MAX_TOOL_EVENTS);
}
function finalizePendingToolEvents(message) {
  if (!Array.isArray(message?.toolEvents)) return;
  let changed = false;
  message.toolEvents = message.toolEvents.map((event) => {
    pendingToolApprovals.delete(event.id);
    if (!["pending", "approved", "running"].includes(event.status)) return event;
    changed = true;
    return { ...event, status: "failed", errorCode: "interrupted", updatedAt: Date.now() };
  });
  if (changed) {
    saveMessages();
    renderMessages(true);
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
    let contentTarget = node;
    if (message.role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "message-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = "C";
      const header = document.createElement("div");
      header.className = "message-header";
      const author = document.createElement("strong");
      author.className = "message-author";
      author.textContent = "Chatus";
      header.append(author, createMessageMeta(message));
      const body = document.createElement("div");
      body.className = "message-body";
      const text = extractText(message.content);
      if (!text.trim()) body.append(document.createTextNode(isBusy && index === messages.length - 1 ? "…" : ""));
      else body.append(renderMarkdown(text));
      node.append(avatar, header);
      if (message.toolEvents?.length) node.append(renderToolTimeline(message));
      node.append(body);
    } else if (message.role === "error") {
      node.append(document.createTextNode(extractText(message.content) || "错误"));
    } else {
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      const body = document.createElement("div");
      body.className = "message-body";
      const text = extractText(message.content);
      if (text) body.append(document.createTextNode(text));
      bubble.append(body);
      node.append(bubble);
      contentTarget = bubble;
    }
    for (const image of extractImages(message.content)) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      contentTarget.append(img);
    }
    if (message.role === "user") contentTarget.append(createMessageMeta(message));
    const actions = document.createElement("div");
    actions.className = "message-actions";
    if (message.role === "assistant" || message.role === "user") actions.append(actionButton("copy", "复制", () => copyMessage(message)));
    if ((message.role === "assistant" || message.role === "user") && !isBusy && !offlineMode) {
      actions.append(actionButton("git-branch", "创建分支", () => branchConversationAt(index)));
    }
    if (message.role === "user" && !isBusy && !offlineMode) {
      actions.append(actionButton("pencil", "编辑消息", () => editUserMessage(index)));
      actions.append(actionButton("send-horizontal", "重新发送", () => resendFromUser(index)));
    }
    if (message.role === "assistant" && !isBusy && !offlineMode) {
      if (message.finishReason === "length") actions.append(actionButton("refresh-cw", "继续生成", () => continueAssistant(index)));
      actions.append(actionButton("thumbs-up", "有帮助", () => rateAssistant(message, "up"), message.rating === "up"));
      actions.append(actionButton("thumbs-down", "需要改进", () => rateAssistant(message, "down"), message.rating === "down"));
      actions.append(actionButton("rotate-cw", "重新生成", () => regenerateAssistant(index)));
    }
    if (message.role === "error" && !isBusy && !offlineMode) actions.append(actionButton("rotate-cw", "重试", () => retryLastFailed()));
    if (actions.childNodes.length) node.append(actions);
    messageList.append(node);
  });
  if (forceScroll || nearBottom) messageList.scrollTop = messageList.scrollHeight;
  updateScrollButton(!nearBottom && isBusy);
}

function renderToolTimeline(message) {
  const timeline = document.createElement("div");
  timeline.className = "tool-timeline";
  timeline.setAttribute("aria-label", "工具调用记录");
  for (const event of message.toolEvents || []) {
    const row = document.createElement("section");
    row.className = `tool-event tool-${event.status}`;
    const icon = document.createElement("span");
    icon.className = "tool-event-icon";
    icon.append(createIcon(toolEventIcon(event.status)));
    const copy = document.createElement("div");
    copy.className = "tool-event-copy";
    const heading = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = event.label;
    const status = document.createElement("span");
    status.textContent = toolEventStatusLabel(event);
    heading.append(label, status);
    copy.append(heading);
    if (event.argumentSummary) {
      const args = document.createElement("p");
      args.textContent = event.argumentSummary;
      copy.append(args);
    }
    if (event.resultPreview) {
      const result = document.createElement("pre");
      result.textContent = event.resultPreview;
      copy.append(result);
    }
    const approval = pendingToolApprovals.get(event.id);
    if (event.status === "pending" && approval) copy.append(renderToolApprovalActions(event.id, approval));
    row.append(icon, copy);
    timeline.append(row);
  }
  return timeline;
}

function toolEventIcon(status) {
  if (status === "completed") return "circle-check";
  if (status === "failed" || status === "denied") return "circle-x";
  if (status === "running" || status === "approved") return "loader-circle";
  return "clock-3";
}

function toolEventStatusLabel(event) {
  const labels = {
    pending: "等待确认",
    approved: event.confirmation === "conversation" ? "本会话已允许" : "已允许",
    running: "运行中",
    completed: event.truncated ? "已完成 · 预览已截断" : "已完成",
    denied: "已拒绝",
    failed: event.errorCode === "interrupted" ? "已中断" : "失败",
  };
  return labels[event.status] || event.status;
}

function renderToolApprovalActions(eventId, approval) {
  const actions = document.createElement("div");
  actions.className = "tool-approval-actions";
  const choices = [
    ["once", "仅本次", false],
    ["conversation", "本会话允许", false],
    ["deny", "拒绝", true],
  ];
  for (const [decision, label, destructive] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tool-approval-button${destructive ? " deny" : ""}`;
    button.textContent = label;
    button.disabled = approval.inFlight;
    button.addEventListener("click", () => resolveToolApproval(eventId, decision));
    actions.append(button);
  }
  return actions;
}

async function resolveToolApproval(eventId, decision) {
  const approval = pendingToolApprovals.get(eventId);
  if (!approval || approval.inFlight) return;
  approval.inFlight = true;
  renderMessages(false);
  try {
    const response = await fetchWithTimeout("/api/tool-approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify({ runId: approval.runId, callId: approval.callId, decision }),
    });
    if (handleUnauthorizedResponse(response)) return;
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "确认已失效，请重新发送消息");
    }
    pendingToolApprovals.delete(eventId);
    const message = messages.find((item) => item.id === approval.messageId);
    const event = message?.toolEvents?.find((item) => item.id === eventId);
    if (event) {
      event.status = decision === "deny" ? "denied" : "approved";
      event.confirmation = decision === "conversation" ? "conversation" : decision === "once" ? "once" : "";
      event.updatedAt = Date.now();
    }
    renderMessages(false);
  } catch (error) {
    approval.inFlight = false;
    showStatusToast(error.message || "工具确认失败");
    renderMessages(false);
  }
}

function createMessageMeta(message) {
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
  return meta;
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
  title.textContent = `今天想一起完成什么，${currentDisplayName || currentUser || "朋友"}？`;
  const copy = document.createElement("p");
  copy.textContent = route ? `${route.label || route.model || route.id} 已就绪，从一个具体任务开始吧。` : "从一个具体任务开始吧。";
  const suggestions = document.createElement("div");
  suggestions.className = "empty-suggestions";
  const prompts = [
    { icon: "list-checks", title: "梳理问题", prompt: "帮我梳理一个复杂问题，并列出下一步行动" },
    { icon: "file-search", title: "提炼重点", prompt: "阅读一段内容，提炼重点并给出改进建议" },
    { icon: "lightbulb", title: "设计方案", prompt: "为一个想法设计三种可执行的实现方案" },
    { icon: "code-xml", title: "检查优化", prompt: "检查一段代码或文字，找出问题并优化" },
  ];
  for (const item of prompts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "empty-suggestion";
    const iconWrap = document.createElement("span");
    iconWrap.className = "empty-suggestion-icon";
    iconWrap.append(createIcon(item.icon));
    const text = document.createElement("span");
    text.className = "empty-suggestion-copy";
    const heading = document.createElement("strong");
    heading.textContent = item.title;
    const prompt = document.createElement("span");
    prompt.textContent = item.prompt;
    text.append(heading, prompt);
    button.append(iconWrap, text);
    button.addEventListener("click", () => {
      promptInput.value = item.prompt;
      saveActiveDraft();
      autoResizePrompt();
      updateComposerMeta();
      promptInput.focus();
    });
    suggestions.append(button);
  }
  empty.append(mark, title, copy, suggestions);
  messageList.append(empty);
}

function actionButton(icon, label, onClick, active = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "msg-action";
  button.classList.toggle("active", active);
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(icon));
  button.addEventListener("click", onClick);
  return button;
}

function branchConversationAt(index) {
  if (offlineMode || isBusy) return;
  if (sessions.length >= MAX_SESSIONS) {
    return showStatusToast(`最多保留 ${MAX_SESSIONS} 个会话，请先删除一个会话再创建分支`);
  }
  const source = getActiveSession();
  const branchMessages = messages
    .slice(0, index + 1)
    .filter((message) => message.role !== "error")
    .map((message) => normalizeMessage(structuredClone(message)));
  if (!branchMessages.length) return showStatusToast("这里还不能创建分支");

  const now = Date.now();
  const baseTitle = source.title && source.title !== "新会话" ? source.title : deriveSessionTitle(branchMessages);
  const branch = {
    id: createId(),
    title: `${baseTitle.replace(/ · 分支(?: \d+)?$/, "").slice(0, 68)} · 分支`,
    createdAt: now,
    updatedAt: now,
    summary: "",
    summaryUntil: 0,
    pinned: false,
    routeId: source.routeId || selectedRouteId,
    parentChatId: source.id,
    skillIds: normalizeSelectedSkillIds(source.skillIds),
    messages: branchMessages,
  };
  sessions = [branch, ...sessions].sort(compareSessions);
  activeSessionId = branch.id;
  messages = branch.messages;
  attachments = [];
  localStorage.setItem(activeSessionStorageKey(), branch.id);
  restoreSessionRoute(branch);
  restoreActiveDraft();
  hideMemorySuggest();
  saveSessions({ immediate: true });
  renderAttachments();
  renderChatList();
  renderMessages(true);
  updateChatTitle();
  closeSidebar();
  showStatusToast("已创建对话分支，原会话保持不变");
  promptInput.focus();
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
    const response = await fetchWithTimeout("/api/feedback", {
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
  if (sessions.length >= MAX_SESSIONS) {
    return showStatusToast(`最多保留 ${MAX_SESSIONS} 个会话，请先删除一个会话再编辑历史消息`);
  }
  const next = await promptAction({
    title: "编辑消息",
    description: "将创建新的编辑分支并重新生成回答，原会话保持不变。",
    value: extractText(message.content),
    confirmLabel: "创建分支并重发",
    rows: 5,
  });
  if (next === null) return;
  if (!next.trim()) return showStatusToast("编辑后的消息不能为空");
  const source = getActiveSession();
  const images = extractImages(message.content).map((url, i) => ({ name: `image-${i + 1}`, url }));
  const now = Date.now();
  const editedMessages = messages.slice(0, index).map((item) => normalizeMessage(structuredClone(item)));
  editedMessages.push({ id: createId(), role: "user", content: buildUserContent(next.trim(), images), createdAt: now });
  const baseTitle = source.title && source.title !== "新会话" ? source.title : deriveSessionTitle(editedMessages);
  const branch = {
    id: createId(),
    title: `${baseTitle.replace(/ · 编辑$/, "").slice(0, 68)} · 编辑`,
    createdAt: now,
    updatedAt: now,
    summary: "",
    summaryUntil: 0,
    pinned: false,
    routeId: source.routeId || selectedRouteId,
    parentChatId: source.id,
    skillIds: normalizeSelectedSkillIds(source.skillIds),
    messages: editedMessages,
  };
  sessions = [branch, ...sessions].sort(compareSessions);
  activeSessionId = branch.id;
  messages = branch.messages;
  attachments = [];
  localStorage.setItem(activeSessionStorageKey(), branch.id);
  restoreSessionRoute(branch);
  restoreActiveDraft();
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderAttachments();
  renderMessages(true);
  updateChatTitle();
  closeSidebar();
  showStatusToast("已创建编辑分支，原会话保持不变");
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
  if (!createResponseBranch(index, "重发")) return;
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages(true);
  showStatusToast("已创建重发分支，原会话保持不变");
  streamChat(assistantMessage).then(() => maybeRefreshSummary());
}

function regenerateAssistant(index) {
  if (offlineMode) return;
  const message = messages[index];
  if (!message || message.role !== "assistant") return;
  let userIndex = index - 1;
  while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex -= 1;
  if (userIndex < 0) return;
  if (!createResponseBranch(userIndex, "重新生成")) return;
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages(true);
  showStatusToast("已创建重新生成分支，原会话保持不变");
  streamChat(assistantMessage).then(() => maybeRefreshSummary());
}

function continueAssistant(index) {
  if (offlineMode) return;
  const message = messages[index];
  if (!message || message.role !== "assistant" || message.finishReason !== "length") return;
  if (!createResponseBranch(index, "继续")) return;
  messages.push({
    id: createId(),
    role: "user",
    content: "请从刚才因长度限制而中断的位置继续，不要重复已经输出的内容。",
    createdAt: Date.now(),
  });
  const assistantMessage = { id: createId(), role: "assistant", content: "", createdAt: Date.now() };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages(true);
  showStatusToast("已创建继续生成分支，原会话保持不变");
  streamChat(assistantMessage).then(() => maybeRefreshSummary());
}

function createResponseBranch(endIndex, suffix) {
  if (sessions.length >= MAX_SESSIONS) {
    showStatusToast(`最多保留 ${MAX_SESSIONS} 个会话，请先删除一个会话再${suffix}`);
    return false;
  }
  const source = getActiveSession();
  const branchMessages = messages
    .slice(0, endIndex + 1)
    .filter((message) => message.role !== "error")
    .map((message) => normalizeMessage(structuredClone(message)));
  if (!branchMessages.length) return false;
  const now = Date.now();
  const baseTitle = source.title && source.title !== "新会话" ? source.title : deriveSessionTitle(branchMessages);
  const branch = {
    id: createId(),
    title: `${baseTitle.replace(new RegExp(` · ${suffix}$`), "").slice(0, 64)} · ${suffix}`,
    createdAt: now,
    updatedAt: now,
    summary: "",
    summaryUntil: 0,
    pinned: false,
    routeId: source.routeId || selectedRouteId,
    parentChatId: source.id,
    skillIds: normalizeSelectedSkillIds(source.skillIds),
    messages: branchMessages,
  };
  sessions = [branch, ...sessions].sort(compareSessions);
  activeSessionId = branch.id;
  messages = branch.messages;
  attachments = [];
  localStorage.setItem(activeSessionStorageKey(), branch.id);
  restoreSessionRoute(branch);
  restoreActiveDraft();
  renderAttachments();
  renderChatList();
  updateChatTitle();
  closeSidebar();
  return true;
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
  if (capabilityButton) capabilityButton.disabled = offlineMode || nextBusy || !skills.length;
  if (nextBusy) closeCapabilityPopover();
  userApiKeyInput.disabled = offlineMode || nextBusy;
  updateImageInputState();
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
    image_not_supported: "当前线路不支持图片",
    route_does_not_support_tools: "当前线路不支持工具调用",
    route_not_allowed: "这条线路不可用",
    request_failed: "请求失败",
    request_too_large: "请求内容太大",
    upstream_error: "上游线路暂时不可用",
    user_api_key_required: "需要填写 API Key",
    tool_arguments_invalid: "工具参数无效",
    tool_confirmation_timeout: "工具确认已超时，请重新发送",
    tool_denied: "工具调用已拒绝",
    tool_call_limit: "工具调用次数达到上限",
    tool_round_limit: "工具交互轮次达到上限",
    tool_time_budget_exceeded: "工具运行时间达到上限",
    tool_execution_failed: "工具执行失败",
    mcp_tool_changed: "远程工具定义已变化，需要管理员重新审核",
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
  // CSS field-sizing handles growth; this function remains as a compatibility hook for existing call sites.
}
function updateComposerMeta() {
  if (!composerCount) return;
  const textLen = promptInput.value.length;
  const attach = attachments.length;
  composerCount.textContent = attach ? `${textLen} 字 · ${attach} 图` : textLen ? `${textLen} 字` : "";
}
function updateChatTitle() {
  const active = getActiveSession();
  const title = active.title || "聊天";
  if (chatTitle) chatTitle.textContent = title;
  if (mobileTitle) mobileTitle.textContent = title;
  if (branchOriginButton) branchOriginButton.hidden = !active.parentChatId;
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
    lines.push(`## ${message.role === "user" ? "用户" : "助手"}`, "");
    if (message.role === "assistant" && message.toolEvents?.length) {
      lines.push("### 工具调用", "");
      for (const event of message.toolEvents) {
        lines.push(`- ${event.label}：${toolEventStatusLabel(event)}`);
        if (event.argumentSummary) lines.push(`  - 参数摘要：${event.argumentSummary.replace(/\s+/g, " ")}`);
        if (event.resultPreview) lines.push(`  - 结果预览：${event.resultPreview.replace(/\s+/g, " ")}`);
      }
      lines.push("");
    }
    lines.push(extractText(message.content) || "(空)", "");
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
    formatVersion: 4,
    exportedAt: new Date().toISOString(),
    release: clientRelease?.commit || "",
    user: currentUser,
    displayName: currentDisplayName,
    conversations: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
      summary: session.summary || "",
      summaryUntil: Number(session.summaryUntil) || 0,
      pinned: Boolean(session.pinned),
      routeId: session.routeId || "",
      parentChatId: session.parentChatId || "",
      skillIds: normalizeSelectedSkillIds(session.skillIds),
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
    const formatVersion = Number(payload.formatVersion || 1);
    if (!Number.isInteger(formatVersion) || formatVersion < 1) throw new Error("invalid_backup");
    if (formatVersion > 4) throw new Error("unsupported_backup_version");
    if (payload.conversations.length > MAX_SESSIONS) throw new Error("backup_session_limit");
    const imported = normalizeImportedSessions(payload.conversations);
    if (!imported.length) throw new Error("empty_backup");
    if (!(await confirmAction({
      title: `导入 ${imported.length} 个会话？`,
      description: describeBackupImport(payload),
      confirmLabel: "导入",
    }))) return;
    const byId = new Map(sessions.map((session) => [session.id, session]));
    for (const session of imported) {
      const existing = byId.get(session.id);
      if (!existing || session.updatedAt >= existing.updatedAt) byId.set(session.id, session);
    }
    if (byId.size > MAX_SESSIONS) throw new Error("merged_session_limit");
    const merged = [...byId.values()].sort(compareSessions);
    const response = await fetchWithTimeout("/api/chats/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chats: imported, mode: "restore" }),
    });
    if (handleUnauthorizedResponse(response)) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "cloud_import_failed");
    sessions = normalizeSessions(data.chats || []);
    if (!sessions.length) throw new Error("cloud_import_failed");
    activeSessionId = sessions[0].id;
    messages = sessions[0].messages;
    restoreActiveDraft();
    saveSessionsLocalOnly();
    renderChatList();
    renderMessages(true);
    updateChatTitle();
    settingsDialog?.close();
    showStatusToast(`已导入 ${imported.length} 个会话`);
  } catch (error) {
    const known = error.message === "invalid_backup" || error.message === "empty_backup";
    const capacityError = error.message === "backup_session_limit" || error.message === "merged_session_limit";
    showStatusToast(known
      ? "这不是有效的 Chatus 对话备份"
      : error.message === "unsupported_backup_version"
        ? "该备份来自更新版本的 Chatus，请更新页面后再导入"
        : capacityError
          ? `导入后会超过 ${MAX_SESSIONS} 个会话，请先删除部分会话`
          : error.message || "导入失败");
  } finally {
    importAllButton.disabled = false;
  }
}
function describeBackupImport(payload) {
  const sourceUser = typeof payload.user === "string" ? payload.user.trim().slice(0, 80) : "未知用户";
  const exportedAt = parseBackupTime(payload.exportedAt);
  const time = Number.isFinite(exportedAt)
    ? new Date(exportedAt).toLocaleString("zh-CN", { hour12: false })
    : "时间未知";
  const crossUser = sourceUser !== "未知用户" && sourceUser !== currentUser;
  return `来源：${sourceUser} · 导出：${time}${crossUser ? " · 跨用户导入" : ""}。备份会与当前会话合并，ID 相同的会话保留较新版本并同步到云端。`;
}
function normalizeImportedSessions(input) {
  const prepared = input.map((item) => {
    if (!item || typeof item !== "object") return null;
    const createdAt = parseBackupTime(item.createdAt);
    const updatedAt = parseBackupTime(item.updatedAt);
    return {
      ...item,
      id: typeof item.id === "string" && item.id ? item.id : createId(),
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Number.isFinite(createdAt) ? createdAt : Date.now(),
      summaryUntil: Number.isFinite(item.summaryUntil) ? Number(item.summaryUntil) : 0,
      routeId: typeof item.routeId === "string" ? item.routeId : "",
      parentChatId: typeof item.parentChatId === "string" ? item.parentChatId : "",
      skillIds: normalizeSelectedSkillIds(item.skillIds),
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
  if (isBusy) return showStatusToast("请先停止当前生成");
  if (!(await confirmAction({ title: "清除本机缓存？", description: "将移除当前设备保存的会话副本和离线页面缓存。重新联网后仍可从云端同步。", confirmLabel: "清除" }))) return;
  localStorage.removeItem(sessionsStorageKey());
  localStorage.removeItem(activeSessionStorageKey());
  localStorage.removeItem(memoryStorageKey());
  localStorage.removeItem(SESSION_SNAPSHOT_KEY);
  clearUserDrafts(currentUser);
  if ("caches" in window) await caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => null);
  settingsDialog?.close();
  showStatusToast("本机缓存已清理，当前会话仍保留在页面中");
}
async function logoutAllDevices() {
  if (offlineMode) return showStatusToast("需要联网才能退出所有设备");
  if (isBusy) return showStatusToast("请先停止当前生成");
  if (!(await confirmAction({ title: "退出所有设备？", description: "当前用户在所有浏览器和设备上的登录都会失效，对话和记忆不会被删除。", confirmLabel: "全部退出", destructive: true }))) return;
  logoutAllDevicesButton.disabled = true;
  try {
    const response = await fetchWithTimeout("/api/sessions/revoke-all", { method: "POST" });
    if (!response.ok) throw new Error("revoke_failed");
    localStorage.removeItem(SESSION_SNAPSHOT_KEY);
    clearUserDrafts(currentUser);
    localStorage.removeItem(memoryStorageKey());
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
  if (isBusy) return showStatusToast("请先停止当前生成");
  if (!(await confirmAction({ title: "永久删除全部数据？", description: "所有云端与本地对话、会话摘要和长期记忆都将被删除。此操作无法撤销。", confirmLabel: "永久删除", destructive: true }))) return;
  deleteUserDataButton.disabled = true;
  try {
    const response = await fetchWithTimeout("/api/user-data", { method: "DELETE" });
    if (handleUnauthorizedResponse(response)) return;
    if (!response.ok) throw new Error("delete_failed");
    localStorage.removeItem(sessionsStorageKey());
    localStorage.removeItem(activeSessionStorageKey());
    localStorage.removeItem(memoryStorageKey());
    localStorage.removeItem(SESSION_SNAPSHOT_KEY);
    clearUserDrafts(currentUser);
    sessions = [];
    activeSessionId = "";
    messages = [];
    memoryInput.value = "";
    memoryRevision = "";
    memoryStatus.textContent = "暂无长期记忆";
    settingsDialog?.close();
    currentUser = "";
    currentDisplayName = "";
    showLogin();
    loginStatus.textContent = "全部数据已永久删除，所有设备均已退出";
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
  const sessionId = active.id;
  if (summaryInFlight.has(sessionId)) return;
  const chatMessages = active.messages.filter((m) => m.role === "user" || m.role === "assistant");
  if (chatMessages.length < 6) return;
  if (chatMessages.length - (active.summaryUntil || 0) < SUMMARY_EVERY) return;
  const sliceStart = Math.max(0, (active.summaryUntil || 0) - 2);
  const batch = chatMessages.slice(sliceStart);
  if (batch.length < 4) return;
  summaryInFlight.add(sessionId);
  try {
    const payload = {
      messages: batch.map(({ role, content }) => ({ role, content })),
      previousSummary: active.summary || "",
      routeId: active.routeId || selectedRouteId,
    };
    const userApiKey = userApiKeyInput.value.trim();
    if (userApiKey) payload.userApiKey = userApiKey;
    const response = await fetchWithTimeout("/api/session-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chatus-Client": "web" },
      body: JSON.stringify(payload),
    });
    if (handleUnauthorizedResponse(response)) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.summary) {
      if (activeSessionId === sessionId) setSyncStatus(data.message || "摘要更新失败，将继续使用现有上下文");
      return;
    }
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return;
    target.summary = String(data.summary).trim();
    target.summaryUntil = chatMessages.length;
    target.updatedAt = Math.max(Date.now(), Number(target.updatedAt || 0) + 1);
    saveSessionsLocalOnly();
    queueCloudSave(target, true);
    renderChatList();
    if (activeSessionId === sessionId) setSyncStatus("会话摘要已更新");
  } catch {
    if (activeSessionId === sessionId) setSyncStatus("摘要更新失败，将继续使用现有上下文");
  } finally {
    summaryInFlight.delete(sessionId);
  }
}
