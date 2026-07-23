import { buildAdminReportCsv } from "./admin-report.js?v=development";

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

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
const exportReportButton = document.querySelector("#exportReportButton");
const adminLogoutButton = document.querySelector("#adminLogoutButton");
const statsDay = document.querySelector("#statsDay");
const statsList = document.querySelector("#statsList");
const metricsSummary = document.querySelector("#metricsSummary");
const metricsTrend = document.querySelector("#metricsTrend");
const routeMetrics = document.querySelector("#routeMetrics");
const releaseState = document.querySelector("#releaseState");
const releaseCommit = document.querySelector("#releaseCommit");
const releaseTime = document.querySelector("#releaseTime");
const releaseRoutes = document.querySelector("#releaseRoutes");
const releaseUsers = document.querySelector("#releaseUsers");
const diagnosticList = document.querySelector("#diagnosticList");
const auditList = document.querySelector("#auditList");
const feedbackSummary = document.querySelector("#feedbackSummary");
const feedbackList = document.querySelector("#feedbackList");
const attentionPanel = document.querySelector("#attentionPanel");
const attentionSummary = document.querySelector("#attentionSummary");
const attentionList = document.querySelector("#attentionList");
const userSystemPrompt = document.querySelector("#userSystemPrompt");
const userDisplayName = document.querySelector("#userDisplayName");
const userForm = document.querySelector("#userForm");
const userSelect = document.querySelector("#userSelect");
const newUserLabel = document.querySelector("#newUserLabel");
const userDefaultRoute = document.querySelector("#userDefaultRoute");
const userDailyLimit = document.querySelector("#userDailyLimit");
const userMinuteLimit = document.querySelector("#userMinuteLimit");
const userByok = document.querySelector("#userByok");
const userEnabled = document.querySelector("#userEnabled");
const allowedRoutesBox = document.querySelector("#allowedRoutesBox");
const allowedSkillsBox = document.querySelector("#allowedSkillsBox");
const allowedToolsBox = document.querySelector("#allowedToolsBox");
const deleteUserButton = document.querySelector("#deleteUserButton");
const revokeUserSessionsButton = document.querySelector("#revokeUserSessionsButton");
const createdAccessCode = document.querySelector("#createdAccessCode");
const createdAccessCodeInput = document.querySelector("#createdAccessCodeInput");
const copyCreatedAccessCode = document.querySelector("#copyCreatedAccessCode");
const providerForm = document.querySelector("#providerForm");
const providerAdminSelect = document.querySelector("#providerAdminSelect");
const providerIdInput = document.querySelector("#providerIdInput");
const providerLabelInput = document.querySelector("#providerLabelInput");
const providerTypeInput = document.querySelector("#providerTypeInput");
const providerBaseUrlInput = document.querySelector("#providerBaseUrlInput");
const providerKeyRefInput = document.querySelector("#providerKeyRefInput");
const providerSecretInput = document.querySelector("#providerSecretInput");
const saveProviderSecretButton = document.querySelector("#saveProviderSecretButton");
const deleteProviderSecretButton = document.querySelector("#deleteProviderSecretButton");
const providerSecretStatus = document.querySelector("#providerSecretStatus");
const providerConcurrencyInput = document.querySelector("#providerConcurrencyInput");
const providerMaxConcurrentInput = document.querySelector("#providerMaxConcurrentInput");
const providerQueueTimeoutInput = document.querySelector("#providerQueueTimeoutInput");
const providerPriorityInput = document.querySelector("#providerPriorityInput");
const providerImagesInput = document.querySelector("#providerImagesInput");
const providerToolsInput = document.querySelector("#providerToolsInput");
const providerAllowUserKeyInput = document.querySelector("#providerAllowUserKeyInput");
const providerRequiresKeyInput = document.querySelector("#providerRequiresKeyInput");
const providerEnabledInput = document.querySelector("#providerEnabledInput");
const providerDirectEndpointInput = document.querySelector("#providerDirectEndpointInput");
const providerStatus = document.querySelector("#providerStatus");
const fetchProviderModelsButton = document.querySelector("#fetchProviderModelsButton");
const deleteProviderButton = document.querySelector("#deleteProviderButton");
const routeEditorTabs = [...document.querySelectorAll("[data-route-editor-tab]")];
const providerEditorPanel = document.querySelector("#providerEditorPanel");
const routeEditorPanel = document.querySelector("#routeEditorPanel");
const routeForm = document.querySelector("#routeForm");
const routeAdminSelect = document.querySelector("#routeAdminSelect");
const routeIdInput = document.querySelector("#routeIdInput");
const routeLabelInput = document.querySelector("#routeLabelInput");
const routeFallbacksInput = document.querySelector("#routeFallbacksInput");
const routeImagesInput = document.querySelector("#routeImagesInput");
const routeToolsInput = document.querySelector("#routeToolsInput");
const routeEnabledInput = document.querySelector("#routeEnabledInput");
const routeAllowUserKeyInput = document.querySelector("#routeAllowUserKeyInput");
const routeRequiresKeyInput = document.querySelector("#routeRequiresKeyInput");
const routeOfferingsList = document.querySelector("#routeOfferingsList");
const routeOfferingStatus = document.querySelector("#routeOfferingStatus");
const addRouteOfferingButton = document.querySelector("#addRouteOfferingButton");
const legacyRoutePanel = document.querySelector("#legacyRoutePanel");
const legacyRouteType = document.querySelector("#legacyRouteType");
const legacyRouteBaseUrl = document.querySelector("#legacyRouteBaseUrl");
const legacyRouteModel = document.querySelector("#legacyRouteModel");
const legacyRouteKeyRef = document.querySelector("#legacyRouteKeyRef");
const migrateLegacyRouteButton = document.querySelector("#migrateLegacyRouteButton");
const legacyRouteStatus = document.querySelector("#legacyRouteStatus");
const deleteRouteButton = document.querySelector("#deleteRouteButton");
const accessCodesInput = document.querySelector("#accessCodesInput");
const accessEntryList = document.querySelector("#accessEntryList");
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
const healthAllRoutesButton = document.querySelector("#healthAllRoutesButton");
const routeHealthStatus = document.querySelector("#routeHealthStatus");
const routeHealthList = document.querySelector("#routeHealthList");
const providerModelDialog = document.querySelector("#providerModelDialog");
const providerModelDialogSummary = document.querySelector("#providerModelDialogSummary");
const providerModelSearchInput = document.querySelector("#providerModelSearchInput");
const providerModelList = document.querySelector("#providerModelList");
const providerModelPrefixInput = document.querySelector("#providerModelPrefixInput");
const providerModelSelectionStatus = document.querySelector("#providerModelSelectionStatus");
const batchAddOfferingsButton = document.querySelector("#batchAddOfferingsButton");
const adminNavItems = [...document.querySelectorAll("[data-admin-target]")];
const adminSections = [...document.querySelectorAll("[data-admin-section]")];
const adminPageTitle = document.querySelector("#adminPageTitle");
const adminDialog = document.querySelector("#adminDialog");
const adminDialogTitle = document.querySelector("#adminDialogTitle");
const adminDialogDescription = document.querySelector("#adminDialogDescription");
const adminDialogConfirm = document.querySelector("#adminDialogConfirm");
const capabilityTabs = [...document.querySelectorAll("[data-capability-tab]")];
const capabilitySkillsPanel = document.querySelector("#capabilitySkillsPanel");
const capabilityToolsPanel = document.querySelector("#capabilityToolsPanel");
const capabilityMcpPanel = document.querySelector("#capabilityMcpPanel");
const skillForm = document.querySelector("#skillForm");
const skillSelect = document.querySelector("#skillSelect");
const skillIdInput = document.querySelector("#skillIdInput");
const skillLabelInput = document.querySelector("#skillLabelInput");
const skillDescriptionInput = document.querySelector("#skillDescriptionInput");
const skillInstructionsInput = document.querySelector("#skillInstructionsInput");
const skillOrderInput = document.querySelector("#skillOrderInput");
const skillEnabledInput = document.querySelector("#skillEnabledInput");
const skillToolsBox = document.querySelector("#skillToolsBox");
const deleteSkillButton = document.querySelector("#deleteSkillButton");
const toolForm = document.querySelector("#toolForm");
const toolSelect = document.querySelector("#toolSelect");
const toolIdInput = document.querySelector("#toolIdInput");
const toolLabelInput = document.querySelector("#toolLabelInput");
const toolSourceInput = document.querySelector("#toolSourceInput");
const toolConfirmationInput = document.querySelector("#toolConfirmationInput");
const toolEnabledInput = document.querySelector("#toolEnabledInput");
const toolDescriptionInput = document.querySelector("#toolDescriptionInput");
const toolSchemaSummary = document.querySelector("#toolSchemaSummary");
const deleteToolButton = document.querySelector("#deleteToolButton");
const mcpForm = document.querySelector("#mcpForm");
const mcpSelect = document.querySelector("#mcpSelect");
const mcpIdInput = document.querySelector("#mcpIdInput");
const mcpLabelInput = document.querySelector("#mcpLabelInput");
const mcpEndpointInput = document.querySelector("#mcpEndpointInput");
const mcpAuthTypeInput = document.querySelector("#mcpAuthTypeInput");
const mcpSecretRefInput = document.querySelector("#mcpSecretRefInput");
const mcpEnabledInput = document.querySelector("#mcpEnabledInput");
const mcpSecretInput = document.querySelector("#mcpSecretInput");
const saveMcpSecretButton = document.querySelector("#saveMcpSecretButton");
const deleteMcpSecretButton = document.querySelector("#deleteMcpSecretButton");
const mcpSecretStatus = document.querySelector("#mcpSecretStatus");
const mcpDiscoverySummary = document.querySelector("#mcpDiscoverySummary");
const discoverMcpToolsButton = document.querySelector("#discoverMcpToolsButton");
const deleteMcpButton = document.querySelector("#deleteMcpButton");

const DEFAULT_USER = "__defaults";
const ADMIN_SECTION_KEY = "chatus.admin.section.v1";
const ADMIN_SECTION_TITLES = {
  overview: "概览",
  users: "用户管理",
  routes: "模型与服务商",
  capabilities: "AI 能力",
  access: "访问控制",
  advanced: "高级配置",
};

let config = { providers: {}, routes: {}, users: {}, defaults: {} };
let stats = null;
let accessLabels = [];
let routeHealth = {};
let feedbackEntries = [];
let coreHealth = null;
let selectedUser = DEFAULT_USER;
let selectedProvider = "";
let selectedRoute = "";
let currentRouteEditorTab = "providers";
let selectedSkill = "__new";
let selectedTool = "";
let selectedMcp = "__new";
let currentCapabilityTab = "skills";
let selectedMemoryUser = "";
let currentAdminSection = "overview";
let savedAccessCodes = "";
let savedMemory = "";
let memoryRevision = "";
let configRevision = "";
let accessRevision = "";
let routeSecrets = {};
let routeSecretMasterReady = false;
let routeSecretMasterMessage = "";
let mcpSecrets = {};
let mcpSecretMasterReady = false;
let mcpSecretMasterMessage = "";
let providerModelSuggestions = [];
let selectedProviderModels = new Set();
const dirtyScopes = new Set();

for (const item of adminNavItems) {
  item.addEventListener("click", async () => {
    const target = item.dataset.adminTarget;
    if (target === currentAdminSection) return;
    if (!(await confirmDiscardChanges("切换栏目"))) return;
    showAdminSection(target);
  });
}

for (const [element, scope] of [
  [userForm, "user"],
  [providerForm, "provider"],
  [routeForm, "route"],
  [skillForm, "capability"],
  [toolForm, "capability"],
  [mcpForm, "capability"],
  [accessCodesInput, "access"],
  [configJsonInput, "config"],
  [adminMemoryInput, "memory"],
]) {
  element?.addEventListener("input", (event) => {
    if (event.target !== providerSecretInput && event.target !== mcpSecretInput) markDirty(scope);
  });
  element?.addEventListener("change", (event) => {
    if (event.target !== providerSecretInput && event.target !== mcpSecretInput) markDirty(scope);
  });
}

window.addEventListener("beforeunload", (event) => {
  if (!dirtyScopes.size) return;
  event.preventDefault();
  event.returnValue = "";
});

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
  markDirty("access");
  renderAccessEntries();
  if (newAccessLabel) newAccessLabel.value = "";
  setStatus(`已为 ${label} 生成访问码，记得点击保存`);
});

loadMemoryButton?.addEventListener("click", () => loadAdminMemory());
saveMemoryAdminButton?.addEventListener("click", () => saveAdminMemory());
clearMemoryAdminButton?.addEventListener("click", async () => {
  if (!(await confirmAdminAction("清空长期记忆？", "该用户保存的长期记忆将被永久移除。", "清空"))) return;
  adminMemoryInput.value = "";
  await saveAdminMemory(true);
});
memoryUserSelect?.addEventListener("change", async () => {
  const next = memoryUserSelect.value;
  memoryUserSelect.value = selectedMemoryUser;
  if (!(await confirmDiscardChanges("切换记忆用户"))) return;
  memoryUserSelect.value = next;
  selectedMemoryUser = next;
  loadAdminMemory();
});
healthRouteButton?.addEventListener("click", () => checkRouteHealth());
healthAllRoutesButton?.addEventListener("click", () => checkAllRoutesHealth());
fetchProviderModelsButton?.addEventListener("click", () => fetchProviderModels());
providerModelSearchInput?.addEventListener("input", () => renderProviderModelList());
batchAddOfferingsButton?.addEventListener("click", () => addSelectedProviderOfferings());
saveProviderSecretButton?.addEventListener("click", () => saveProviderSecret());
deleteProviderSecretButton?.addEventListener("click", () => deleteProviderSecret());
providerKeyRefInput?.addEventListener("input", () => renderProviderSecretStatus());
for (const field of [providerTypeInput, providerBaseUrlInput, providerKeyRefInput]) {
  field?.addEventListener("input", () => invalidateRouteModels());
  field?.addEventListener("change", () => invalidateRouteModels());
}
providerSecretInput?.addEventListener("input", () => renderProviderSecretStatus());
providerSecretInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  saveProviderSecret();
});
providerConcurrencyInput?.addEventListener("change", () => updateProviderCapacityFields());
addRouteOfferingButton?.addEventListener("click", () => {
  appendOfferingRow({ providerId: selectedProvider || "", model: "" });
  markDirty("route");
});
migrateLegacyRouteButton?.addEventListener("click", () => migrateLegacyRoute());

