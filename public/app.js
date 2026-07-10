const loginView = document.querySelector("#loginView");
const chatView = document.querySelector("#chatView");
const loginForm = document.querySelector("#loginForm");
const loginStatus = document.querySelector("#loginStatus");
const accessCode = document.querySelector("#accessCode");
const userLabel = document.querySelector("#userLabel");
const usageText = document.querySelector("#usageText");
const messageList = document.querySelector("#messageList");
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
const memoryInput = document.querySelector("#memoryInput");
const saveMemoryButton = document.querySelector("#saveMemoryButton");
const memoryStatus = document.querySelector("#memoryStatus");

const LEGACY_STORAGE_KEY = "chatus.messages.v1";
const SESSIONS_STORAGE_PREFIX = "chatus.sessions.v2.";
const ACTIVE_SESSION_PREFIX = "chatus.activeSession.v2.";
const ROUTE_STORAGE_KEY = "chatus.route.v1";
const MAX_ATTACHMENTS = 4;
const MAX_SESSIONS = 20;
const MAX_STORED_MESSAGES = 80;
const MAX_CONTEXT_MESSAGES = 24;

let currentUser = "";
let sessions = [];
let activeSessionId = "";
let messages = [];
let attachments = [];
let abortController = null;
let routes = [];
let selectedRouteId = "";

boot();

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";
  const code = accessCode.value.trim();
  if (!code) return;

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    loginStatus.textContent = "访问码不可用";
    return;
  }

  accessCode.value = "";
  await showChat();
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  currentUser = "";
  sessions = [];
  activeSessionId = "";
  messages = [];
  attachments = [];
  renderMessages();
  renderAttachments();
  renderChatList();
  memoryInput.value = "";
  memoryStatus.textContent = "";
  showLogin();
});

document.querySelector("#newChatButton").addEventListener("click", () => {
  createNewSession();
  attachments = [];
  renderAttachments();
  promptInput.focus();
});

document.querySelector("#clearButton").addEventListener("click", () => {
  messages = [];
  saveMessages();
  renderMessages();
});

saveMemoryButton.addEventListener("click", () => {
  saveMemory();
});

routeSelect.addEventListener("change", () => {
  selectedRouteId = routeSelect.value;
  localStorage.setItem(ROUTE_STORAGE_KEY, selectedRouteId);
  updateRouteControls();
  updateConnectionState();
});

