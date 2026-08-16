import crypto from "node:crypto";
import {
  isProductionAcceptanceLabel,
  retryTemporaryMemberDeletion,
  runProductionAcceptanceCleanup,
  waitForTemporaryMemberSessionRevocation,
} from "./production-acceptance-cleanup.mjs";

const productionUrl = process.env.PRODUCTION_URL?.trim() || process.argv[2] || "";
const adminToken = process.env.ADMIN_TOKEN?.trim() || "";
const expectedReleaseSha = process.env.EXPECTED_RELEASE_SHA?.trim() || process.env.GITHUB_SHA?.trim() || process.argv[3] || "";
const requestTimeoutMs = 15_000;
// KV-backed access updates may need close to a minute to reach another edge.
// Keep attempts below the per-source eight-failure throttle while covering that window.
const loginAttempts = 5;
const loginRetryDelayMs = 15_000;
const memberCleanupAttempts = 8;
const memberCleanupRetryDelayMs = 5_000;

if (!productionUrl) {
  throw new Error("PRODUCTION_URL is required");
}
const baseUrl = new URL(productionUrl);
const localHttp = baseUrl.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
if (baseUrl.protocol !== "https:" && !localHttp) {
  throw new Error("Production acceptance requires HTTPS; HTTP is allowed only for localhost verification");
}
if (!adminToken) {
  throw new Error("ADMIN_TOKEN is required");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cookieFromResponse(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const value = values.find((item) => item.includes("="));
  return value ? value.split(";", 1)[0] : "";
}

async function request(path, { cookie = "", method = "GET", body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (cookie) requestHeaders.set("Cookie", cookie);
  if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
  return fetch(new URL(path, baseUrl), {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

async function json(response, operation) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation}: response was not JSON`);
  }
}

async function expectStatus(response, expected, operation) {
  if (response.status !== expected) {
    throw new Error(`${operation}: expected HTTP ${expected}, got ${response.status}`);
  }
}

async function verifyReleaseRevision(operation) {
  if (!expectedReleaseSha) return;
  const response = await request(`/release.json?acceptance=${Date.now()}`);
  await expectStatus(response, 200, operation);
  const payload = await json(response, operation);
  assert(
    payload.commit === expectedReleaseSha,
    `${operation}: expected deployed commit ${expectedReleaseSha}, got ${payload.commit || "missing"}`,
  );
}

async function adminLogin() {
  const response = await request("/api/admin/login", { method: "POST", body: { token: adminToken } });
  await expectStatus(response, 200, "admin login");
  const cookie = cookieFromResponse(response);
  assert(cookie, "admin login: session cookie missing");
  return cookie;
}

async function getAccessCodes(cookie) {
  const response = await request("/api/admin/access-codes", { cookie });
  await expectStatus(response, 200, "read access-code configuration");
  const payload = await json(response, "read access-code configuration");
  assert(typeof payload.accessCodes === "string", "read access-code configuration: value missing");
  assert(typeof payload.revision === "string" && payload.revision, "read access-code configuration: revision missing");
  assert(
    payload.source === "kv" || payload.source === "secret" || payload.source === "managed",
    "read access-code configuration: invalid source",
  );
  return payload;
}

async function putAccessCodes(cookie, accessCodes, expectedRevision) {
  const response = await request("/api/admin/access-codes", {
    cookie,
    method: "PUT",
    body: { accessCodes, expectedRevision },
  });
  await expectStatus(response, 200, "write access-code configuration");
  const payload = await json(response, "write access-code configuration");
  assert(typeof payload.revision === "string" && payload.revision, "write access-code configuration: revision missing");
  return payload;
}

async function deleteAccessCodes(cookie, expectedRevision, operation) {
  const response = await request("/api/admin/access-codes", {
    cookie,
    method: "DELETE",
    body: { expectedRevision },
  });
  await expectStatus(response, 200, operation);
}

function parseAccessCodes(accessCodes) {
  return accessCodes
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      const label = separator === -1 ? "friend" : entry.slice(0, separator).trim() || "friend";
      const code = separator === -1 ? entry : entry.slice(separator + 1).trim();
      return { label, code };
    })
    .filter((entry) => entry.code);
}

function makeMember(labelSuffix) {
  const nonce = crypto.randomBytes(12).toString("hex");
  return {
    label: `codex-accept-${nonce}-${labelSuffix}`,
    code: crypto.randomBytes(32).toString("base64url"),
    chatId: `codex-accept-${nonce}-${labelSuffix}-chat`,
    cookie: "",
    instance: "",
  };
}

function buildTemporaryAccessCodes(original, members) {
  const entries = parseAccessCodes(original.accessCodes);
  const labels = new Set(entries.map((entry) => entry.label));
  const codes = new Set(entries.map((entry) => entry.code));
  for (const member of members) {
    assert(!labels.has(member.label) && !codes.has(member.code), "temporary member identifier collision");
  }
  const temporaryEntries = members.map((member) => `${member.label}:${member.code}`).join(",");
  return original.accessCodes.trim()
    ? `${original.accessCodes.trim()},${temporaryEntries}`
    : temporaryEntries;
}

async function loginMember(member) {
  for (let attempt = 1; attempt <= loginAttempts; attempt += 1) {
    const response = await request("/api/login", { method: "POST", body: { code: member.code } });
    if (response.status === 200) {
      const cookie = cookieFromResponse(response);
      assert(cookie, "member login: session cookie missing");
      member.cookie = cookie;
      return;
    }
    if (response.status !== 401 && response.status !== 503) {
      throw new Error(`member login: unexpected HTTP ${response.status}`);
    }
    if (attempt < loginAttempts) await sleep(loginRetryDelayMs);
  }
  throw new Error("member login: temporary access code was not observed in time");
}

async function sessionProjection(member) {
  const response = await request("/api/session", { cookie: member.cookie });
  await expectStatus(response, 200, "member session");
  const payload = await json(response, "member session");
  assert(payload.authenticated === true, "member session: not authenticated");
  assert(payload.user === member.label, "member session: label projection mismatch");
  assert(payload.agent?.transport === "cloudflare-ai-chat", "member session: Agent transport mismatch");
  assert(payload.agent?.className === "team-agent", "member session: Agent class mismatch");
  assert(payload.agent?.basePath === "agent", "member session: Agent base path mismatch");
  assert(typeof payload.agent?.instance === "string" && payload.agent.instance, "member session: Agent instance missing");
  assert(!payload.agent.instance.includes(member.label), "member session: Agent instance leaks label");
  member.instance = payload.agent.instance;
  return payload;
}

async function modelAvailability(member) {
  const response = await request("/api/model-availability", { cookie: member.cookie });
  await expectStatus(response, 200, "member model availability");
  const payload = await json(response, "member model availability");
  assert(isMemberAvailabilityProjection(payload), "member model availability: invalid or privacy-unsafe projection");
  return payload.routes.length;
}

function isMemberAvailabilityProjection(value) {
  if (!isRecord(value)
    || !hasExactKeys(value, ["version", "generatedAt", "window", "routes"])
    || value.version !== 1
    || !isNonNegativeInteger(value.generatedAt)
    || value.window !== "24h"
    || !Array.isArray(value.routes)
    || value.routes.length > 500) return false;
  const ids = new Set();
  for (const route of value.routes) {
    if (!isRecord(route)
      || !hasExactKeys(route, ["routeId", "label", "model", "status", "confidence", "speed", "observedAt", "fallbackRecentlyUsed", "message"])
      || !isBoundedString(route.routeId, 200)
      || !isBoundedString(route.label, 300)
      || !isBoundedString(route.model, 200)
      || !["healthy", "degraded", "unavailable", "unknown"].includes(route.status)
      || route.message !== route.status
      || !["recent", "limited", "stale"].includes(route.confidence)
      || !["fast", "normal", "slow", "unknown"].includes(route.speed)
      || (route.observedAt !== null && !isNonNegativeInteger(route.observedAt))
      || typeof route.fallbackRecentlyUsed !== "boolean"
      || ids.has(route.routeId)) return false;
    ids.add(route.routeId);
  }
  return true;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isBoundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

async function listConversations(member) {
  const response = await request("/api/agent/conversations", { cookie: member.cookie });
  await expectStatus(response, 200, "conversation list");
  const payload = await json(response, "conversation list");
  assert(Array.isArray(payload.conversations), "conversation list: conversations missing");
  return payload.conversations;
}

async function getMemory(member) {
  const response = await request("/api/agent/memory", { cookie: member.cookie });
  await expectStatus(response, 200, "memory read");
  const payload = await json(response, "memory read");
  assert(typeof payload.memory === "string" && typeof payload.revision === "string", "memory read: invalid payload");
  return payload;
}

async function createConversation(member) {
  const response = await request("/api/agent/conversations", {
    cookie: member.cookie,
    method: "POST",
    body: { id: member.chatId, title: "Production acceptance" },
  });
  await expectStatus(response, 201, "conversation create");
  const payload = await json(response, "conversation create");
  assert(payload.conversation?.id === member.chatId, "conversation create: id mismatch");
  assert(Number.isFinite(payload.conversation.updatedAt) && payload.conversation.updatedAt > 0, "conversation create: timestamp missing");
  return payload.conversation;
}

async function updateConversation(member, conversation, title) {
  const response = await request(`/api/agent/conversations/${encodeURIComponent(member.chatId)}`, {
    cookie: member.cookie,
    method: "PATCH",
    body: { title, expectedUpdatedAt: conversation.updatedAt },
  });
  await expectStatus(response, 200, "conversation update");
  const payload = await json(response, "conversation update");
  assert(payload.conversation?.title === title, "conversation update: title mismatch");
  return payload.conversation;
}

async function assertConversationConflict(member, expectedUpdatedAt) {
  const response = await request(`/api/agent/conversations/${encodeURIComponent(member.chatId)}`, {
    cookie: member.cookie,
    method: "PATCH",
    body: { title: "Stale title", expectedUpdatedAt },
  });
  await expectStatus(response, 409, "stale conversation update");
}

async function putMemory(member, memory, expectedRevision) {
  const response = await request("/api/agent/memory", {
    cookie: member.cookie,
    method: "PUT",
    body: { memory, expectedRevision },
  });
  await expectStatus(response, 200, "memory update");
  const payload = await json(response, "memory update");
  assert(payload.memory === memory, "memory update: content mismatch");
  assert(typeof payload.revision === "string" && payload.revision, "memory update: revision missing");
  return payload;
}

async function assertMemoryConflict(member, expectedRevision) {
  const response = await request("/api/agent/memory", {
    cookie: member.cookie,
    method: "PUT",
    body: { memory: "stale memory", expectedRevision },
  });
  await expectStatus(response, 409, "stale memory update");
}

async function openAgentSocket(member) {
  const { default: WebSocket } = await import("ws");
  const socketUrl = new URL(`/agent?chatId=${encodeURIComponent(member.chatId)}&_pk=${crypto.randomUUID()}`, baseUrl);
  socketUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, {
      headers: { Cookie: member.cookie, Origin: baseUrl.origin },
      handshakeTimeout: requestTimeoutMs,
    });
    let settled = false;
    const finish = (error, identity) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.terminate();
      if (error) reject(error);
      else resolve(identity);
    };
    const timer = setTimeout(() => finish(new Error("Agent WebSocket: identity timeout")), requestTimeoutMs);
    socket.on("unexpected-response", (_request, response) => {
      finish(new Error(`Agent WebSocket: unexpected HTTP ${response.statusCode}`));
    });
    socket.on("error", () => finish(new Error("Agent WebSocket: connection failed")));
    socket.on("message", (data) => {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (payload?.type !== "cf_agent_identity") return;
      try {
        assert(payload.agent === "team-agent", "Agent WebSocket: class identity mismatch");
        assert(typeof payload.name === "string" && payload.name, "Agent WebSocket: instance identity missing");
        assert(!payload.name.includes(member.label), "Agent WebSocket: instance leaks label");
        finish(null, payload.name);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Agent WebSocket: invalid identity"));
      }
    });
  });
}

async function deleteConversation(member, conversation) {
  const response = await request(
    `/api/agent/conversations/${encodeURIComponent(member.chatId)}?expectedUpdatedAt=${encodeURIComponent(conversation.updatedAt)}`,
    { cookie: member.cookie, method: "DELETE" },
  );
  assert(response.status === 200 || response.status === 202, `conversation delete: unexpected HTTP ${response.status}`);
  const payload = await json(response, "conversation delete");
  assert(payload.deleted === true && Array.isArray(payload.conversations), "conversation delete: invalid payload");
}

async function assertDeletedConversation(member) {
  const response = await request(`/agent?chatId=${encodeURIComponent(member.chatId)}`, { cookie: member.cookie });
  await expectStatus(response, 410, "deleted conversation reconnect");
  const recreate = await request("/api/agent/conversations", {
    cookie: member.cookie,
    method: "POST",
    body: { id: member.chatId },
  });
  await expectStatus(recreate, 410, "deleted conversation recreate");
}

async function deleteTemporaryMemberData(member, { allowUnauthorized = false } = {}) {
  let finalResponse;
  await retryTemporaryMemberDeletion(
    async () => {
      finalResponse = await request("/api/user-data", { cookie: member.cookie, method: "DELETE" });
      return finalResponse.status;
    },
    {
      allowUnauthorized,
      wait: sleep,
      attempts: memberCleanupAttempts,
      delayMs: memberCleanupRetryDelayMs,
    },
  );
  return finalResponse;
}

async function verifyTemporaryMemberSessionRevoked(member) {
  await waitForTemporaryMemberSessionRevocation(
    async () => {
      const response = await request("/api/session", { cookie: member.cookie });
      return response.status;
    },
    {
      retryDeletion: () => deleteTemporaryMemberData(member, { allowUnauthorized: true }),
      wait: sleep,
    },
  );
}

async function purgeMember(member) {
  const response = await deleteTemporaryMemberData(member);
  if (response.status === 200) {
    assert((response.headers.get("set-cookie") || "").includes("Max-Age=0"), "member data deletion: session cookie not cleared");
  }
  await verifyTemporaryMemberSessionRevoked(member);

  await loginMember(member);
  assert((await listConversations(member)).length === 0, "member data deletion: conversations remain");
  assert((await getMemory(member)).memory === "", "member data deletion: memory remains");
  await deleteTemporaryMemberData(member);
}

async function removeStaleTemporaryAccessEntries(adminCookie) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const current = await getAccessCodes(adminCookie);
    const currentEntries = parseAccessCodes(current.accessCodes);
    const kept = currentEntries.filter((entry) => !isProductionAcceptanceLabel(entry.label));
    if (kept.length === currentEntries.length) return current;

    try {
      const cleaned = kept.map((entry) => `${entry.label}:${entry.code}`).join(",");
      if (cleaned) {
        await putAccessCodes(adminCookie, cleaned, current.revision);
      } else {
        await deleteAccessCodes(adminCookie, current.revision, "remove stale access-code override");
      }
      const verified = await getAccessCodes(adminCookie);
      assert(
        parseAccessCodes(verified.accessCodes).every((entry) => !isProductionAcceptanceLabel(entry.label)),
        "remove stale access-code entries: temporary label remains",
      );
      return verified;
    } catch (error) {
      const conflict = String(error?.message || "").includes("409");
      if (!conflict || attempt === 4) throw error;
      await sleep(1_000);
    }
  }
  throw new Error("remove stale access-code entries failed");
}

async function cleanupTemporaryMembers(adminCookie, original, members, augmentedAccessCodes) {
  const temporaryLabels = new Set(members.map((member) => member.label));
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const current = await getAccessCodes(adminCookie);
    const currentEntries = parseAccessCodes(current.accessCodes);
    const hasTemporaryMembers = currentEntries.some((entry) => temporaryLabels.has(entry.label));
    if (!hasTemporaryMembers) {
      const sourceUnchanged = current.source === original.source;
      const valueUnchanged = current.accessCodes === original.accessCodes.trim();
      if (sourceUnchanged && valueUnchanged) return;
      throw new Error("restore access-code configuration: concurrent modification detected");
    }
    const exactTemporaryValue = current.accessCodes === augmentedAccessCodes;
    const kept = currentEntries.filter((entry) => !temporaryLabels.has(entry.label));
    const cleaned = kept.map((entry) => `${entry.label}:${entry.code}`).join(",");
    try {
      if (exactTemporaryValue && original.source !== "kv") {
        await deleteAccessCodes(adminCookie, current.revision, "restore access-code bootstrap source");
      } else {
        const restoreValue = exactTemporaryValue ? original.accessCodes.trim() : cleaned;
        assert(restoreValue, "restore access-code configuration: no remaining access code");
        await putAccessCodes(adminCookie, restoreValue, current.revision);
      }
      const restored = await getAccessCodes(adminCookie);
      assert(parseAccessCodes(restored.accessCodes).every((entry) => !temporaryLabels.has(entry.label)), "restore access-code configuration: temporary label remains");
      if (!exactTemporaryValue) {
        throw new Error("restore access-code configuration: concurrent modification detected after cleanup");
      }
      if (original.source !== "kv") {
        assert(restored.source === original.source, "restore access-code configuration: bootstrap source was not restored");
      } else {
        assert(restored.accessCodes === original.accessCodes.trim(), "restore access-code configuration: original value changed");
      }
      return;
    } catch (error) {
      const conflict = String(error.message || "").includes("409");
      if (!conflict || attempt === 4) throw error;
      await sleep(1000);
    }
  }
  throw new Error("restore access-code configuration failed");
}

await verifyReleaseRevision("pre-acceptance release verification");
const adminCookie = await adminLogin();
const originalAccess = await removeStaleTemporaryAccessEntries(adminCookie);
const members = [makeMember("a"), makeMember("b")];
const augmentedAccessCodes = buildTemporaryAccessCodes(originalAccess, members);
let primaryError;

try {
  await putAccessCodes(adminCookie, augmentedAccessCodes, originalAccess.revision);
  await sleep(2_000);
  for (const member of members) await loginMember(member);
  const sessions = await Promise.all(members.map(sessionProjection));
  assert(sessions[0].agent.instance !== sessions[1].agent.instance, "member isolation: Agent instances are shared");
  console.log("Authentication and per-member Agent identity passed");

  const availabilityRouteCounts = await Promise.all(members.map(modelAvailability));
  assert(availabilityRouteCounts.every((count) => Number.isSafeInteger(count) && count >= 0), "member model availability: route count missing");
  console.log("Member model availability projection passed");

  const initialLists = await Promise.all(members.map(listConversations));
  assert(initialLists.every((list) => list.length === 0), "member isolation: temporary member had existing conversations");
  const initialMemories = await Promise.all(members.map(getMemory));
  assert(initialMemories.every((memory) => memory.memory === ""), "member isolation: temporary member had existing memory");

  const conversations = await Promise.all(members.map(createConversation));
  const renamed = await updateConversation(members[0], conversations[0], "Production acceptance updated");
  await assertConversationConflict(members[0], conversations[0].updatedAt);
  await putMemory(members[0], "temporary acceptance memory A", initialMemories[0].revision);
  await assertMemoryConflict(members[0], initialMemories[0].revision);
  await putMemory(members[1], "temporary acceptance memory B", initialMemories[1].revision);

  const [aList, bList, aMemory, bMemory] = await Promise.all([
    listConversations(members[0]),
    listConversations(members[1]),
    getMemory(members[0]),
    getMemory(members[1]),
  ]);
  assert(aList.some((conversation) => conversation.id === members[0].chatId), "member isolation: member A cannot see own conversation");
  assert(!aList.some((conversation) => conversation.id === members[1].chatId), "member isolation: member A sees member B conversation");
  assert(bList.some((conversation) => conversation.id === members[1].chatId), "member isolation: member B cannot see own conversation");
  assert(!bList.some((conversation) => conversation.id === members[0].chatId), "member isolation: member B sees member A conversation");
  assert(aMemory.memory === "temporary acceptance memory A" && bMemory.memory === "temporary acceptance memory B", "member isolation: memory crossed users");
  assert(renamed.title === "Production acceptance updated", "conversation update: title was not retained");
  console.log("Conversation, revision conflict, and memory isolation passed");

  const socketNames = await Promise.all(members.map((member) => openAgentSocket(member)));
  assert(socketNames[0] !== socketNames[1], "Agent WebSocket: instances are shared");
  console.log("Agent WebSocket authentication and identity passed");

  await Promise.all(members.map((member, index) => deleteConversation(member, index === 0 ? renamed : conversations[index])));
  await assertDeletedConversation(members[0]);
  assert((await listConversations(members[0])).length === 0, "conversation deletion: member A list is not empty");
  assert((await listConversations(members[1])).length === 0, "conversation deletion: member B list is not empty");
  for (const member of members) await purgeMember(member);
  console.log("Conversation tombstones and user-data deletion passed");
} catch (error) {
  primaryError = error;
} finally {
  try {
    await runProductionAcceptanceCleanup({
      members,
      purgeMember: async (member) => {
        if (!member.cookie) return;
        await deleteTemporaryMemberData(member, { allowUnauthorized: true });
      },
      restoreAccess: () => cleanupTemporaryMembers(adminCookie, originalAccess, members, augmentedAccessCodes),
      logoutAdmin: async () => {
        const logout = await request("/api/admin/logout", { cookie: adminCookie, method: "POST" });
        await expectStatus(logout, 200, "admin logout");
      },
      verifyRelease: () => verifyReleaseRevision("post-cleanup release verification"),
    });
    console.log("Temporary members and access-code configuration restored");
  } catch (cleanupError) {
    const message = cleanupError instanceof Error ? cleanupError.message : "unknown cleanup error";
    primaryError = primaryError || new Error(message);
    if (primaryError && primaryError.message !== message) {
      primaryError = new Error(`${primaryError.message}; cleanup failed: ${message}`);
    }
  }
}

if (primaryError) throw primaryError;
console.log(`Production member acceptance passed: ${baseUrl.origin}`);