for (const tab of routeEditorTabs) {
  tab.addEventListener("click", async () => {
    const next = tab.dataset.routeEditorTab;
    if (!next || next === currentRouteEditorTab) return;
    if (!(await confirmDiscardChanges("切换模型配置"))) return;
    showRouteEditorTab(next);
  });
  tab.addEventListener("keydown", (event) => {
    const current = routeEditorTabs.indexOf(tab);
    let next = -1;
    if (event.key === "ArrowRight") next = (current + 1) % routeEditorTabs.length;
    if (event.key === "ArrowLeft") next = (current - 1 + routeEditorTabs.length) % routeEditorTabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = routeEditorTabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    routeEditorTabs[next].click();
    routeEditorTabs[next].focus();
  });
}
mcpSecretRefInput?.addEventListener("input", () => renderMcpSecretStatus());
mcpAuthTypeInput?.addEventListener("change", () => {
  if (mcpAuthTypeInput.value === "none") clearMcpSecretInput();
  renderMcpSecretStatus();
});
mcpSecretInput?.addEventListener("input", () => renderMcpSecretStatus());
mcpSecretInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  saveMcpSecret();
});
saveMcpSecretButton?.addEventListener("click", () => saveMcpSecret());
deleteMcpSecretButton?.addEventListener("click", () => deleteMcpSecret());
discoverMcpToolsButton?.addEventListener("click", () => discoverMcpTools());
accessCodesInput?.addEventListener("input", () => renderAccessEntries());

for (const tab of capabilityTabs) {
  tab.addEventListener("click", async () => {
    const next = tab.dataset.capabilityTab;
    if (next === currentCapabilityTab) return;
    if (!(await confirmDiscardChanges("切换能力类型"))) return;
    showCapabilityTab(next);
  });
  tab.addEventListener("keydown", (event) => {
    const current = capabilityTabs.indexOf(tab);
    let next = -1;
    if (event.key === "ArrowRight") next = (current + 1) % capabilityTabs.length;
    if (event.key === "ArrowLeft") next = (current - 1 + capabilityTabs.length) % capabilityTabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = capabilityTabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    capabilityTabs[next].click();
    capabilityTabs[next].focus();
  });
}

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

refreshAdminButton.addEventListener("click", async () => {
  if (!(await confirmDiscardChanges("刷新数据"))) return;
  loadDashboard();
});

exportReportButton?.addEventListener("click", () => exportAdminReport());

adminLogoutButton.addEventListener("click", async () => {
  if (!(await confirmDiscardChanges("退出后台"))) return;
  await fetchWithTimeout("/api/admin/logout", { method: "POST" });
  showLogin();
});

userSelect.addEventListener("change", async () => {
  const next = userSelect.value;
  userSelect.value = selectedUser;
  if (!(await confirmDiscardChanges("切换用户"))) return;
  selectedUser = next;
  userSelect.value = next;
  populateUserForm();
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncConfigFromEditor();

  const target = newUserLabel.value.trim() || selectedUser;
  const userConfig = readUserForm();
  if (!userConfig) return;

  const creating = Boolean(newUserLabel.value.trim());
  if (creating) {
    try {
      const data = await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ label: target, user: userConfig }),
      });
      selectedUser = target;
      newUserLabel.value = "";
      await loadDashboard(`已创建用户 ${target}`);
      createdAccessCodeInput.value = data.accessCode || "";
      createdAccessCode.hidden = !createdAccessCodeInput.value;
    } catch (error) {
      setStatus(error.message || "创建用户失败", true);
    }
    return;
  }

  if (target === DEFAULT_USER) {
    config.defaults = userConfig;
  } else {
    config.users = config.users || {};
    config.users[target] = userConfig;
    selectedUser = target;
  }

  newUserLabel.value = "";
  await attemptSaveConfig("用户配置已保存");
});

copyCreatedAccessCode?.addEventListener("click", async () => {
  if (!createdAccessCodeInput?.value) return;
  try {
    await navigator.clipboard.writeText(createdAccessCodeInput.value);
    setStatus("新访问码已复制");
  } catch {
    createdAccessCodeInput.select();
    setStatus("无法自动复制，请手动复制访问码", true);
  }
});

deleteUserButton.addEventListener("click", async () => {
  if (selectedUser === DEFAULT_USER) {
    setStatus("默认配置不能删除");
    return;
  }

  if (!(await confirmAdminAction("删除用户配置？", `${selectedUser} 将恢复使用默认配置，访问码不会被删除。`, "删除配置"))) return;

  syncConfigFromEditor();
  delete config.users?.[selectedUser];
  selectedUser = DEFAULT_USER;
  await attemptSaveConfig("用户配置已删除");
});

revokeUserSessionsButton?.addEventListener("click", async () => {
  if (selectedUser === DEFAULT_USER) return;
  if (!(await confirmDiscardChanges("注销用户会话"))) return;
  const active = activeSessionCount(selectedUser);
  if (!(await confirmAdminAction("注销全部会话？", `${selectedUser} 在所有设备上的 ${active} 个登录会话将立即失效，访问码本身保持不变。`, "全部注销"))) return;
  revokeUserSessionsButton.disabled = true;
  try {
    const data = await api("/api/admin/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ label: selectedUser }),
    });
    await loadDashboard(`已注销 ${Number(data.revoked) || 0} 个会话`);
  } catch (error) {
    setStatus(error.message || "会话注销失败", true);
    revokeUserSessionsButton.disabled = activeSessionCount(selectedUser) === 0;
  }
});

providerAdminSelect?.addEventListener("change", async () => {
  const next = providerAdminSelect.value;
  providerAdminSelect.value = selectedProvider;
  if (!(await confirmDiscardChanges("切换服务商"))) return;
  selectedProvider = next;
  providerAdminSelect.value = next;
  populateProviderForm();
});

providerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncConfigFromEditor();
  const editor = readProviderEditor();
  if (!PROVIDER_ID_PATTERN.test(editor.providerId)) {
    setProviderStatus("服务商 ID 必须以字母或数字开头，只能包含字母、数字、点、下划线和短横线", true);
    return;
  }
  if (!/^https?:\/\//i.test(editor.baseUrl)) {
    setProviderStatus("请填写有效的 http(s) Base URL", true);
    return;
  }
  if (editor.concurrency === "bounded" && (!Number.isInteger(editor.maxConcurrent) || editor.maxConcurrent < 1 || editor.maxConcurrent > 100)) {
    setProviderStatus("固定并发容量必须是 1 到 100 的整数", true);
    return;
  }
  if (!Number.isInteger(editor.queueTimeoutMs) || editor.queueTimeoutMs < 0 || editor.queueTimeoutMs > 10_000) {
    setProviderStatus("全忙等待必须是 0 到 10000 毫秒", true);
    return;
  }

  config.providers = config.providers || {};
  const previous = selectedProvider && selectedProvider !== "__new" ? selectedProvider : "";
  if (previous !== editor.providerId && config.providers[editor.providerId]) {
    setProviderStatus("该服务商 ID 已存在，请先选择它或使用其他 ID", true);
    return;
  }
  const existing = config.providers[previous] || config.providers[editor.providerId] || {};
  const rollbackState = captureModelAdminState();
  if (previous && previous !== editor.providerId) delete config.providers[previous];
  const nextProvider = buildProviderFromEditor(editor, existing);
  config.providers[editor.providerId] = nextProvider;
  replaceProviderReferences(previous, editor.providerId);
  selectedProvider = editor.providerId;
  const saved = await attemptSaveConfig("服务商配置已保存");
  if (!saved) restoreModelAdminState(rollbackState);
});

deleteProviderButton?.addEventListener("click", async () => {
  if (!selectedProvider || selectedProvider === "__new") return;
  syncConfigFromEditor();
  const routeRefs = Object.entries(config.routes || {})
    .filter(([, route]) => (route.offerings || []).some((offering) => offering.providerId === selectedProvider))
    .map(([routeId]) => routeLabel(routeId));
  if (routeRefs.length) {
    setProviderStatus(`仍被 ${routeRefs.length} 个逻辑模型使用，先移除服务商映射`, true);
    return;
  }
  if (!(await confirmAdminAction("删除服务商？", `${providerLabel(selectedProvider)} 将不再出现在模型映射中。`, "删除服务商"))) return;
  const rollbackState = captureModelAdminState();
  delete config.providers[selectedProvider];
  selectedProvider = Object.keys(config.providers)[0] || "__new";
  const saved = await attemptSaveConfig("服务商已删除");
  if (!saved) restoreModelAdminState(rollbackState);
});

routeAdminSelect.addEventListener("change", async () => {
  const next = routeAdminSelect.value;
  routeAdminSelect.value = selectedRoute;
  if (!(await confirmDiscardChanges("切换逻辑模型"))) return;
  selectedRoute = next;
  routeAdminSelect.value = next;
  populateRouteForm();
});

routeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncConfigFromEditor();

  const editor = readRouteEditor();
  const routeId = editor.routeId;
  if (!/^[A-Za-z0-9._-]+$/.test(routeId)) {
    setStatus("线路 ID 只能包含字母、数字、点、下划线和短横线", true);
    return;
  }

  if (!editor.offerings.length && !editor.legacy) {
    setStatus("至少添加一个有效的服务商映射", true);
    return;
  }
  if (editor.invalidOffering) {
    setStatus("每个服务商映射都需要有效服务商和上游模型", true);
    return;
  }
  if (editor.duplicateProvider) {
    setStatus(`同一逻辑模型不能重复引用服务商 ${editor.duplicateProvider}`, true);
    return;
  }

  config.routes = config.routes || {};
  const previous = selectedRoute && selectedRoute !== "__new" ? selectedRoute : "";
  if (previous !== routeId && config.routes[routeId]) {
    setStatus("该逻辑模型 ID 已存在，请先选择它或使用其他 ID", true);
    return;
  }
  const existing = config.routes[previous] || config.routes[routeId] || {};
  const rollbackState = captureModelAdminState();
  if (previous && previous !== routeId) delete config.routes[previous];

  config.routes[routeId] = buildRouteFromEditor(editor, existing);
  replaceRouteReferences(previous, routeId);
  if (!routeEnabledInput.checked) repairDisabledRouteAssignments(routeId);
  selectedRoute = routeId;
  const saved = await attemptSaveConfig("逻辑模型配置已保存");
  if (!saved) restoreModelAdminState(rollbackState);
});

skillSelect?.addEventListener("change", async () => {
  const next = skillSelect.value;
  skillSelect.value = selectedSkill;
  if (!(await confirmDiscardChanges("切换 Skill"))) return;
  selectedSkill = next;
  skillSelect.value = next;
  populateSkillForm();
});

skillForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncConfigFromEditor();
  const skillId = skillIdInput.value.trim();
  const instructions = skillInstructionsInput.value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(skillId) || skillId.length > 80) {
    return setStatus("Skill ID 格式无效", true);
  }
  if (!instructions) return setStatus("Skill Instructions 必填", true);
  const previous = selectedSkill !== "__new" ? selectedSkill : "";
  if (previous && previous !== skillId) {
    delete config.skills?.[previous];
    replaceSkillAssignments(previous, skillId);
  }
  config.skills = config.skills || {};
  config.skills[skillId] = compactObject({
    enabled: skillEnabledInput.checked,
    label: skillLabelInput.value.trim() || skillId,
    description: skillDescriptionInput.value.trim().slice(0, 500),
    instructions: instructions.slice(0, 8_000),
    order: Math.max(-10_000, Math.min(10_000, Math.trunc(Number(skillOrderInput.value) || 0))),
    toolIds: checkedValues(skillToolsBox),
  });
  selectedSkill = skillId;
  await attemptSaveConfig("Skill 已保存");
});

deleteSkillButton?.addEventListener("click", async () => {
  if (!selectedSkill || selectedSkill === "__new") return;
  if (!(await confirmAdminAction("删除 Skill？", `${config.skills?.[selectedSkill]?.label || selectedSkill} 将不再出现在会话选择器中。`, "删除 Skill"))) return;
  syncConfigFromEditor();
  pruneSkillAssignments(selectedSkill);
  delete config.skills?.[selectedSkill];
  selectedSkill = "__new";
  await attemptSaveConfig("Skill 已删除");
});

toolSelect?.addEventListener("change", async () => {
  const next = toolSelect.value;
  toolSelect.value = selectedTool;
  if (!(await confirmDiscardChanges("切换工具"))) return;
  selectedTool = next;
  toolSelect.value = next;
  populateToolForm();
});

toolForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncConfigFromEditor();
  const tool = config.tools?.[selectedTool];
  if (!tool) return setStatus("请先选择工具", true);
  tool.label = toolLabelInput.value.trim().slice(0, 80) || selectedTool;
  tool.description = toolDescriptionInput.value.trim().slice(0, 1_000) || undefined;
  tool.enabled = toolEnabledInput.checked;
  tool.confirmation = tool.executor?.type === "builtin"
    ? toolConfirmationInput.value === "always" ? "always" : "auto"
    : toolConfirmationInput.value === "always" ? "always" : "first-per-conversation";
  await attemptSaveConfig("工具配置已保存");
});

deleteToolButton?.addEventListener("click", async () => {
  const tool = config.tools?.[selectedTool];
  if (!tool || tool.executor?.type === "builtin") return;
  if (!(await confirmAdminAction("删除远程工具？", `${tool.label || selectedTool} 将从所有 Skill 和用户权限中移除。`, "删除工具"))) return;
  syncConfigFromEditor();
  delete config.tools[selectedTool];
  pruneToolAssignments(selectedTool);
  selectedTool = "";
  await attemptSaveConfig("远程工具已删除");
});

mcpSelect?.addEventListener("change", async () => {
  const next = mcpSelect.value;
  mcpSelect.value = selectedMcp;
  if (!(await confirmDiscardChanges("切换 MCP 服务"))) return;
  selectedMcp = next;
  mcpSelect.value = next;
  populateMcpForm();
});

mcpForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncConfigFromEditor();
  const draft = readMcpEditor();
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(draft.serverId) || draft.serverId.length > 80) {
    return setStatus("MCP Server ID 格式无效", true);
  }
  if (!isPublicHttpsEndpoint(draft.endpoint)) return setStatus("MCP 地址必须是公开 HTTPS 地址", true);
  if (draft.authType !== "none" && !/^[A-Z][A-Z0-9_]{1,63}$/.test(draft.secretRef)) {
    return setStatus("该认证方式需要有效的 Secret Ref", true);
  }
  const previous = selectedMcp !== "__new" ? selectedMcp : "";
  if (previous && previous !== draft.serverId) {
    delete config.mcpServers?.[previous];
    removeMcpServerTools(previous);
  }
  config.mcpServers = config.mcpServers || {};
  config.mcpServers[draft.serverId] = compactObject({
    enabled: draft.enabled,
    label: draft.label || draft.serverId,
    endpoint: draft.endpoint,
    authType: draft.authType,
    secretRef: draft.authType === "none" ? "" : draft.secretRef,
  });
  selectedMcp = draft.serverId;
  await attemptSaveConfig("MCP 服务已保存");
  clearMcpSecretInput();
  renderMcpSecretStatus();
});

deleteMcpButton?.addEventListener("click", async () => {
  if (!selectedMcp || selectedMcp === "__new") return;
  if (!(await confirmAdminAction("删除 MCP 服务？", `${config.mcpServers?.[selectedMcp]?.label || selectedMcp} 及其发现的工具将被移除。`, "删除 MCP"))) return;
  syncConfigFromEditor();
  delete config.mcpServers?.[selectedMcp];
  removeMcpServerTools(selectedMcp);
  selectedMcp = "__new";
  await attemptSaveConfig("MCP 服务已删除");
});

