const loginView = document.querySelector("#loginView");
const chatView = document.querySelector("#chatView");
const loginForm = document.querySelector("#loginForm");
const loginStatus = document.querySelector("#loginStatus");
const accessCode = document.querySelector("#accessCode");
const userLabel = document.querySelector("#userLabel");
const usageText = document.querySelector("#usageText");
const messageList = document.querySelector("#messageList");
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

const STORAGE_KEY = "chatus.messages.v1";
const ROUTE_STORAGE_KEY = "chatus.route.v1";
const MAX_ATTACHMENTS = 4;

let messages = loadMessages();
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
  messages = [];
  attachments = [];
  saveMessages();
  renderMessages();
  renderAttachments();
  showLogin();
});

document.querySelector("#newChatButton").addEventListener("click", () => {
  messages = [];
  attachments = [];
  saveMessages();
  renderMessages();
  renderAttachments();
  promptInput.focus();
});

document.querySelector("#clearButton").addEventListener("click", () => {
  messages = [];
  saveMessages();
  renderMessages();
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
  routes = Array.isArray(session.routes) ? session.routes : [];
  selectedRouteId = chooseRoute(session.defaultRoute);
  userLabel.textContent = session.user || "";
  updateUsage(session.usage);
  renderRoutes();
  renderMessages();
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
  return messages.filter((message) => {
    if (message === pendingAssistantMessage || message.role === "error") return false;
    if (typeof message.content === "string") return Boolean(message.content.trim());
    return Array.isArray(message.content) && message.content.length > 0;
  });
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

function loadMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