imageInput.addEventListener("change", async () => {
  const route = getSelectedRoute();
  if (route?.supportsImages === false) {
    imageInput.value = "";
    return;
  }

  const files = [...imageInput.files].slice(0, MAX_ATTACHMENTS - attachments.length);
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const dataUrl = await readFileAsDataUrl(file);
    attachments.push({ name: file.name, url: dataUrl });
  }
  imageInput.value = "";
  renderAttachments();
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 170)}px`;
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

stopButton.addEventListener("click", () => {
  abortController?.abort();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptInput.value.trim();
  const route = getSelectedRoute();
  if (!text && !attachments.length) return;
  if (!route) {
    showInlineError("没有可用线路");
    return;
  }
  if (route.requiresUserKey && !userApiKeyInput.value.trim()) {
    userApiKeyInput.focus();
    connectionState.textContent = "需要 API Key";
    return;
  }
  if (route.supportsImages === false && attachments.length) {
    showInlineError("当前线路不支持图片");
    return;
  }

  const userMessage = {
    role: "user",
    content: buildUserContent(text, attachments),
  };

  messages.push(userMessage);
  const assistantMessage = { role: "assistant", content: "" };
  messages.push(assistantMessage);
  saveMessages();
  renderMessages();

  promptInput.value = "";
  promptInput.style.height = "auto";
  attachments = [];
  renderAttachments();

  await streamChat(assistantMessage);
});

async function boot() {
  const response = await fetch("/api/session");
  if (response.ok) {
    await showChat(await response.json());
  } else {
    showLogin();
  }
}

function showLogin() {
  chatView.hidden = true;
  loginView.hidden = false;
  accessCode.focus();
}

async function showChat(existingSession) {
  loginView.hidden = true;
  chatView.hidden = false;
  const session = existingSession || (await (await fetch("/api/session")).json());
  currentUser = session.user || "friend";
  routes = Array.isArray(session.routes) ? session.routes : [];
  selectedRouteId = chooseRoute(session.defaultRoute);
  loadUserSessions();
  userLabel.textContent = currentUser;
  updateUsage(session.usage);
  renderRoutes();
  renderChatList();
  renderMessages();
  await loadMemory();
  updateConnectionState();
  promptInput.focus();
}

async function streamChat(assistantMessage) {
  setBusy(true);
  updateConnectionState("生成中");
  abortController = new AbortController();

  try {
    const payload = {
      messages: buildRequestMessages(assistantMessage),
      routeId: selectedRouteId,
    };
    const userApiKey = userApiKeyInput.value.trim();
    if (userApiKey) payload.userApiKey = userApiKey;

    const response = await fetch("/api/chat", {
      method: "POST",
      signal: abortController.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Chatus-Client": "web",
      },
      body: JSON.stringify(payload),
    });

    const remaining = response.headers.get("X-RateLimit-Remaining");
    if (remaining !== null) usageText.textContent = remaining;

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || formatError(data.error || "request_failed"));
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
        assistantMessage.content += chunk;
        saveMessages();
        renderMessages();
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      messages = messages.filter((message) => message !== assistantMessage);
      messages.push({ role: "error", content: error.message || "请求失败" });
      saveMessages();
      renderMessages();
    }
  } finally {
    abortController = null;
    setBusy(false);
    updateConnectionState();
  }
}

async function loadMemory() {
  memoryStatus.textContent = "读取中";
  saveMemoryButton.disabled = true;

  try {
    const response = await fetch("/api/memory");
    if (!response.ok) throw new Error("load_failed");
    const data = await response.json();
    memoryInput.maxLength = Number(data.maxChars) || 4000;
    memoryInput.value = data.memory || "";
    memoryStatus.textContent = memoryInput.value ? "已加载" : "空";
  } catch {
    memoryStatus.textContent = "读取失败";
  } finally {
    saveMemoryButton.disabled = false;
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
    if (!response.ok) throw new Error("save_failed");
    const data = await response.json();
    memoryInput.value = data.memory || "";
    memoryStatus.textContent = "已保存";
  } catch {
    memoryStatus.textContent = "保存失败";
  } finally {
    saveMemoryButton.disabled = false;
  }
}

function loadUserSessions() {
  sessions = loadSessions();
  activeSessionId = chooseActiveSessionId();
  messages = getActiveSession().messages;
}

function loadSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionsStorageKey()) || "[]");
    if (Array.isArray(parsed) && parsed.length) {
      return normalizeSessions(parsed);
    }
  } catch {
    // Fall through to legacy migration.
  }

  const legacyMessages = loadLegacyMessages();
  return [createSession(legacyMessages)];
}

function normalizeSessions(input) {
  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : createId(),
      title: typeof item.title === "string" && item.title.trim() ? item.title : "新会话",
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
      messages: Array.isArray(item.messages) ? item.messages.slice(-MAX_STORED_MESSAGES) : [],
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
}

function loadLegacyMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createSession(initialMessages = []) {
  const now = Date.now();
  const trimmedMessages = initialMessages.slice(-MAX_STORED_MESSAGES);
  return {
    id: createId(),
    title: deriveSessionTitle(trimmedMessages),
    createdAt: now,
    updatedAt: now,
    messages: trimmedMessages,
  };
}

function createNewSession() {
  const session = createSession();
  sessions = [session, ...sessions].slice(0, MAX_SESSIONS);
  activeSessionId = session.id;
  messages = session.messages;
  saveSessions();
  renderChatList();
  renderMessages();
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

function activateSession(id) {
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  activeSessionId = id;
  messages = session.messages;
  attachments = [];
  localStorage.setItem(activeSessionStorageKey(), id);
  renderAttachments();
  renderChatList();
  renderMessages();
  promptInput.focus();
}

function deleteSession(id) {
  sessions = sessions.filter((session) => session.id !== id);
  if (!sessions.length) sessions = [createSession()];
  if (activeSessionId === id) {
    activeSessionId = sessions[0].id;
    messages = sessions[0].messages;
  }
  saveSessions();
  renderChatList();
  renderMessages();
}

function saveMessages() {
  const active = getActiveSession();
  active.messages = messages.slice(-MAX_STORED_MESSAGES);
  active.title = deriveSessionTitle(active.messages);
  active.updatedAt = Date.now();
  sessions = [active, ...sessions.filter((session) => session.id !== active.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  messages = active.messages;
  activeSessionId = active.id;
  saveSessions();
  renderChatList();
}

function saveSessions() {
  localStorage.setItem(sessionsStorageKey(), JSON.stringify(sessions));
  if (activeSessionId) localStorage.setItem(activeSessionStorageKey(), activeSessionId);
}

function renderChatList() {
  chatList.textContent = "";
  if (!sessions.length) return;

  for (const session of sessions) {
    const item = document.createElement("div");
    item.className = `chat-list-item${session.id === activeSessionId ? " active" : ""}`;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "chat-list-main";
    open.textContent = session.title || "新会话";
    open.title = session.title || "新会话";
    open.addEventListener("click", () => activateSession(session.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chat-list-remove";
    remove.textContent = "x";
    remove.title = "删除会话";
    remove.addEventListener("click", () => deleteSession(session.id));

    item.append(open, remove);
    chatList.append(item);
  }
}

function sessionsStorageKey() {
  return `${SESSIONS_STORAGE_PREFIX}${encodeURIComponent(currentUser || "friend")}`;
}

function activeSessionStorageKey() {
  return `${ACTIVE_SESSION_PREFIX}${encodeURIComponent(currentUser || "friend")}`;
}

function createId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function deriveSessionTitle(inputMessages) {
  const firstUser = inputMessages.find((message) => message.role === "user");
  const text = firstUser ? extractText(firstUser.content).replace(/\s+/g, " ").trim() : "";
  if (!text) return "新会话";
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

function chooseRoute(defaultRoute) {
  const stored = localStorage.getItem(ROUTE_STORAGE_KEY);
  if (routes.some((route) => route.id === stored)) return stored;
  if (routes.some((route) => route.id === defaultRoute)) return defaultRoute;
  return routes[0]?.id || "";
}

function renderRoutes() {
  routeSelect.textContent = "";

  for (const route of routes) {
    const option = document.createElement("option");
    option.value = route.id;
    option.textContent = route.label || route.model || route.id;
    routeSelect.append(option);
  }

  routeSelect.value = selectedRouteId;
  routeSelect.disabled = routes.length <= 1;
  updateRouteControls();
}

function updateRouteControls() {
  const route = getSelectedRoute();
  const canUseOwnKey = Boolean(route?.allowUserKey || route?.requiresUserKey);
  userApiKeyLabel.hidden = !canUseOwnKey;
  userApiKeyInput.hidden = !canUseOwnKey;
  userApiKeyInput.required = Boolean(route?.requiresUserKey);
  if (!canUseOwnKey) userApiKeyInput.value = "";

  const supportsImages = route?.supportsImages !== false;
  imageInput.disabled = !supportsImages;
  imageInputLabel.classList.toggle("disabled", !supportsImages);
  imageInputLabel.title = supportsImages ? "添加图片" : "当前线路不支持图片";

  if (!supportsImages && attachments.length) {
    attachments = [];
    renderAttachments();
  }
}

function getSelectedRoute() {
  return routes.find((route) => route.id === selectedRouteId) || null;
}

function updateConnectionState(prefix = "已连接") {
  const route = getSelectedRoute();
  connectionState.textContent = route ? `${prefix} · ${route.label}` : prefix;
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
  for (const file of files) {
    content.push({ type: "image_url", image_url: { url: file.url } });
  }
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
  return recent;
}

function renderMessages() {
  messageList.textContent = "";

  for (const message of messages) {
    const node = document.createElement("article");
    node.className = `message ${message.role}`;
    const text = extractText(message.content);
    node.append(document.createTextNode(text || (message.role === "assistant" ? "..." : "")));

    for (const image of extractImages(message.content)) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      node.append(img);
    }

    messageList.append(node);
  }

  messageList.scrollTop = messageList.scrollHeight;
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
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      attachments.splice(index, 1);
      renderAttachments();
    });
    item.append(img, remove);
    attachmentRow.append(item);
  });
}

function extractText(content) {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function extractImages(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part.type === "image_url")
    .map((part) => part.image_url.url);
}

function setBusy(isBusy) {
  sendButton.hidden = isBusy;
  stopButton.hidden = !isBusy;
  promptInput.disabled = isBusy;
  routeSelect.disabled = isBusy || routes.length <= 1;
  userApiKeyInput.disabled = isBusy;
  imageInput.disabled = isBusy || getSelectedRoute()?.supportsImages === false;
}

function updateUsage(usage) {
  if (!usage) {
    usageText.textContent = "--";
    return;
  }
  usageText.textContent = `${usage.remaining}/${usage.limit}`;
}

function showInlineError(message) {
  messages.push({ role: "error", content: message });
  saveMessages();
  renderMessages();
}

function formatError(code) {
  const messagesByCode = {
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
  return messagesByCode[code] || code || "请求失败";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