deleteRouteButton.addEventListener("click", async () => {
  if (!selectedRoute || selectedRoute === "__new") return;
  syncConfigFromEditor();
  const routeIds = Object.keys(config.routes || {});
  if (routeIds.length <= 1) {
    setStatus("至少需要保留一条线路", true);
    return;
  }
  if (!(await confirmAdminAction("删除模型线路？", `${routeLabel(selectedRoute)} 将被删除，关联用户会自动调整到其他线路。`, "删除线路"))) return;

  const rollbackState = captureModelAdminState();
  delete config.routes[selectedRoute];
  const fallbackRoute = Object.keys(config.routes)[0] || "";
  pruneRouteReferences(selectedRoute, fallbackRoute);
  selectedRoute = fallbackRoute;
  const saved = await attemptSaveConfig("线路已删除");
  if (!saved) restoreModelAdminState(rollbackState);
});

saveAccessCodesButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/access-codes", {
      method: "PUT",
      body: JSON.stringify({ accessCodes: accessCodesInput.value, expectedRevision: accessRevision }),
    });
    await loadDashboard("访问码已保存");
  } catch (error) {
    setStatus(error.message || "访问码保存失败", true);
  }
});

resetAccessCodesButton.addEventListener("click", async () => {
  if (!(await confirmAdminAction("恢复 Secret 访问码？", "后台保存的访问码覆盖将被删除，当前 Secret 配置会重新生效。", "恢复"))) return;
  await api("/api/admin/access-codes", {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: accessRevision }),
  });
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
  if (!(await confirmAdminAction("恢复 Secret 配置？", "后台保存的用户和线路配置将被删除，当前 Secret 配置会重新生效。", "恢复"))) return;
  await api("/api/admin/config", {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: configRevision }),
  });
  selectedUser = DEFAULT_USER;
  selectedRoute = "";
  await loadDashboard("已恢复 Secret 里的配置");
});

async function bootAdmin() {
  const response = await fetchWithTimeout("/api/admin/session");
  if (response.ok) {
    await showAdmin();
  } else {
    showLogin();
  }
}

function showLogin() {
  clearProviderSecretInput();
  clearMcpSecretInput();
  clearDirty();
  adminView.hidden = true;
  adminLoginView.hidden = false;
  adminToken.focus();
}

async function showAdmin() {
  adminLoginView.hidden = true;
  adminView.hidden = false;
  showAdminSection(localStorage.getItem(ADMIN_SECTION_KEY) || "overview");
  await loadDashboard();
}

function showAdminSection(section) {
  const target = ADMIN_SECTION_TITLES[section] ? section : "overview";
  currentAdminSection = target;
  for (const panel of adminSections) panel.hidden = panel.dataset.adminSection !== target;
  for (const item of adminNavItems) {
    const active = item.dataset.adminTarget === target;
    item.classList.toggle("active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  }
  if (adminPageTitle) adminPageTitle.textContent = ADMIN_SECTION_TITLES[target];
  clearMcpSecretInput();
  localStorage.setItem(ADMIN_SECTION_KEY, target);
  document.querySelector(".admin-content")?.scrollTo({ top: 0, behavior: "instant" });
}

function showCapabilityTab(tab) {
  const target = ["skills", "tools", "mcp"].includes(tab) ? tab : "skills";
  currentCapabilityTab = target;
  const panels = { skills: capabilitySkillsPanel, tools: capabilityToolsPanel, mcp: capabilityMcpPanel };
  for (const [key, panel] of Object.entries(panels)) {
    if (panel) panel.hidden = key !== target;
  }
  for (const control of capabilityTabs) {
    const active = control.dataset.capabilityTab === target;
    control.classList.toggle("active", active);
    control.setAttribute("aria-selected", String(active));
    control.tabIndex = active ? 0 : -1;
  }
  clearMcpSecretInput();
}

function showRouteEditorTab(tab) {
  const target = tab === "routes" ? "routes" : "providers";
  currentRouteEditorTab = target;
  if (providerEditorPanel) providerEditorPanel.hidden = target !== "providers";
  if (routeEditorPanel) routeEditorPanel.hidden = target !== "routes";
  for (const control of routeEditorTabs) {
    const active = control.dataset.routeEditorTab === target;
    control.classList.toggle("active", active);
    control.setAttribute("aria-selected", String(active));
    control.tabIndex = active ? 0 : -1;
  }
  if (target === "providers") populateProviderForm();
  else populateRouteForm();
}

async function loadDashboard(message = "") {
  clearProviderSecretInput();
  clearMcpSecretInput();
  setStatus("读取中");
  const [configData, accessData, statsData, releaseData, healthData, auditData, feedbackData, coreHealthData, routeSecretsData, mcpSecretsData] = await Promise.all([
    api("/api/admin/config"),
    api("/api/admin/access-codes"),
    api("/api/admin/stats"),
    fetchRelease(),
    api("/api/admin/route-health"),
    api("/api/admin/audit"),
    api("/api/admin/feedback"),
    fetchCoreHealth(),
    api("/api/admin/route-secrets"),
    api("/api/admin/mcp-secrets"),
  ]);

  config = normalizeClientConfig(configData.config);
  configRevision = configData.revision || "";
  stats = statsData;
  routeHealth = healthData?.routes || {};
  coreHealth = coreHealthData;
  routeSecretMasterReady = routeSecretsData?.masterKeyReady === true;
  routeSecretMasterMessage = routeSecretsData?.masterKeyMessage || "";
  routeSecrets = Object.fromEntries(
    (Array.isArray(routeSecretsData?.items) ? routeSecretsData.items : [])
      .filter((item) => item?.apiKeyRef)
      .map((item) => [item.apiKeyRef, item]),
  );
  mcpSecretMasterReady = mcpSecretsData?.masterKeyReady === true;
  mcpSecretMasterMessage = mcpSecretsData?.masterKeyMessage || "";
  mcpSecrets = Object.fromEntries(
    (Array.isArray(mcpSecretsData?.items) ? mcpSecretsData.items : [])
      .filter((item) => item?.secretRef)
      .map((item) => [item.secretRef, item]),
  );
  renderAuditLog(auditData?.entries || []);
  renderFeedback(feedbackData?.entries || []);
  accessLabels = Array.isArray(accessData.entries)
    ? accessData.entries.map((entry) => entry?.label).filter(Boolean)
    : [];
  renderProductionStatus(releaseData, coreHealthData);
  configJsonInput.value = JSON.stringify(config, null, 2);
  accessCodesInput.value = accessData.accessCodes || "";
  accessRevision = accessData.revision || "";
  savedAccessCodes = accessCodesInput.value;
  renderAccessEntries();

  configSourceText.textContent = sourceLabel(configData.source);
  accessSourceText.textContent = sourceLabel(accessData.source);
  adminSourceText.textContent = `配置：${sourceLabel(configData.source)} · 访问码：${sourceLabel(accessData.source)}`;

  if (!selectedProvider || !config.providers[selectedProvider]) selectedProvider = Object.keys(config.providers)[0] || "__new";
  if (!selectedRoute || !config.routes[selectedRoute]) selectedRoute = Object.keys(config.routes)[0] || "__new";
  if (!getUserLabels().includes(selectedUser)) selectedUser = DEFAULT_USER;

  renderStats();
  renderAttentionCenter();
  renderUserPicker();
  renderProviderPicker();
  renderRoutePicker();
  showRouteEditorTab(currentRouteEditorTab);
  renderCapabilityEditors();
  clearDirty();
  setStatus(message || "已同步");
}

function renderFeedback(entries) {
  if (!feedbackList || !feedbackSummary) return;
  const items = Array.isArray(entries) ? entries : [];
  feedbackEntries = items;
  const positive = items.filter((item) => item.rating === "up").length;
  const positiveRate = items.length ? Math.round((positive / items.length) * 100) : 0;
  feedbackSummary.textContent = items.length ? `${positiveRate}% 有帮助 · ${items.length} 条` : "暂无评价";
  feedbackList.textContent = "";
  if (!items.length) {
    feedbackList.append(textNode("朋友评价回答后会显示在这里"));
    return;
  }
  for (const entry of items.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = `feedback-row ${entry.rating === "up" ? "positive" : "negative"}`;
    const marker = document.createElement("span");
    marker.textContent = entry.rating === "up" ? "+" : "−";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${entry.label || "用户"} · ${entry.rating === "up" ? "有帮助" : "需改进"}`;
    const detail = document.createElement("small");
    const reasonLabels = {
      inaccurate: "内容不准确",
      misunderstood: "没有理解问题",
      verbose: "回答太啰嗦",
      format: "格式或排版问题",
      other: "其他原因",
    };
    detail.textContent = `${routeLabel(entry.routeId)}${entry.reason ? ` · ${reasonLabels[entry.reason] || entry.reason}` : ""} · ${relativeTime(entry.at)}`;
    copy.append(title, detail);
    row.append(marker, copy);
    feedbackList.append(row);
  }
}

function renderAuditLog(entries) {
  if (!auditList) return;
  auditList.textContent = "";
  const labels = {
    "config.update": "更新配置",
    "config.reset": "恢复配置 Secret",
    "access.update": "更新访问码",
    "access.reset": "恢复访问码 Secret",
    "sessions.revoke": "注销用户会话",
    "memory.update": "更新长期记忆",
    "memory.clear": "清空长期记忆",
    "usage.reset": "重置用户额度",
    "user.create": "创建用户",
  };
  const visible = Array.isArray(entries) ? entries.slice(0, 8) : [];
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "audit-empty";
    empty.textContent = "暂无管理记录";
    auditList.append(empty);
    return;
  }
  for (const entry of visible) {
    const row = document.createElement("div");
    const marker = document.createElement("span");
    marker.className = "audit-marker";
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = labels[entry.action] || entry.action || "管理操作";
    const detail = document.createElement("small");
    detail.textContent = `${entry.target ? `${entry.target} · ` : ""}${relativeTime(entry.at)}`;
    copy.append(title, detail);
    row.append(marker, copy);
    auditList.append(row);
  }
}

function renderAttentionCenter() {
  if (!attentionPanel || !attentionList || !attentionSummary) return;
  const alerts = [];

  for (const [routeId, route] of Object.entries(config.routes || {})) {
    if (route.enabled === false) continue;
    const health = routeHealth[routeId];
    if (health?.status === "unhealthy" || health?.status === "unavailable") {
      alerts.push({
        severity: "critical",
        title: `${route.label || routeId} ${health.status === "unavailable" ? "配置不可用" : "近期真实任务失败"}`,
        detail: health.message || "上游线路不可用",
        section: "routes",
        routeId,
      });
    }
  }

  for (const route of Array.isArray(stats?.routeStats) ? stats.routeStats : []) {
    const attempts = Number(route.ok7d || 0) + Number(route.error7d || 0);
    if (attempts >= 5 && Number(route.errorRate7d || 0) >= 20) {
      alerts.push({
        severity: Number(route.errorRate7d) >= 50 ? "critical" : "warning",
        title: `${route.label || route.id} 近期错误率偏高`,
        detail: `7 日内 ${attempts} 次调用，错误率 ${route.errorRate7d}%`,
        section: "routes",
        routeId: route.id,
      });
    }
  }

  const feedbackByRoute = new Map();
  for (const entry of feedbackEntries) {
    if (!entry?.routeId || (entry.rating !== "up" && entry.rating !== "down")) continue;
    const current = feedbackByRoute.get(entry.routeId) || { total: 0, negative: 0 };
    current.total += 1;
    if (entry.rating === "down") current.negative += 1;
    feedbackByRoute.set(entry.routeId, current);
  }
  for (const [routeId, quality] of feedbackByRoute) {
    if (!config.routes?.[routeId] || config.routes[routeId].enabled === false) continue;
    if (quality.total < 3) continue;
    const negativeRate = Math.round((quality.negative / quality.total) * 100);
    if (negativeRate < 50) continue;
    alerts.push({
      severity: negativeRate >= 75 ? "critical" : "warning",
      title: `${routeLabel(routeId)} 回答质量评价偏低`,
      detail: `最近 ${quality.total} 条评价中，${negativeRate}% 标记为需改进`,
      section: "routes",
      routeId,
    });
  }

  for (const user of Array.isArray(stats?.users) ? stats.users : []) {
    const limit = Number(user.dailyLimit || 0);
    const remaining = Number(user.remaining || 0);
    if (limit > 0 && remaining <= 0) {
      alerts.push({ severity: "critical", title: `${user.label} 今日额度已耗尽`, detail: `已使用 ${user.used}/${limit}`, section: "users", userLabel: user.label });
    } else if (limit > 0 && remaining / limit <= 0.1) {
      alerts.push({ severity: "warning", title: `${user.label} 今日额度即将耗尽`, detail: `剩余 ${remaining}/${limit}`, section: "users", userLabel: user.label });
    }
  }

  if (coreHealth?.status !== "ok") {
    alerts.push({
      severity: "critical",
      title: "核心服务健康检查异常",
      detail: coreHealth ? "KV、Durable Object 或基础配置检查未通过" : "无法连接健康检查端点",
      section: "overview",
    });
  }

  alerts.sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1));
  attentionList.textContent = "";
  attentionPanel.hidden = currentAdminSection !== "overview" || alerts.length === 0;
  attentionSummary.textContent = alerts.length ? `${alerts.length} 项待处理` : "运行正常";

  for (const alert of alerts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `attention-item ${alert.severity}`;
    const indicator = document.createElement("span");
    indicator.className = "attention-indicator";
    indicator.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = alert.title;
    const detail = document.createElement("small");
    detail.textContent = alert.detail;
    const action = document.createElement("span");
    action.className = "attention-action";
    action.textContent = "处理";
    copy.append(title, detail);
    button.append(indicator, copy, action);
    button.addEventListener("click", () => {
      if (alert.routeId && config.routes?.[alert.routeId]) selectedRoute = alert.routeId;
      if (alert.userLabel && getUserLabels().includes(alert.userLabel)) selectedUser = alert.userLabel;
      showAdminSection(alert.section);
      if (alert.section === "routes") renderRoutePicker();
      if (alert.section === "users") renderUserPicker();
    });
    attentionList.append(button);
  }
}

function renderAccessEntries() {
  if (!accessEntryList) return;
  accessEntryList.textContent = "";
  const entries = parseAccessEntries(accessCodesInput.value);
  for (const [index, entry] of entries.entries()) {
    const row = document.createElement("div");
    row.className = "access-entry-row";
    const avatar = document.createElement("span");
    avatar.className = "access-entry-avatar";
    avatar.textContent = entry.label.slice(0, 1).toUpperCase() || "U";
    const copy = document.createElement("div");
    copy.className = "access-entry-copy";
    const label = document.createElement("strong");
    label.textContent = entry.label;
    const masked = document.createElement("small");
    masked.textContent = `访问码 ·•••• ${entry.code.slice(-4)}`;
    copy.append(label, masked);
    const actions = document.createElement("div");
    actions.className = "access-entry-actions";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "plain-button compact";
    copyButton.textContent = "复制";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(entry.code);
        setStatus(`${entry.label} 的访问码已复制`);
      } catch {
        setStatus("复制失败，请使用下方文本编辑器", true);
      }
    });
    const rotateButton = document.createElement("button");
    rotateButton.type = "button";
    rotateButton.className = "plain-button compact";
    rotateButton.textContent = "轮换";
    rotateButton.addEventListener("click", () => rotateAccessEntry(index, entry));
    const revokeButton = document.createElement("button");
    revokeButton.type = "button";
    revokeButton.className = "plain-button compact danger-action";
    revokeButton.textContent = "撤销";
    revokeButton.addEventListener("click", () => revokeAccessEntry(index, entry));
    actions.append(copyButton, rotateButton, revokeButton);
    row.append(avatar, copy, actions);
    accessEntryList.append(row);
  }
}

async function rotateAccessEntry(index, entry) {
  if (!(await confirmAdminAction("轮换访问码？", `${entry.label} 的旧访问码将立即失效，该用户当前已登录的会话也会全部注销。新访问码会自动复制。`, "轮换"))) return;
  const entries = parseAccessEntries(accessCodesInput.value);
  if (!entries[index]) return setStatus("访问码列表已变化，请刷新后重试", true);
  const previousValue = accessCodesInput.value;
  const nextCode = generateAccessCode();
  entries[index] = { ...entries[index], code: nextCode };
  accessCodesInput.value = entries.map((item) => `${item.label}:${item.code}`).join(",");
  renderAccessEntries();
  let accessSaved = false;
  try {
    await api("/api/admin/access-codes", {
      method: "PUT",
      body: JSON.stringify({ accessCodes: accessCodesInput.value, expectedRevision: accessRevision }),
    });
    accessSaved = true;
    const revoked = await revokeLabelSessions(entry.label);
    let copied = false;
    try {
      await navigator.clipboard.writeText(nextCode);
      copied = true;
    } catch {}
    const sessionText = revoked === null ? " · 会话注销失败，请稍后重试" : ` · 注销 ${revoked} 个会话`;
    await loadDashboard((copied
      ? `${entry.label} 的访问码已轮换并复制`
      : `${entry.label} 的访问码已轮换，请点击复制`) + sessionText);
  } catch (error) {
    if (!accessSaved) {
      accessCodesInput.value = previousValue;
      renderAccessEntries();
    }
    setStatus(accessSaved ? "访问码已轮换，但后台刷新失败" : error.message || "轮换失败", true);
  }
}

function parseAccessEntries(value) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf(":");
    return separator === -1
      ? { label: "friend", code: part }
      : { label: part.slice(0, separator).trim() || "friend", code: part.slice(separator + 1).trim() };
  }).filter((entry) => entry.code);
}

async function revokeAccessEntry(index, entry) {
  const entries = parseAccessEntries(accessCodesInput.value);
  if (entries.length <= 1) return setStatus("至少需要保留一个访问码", true);
  if (!(await confirmAdminAction("撤销访问码？", `${entry.label} 将无法再使用这个访问码登录，该用户当前已登录的会话也会全部注销。`, "撤销"))) return;
  const previousValue = accessCodesInput.value;
  entries.splice(index, 1);
  accessCodesInput.value = entries.map((item) => `${item.label}:${item.code}`).join(",");
  renderAccessEntries();
  let accessSaved = false;
  try {
    await api("/api/admin/access-codes", {
      method: "PUT",
      body: JSON.stringify({ accessCodes: accessCodesInput.value, expectedRevision: accessRevision }),
    });
    accessSaved = true;
    const revoked = await revokeLabelSessions(entry.label);
    await loadDashboard(revoked === null ? "访问码已撤销 · 会话注销失败，请稍后重试" : `访问码已撤销 · 注销 ${revoked} 个会话`);
  } catch (error) {
    if (!accessSaved) {
      accessCodesInput.value = previousValue;
      renderAccessEntries();
    }
    setStatus(accessSaved ? "访问码已撤销，但后台刷新失败" : error.message || "撤销失败", true);
  }
}

async function revokeLabelSessions(label) {
  try {
    const data = await api("/api/admin/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
    return Number(data.revoked) || 0;
  } catch {
    return null;
  }
}

async function fetchRelease() {
  try {
    const response = await fetchWithTimeout(`/release.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchCoreHealth() {
  try {
    const response = await fetchWithTimeout(`/healthz?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    return response.ok && data?.status === "ok" ? data : data || { status: "degraded", checks: {} };
  } catch {
    return null;
  }
}

function renderProductionStatus(release, health) {
  const routeCount = Object.keys(config.routes || {}).length;
  const userCount = Object.keys(config.users || {}).length;
  const commit = typeof release?.commit === "string" ? release.commit : "";
  const deployedAt = typeof release?.deployedAt === "string" ? new Date(release.deployedAt) : null;
  const healthy = health?.status === "ok";
  releaseState.textContent = commit && healthy ? "运行正常" : healthy ? "版本信息不可用" : "核心服务异常";
  releaseState.classList.toggle("status-ok", Boolean(commit && healthy));
  releaseCommit.textContent = commit ? commit.slice(0, 8) : "--";
  releaseCommit.title = commit;
  releaseTime.textContent = deployedAt && !Number.isNaN(deployedAt.valueOf())
    ? deployedAt.toLocaleString("zh-CN", { hour12: false })
    : "--";
  releaseRoutes.textContent = String(routeCount);
  releaseUsers.textContent = String(userCount);
  diagnosticList.textContent = "";
  const checks = [
    ["发布身份", Boolean(commit), commit ? "已验证" : "无法读取 release.json"],
    ["模型配置", routeCount > 0, routeCount > 0 ? `${routeCount} 条线路` : "尚未配置线路"],
    ["访问控制", accessLabels.length > 0, accessLabels.length > 0 ? `${accessLabels.length} 个 label` : "尚无访问码 label"],
    ["KV 存储", health?.checks?.kv === true, health ? health.checks?.kv ? "连接正常" : "检查失败" : "无法读取健康状态"],
    ["云端同步", health?.checks?.durableObject === true, health ? health.checks?.durableObject ? "Durable Object 正常" : "检查失败" : "无法读取健康状态"],
    ["核心配置", health?.checks?.configured === true, health ? health.checks?.configured ? "基础配置有效" : "检查失败" : "无法读取健康状态"],
  ];
  for (const [label, ok, detail] of checks) {
    const row = document.createElement("div");
    const indicator = document.createElement("span");
    indicator.className = `diagnostic-dot${ok ? " ok" : " warning"}`;
    indicator.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    const description = document.createElement("small");
    name.textContent = label;
    description.textContent = detail;
    copy.append(name, description);
    row.append(indicator, copy);
    diagnosticList.append(row);
  }
}

async function api(path, options = {}) {
  const headers = options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers;
  const response = await fetchWithTimeout(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  const requestId = response.headers.get("X-Request-ID") || "";
  const reference = requestId ? ` · 请求 ${requestId.slice(0, 8)}` : "";

  if (response.status === 401 && path !== "/api/admin/login") {
    showLogin();
    throw new Error(`需要重新登录${reference}`);
  }

  if (!response.ok) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const retryMessage = response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
      ? `请求过于频繁，请在 ${retryAfter < 60 ? `${Math.ceil(retryAfter)} 秒` : `约 ${Math.ceil(retryAfter / 60)} 分钟`}后重试`
      : data.message || data.error || "请求失败";
    throw new Error(`${retryMessage}${reference}`);
  }

  return data;
}

async function fetchWithTimeout(input, init = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("请求超时，请检查网络后重试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
      const fill = document.createElement("progress");
      fill.className = "trend-fill";
      fill.max = maxReq;
      fill.value = Number(item.requests) || 0;
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
    title.textContent = `${user.displayName && user.displayName !== user.label ? `${user.displayName}（${user.label}）` : user.label}${user.enabled === false ? " · 已暂停" : ""}`;
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
        const bar = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        bar.setAttribute("class", "usage-spark-bar");
        bar.setAttribute("viewBox", "0 0 8 28");
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", `${day.day}: ${day.used || 0}`);
        const height = Math.max(3, Math.round(((Number(day.used) || 0) / maxUsed) * 28));
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", String(28 - height));
        rect.setAttribute("width", "8");
        rect.setAttribute("height", String(height));
        rect.setAttribute("rx", "2");
        bar.append(rect);
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
    memoryBtn.addEventListener("click", async () => {
      if (memoryUserSelect) {
        if (user.label !== selectedMemoryUser && !(await confirmDiscardChanges("切换记忆用户"))) return;
        memoryUserSelect.value = user.label;
        selectedMemoryUser = user.label;
        loadAdminMemory();
      }
    });
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "plain-button compact";
    resetBtn.textContent = "重置今日";
    resetBtn.addEventListener("click", async () => {
      if (!(await confirmAdminAction("重置今日用量？", `${user.label} 的今日已用额度将归零。`, "重置"))) return;
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

function exportAdminReport() {
  if (!stats) return setStatus("运营数据尚未加载", true);
  const csv = buildAdminReportCsv(stats, new Date());
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chatus-report-${stats.day || new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("运营报表已导出，不包含密钥、Prompt、记忆或对话内容");
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
    if (config.routes[routeId]?.enabled === false) continue;
    const option = document.createElement("option");
    option.value = routeId;
    const health = routeHealth[routeId];
    const statusLabel = health?.status === "healthy"
      ? " · 近期任务正常"
      : health?.status === "unhealthy" || health?.status === "unavailable"
        ? " · 需处理"
        : "";
    option.textContent = `${routeLabel(routeId)}${statusLabel}`;
    userDefaultRoute.append(option);
  }

  renderAllowedRouteChecks();
  renderAllowedSkillChecks();
  renderAllowedToolChecks();
  populateUserForm();
}

function renderAllowedRouteChecks() {
  allowedRoutesBox.textContent = "";
  for (const routeId of Object.keys(config.routes || {})) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = routeId;
    const disabled = config.routes[routeId]?.enabled === false;
    label.classList.toggle("disabled-route-option", disabled);
    label.append(input, document.createTextNode(`${routeLabel(routeId)}${disabled ? "（已停用）" : ""}`));
    allowedRoutesBox.append(label);
  }
}

function renderAllowedToolChecks() {
  renderToolCheckboxes(allowedToolsBox, []);
}

function renderAllowedSkillChecks() {
  if (!allowedSkillsBox) return;
  allowedSkillsBox.textContent = "";
  const entries = Object.entries(config.skills || {}).sort((left, right) => {
    const order = (Number(left[1]?.order) || 0) - (Number(right[1]?.order) || 0);
    return order || left[0].localeCompare(right[0]);
  });
  if (!entries.length) {
    allowedSkillsBox.append(textNode("尚未配置 Skill"));
    return;
  }
  for (const [skillId, skill] of entries) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = skillId;
    const disabled = skill.enabled !== true;
    label.classList.toggle("disabled-route-option", disabled);
    label.append(input, document.createTextNode(`${skill.label || skillId}${disabled ? "（已停用）" : ""}`));
    allowedSkillsBox.append(label);
  }
}

function populateUserForm() {
  const user =
    selectedUser === DEFAULT_USER
      ? config.defaults || {}
      : { ...(config.defaults || {}), ...(config.users?.[selectedUser] || {}) };
  const routeIds = Object.keys(config.routes || {});
  const enabledRouteIds = routeIds.filter((routeId) => config.routes[routeId]?.enabled !== false);
  userDefaultRoute.value = enabledRouteIds.includes(user.defaultRoute) ? user.defaultRoute : enabledRouteIds[0] || "";
  userDailyLimit.value = user.dailyMessageLimit || 500;
  userMinuteLimit.value = user.minuteMessageLimit || 12;
  userByok.checked = Boolean(user.allowBringYourOwnKey);
  if (userEnabled) userEnabled.checked = user.enabled !== false;
  if (userDisplayName) userDisplayName.value = user.displayName || "";
  if (userSystemPrompt) userSystemPrompt.value = user.systemPrompt || "";
  deleteUserButton.disabled = selectedUser === DEFAULT_USER || !config.users?.[selectedUser];
  const activeSessions = selectedUser === DEFAULT_USER ? 0 : activeSessionCount(selectedUser);
  if (revokeUserSessionsButton) {
    revokeUserSessionsButton.textContent = activeSessions ? `注销会话（${activeSessions}）` : "注销会话";
    revokeUserSessionsButton.disabled = selectedUser === DEFAULT_USER || activeSessions === 0;
  }

  const allowed = new Set(user.allowedRoutes?.length ? user.allowedRoutes : routeIds);
  for (const input of allowedRoutesBox.querySelectorAll("input[type='checkbox']")) {
    input.checked = allowed.has(input.value);
  }
  const allowedSkills = new Set(
    Array.isArray(user.allowedSkills) ? user.allowedSkills : Object.keys(config.skills || {}),
  );
  for (const input of allowedSkillsBox.querySelectorAll("input[type='checkbox']")) {
    input.checked = allowedSkills.has(input.value);
  }
  const allowedTools = new Set(Array.isArray(user.allowedTools) ? user.allowedTools : []);
  for (const input of allowedToolsBox.querySelectorAll("input[type='checkbox']")) {
    input.checked = allowedTools.has(input.value);
  }
}

function activeSessionCount(label) {
  const user = (Array.isArray(stats?.users) ? stats.users : []).find((item) => item.label === label);
  return Number(user?.activeSessions) || 0;
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
  const enabledAllowedRoutes = allowedRoutes.filter((routeId) => config.routes?.[routeId]?.enabled !== false);
  if (!enabledAllowedRoutes.length) {
    setStatus("至少选择一条已启用的线路", true);
    return null;
  }

  const systemPrompt = (userSystemPrompt?.value || "").trim();
  const displayName = (userDisplayName?.value || "").trim();
  return {
    enabled: userEnabled?.checked !== false,
    ...(displayName ? { displayName: displayName.slice(0, 40) } : {}),
    defaultRoute: userDefaultRoute.value,
    allowedRoutes,
    allowedSkills: checkedValues(allowedSkillsBox),
    allowedTools: checkedValues(allowedToolsBox),
    allowBringYourOwnKey: userByok.checked,
    dailyMessageLimit: positiveNumber(userDailyLimit.value),
    minuteMessageLimit: positiveNumber(userMinuteLimit.value),
    ...(systemPrompt ? { systemPrompt: systemPrompt.slice(0, 2000) } : {}),
  };
}

function repairDisabledRouteAssignments(routeId) {
  const replacement = Object.keys(config.routes || {}).find((id) => id !== routeId && config.routes[id]?.enabled !== false);
  if (!replacement) return;
  const repair = (user) => {
    if (!user) return;
    if (user.defaultRoute === routeId) user.defaultRoute = replacement;
    if (Array.isArray(user.allowedRoutes) && !user.allowedRoutes.some((id) => config.routes[id]?.enabled !== false)) {
      user.allowedRoutes.push(replacement);
    }
  };
  repair(config.defaults);
  for (const user of Object.values(config.users || {})) repair(user);
}

function renderProviderPicker() {
  if (!providerAdminSelect) return;
  providerAdminSelect.textContent = "";
  const entries = Object.entries(config.providers || {}).sort((left, right) => providerLabel(left[0]).localeCompare(providerLabel(right[0]), "zh-CN"));
  for (const [providerId, provider] of entries) {
    const option = document.createElement("option");
    option.value = providerId;
    option.textContent = `${provider.label || providerId}${provider.enabled === false ? "（已停用）" : ""}`;
    providerAdminSelect.append(option);
  }
  const newOption = document.createElement("option");
  newOption.value = "__new";
  newOption.textContent = "新增服务商";
  providerAdminSelect.append(newOption);
  if (selectedProvider !== "__new" && !config.providers?.[selectedProvider]) selectedProvider = entries[0]?.[0] || "__new";
  providerAdminSelect.value = selectedProvider;
  populateProviderForm();
}

function populateProviderForm() {
  if (!providerForm) return;
  clearProviderSecretInput();
  invalidateRouteModels();
  const provider = selectedProvider === "__new" ? {} : config.providers?.[selectedProvider] || {};
  providerIdInput.value = selectedProvider === "__new" ? "" : selectedProvider;
  providerLabelInput.value = provider.label || "";
  providerTypeInput.value = provider.type || "openai-chat";
  providerBaseUrlInput.value = provider.baseUrl || "";
  providerKeyRefInput.value = provider.apiKeyRef || "";
  providerConcurrencyInput.value = ["exclusive", "bounded"].includes(provider.concurrency) ? provider.concurrency : "unlimited";
  providerMaxConcurrentInput.value = String(provider.concurrency === "exclusive" ? 1 : positiveInteger(provider.maxConcurrent, 1, 100, 1));
  providerQueueTimeoutInput.value = String(nonNegativeInteger(provider.queueTimeoutMs, 10_000, 10_000));
  providerPriorityInput.value = String(finiteNumber(provider.priority, 0));
  providerImagesInput.checked = provider.supportsImages !== false;
  providerToolsInput.checked = provider.supportsTools === true;
  providerAllowUserKeyInput.checked = provider.allowUserKey !== false;
  providerRequiresKeyInput.checked = provider.requiresUserKey === true;
  providerEnabledInput.checked = provider.enabled !== false;
  providerDirectEndpointInput.checked = provider.directEndpoint === true;
  deleteProviderButton.disabled = selectedProvider === "__new";
  updateProviderCapacityFields();
  renderProviderSecretStatus();
  setProviderStatus("");
}

function updateProviderCapacityFields() {
  const concurrency = providerConcurrencyInput?.value || "unlimited";
  if (providerMaxConcurrentInput) {
    providerMaxConcurrentInput.disabled = concurrency !== "bounded";
    if (concurrency === "exclusive") providerMaxConcurrentInput.value = "1";
  }
  if (providerQueueTimeoutInput) providerQueueTimeoutInput.disabled = concurrency === "unlimited";
}

function renderRoutePicker() {
  routeAdminSelect.textContent = "";
  const routeIds = Object.keys(config.routes || {});
  for (const routeId of routeIds) {
    const option = document.createElement("option");
    option.value = routeId;
    option.textContent = `${routeLabel(routeId)}${config.routes[routeId]?.enabled === false ? "（已停用）" : ""}`;
    routeAdminSelect.append(option);
  }

  const newOption = document.createElement("option");
  newOption.value = "__new";
  newOption.textContent = "新增逻辑模型";
  routeAdminSelect.append(newOption);

  routeAdminSelect.value = routeIds.includes(selectedRoute) ? selectedRoute : routeIds[0] || "__new";
  selectedRoute = routeAdminSelect.value;
  populateRouteForm();
  renderRouteHealthList();
}

function renderRouteHealthList() {
  if (!routeHealthList) return;
  routeHealthList.textContent = "";
  const routeIds = Object.keys(config.routes || {}).sort((a, b) => healthRank(routeHealth[a]) - healthRank(routeHealth[b]));
  for (const routeId of routeIds) {
    const health = routeHealth[routeId];
    const row = document.createElement("button");
    row.type = "button";
    const disabled = config.routes[routeId]?.enabled === false;
    const status = disabled ? "disabled" : health?.status || "unknown";
    row.className = `route-health-row ${status === "unavailable" ? "unhealthy" : status}`;
    const indicator = document.createElement("span");
    indicator.className = "route-health-indicator";
    indicator.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "route-health-copy";
    const title = document.createElement("strong");
    title.textContent = routeLabel(routeId);
    const detail = document.createElement("small");
    detail.textContent = routeStatusDescription(health, disabled);
    copy.append(title, detail);
    const model = document.createElement("small");
    model.className = "route-health-model";
    const route = config.routes[routeId] || {};
    model.textContent = route.model || `${Array.isArray(route.offerings) ? route.offerings.length : 0} 个服务商`;
    row.append(indicator, copy, model);
    row.addEventListener("click", async () => {
      if (routeId !== selectedRoute && !(await confirmDiscardChanges("切换逻辑模型"))) return;
      selectedRoute = routeId;
      routeAdminSelect.value = routeId;
      showRouteEditorTab("routes");
      populateRouteForm();
      routeIdInput.focus();
    });
    routeHealthList.append(row);
  }
}

function healthRank(health) {
  if (health?.status === "unavailable" || health?.status === "unhealthy") return 0;
  if (!health || health.status === "unknown") return 1;
  if (health.status === "healthy") return 3;
  return 2;
}

function routeStatusDescription(health, disabled = false) {
  if (disabled || health?.status === "disabled") return "已停用，不参与用户请求";
  if (!health) return "暂无状态记录";
  const latency = Number.isFinite(health.latencyMs) ? ` · ${health.latencyMs}ms` : "";
  const observed = health.checkedAt ? ` · ${relativeTime(health.checkedAt)}` : "";
  if (health.status === "healthy") return `近期真实任务正常${latency}${observed}`;
  if (health.status === "unhealthy") return `${health.message || "近期真实任务异常"}${latency}${observed}`;
  if (health.status === "unavailable") return health.message || "线路配置不可用";
  return health.message || "配置已就绪，暂无近期真实任务记录";
}

function relativeTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "时间未知";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function populateRouteForm() {
  const route = selectedRoute === "__new" ? {} : config.routes?.[selectedRoute] || {};
  routeIdInput.value = selectedRoute === "__new" ? "" : selectedRoute;
  routeLabelInput.value = route.label || "";
  routeFallbacksInput.value = Array.isArray(route.fallbacks) ? route.fallbacks.join(",") : "";
  routeImagesInput.checked = route.supportsImages !== false;
  routeToolsInput.checked = route.supportsTools === true;
  routeEnabledInput.checked = route.enabled !== false;
  routeAllowUserKeyInput.checked = route.allowUserKey !== false;
  routeRequiresKeyInput.checked = Boolean(route.requiresUserKey);
  routeOfferingsList.textContent = "";
  for (const offering of Array.isArray(route.offerings) ? route.offerings : []) appendOfferingRow(offering);
  const legacy = isLegacyRoute(route);
  if (!legacy && !routeOfferingsList.children.length && selectedRoute === "__new") {
    appendOfferingRow({ providerId: selectedProvider === "__new" ? "" : selectedProvider, model: "" });
  }
  legacyRoutePanel.hidden = !legacy;
  if (legacy) {
    legacyRouteType.textContent = route.type === "anthropic-messages" ? "Anthropic Messages" : "OpenAI Chat";
    legacyRouteBaseUrl.textContent = route.baseUrl || "--";
    legacyRouteModel.textContent = route.model || "--";
    legacyRouteKeyRef.textContent = route.apiKeyRef || "未配置";
    legacyRouteStatus.textContent = route.hasLegacyKey === true
      ? isConfiguredRouteSecret(route.apiKeyRef)
        ? "安全密钥已就绪，可以迁移；旧式 Key 不会复制到服务商配置。"
        : "迁移前需要先为该 Key Ref 配置后台密钥或同名 Worker Secret。"
      : "迁移后 endpoint 与凭据引用由服务商统一管理。";
  } else {
    legacyRouteStatus.textContent = "";
  }
  routeOfferingStatus.textContent = legacy
    ? "旧式线路仍可使用；迁移后可为该逻辑模型添加多个服务商。"
    : routeOfferingsList.children.length
      ? `${routeOfferingsList.children.length} 个服务商映射`
      : "尚未添加服务商映射";
  deleteRouteButton.disabled = selectedRoute === "__new";
  renderStoredRouteHealth(selectedRoute);
}

function appendOfferingRow(offering = {}) {
  if (!routeOfferingsList) return;
  const row = document.createElement("div");
  row.className = "offering-row";

  const providerField = document.createElement("label");
  providerField.append(document.createTextNode("服务商"));
  const providerInput = document.createElement("select");
  providerInput.className = "offering-provider-input";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "选择服务商";
  providerInput.append(blank);
  for (const [providerId, provider] of Object.entries(config.providers || {})) {
    const option = document.createElement("option");
    option.value = providerId;
    option.textContent = `${provider.label || providerId}${provider.enabled === false ? "（已停用）" : ""}`;
    providerInput.append(option);
  }
  providerInput.value = offering.providerId || "";
  providerField.append(providerInput);

  const modelField = document.createElement("label");
  modelField.append(document.createTextNode("上游模型"));
  const modelInput = document.createElement("input");
  modelInput.className = "offering-model-input";
  modelInput.autocomplete = "off";
  modelInput.maxLength = 200;
  modelInput.placeholder = "model-name";
  modelInput.value = offering.model || "";
  modelField.append(modelInput);

  const priorityField = document.createElement("label");
  priorityField.append(document.createTextNode("优先级覆盖"));
  const priorityInput = document.createElement("input");
  priorityInput.className = "offering-priority-input";
  priorityInput.type = "number";
  priorityInput.step = "1";
  priorityInput.placeholder = "继承";
  priorityInput.value = Number.isFinite(Number(offering.priority)) ? String(Number(offering.priority)) : "";
  priorityField.append(priorityInput);

  const imagesField = offeringCapabilityField("图片", "offering-images-input", offering.supportsImages);
  const toolsField = offeringCapabilityField("工具", "offering-tools-input", offering.supportsTools);

  const enabledField = document.createElement("label");
  enabledField.className = "offering-enabled-field";
  const enabledInput = document.createElement("input");
  enabledInput.className = "offering-enabled-input";
  enabledInput.type = "checkbox";
  enabledInput.checked = offering.enabled !== false;
  enabledField.append(enabledInput, document.createTextNode("启用"));

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "icon-control offering-remove-button";
  removeButton.textContent = "×";
  removeButton.title = "删除服务商映射";
  removeButton.setAttribute("aria-label", "删除服务商映射");
  removeButton.addEventListener("click", () => {
    row.remove();
    routeOfferingStatus.textContent = routeOfferingsList.children.length
      ? `${routeOfferingsList.children.length} 个服务商映射`
      : "尚未添加服务商映射";
    markDirty("route");
  });

  row.append(providerField, modelField, priorityField, imagesField, toolsField, enabledField, removeButton);
  routeOfferingsList.append(row);
  routeOfferingStatus.textContent = `${routeOfferingsList.children.length} 个服务商映射`;
}

function offeringCapabilityField(labelText, className, value) {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const select = document.createElement("select");
  select.className = className;
  for (const [optionValue, text] of [["", "继承"], ["true", "支持"], ["false", "不支持"]]) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = text;
    select.append(option);
  }
  select.value = typeof value === "boolean" ? String(value) : "";
  label.append(select);
  return label;
}

function renderProviderSecretStatus(message = "", isError = false) {
  if (!providerSecretStatus) return;
  const apiKeyRef = providerKeyRefInput.value.trim();
  const validRef = /^[A-Z][A-Z0-9_]{1,63}$/.test(apiKeyRef);
  const item = validRef ? routeSecrets[apiKeyRef] : null;
  const provider = selectedProvider === "__new" ? null : config.providers?.[selectedProvider];
  const hasLegacyKey = provider?.hasLegacyKey === true;
  const hasServerSecret = isConfiguredRouteSecret(apiKeyRef);

  saveProviderSecretButton.disabled = !routeSecretMasterReady || !validRef || !providerSecretInput.value.trim();
  deleteProviderSecretButton.disabled = !item?.managed;

  let statusMessage = message;
  let statusError = isError;
  if (!statusMessage) {
    if (!apiKeyRef) {
      statusMessage = "先填写 API Key Ref";
    } else if (!validRef) {
      statusMessage = "仅支持大写字母、数字和下划线，且必须以字母开头";
      statusError = true;
    } else if (hasLegacyKey && hasServerSecret) {
      statusMessage = "安全密钥已配置；保存服务商后会移除旧式配置 Key";
    } else if (hasLegacyKey) {
      statusMessage = "当前服务商仍使用旧式配置 Key；请写入后台密钥完成迁移";
    } else if (item?.source === "managed" && item.status === "configured") {
      statusMessage = `后台密钥已配置${item.updatedAt ? ` · ${formatRouteSecretTime(item.updatedAt)}` : ""}`;
    } else if (item?.source === "managed" && item.status === "unavailable") {
      statusMessage = item.message || "后台密钥不可用，请重新录入";
      statusError = true;
    } else if (item?.source === "worker") {
      statusMessage = "使用 Worker Secret；保存后将改用后台加密密钥";
    } else if (!routeSecretMasterReady) {
      statusMessage = routeSecretMasterMessage || "尚未配置服务商密钥主密钥";
      statusError = true;
    } else {
      statusMessage = "尚未配置后台密钥";
    }
  }

  providerSecretStatus.textContent = statusMessage;
  providerSecretStatus.classList.toggle("is-error", statusError);
}

function isConfiguredRouteSecret(apiKeyRef) {
  const item = typeof apiKeyRef === "string" ? routeSecrets[apiKeyRef.trim()] : null;
  return item?.status === "configured" && (item.source === "managed" || item.source === "worker");
}

function formatRouteSecretTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "更新时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}

function clearProviderSecretInput() {
  if (providerSecretInput) providerSecretInput.value = "";
}

function renderMcpSecretStatus(message = "", isError = false) {
  if (!mcpSecretStatus) return;
  const authType = mcpAuthTypeInput.value;
  const secretRef = mcpSecretRefInput.value.trim();
  const validRef = /^[A-Z][A-Z0-9_]{1,63}$/.test(secretRef);
  const item = validRef ? mcpSecrets[secretRef] : null;
  const needsSecret = authType !== "none";
  mcpSecretRefInput.disabled = !needsSecret;
  mcpSecretInput.disabled = !needsSecret;
  saveMcpSecretButton.disabled = !needsSecret || !mcpSecretMasterReady || !validRef || !mcpSecretInput.value.trim();
  deleteMcpSecretButton.disabled = !needsSecret || !item?.managed;

  let statusMessage = message;
  let statusError = isError;
  if (!statusMessage) {
    if (!needsSecret) {
      statusMessage = "该服务不发送认证密钥";
    } else if (!secretRef) {
      statusMessage = "先填写 Secret Ref";
    } else if (!validRef) {
      statusMessage = "仅支持大写字母、数字和下划线，且必须以字母开头";
      statusError = true;
    } else if (item?.source === "managed" && item.status === "configured") {
      statusMessage = `后台密钥已配置${item.updatedAt ? ` · ${formatRouteSecretTime(item.updatedAt)}` : ""}`;
    } else if (item?.source === "managed" && item.status === "unavailable") {
      statusMessage = item.message || "后台密钥不可用，请重新录入";
      statusError = true;
    } else if (item?.source === "worker") {
      statusMessage = "使用 Worker Secret；保存后将改用后台加密密钥";
    } else if (!mcpSecretMasterReady) {
      statusMessage = mcpSecretMasterMessage || "尚未配置密钥主密钥";
      statusError = true;
    } else {
      statusMessage = "尚未配置后台密钥";
    }
  }
  mcpSecretStatus.textContent = statusMessage;
  mcpSecretStatus.classList.toggle("is-error", statusError);
}

function clearMcpSecretInput() {
  if (mcpSecretInput) mcpSecretInput.value = "";
}

async function saveMcpSecret() {
  const secretRef = mcpSecretRefInput.value.trim();
  const secret = mcpSecretInput.value.trim();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(secretRef)) {
    renderMcpSecretStatus("请先填写有效的 Secret Ref", true);
    mcpSecretRefInput.focus();
    return;
  }
  if (!secret) {
    renderMcpSecretStatus("请输入要保存的 MCP 密钥", true);
    mcpSecretInput.focus();
    return;
  }
  let resultMessage = "";
  let resultError = false;
  saveMcpSecretButton.disabled = true;
  renderMcpSecretStatus("正在加密保存…");
  try {
    const data = await api(`/api/admin/mcp-secrets/${encodeURIComponent(secretRef)}`, {
      method: "PUT",
      body: JSON.stringify({ secret, expectedRevision: mcpSecrets[secretRef]?.revision || undefined }),
    });
    if (data.item) mcpSecrets[secretRef] = data.item;
    resultMessage = "MCP 密钥已保存";
    setStatus(resultMessage);
  } catch (error) {
    resultMessage = error.message || "MCP 密钥保存失败";
    resultError = true;
    setStatus(resultMessage, true);
  } finally {
    clearMcpSecretInput();
    renderMcpSecretStatus(resultMessage, resultError);
  }
}

async function deleteMcpSecret() {
  clearMcpSecretInput();
  const secretRef = mcpSecretRefInput.value.trim();
  const item = mcpSecrets[secretRef];
  if (!item?.managed) return renderMcpSecretStatus("当前没有可删除的后台密钥", true);
  if (!(await confirmAdminAction(
    "删除 MCP 密钥？",
    item.environmentFallback ? `${secretRef} 将恢复使用同名 Worker Secret。` : `${secretRef} 删除后远程服务认证将不可用。`,
    "删除密钥",
  ))) return;
  deleteMcpSecretButton.disabled = true;
  renderMcpSecretStatus("正在删除…");
  try {
    const data = await api(`/api/admin/mcp-secrets/${encodeURIComponent(secretRef)}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: item.revision || undefined }),
    });
    if (data.item) mcpSecrets[secretRef] = data.item;
    renderMcpSecretStatus(data.item?.source === "worker" ? "后台密钥已删除，已恢复 Worker Secret" : "后台密钥已删除");
    setStatus("MCP 密钥已删除");
  } catch (error) {
    renderMcpSecretStatus(error.message || "MCP 密钥删除失败", true);
    setStatus(error.message || "MCP 密钥删除失败", true);
  }
}

async function discoverMcpTools() {
  const draft = readMcpEditor();
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(draft.serverId) || draft.serverId.length > 80) {
    return setStatus("请先填写有效的 MCP Server ID", true);
  }
  if (!isPublicHttpsEndpoint(draft.endpoint)) return setStatus("MCP 地址必须是公开 HTTPS 地址", true);
  if (draft.authType !== "none" && !/^[A-Z][A-Z0-9_]{1,63}$/.test(draft.secretRef)) {
    return setStatus("发现工具前需要有效的 Secret Ref", true);
  }
  discoverMcpToolsButton.disabled = true;
  mcpDiscoverySummary.textContent = "正在连接服务并读取工具…";
  clearMcpSecretInput();
  try {
    const data = await api("/api/admin/mcp-discovery", {
      method: "POST",
      body: JSON.stringify({
        serverId: draft.serverId,
        label: draft.label || draft.serverId,
        endpoint: draft.endpoint,
        authType: draft.authType,
        ...(draft.authType === "none" ? {} : { secretRef: draft.secretRef }),
      }),
    });
    syncConfigFromEditor();
    const previous = selectedMcp !== "__new" ? selectedMcp : "";
    if (previous && previous !== draft.serverId) {
      delete config.mcpServers?.[previous];
      removeMcpServerTools(previous);
    }
    config.mcpServers = config.mcpServers || {};
    config.mcpServers[draft.serverId] = compactObject({
      enabled: draft.enabled,
      label: draft.label || draft.serverId,
      endpoint: draft.endpoint,
      authType: draft.authType,
      secretRef: draft.authType === "none" ? "" : draft.secretRef,
    });
    config.tools = config.tools || {};
    let added = 0;
    let changed = 0;
    let refreshed = 0;
    for (const candidate of Array.isArray(data.tools) ? data.tools : []) {
      if (!candidate?.id || candidate.executor?.type !== "mcp" || candidate.executor.serverId !== draft.serverId) continue;
      const existing = config.tools[candidate.id];
      const schemaChanged = Boolean(existing && existing.schemaFingerprint !== candidate.schemaFingerprint);
      config.tools[candidate.id] = {
        ...candidate,
        enabled: existing && !schemaChanged ? existing.enabled === true : false,
        confirmation: existing && !schemaChanged && existing.confirmation === "always" ? "always" : "first-per-conversation",
      };
      if (!existing) added += 1;
      else if (schemaChanged) changed += 1;
      else refreshed += 1;
    }
    selectedMcp = draft.serverId;
    const saved = await attemptSaveConfig(`MCP 发现完成：新增 ${added}，更新 ${refreshed}，待复核 ${changed}`);
    if (!saved) return;
    mcpDiscoverySummary.textContent = `${Array.isArray(data.tools) ? data.tools.length : 0} 个可用工具 · ${Number(data.rejected) || 0} 个已跳过`;
  } catch (error) {
    mcpDiscoverySummary.textContent = error.message || "MCP 工具发现失败";
    setStatus(error.message || "MCP 工具发现失败", true);
  } finally {
    clearMcpSecretInput();
    discoverMcpToolsButton.disabled = false;
    renderMcpSecretStatus();
  }
}

function renderStoredRouteHealth(routeId) {
  if (!routeId || routeId === "__new") return setRouteHealth("");
  const health = routeHealth[routeId];
  if (!health) return setRouteHealth("暂无状态记录");
  const checkedAt = new Date(health.checkedAt);
  const time = Number.isNaN(checkedAt.valueOf()) ? "" : checkedAt.toLocaleString("zh-CN", { hour12: false });
  const latency = Number.isFinite(health.latencyMs) ? ` · ${health.latencyMs}ms` : "";
  const suffix = `${latency}${time ? ` · ${time}` : ""}`;
  if (health.status === "healthy") return setRouteHealth(`近期真实任务正常${suffix}`);
  if (health.status === "unhealthy") return setRouteHealth(`${health.message || "近期真实任务异常"}${suffix}`, true);
  if (health.status === "unavailable") return setRouteHealth(health.message || "线路配置不可用", true);
  setRouteHealth(health.message || "配置已就绪，暂无近期真实任务记录");
}

function syncConfigFromEditor() {
  const parsed = JSON.parse(configJsonInput.value);
  config = normalizeClientConfig(parsed);
}

async function saveConfigObject(message) {
  const data = await api("/api/admin/config", {
    method: "PUT",
    body: JSON.stringify({ config, expectedRevision: configRevision }),
  });
  config = normalizeClientConfig(data.config);
  configRevision = data.revision || configRevision;
  configJsonInput.value = JSON.stringify(config, null, 2);
  clearDirty("user", "provider", "route", "capability", "config");
  await loadDashboard(message);
}

async function attemptSaveConfig(message) {
  try {
    await saveConfigObject(message);
    return true;
  } catch (error) {
    setStatus(error.message || "配置保存失败", true);
    return false;
  }
}

function captureModelAdminState() {
  return {
    config: structuredClone(config),
    selectedProvider,
    selectedRoute,
  };
}

function restoreModelAdminState(state) {
  config = state.config;
  selectedProvider = state.selectedProvider;
  selectedRoute = state.selectedRoute;
}

function normalizeClientConfig(value) {
  const input = isClientRecord(value) ? value : {};
  return {
    defaults: isClientRecord(input.defaults) ? input.defaults : {},
    users: isClientRecord(input.users) ? input.users : {},
    providers: isClientRecord(input.providers) ? input.providers : {},
    routes: isClientRecord(input.routes) ? input.routes : {},
    skills: isClientRecord(input.skills) ? input.skills : {},
    tools: isClientRecord(input.tools) ? input.tools : {},
    mcpServers: isClientRecord(input.mcpServers) ? input.mcpServers : {},
  };
}

function isClientRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function renderCapabilityEditors() {
  renderSkillPicker();
  renderToolPicker();
  renderMcpPicker();
  showCapabilityTab(currentCapabilityTab);
}

function renderSkillPicker() {
  if (!skillSelect) return;
  const entries = Object.entries(config.skills || {}).sort((left, right) => {
    const order = (Number(left[1]?.order) || 0) - (Number(right[1]?.order) || 0);
    return order || left[0].localeCompare(right[0]);
  });
  skillSelect.textContent = "";
  for (const [skillId, skill] of entries) {
    const option = document.createElement("option");
    option.value = skillId;
    option.textContent = `${skill.label || skillId}${skill.enabled === true ? "" : "（已停用）"}`;
    skillSelect.append(option);
  }
  const newOption = document.createElement("option");
  newOption.value = "__new";
  newOption.textContent = "新增 Skill";
  skillSelect.append(newOption);
  if (selectedSkill !== "__new" && !config.skills?.[selectedSkill]) selectedSkill = entries[0]?.[0] || "__new";
  skillSelect.value = selectedSkill;
  populateSkillForm();
}

function populateSkillForm() {
  if (!skillForm) return;
  const skill = selectedSkill === "__new" ? {} : config.skills?.[selectedSkill] || {};
  skillIdInput.value = selectedSkill === "__new" ? "" : selectedSkill;
  skillLabelInput.value = skill.label || "";
  skillDescriptionInput.value = skill.description || "";
  skillInstructionsInput.value = skill.instructions || "";
  skillOrderInput.value = Number.isFinite(Number(skill.order)) ? String(Math.trunc(Number(skill.order))) : "0";
  skillEnabledInput.checked = skill.enabled === true;
  renderToolCheckboxes(skillToolsBox, Array.isArray(skill.toolIds) ? skill.toolIds : []);
  deleteSkillButton.disabled = selectedSkill === "__new";
}

function renderToolPicker() {
  if (!toolSelect) return;
  const entries = Object.entries(config.tools || {}).sort((left, right) => toolSortLabel(left).localeCompare(toolSortLabel(right), "zh-CN"));
  toolSelect.textContent = "";
  for (const [toolId, tool] of entries) {
    const option = document.createElement("option");
    option.value = toolId;
    option.textContent = `${tool.label || toolId}${tool.enabled === true ? "" : "（已停用）"}`;
    toolSelect.append(option);
  }
  if (!entries.some(([toolId]) => toolId === selectedTool)) selectedTool = entries[0]?.[0] || "";
  toolSelect.value = selectedTool;
  populateToolForm();
}

function toolSortLabel([toolId, tool]) {
  const source = tool?.executor?.type === "builtin" ? "0" : "1";
  return `${source}:${tool?.label || toolId}:${toolId}`;
}

function populateToolForm() {
  if (!toolForm) return;
  const tool = config.tools?.[selectedTool] || null;
  const builtin = tool?.executor?.type === "builtin";
  toolIdInput.value = selectedTool || "";
  toolLabelInput.value = tool?.label || "";
  toolDescriptionInput.value = tool?.description || "";
  toolSourceInput.value = builtin
    ? "内置 · text_stats"
    : tool?.executor?.type === "mcp"
      ? `MCP · ${config.mcpServers?.[tool.executor.serverId]?.label || tool.executor.serverId}`
      : "";
  toolEnabledInput.checked = tool?.enabled === true;
  toolConfirmationInput.value = builtin
    ? tool?.confirmation === "always" ? "always" : "auto"
    : tool?.confirmation === "always" ? "always" : "first-per-conversation";
  toolConfirmationInput.querySelector('option[value="auto"]').disabled = !builtin;
  toolConfirmationInput.querySelector('option[value="first-per-conversation"]').disabled = builtin;
  toolLabelInput.disabled = !tool;
  toolDescriptionInput.disabled = !tool;
  toolConfirmationInput.disabled = !tool;
  toolEnabledInput.disabled = !tool;
  deleteToolButton.disabled = !tool || builtin;
  if (!tool) {
    toolSchemaSummary.textContent = "尚未配置工具";
    return;
  }
  const properties = tool.inputSchema?.properties && typeof tool.inputSchema.properties === "object"
    ? Object.keys(tool.inputSchema.properties).length
    : 0;
  const fingerprint = typeof tool.schemaFingerprint === "string" ? ` · schema ${tool.schemaFingerprint.slice(0, 12)}` : "";
  toolSchemaSummary.textContent = `${builtin ? "本地只读工具" : "远程只读工具"} · ${properties} 个输入字段${fingerprint}`;
}

function renderMcpPicker() {
  if (!mcpSelect) return;
  const entries = Object.entries(config.mcpServers || {}).sort((left, right) => (left[1]?.label || left[0]).localeCompare(right[1]?.label || right[0], "zh-CN"));
  mcpSelect.textContent = "";
  for (const [serverId, server] of entries) {
    const option = document.createElement("option");
    option.value = serverId;
    option.textContent = `${server.label || serverId}${server.enabled === true ? "" : "（已停用）"}`;
    mcpSelect.append(option);
  }
  const newOption = document.createElement("option");
  newOption.value = "__new";
  newOption.textContent = "新增 MCP 服务";
  mcpSelect.append(newOption);
  if (selectedMcp !== "__new" && !config.mcpServers?.[selectedMcp]) selectedMcp = entries[0]?.[0] || "__new";
  mcpSelect.value = selectedMcp;
  populateMcpForm();
}

function populateMcpForm() {
  if (!mcpForm) return;
  clearMcpSecretInput();
  const server = selectedMcp === "__new" ? {} : config.mcpServers?.[selectedMcp] || {};
  mcpIdInput.value = selectedMcp === "__new" ? "" : selectedMcp;
  mcpLabelInput.value = server.label || "";
  mcpEndpointInput.value = server.endpoint || "";
  mcpAuthTypeInput.value = ["bearer", "x-api-key"].includes(server.authType) ? server.authType : "none";
  mcpSecretRefInput.value = server.secretRef || "";
  mcpEnabledInput.checked = server.enabled === true;
  deleteMcpButton.disabled = selectedMcp === "__new";
  mcpDiscoverySummary.textContent = selectedMcp === "__new"
    ? "保存或直接填写服务信息后发现只读工具"
    : `${mcpToolIds(selectedMcp).length} 个已登记工具`;
  renderMcpSecretStatus();
}

function renderToolCheckboxes(container, checkedIds) {
  if (!container) return;
  const selected = new Set(checkedIds);
  container.textContent = "";
  const entries = Object.entries(config.tools || {}).sort((left, right) => toolSortLabel(left).localeCompare(toolSortLabel(right), "zh-CN"));
  if (!entries.length) {
    container.append(textNode("尚未配置工具"));
    return;
  }
  for (const [toolId, tool] of entries) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = toolId;
    input.checked = selected.has(toolId);
    const disabled = tool.enabled !== true;
    label.classList.toggle("disabled-route-option", disabled);
    const source = tool.executor?.type === "builtin" ? "内置" : "MCP";
    label.append(input, document.createTextNode(`${tool.label || toolId} · ${source}${disabled ? "（已停用）" : ""}`));
    container.append(label);
  }
}

function readMcpEditor() {
  return {
    serverId: mcpIdInput.value.trim(),
    label: mcpLabelInput.value.trim().slice(0, 80),
    endpoint: mcpEndpointInput.value.trim(),
    authType: mcpAuthTypeInput.value,
    secretRef: mcpSecretRefInput.value.trim(),
    enabled: mcpEnabledInput.checked,
  };
}

function checkedValues(container) {
  return [...(container?.querySelectorAll("input[type='checkbox']:checked") || [])].map((input) => input.value);
}

function isPublicHttpsEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function pruneToolAssignments(toolId) {
  for (const skill of Object.values(config.skills || {})) {
    if (Array.isArray(skill.toolIds)) skill.toolIds = skill.toolIds.filter((id) => id !== toolId);
  }
  for (const user of [config.defaults, ...Object.values(config.users || {})]) {
    if (Array.isArray(user?.allowedTools)) user.allowedTools = user.allowedTools.filter((id) => id !== toolId);
  }
}

function replaceSkillAssignments(skillId, replacementId) {
  for (const user of [config.defaults, ...Object.values(config.users || {})]) {
    if (!Array.isArray(user?.allowedSkills)) continue;
    user.allowedSkills = [...new Set(user.allowedSkills.map((id) => id === skillId ? replacementId : id))];
  }
}

function pruneSkillAssignments(skillId) {
  for (const user of [config.defaults, ...Object.values(config.users || {})]) {
    if (Array.isArray(user?.allowedSkills)) user.allowedSkills = user.allowedSkills.filter((id) => id !== skillId);
  }
}

function removeMcpServerTools(serverId) {
  for (const [toolId, tool] of Object.entries(config.tools || {})) {
    if (tool.executor?.type !== "mcp" || tool.executor.serverId !== serverId) continue;
    delete config.tools[toolId];
    pruneToolAssignments(toolId);
  }
}

function mcpToolIds(serverId) {
  return Object.entries(config.tools || {})
    .filter(([, tool]) => tool.executor?.type === "mcp" && tool.executor.serverId === serverId)
    .map(([toolId]) => toolId);
}

function pruneRouteReferences(routeId, fallbackRoute) {
  const entries = [config.defaults, ...Object.values(config.users || {})].filter(Boolean);
  for (const user of entries) {
    if (Array.isArray(user.allowedRoutes)) {
      user.allowedRoutes = user.allowedRoutes.filter((id) => id !== routeId);
      if (!user.allowedRoutes.length && fallbackRoute) user.allowedRoutes = [fallbackRoute];
    }
    if (user.defaultRoute === routeId) user.defaultRoute = fallbackRoute;
  }
  for (const route of Object.values(config.routes || {})) {
    if (Array.isArray(route.fallbacks)) route.fallbacks = route.fallbacks.filter((id) => id !== routeId);
  }
}

function replaceRouteReferences(previousId, nextId) {
  if (!previousId || previousId === nextId) return;
  for (const user of [config.defaults, ...Object.values(config.users || {})]) {
    if (!user) continue;
    if (user.defaultRoute === previousId) user.defaultRoute = nextId;
    if (Array.isArray(user.allowedRoutes)) {
      user.allowedRoutes = [...new Set(user.allowedRoutes.map((id) => id === previousId ? nextId : id))];
    }
  }
  for (const route of Object.values(config.routes || {})) {
    if (!Array.isArray(route.fallbacks)) continue;
    route.fallbacks = [...new Set(route.fallbacks.map((id) => id === previousId ? nextId : id))];
  }
}

function routeLabel(routeId) {
  const route = config.routes?.[routeId];
  if (!route) return routeId;
  const model = route.model || route.offerings?.[0]?.model || routeId;
  return `${route.label || routeId} · ${model}`;
}

function providerLabel(providerId) {
  const provider = config.providers?.[providerId];
  return provider ? `${provider.label || providerId} · ${providerId}` : providerId;
}

function readProviderEditor() {
  const concurrency = ["exclusive", "bounded"].includes(providerConcurrencyInput.value)
    ? providerConcurrencyInput.value
    : "unlimited";
  return {
    providerId: providerIdInput.value.trim(),
    label: providerLabelInput.value.trim(),
    type: providerTypeInput.value === "anthropic-messages" ? "anthropic-messages" : "openai-chat",
    baseUrl: providerBaseUrlInput.value.trim(),
    apiKeyRef: providerKeyRefInput.value.trim(),
    concurrency,
    maxConcurrent: concurrency === "exclusive" ? 1 : Number(providerMaxConcurrentInput.value),
    queueTimeoutMs: concurrency === "unlimited" ? 10_000 : Number(providerQueueTimeoutInput.value),
    priority: finiteNumber(Number(providerPriorityInput.value), 0),
    enabled: providerEnabledInput.checked,
    directEndpoint: providerDirectEndpointInput.checked,
    allowUserKey: providerAllowUserKeyInput.checked,
    requiresUserKey: providerRequiresKeyInput.checked,
    supportsImages: providerImagesInput.checked,
    supportsTools: providerToolsInput.checked,
  };
}

function buildProviderFromEditor(editor, existing = {}) {
  const inherited = { ...existing };
  delete inherited.apiKey;
  if (inherited.hasLegacyKey === true && isConfiguredRouteSecret(editor.apiKeyRef)) {
    delete inherited.hasLegacyKey;
  }
  return compactObject({
    ...inherited,
    enabled: editor.enabled,
    label: editor.label || editor.providerId,
    type: editor.type,
    baseUrl: editor.baseUrl,
    apiKeyRef: editor.apiKeyRef,
    directEndpoint: editor.directEndpoint,
    allowUserKey: editor.allowUserKey,
    requiresUserKey: editor.requiresUserKey,
    supportsImages: editor.supportsImages,
    supportsTools: editor.supportsTools,
    concurrency: editor.concurrency,
    maxConcurrent: editor.concurrency === "bounded" ? editor.maxConcurrent : undefined,
    queueTimeoutMs: editor.concurrency === "unlimited" ? undefined : editor.queueTimeoutMs,
    priority: editor.priority,
  });
}

function replaceProviderReferences(previousId, nextId) {
  if (!previousId || previousId === nextId) return;
  for (const route of Object.values(config.routes || {})) {
    if (!Array.isArray(route.offerings)) continue;
    route.offerings = route.offerings.map((offering) => (
      offering.providerId === previousId ? { ...offering, providerId: nextId } : offering
    ));
  }
}

function readRouteEditor() {
  const rows = [...routeOfferingsList.querySelectorAll(".offering-row")];
  const offerings = rows.map((row) => {
    const priorityValue = row.querySelector(".offering-priority-input")?.value.trim() || "";
    const imagesValue = row.querySelector(".offering-images-input")?.value || "";
    const toolsValue = row.querySelector(".offering-tools-input")?.value || "";
    return compactObject({
      providerId: row.querySelector(".offering-provider-input")?.value.trim() || "",
      model: row.querySelector(".offering-model-input")?.value.trim() || "",
      enabled: row.querySelector(".offering-enabled-input")?.checked !== false,
      priority: priorityValue ? Number(priorityValue) : undefined,
      supportsImages: imagesValue ? imagesValue === "true" : undefined,
      supportsTools: toolsValue ? toolsValue === "true" : undefined,
    });
  });
  const existing = selectedRoute === "__new" ? {} : config.routes?.[selectedRoute] || {};
  return {
    routeId: routeIdInput.value.trim(),
    label: routeLabelInput.value.trim(),
    fallbacks: splitCsv(routeFallbacksInput.value),
    enabled: routeEnabledInput.checked,
    allowUserKey: routeAllowUserKeyInput.checked,
    requiresUserKey: routeRequiresKeyInput.checked,
    supportsImages: routeImagesInput.checked,
    supportsTools: routeToolsInput.checked,
    offerings,
    invalidOffering: offerings.some((offering) => !offering.providerId || !offering.model || !config.providers?.[offering.providerId]),
    duplicateProvider: offerings.find((offering, index) => offerings.findIndex((item) => item.providerId === offering.providerId) !== index)?.providerId || "",
    legacy: isLegacyRoute(existing) && !offerings.length,
  };
}

function buildRouteFromEditor(editor, existing = {}) {
  const inherited = { ...existing };
  if (editor.offerings.length) {
    for (const field of ["type", "baseUrl", "model", "apiKey", "apiKeyRef", "authHeader", "authPrefix", "directEndpoint", "headers"]) {
      delete inherited[field];
    }
  }
  return compactObject({
    ...inherited,
    label: editor.label || editor.routeId,
    offerings: editor.offerings,
    fallbacks: editor.fallbacks,
    enabled: editor.enabled,
    allowUserKey: editor.allowUserKey,
    requiresUserKey: editor.requiresUserKey,
    supportsImages: editor.supportsImages,
    supportsTools: editor.supportsTools,
  });
}

function isLegacyRoute(route) {
  return Boolean(
    route
    && (route.type === "openai-chat" || route.type === "anthropic-messages")
    && typeof route.baseUrl === "string"
    && route.baseUrl
    && typeof route.model === "string"
    && route.model,
  );
}

async function migrateLegacyRoute() {
  const routeId = selectedRoute;
  if (!routeId) return;
  syncConfigFromEditor();
  const current = config.routes?.[routeId];
  if (!isLegacyRoute(current)) return setStatus("线路已变化，请刷新后重试", true);
  const apiKeyRef = typeof current.apiKeyRef === "string" ? current.apiKeyRef.trim() : "";
  if (current.hasLegacyKey === true && !isConfiguredRouteSecret(apiKeyRef)) {
    const instruction = apiKeyRef
      ? `请先为 ${apiKeyRef} 录入后台密钥或配置同名 Worker Secret，再执行迁移。`
      : "请先在高级配置中为该旧式线路设置 API Key Ref，并录入后台密钥，再执行迁移。";
    setStatus(instruction, true);
    return;
  }
  const providerId = uniqueProviderId(normalizeRouteId(`${routeId}-provider`) || "provider", config.providers || {});
  const credentialNote = current.hasLegacyKey === true ? "旧式 Key 不会复制到新服务商。" : "";
  if (!(await confirmAdminAction(
    "迁移旧式线路？",
    `${routeLabel(routeId)} 将改为逻辑模型，并创建服务商 ${providerId}。${credentialNote}`,
    "开始迁移",
  ))) return;
  const rollbackState = captureModelAdminState();
  config.providers = config.providers || {};
  config.providers[providerId] = compactObject({
    enabled: current.enabled !== false,
    label: current.label || providerId,
    type: current.type,
    baseUrl: current.baseUrl,
    apiKeyRef: current.apiKeyRef,
    authHeader: current.authHeader,
    authPrefix: current.authPrefix,
    directEndpoint: current.directEndpoint === true,
    headers: current.headers,
    headerSourceRouteId: current.hasCustomHeaders === true ? routeId : undefined,
    allowUserKey: current.allowUserKey !== false,
    requiresUserKey: current.requiresUserKey === true,
    supportsImages: current.supportsImages !== false,
    supportsTools: current.supportsTools === true,
    concurrency: "unlimited",
    priority: 0,
  });
  const migrated = { ...current };
  for (const field of ["type", "baseUrl", "model", "apiKey", "apiKeyRef", "hasLegacyKey", "authHeader", "authPrefix", "directEndpoint", "headers"]) {
    delete migrated[field];
  }
  migrated.offerings = [{
    providerId,
    model: current.model,
    enabled: true,
    supportsImages: current.supportsImages !== false,
    supportsTools: current.supportsTools === true,
  }];
  config.routes[routeId] = migrated;
  selectedProvider = providerId;
  const saved = await attemptSaveConfig("旧式线路已迁移到服务商池");
  if (!saved) restoreModelAdminState(rollbackState);
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

function positiveInteger(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function nonNegativeInteger(value, max, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(0, parsed)) : fallback;
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
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
  adminStatus.classList.toggle("is-error", isError);
}

function confirmAdminAction(title, description, confirmLabel = "确认") {
  if (!adminDialog) return Promise.resolve(false);
  adminDialogTitle.textContent = title;
  adminDialogDescription.textContent = description;
  adminDialogConfirm.textContent = confirmLabel;
  adminDialog.returnValue = "";
  adminDialog.showModal();
  return new Promise((resolve) => {
    adminDialog.addEventListener("close", () => resolve(adminDialog.returnValue === "confirm"), { once: true });
  });
}

function markDirty(scope) {
  dirtyScopes.add(scope);
  if (!document.title.startsWith("• ")) document.title = `• ${document.title}`;
}

function clearDirty(...scopes) {
  if (scopes.length) {
    for (const scope of scopes) dirtyScopes.delete(scope);
  } else {
    dirtyScopes.clear();
  }
  if (!dirtyScopes.size) document.title = document.title.replace(/^•\s*/, "");
}

async function confirmDiscardChanges(action) {
  if (!dirtyScopes.size) return true;
  const confirmed = await confirmAdminAction(
    "放弃未保存的更改？",
    `${action}会丢弃当前尚未保存的编辑内容。`,
    "放弃更改",
  );
  if (confirmed) resetUnsavedEditors();
  return confirmed;
}

function resetUnsavedEditors() {
  configJsonInput.value = JSON.stringify(config, null, 2);
  accessCodesInput.value = savedAccessCodes;
  adminMemoryInput.value = savedMemory;
  renderAccessEntries();
  populateUserForm();
  populateProviderForm();
  populateRouteForm();
  renderCapabilityEditors();
  clearProviderSecretInput();
  clearMcpSecretInput();
  clearDirty();
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
    savedMemory = "";
    selectedMemoryUser = "";
    return;
  }
  memoryUserSelect.value = labels.includes(previous) ? previous : labels[0];
  selectedMemoryUser = memoryUserSelect.value;
}

async function loadAdminMemory() {
  if (!memoryUserSelect?.value) return;
  selectedMemoryUser = memoryUserSelect.value;
  setStatus("读取记忆中");
  try {
    const data = await api(`/api/admin/memory?label=${encodeURIComponent(memoryUserSelect.value)}`);
    adminMemoryInput.maxLength = Number(data.maxChars) || 4000;
    adminMemoryInput.value = data.memory || "";
    memoryRevision = data.revision || "";
    savedMemory = adminMemoryInput.value;
    setStatus(`已读取 ${memoryUserSelect.value} 的记忆`);
  } catch (error) {
    setStatus(error.message || "读取记忆失败", true);
  }
}

async function saveAdminMemory(isClear = false) {
  if (!memoryUserSelect?.value) return;
  setStatus("保存记忆中");
  try {
    const data = await api("/api/admin/memory", {
      method: "PUT",
      body: JSON.stringify({
        label: memoryUserSelect.value,
        memory: adminMemoryInput.value,
        expectedRevision: memoryRevision,
      }),
    });
    memoryRevision = data.revision || memoryRevision;
    savedMemory = adminMemoryInput.value;
    clearDirty("memory");
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

async function saveProviderSecret() {
  const apiKeyRef = providerKeyRefInput.value.trim();
  const apiKey = providerSecretInput.value.trim();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(apiKeyRef)) {
    renderProviderSecretStatus("请先填写有效的 API Key Ref", true);
    providerKeyRefInput.focus();
    return;
  }
  if (!apiKey) {
    renderProviderSecretStatus("请输入要保存的服务商密钥", true);
    providerSecretInput.focus();
    return;
  }

  let resultMessage = "";
  let resultError = false;
  saveProviderSecretButton.disabled = true;
  renderProviderSecretStatus("正在加密保存…");
  try {
    const data = await api(`/api/admin/route-secrets/${encodeURIComponent(apiKeyRef)}`, {
      method: "PUT",
      body: JSON.stringify({
        apiKey,
        expectedRevision: routeSecrets[apiKeyRef]?.revision || undefined,
      }),
    });
    if (data.item) routeSecrets[apiKeyRef] = data.item;
    resultMessage = "后台服务商密钥已保存";
    setStatus(resultMessage);
  } catch (error) {
    resultMessage = error.message || "服务商密钥保存失败";
    resultError = true;
    setStatus(resultMessage, true);
  } finally {
    clearProviderSecretInput();
    renderProviderSecretStatus(resultMessage, resultError);
  }
}

async function deleteProviderSecret() {
  clearProviderSecretInput();
  const apiKeyRef = providerKeyRefInput.value.trim();
  const item = routeSecrets[apiKeyRef];
  if (!item?.managed) {
    renderProviderSecretStatus("当前没有可删除的后台密钥", true);
    return;
  }
  if (!(await confirmAdminAction(
    "删除后台服务商密钥？",
    item.environmentFallback
      ? `${apiKeyRef} 将恢复使用同名 Worker Secret。`
      : `${apiKeyRef} 删除后将不可用于服务端请求。`,
    "删除密钥",
  ))) return;

  deleteProviderSecretButton.disabled = true;
  renderProviderSecretStatus("正在删除…");
  try {
    const data = await api(`/api/admin/route-secrets/${encodeURIComponent(apiKeyRef)}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: item.revision || undefined }),
    });
    if (data.item) routeSecrets[apiKeyRef] = data.item;
    renderProviderSecretStatus(data.item?.source === "worker" ? "后台密钥已删除，已恢复 Worker Secret" : "后台密钥已删除");
    setStatus("后台服务商密钥已删除");
  } catch (error) {
    renderProviderSecretStatus(error.message || "服务商密钥删除失败", true);
    setStatus(error.message || "服务商密钥删除失败", true);
  }
}

async function checkRouteHealth() {
  const routeId = selectedRoute === "__new" ? routeIdInput.value.trim() : selectedRoute;
  if (!routeId) {
    setRouteHealth("请先选择或填写线路 ID", true);
    return;
  }
  setRouteHealth("正在读取配置与真实任务状态…");
  healthRouteButton.disabled = true;
  try {
    const data = await api("/api/admin/route-health", {
      method: "POST",
      body: JSON.stringify({ routeId }),
    });
    routeHealth[routeId] = data;
    renderRoutePicker();
    selectedRoute = routeId;
    routeAdminSelect.value = routeId;
    populateRouteForm();
    renderStoredRouteHealth(routeId);
  } catch (error) {
    setRouteHealth(error.message || "检查失败", true);
    try {
      const healthData = await api("/api/admin/route-health");
      routeHealth = healthData?.routes || routeHealth;
      if (config.routes?.[routeId]) {
        selectedRoute = routeId;
        renderRoutePicker();
      }
    } catch {}
  } finally {
    healthRouteButton.disabled = false;
  }
}

async function checkAllRoutesHealth() {
  const routeIds = Object.keys(config.routes || {});
  if (!routeIds.length) return setRouteHealth("没有可读取的线路", true);
  const previousRoute = selectedRoute;
  healthRouteButton.disabled = true;
  healthAllRoutesButton.disabled = true;
  setRouteHealth(`正在读取 ${routeIds.length} 条线路状态…`);
  try {
    const healthData = await api("/api/admin/route-health");
    routeHealth = healthData?.routes || routeHealth;
    selectedRoute = config.routes?.[previousRoute] ? previousRoute : routeIds[0];
    renderRoutePicker();
    const results = Object.values(routeHealth);
    const healthy = results.filter((item) => item?.status === "healthy").length;
    const unhealthy = results.filter((item) => item?.status === "unhealthy" || item?.status === "unavailable").length;
    const unknown = results.filter((item) => item?.status === "unknown").length;
    setRouteHealth(`状态已刷新 · 正常 ${healthy} · 异常 ${unhealthy} · 暂无任务 ${unknown}`, unhealthy > 0);
  } catch (error) {
    setRouteHealth(error.message || "批量状态读取失败", true);
  } finally {
    healthRouteButton.disabled = false;
    healthAllRoutesButton.disabled = false;
  }
}

async function fetchProviderModels() {
  const providerId = selectedProvider === "__new" ? "" : selectedProvider;
  if (!providerId || !config.providers?.[providerId]) {
    setProviderStatus("请先保存服务商配置", true);
    return;
  }
  if (dirtyScopes.has("provider")) {
    setProviderStatus("服务商配置有未保存修改，请先保存", true);
    return;
  }
  setProviderStatus("正在拉取模型列表…");
  fetchProviderModelsButton.disabled = true;
  try {
    const data = await api("/api/admin/route-models", {
      method: "POST",
      body: JSON.stringify({ providerId }),
    });
    const models = Array.isArray(data.models) ? data.models : [];
    providerModelSuggestions = [...new Set(models.filter((model) => typeof model === "string" && model.trim()).map((model) => model.trim()))];
    selectedProviderModels = new Set();
    setProviderStatus(`已拉取 ${providerModelSuggestions.length} 个模型`);
    openProviderModelDialog();
  } catch (error) {
    setProviderStatus(error.message || "模型列表拉取失败", true);
  } finally {
    fetchProviderModelsButton.disabled = false;
  }
}

function invalidateRouteModels() {
  providerModelSuggestions = [];
  selectedProviderModels = new Set();
  if (providerModelDialog?.open) providerModelDialog.close();
  if (providerModelSearchInput) providerModelSearchInput.value = "";
  if (providerModelPrefixInput) providerModelPrefixInput.value = "";
  renderProviderModelList();
}

function openProviderModelDialog() {
  if (!providerModelDialog || !providerModelSuggestions.length) {
    setProviderStatus("当前服务商没有可用模型", true);
    return;
  }
  providerModelSearchInput.value = "";
  if (!providerModelPrefixInput.value.trim()) providerModelPrefixInput.value = deriveProviderModelPrefix();
  renderProviderModelList();
  if (!providerModelDialog.open) providerModelDialog.showModal();
  providerModelSearchInput.focus();
}

function renderProviderModelList() {
  if (!providerModelList) return;
  const query = providerModelSearchInput?.value.trim().toLocaleLowerCase() || "";
  const visible = providerModelSuggestions.filter((model) => model.toLocaleLowerCase().includes(query));
  providerModelList.textContent = "";

  for (const model of visible) {
    const row = document.createElement("div");
    row.className = "route-model-row";
    const select = document.createElement("input");
    select.type = "checkbox";
    select.checked = selectedProviderModels.has(model);
    select.setAttribute("aria-label", `选择 ${model} 添加到模型池`);
    select.addEventListener("change", () => {
      if (select.checked) selectedProviderModels.add(model);
      else selectedProviderModels.delete(model);
      updateProviderModelSelection();
    });
    const use = document.createElement("button");
    use.type = "button";
    use.className = "route-model-use";
    use.textContent = model;
    use.title = `选择 ${model}`;
    use.addEventListener("click", () => {
      if (selectedProviderModels.has(model)) selectedProviderModels.delete(model);
      else selectedProviderModels.add(model);
      select.checked = selectedProviderModels.has(model);
      updateProviderModelSelection();
    });
    row.append(select, use);
    providerModelList.append(row);
  }

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "route-model-empty";
    empty.textContent = "没有匹配的模型";
    providerModelList.append(empty);
  }

  if (providerModelDialogSummary) {
    providerModelDialogSummary.textContent = query
      ? `共 ${providerModelSuggestions.length} 个模型，当前显示 ${visible.length} 个`
      : `共 ${providerModelSuggestions.length} 个模型，当前显示完整列表`;
  }
  updateProviderModelSelection();
}

function updateProviderModelSelection() {
  const count = selectedProviderModels.size;
  if (providerModelSelectionStatus) providerModelSelectionStatus.textContent = count ? `已选择 ${count} 个模型` : "未选择模型";
  if (batchAddOfferingsButton) batchAddOfferingsButton.disabled = count === 0;
}

async function addSelectedProviderOfferings() {
  const models = [...selectedProviderModels];
  if (!models.length) return;

  let parsedConfig;
  try {
    parsedConfig = normalizeClientConfig(JSON.parse(configJsonInput.value));
  } catch {
    providerModelSelectionStatus.textContent = "高级配置 JSON 无法解析，请先修正";
    return;
  }

  const providerId = selectedProvider === "__new" ? "" : selectedProvider;
  const provider = parsedConfig.providers?.[providerId];
  if (!provider) {
    providerModelSelectionStatus.textContent = "请先保存服务商配置";
    return;
  }
  const prefix = normalizeRouteId(providerModelPrefixInput.value);
  if (!prefix) {
    providerModelSelectionStatus.textContent = "请填写有效的模型 ID 前缀";
    providerModelPrefixInput.focus();
    return;
  }

  const nextRoutes = { ...(parsedConfig.routes || {}) };
  const created = [];
  const merged = [];
  const skipped = [];
  for (const model of models) {
    const match = findLogicalRouteForModel(model, nextRoutes);
    if (match) {
      const [routeId, route] = match;
      const offerings = Array.isArray(route.offerings) ? [...route.offerings] : [];
      if (offerings.some((offering) => offering.providerId === providerId)) {
        skipped.push(model);
        continue;
      }
      nextRoutes[routeId] = { ...route, offerings: [...offerings, { providerId, model, enabled: true }] };
      merged.push({ routeId, model });
      continue;
    }
    const routeId = uniqueRouteId(`${prefix}-${normalizeRouteId(model) || "model"}`, nextRoutes);
    nextRoutes[routeId] = compactObject({
      label: model,
      offerings: [{ providerId, model, enabled: true }],
      enabled: true,
      allowUserKey: true,
      requiresUserKey: false,
      supportsImages: provider.supportsImages !== false,
      supportsTools: provider.supportsTools === true,
    });
    created.push({ routeId, model });
  }

  const changed = [...merged, ...created];
  if (!changed.length) {
    providerModelSelectionStatus.textContent = skipped.length ? "所选模型已关联当前服务商" : "没有可添加的模型";
    return;
  }

  const previousConfig = config;
  const previousSelectedRoute = selectedRoute;
  config = { ...parsedConfig, routes: nextRoutes };
  selectedRoute = changed[0].routeId;
  batchAddOfferingsButton.disabled = true;
  const saved = await attemptSaveConfig(
    `已新增 ${created.length} 个逻辑模型，合并 ${merged.length} 个服务商映射${skipped.length ? `，跳过 ${skipped.length} 个已有映射` : ""}`,
  );
  if (!saved) {
    config = previousConfig;
    selectedRoute = previousSelectedRoute;
    providerModelSelectionStatus.textContent = "保存失败，请检查配置后重试";
    batchAddOfferingsButton.disabled = false;
    return;
  }

  selectedProviderModels = new Set();
  if (providerModelDialog.open) providerModelDialog.close();
}

function findLogicalRouteForModel(model, routes) {
  return Object.entries(routes).find(([, route]) => (
    !isLegacyRoute(route)
    && Array.isArray(route.offerings)
    && route.offerings.some((offering) => offering.model === model)
  ));
}

function deriveProviderModelPrefix() {
  const providerId = selectedProvider === "__new" ? providerIdInput.value : selectedProvider;
  const label = normalizeRouteId(providerLabelInput.value);
  return label || normalizeRouteId(providerId) || "model";
}

function uniqueProviderId(candidate, providers) {
  const base = candidate.slice(0, 80) || "provider";
  if (!providers[base]) return base;
  let suffix = 2;
  let next = "";
  do {
    const suffixText = `-${suffix++}`;
    next = `${base.slice(0, 80 - suffixText.length)}${suffixText}`;
  } while (providers[next]);
  return next;
}

function normalizeRouteId(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 72);
}

function uniqueRouteId(candidate, routes) {
  const base = candidate.slice(0, 72) || "model";
  if (!routes[base]) return base;
  let suffix = 2;
  let next = "";
  do {
    const suffixText = `-${suffix++}`;
    next = `${base.slice(0, 72 - suffixText.length)}${suffixText}`;
  } while (routes[next]);
  return next;
}

function setRouteHealth(message, isError = false) {
  if (!routeHealthStatus) {
    setStatus(message, isError);
    return;
  }
  routeHealthStatus.textContent = message;
  routeHealthStatus.classList.toggle("is-error", isError);
}

function setProviderStatus(message, isError = false) {
  if (!providerStatus) {
    setStatus(message, isError);
    return;
  }
  providerStatus.textContent = message;
  providerStatus.classList.toggle("is-error", isError);
}
