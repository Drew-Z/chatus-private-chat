import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamAgent } from "../src/agent/team-agent";
import {
  normalizeWorkspacePath,
  MAX_TEXT_DOCUMENT_BYTES,
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_MEMBER_BYTES,
} from "../src/contracts/workspace-file";
import {
  getTeamAgentConversationInstanceName,
  getTeamAgentInstanceName,
} from "../src/worker";
import { minimalPdfSource } from "./document-fixtures";

const ACCESS_CODES_KEY = "config:access_codes";
const ROUTES_CONFIG_KEY = "config:routes_config";

type Login = { cookie: string; label: string };

async function login(): Promise<Login> {
  const label = `workspace-${crypto.randomUUID()}`;
  await env.CHAT_STORE.put(ACCESS_CODES_KEY, `${label}:workspace-test-code`);
  const response = await exports.default.fetch(new Request("https://example.test/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "workspace-test-code" }),
  }));
  expect(response.status).toBe(200);
  return {
    cookie: response.headers.get("Set-Cookie")!.split(";", 1)[0],
    label,
  };
}

function apiRequest(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return exports.default.fetch(new Request(`https://example.test${path}`, { ...init, headers }));
}

async function getRootAgent(label: string) {
  const instance = await getTeamAgentInstanceName(label);
  return getAgentByName(env.TEAM_AGENT, instance, {
    props: { userLabel: label, scope: "root" },
  }) as DurableObjectStub<TeamAgent>;
}

async function getConversationAgent(label: string, chatId: string) {
  const [instance, rootInstance] = await Promise.all([
    getTeamAgentConversationInstanceName(label, chatId),
    getTeamAgentInstanceName(label),
  ]);
  return getAgentByName(env.TEAM_AGENT, instance, {
    props: { userLabel: label, scope: "conversation", chatId, rootInstance },
  }) as DurableObjectStub<TeamAgent>;
}

async function createConversation(cookie: string, chatId = crypto.randomUUID()) {
  const response = await apiRequest("/api/agent/conversations", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: chatId, routeId: "files" }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json() as any).conversation;
}

async function upload(
  cookie: string,
  content: BlobPart,
  relativePath: string,
  options: { operationId?: string; fileId?: string; expectedUpdatedAt?: number; mediaType?: string } = {},
) {
  const form = new FormData();
  form.set("file", new File([content], relativePath.split("/").at(-1) || "file.txt", {
    type: options.mediaType || "text/plain",
  }));
  form.set("relativePath", relativePath);
  form.set("operationId", options.operationId || `upload-${crypto.randomUUID()}`);
  if (options.expectedUpdatedAt) form.set("expectedUpdatedAt", String(options.expectedUpdatedAt));
  const suffix = options.fileId ? `/${options.fileId}/retry` : "";
  const response = await apiRequest(`/api/workspace/files${suffix}`, cookie, { method: "POST", body: form });
  return { response, payload: await response.clone().json() as any };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fakeProviderResponse(text: string): Response {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

async function waitForIngestStatus(
  root: DurableObjectStub<TeamAgent>,
  fileId: string,
  expected: "ready" | "failed",
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await root.listWorkspaceFileVersions(fileId);
    const version = result?.file.currentVersion;
    if (version?.ingestStatus === expected) return version;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`document ingest did not reach ${expected}`);
}

async function clearWorkspaceBucket() {
  let cursor: string | undefined;
  do {
    const page = await env.WORKSPACE_FILES.list({ cursor, limit: 1_000 });
    if (page.objects.length) await env.WORKSPACE_FILES.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

describe("workspace file contracts", () => {
  it("normalizes safe relative paths and rejects traversal and platform paths", () => {
    expect(normalizeWorkspacePath("notes/e\u0301quipe.md")).toEqual({
      ok: true,
      value: { path: "notes/équipe.md", name: "équipe.md", conflictKey: "notes/équipe.md" },
    });
    for (const invalid of ["/root.txt", "C:/root.txt", "..", "a/../b.txt", "a\\b.txt", "a//b.txt", "./a.txt"]) {
      expect(normalizeWorkspacePath(invalid)).toEqual({ ok: false, error: "workspace_path_invalid" });
    }
    expect(MAX_WORKSPACE_FILE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("workspace file API and R2 recovery", () => {
  beforeEach(async () => {
    await Promise.all([
      env.CHAT_STORE.delete(ACCESS_CODES_KEY),
      env.CHAT_STORE.delete(ROUTES_CONFIG_KEY),
      clearWorkspaceBucket(),
    ]);
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        files: {
          label: "Files",
          type: "openai-chat",
          baseUrl: "https://workspace-provider.example/v1",
          model: "workspace-model",
          apiKey: "workspace-key",
        },
      },
      defaults: { defaultRoute: "files", allowedRoutes: ["files"] },
    }));
  });

  afterEach(() => vi.restoreAllMocks());

  it("projects exact metadata-tracked usage across active, parsed, deleting, and retry states", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    await expect(root.listWorkspaceFiles()).resolves.toMatchObject({
      usage: {
        quotaBytes: 0,
        extractedBytes: 0,
        pendingCleanupBytes: 0,
        trackedBytes: 0,
        limitBytes: MAX_WORKSPACE_MEMBER_BYTES,
      },
    });

    const reserve = async (name: string, size: number) => {
      const result = await root.reserveWorkspaceUpload({
        operationId: `usage-${name}`,
        relativePath: `usage/${name}.txt`,
        size,
        mediaType: "text/plain",
        checksum: await sha256(name),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      await expect(root.completeWorkspaceUpload(
        result.reservation.operationId,
        result.reservation.generation,
      )).resolves.toMatchObject({ ok: true });
      return result.reservation;
    };
    const active = await reserve("active", 100);
    const retrying = await reserve("retrying", 40);
    const deleting = await reserve("deleting", 30);

    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_file_versions SET extracted_bytes = 20, ingest_status = 'ready' WHERE id = ?",
        active.versionId,
      );
      state.storage.sql.exec(
        "UPDATE workspace_file_versions SET extracted_bytes = 9, ingest_status = 'failed' WHERE id = ?",
        retrying.versionId,
      );
      state.storage.sql.exec(
        "UPDATE workspace_file_versions SET state = 'deleting', extracted_bytes = 7 WHERE id = ?",
        deleting.versionId,
      );
      state.storage.sql.exec(
        "UPDATE workspace_files SET state = 'deleting' WHERE id = ?",
        deleting.fileId,
      );
    });

    const usage = (await root.listWorkspaceFiles()).usage;
    expect(usage).toEqual({
      quotaBytes: 140,
      extractedBytes: 29,
      pendingCleanupBytes: 37,
      trackedBytes: 206,
      limitBytes: MAX_WORKSPACE_MEMBER_BYTES,
    });
    expect(Object.keys(usage)).toEqual([
      "quotaBytes",
      "extractedBytes",
      "pendingCleanupBytes",
      "trackedBytes",
      "limitBytes",
    ]);

    await expect(root.retryDocumentIngest(retrying.fileId, retrying.versionId)).resolves.toMatchObject({ ok: true });
    await expect(root.listWorkspaceFiles()).resolves.toMatchObject({
      usage: {
        quotaBytes: 140,
        extractedBytes: 20,
        pendingCleanupBytes: 37,
        trackedBytes: 197,
        limitBytes: MAX_WORKSPACE_MEMBER_BYTES,
      },
    });
  });

  it("reports the exact 250 MiB boundary used by upload admission", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const reservation = await root.reserveWorkspaceUpload({
      operationId: "usage-boundary",
      relativePath: "usage/boundary.txt",
      size: 1,
      mediaType: "text/plain",
      checksum: await sha256("boundary"),
    });
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) throw new Error(reservation.error);
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_file_versions SET size = ? WHERE id = ?",
        MAX_WORKSPACE_MEMBER_BYTES,
        reservation.reservation.versionId,
      );
    });

    await expect(root.listWorkspaceFiles()).resolves.toMatchObject({
      usage: {
        quotaBytes: MAX_WORKSPACE_MEMBER_BYTES,
        extractedBytes: 0,
        pendingCleanupBytes: 0,
        trackedBytes: MAX_WORKSPACE_MEMBER_BYTES,
        limitBytes: MAX_WORKSPACE_MEMBER_BYTES,
      },
    });
    await expect(root.reserveWorkspaceUpload({
      operationId: "usage-boundary-over",
      relativePath: "usage/over.txt",
      size: 1,
      mediaType: "text/plain",
      checksum: await sha256("over"),
    })).resolves.toEqual({ ok: false, error: "workspace_member_quota_exceeded" });
  });

  it("upgrades a version-one root schema idempotently", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const schema = await runInDurableObject(root, async (instance, state) => {
      state.storage.sql.exec("DROP TABLE conversation_file_refs");
      state.storage.sql.exec("DROP TABLE workspace_file_operations");
      state.storage.sql.exec("DROP TABLE workspace_file_versions");
      state.storage.sql.exec("DROP TABLE workspace_files");
      state.storage.sql.exec("DELETE FROM _sql_schema_migrations WHERE id >= 2");
      const migrator = instance as unknown as { applySchemaMigrations(): void };
      migrator.applySchemaMigrations();
      migrator.applySchemaMigrations();
      return {
        versions: state.storage.sql.exec<{ id: number }>(
          "SELECT id FROM _sql_schema_migrations ORDER BY id",
        ).toArray().map((row) => row.id),
        tables: state.storage.sql.exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'workspace_%' OR name = 'conversation_file_refs' ORDER BY name",
        ).toArray().map((row) => row.name),
        indexes: state.storage.sql.exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('workspace_files_active_path_key', 'workspace_file_operations_pending', 'workspace_file_operations_due', 'conversation_file_refs_version', 'chatus_conversation_cleanup_due') ORDER BY name",
        ).toArray().map((row) => row.name),
        cleanupColumns: state.storage.sql.exec<{ name: string }>(
          "PRAGMA table_info(chatus_conversation_cleanup)",
        ).toArray().map((row) => row.name),
        operationColumns: state.storage.sql.exec<{ name: string }>(
          "PRAGMA table_info(workspace_file_operations)",
        ).toArray().map((row) => row.name),
      };
    });
    expect(schema.versions).toEqual([1, 2, 3, 4, 5, 6]);
    expect(schema.tables).toEqual([
      "conversation_file_refs",
      "workspace_file_operations",
      "workspace_file_versions",
      "workspace_files",
    ]);
    expect(schema.indexes).toEqual([
      "chatus_conversation_cleanup_due",
      "conversation_file_refs_version",
      "workspace_file_operations_due",
      "workspace_file_operations_pending",
      "workspace_files_active_path_key",
    ]);
    expect(schema.cleanupColumns).toEqual(expect.arrayContaining([
      "next_attempt_at",
      "terminal_at",
      "last_error",
    ]));
    expect(schema.operationColumns).toEqual(expect.arrayContaining([
      "next_attempt_at",
      "terminal_at",
    ]));
  });

  it("makes pre-v6 cleanup rows immediately eligible without losing ownership", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    await runInDurableObject(root, async (instance, state) => {
      state.storage.sql.exec("DROP INDEX IF EXISTS chatus_conversation_cleanup_due");
      state.storage.sql.exec("ALTER TABLE chatus_conversation_cleanup RENAME TO chatus_conversation_cleanup_v6");
      state.storage.sql.exec(`
        CREATE TABLE chatus_conversation_cleanup (
          chat_id TEXT PRIMARY KEY,
          requested_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_attempt_at INTEGER NOT NULL DEFAULT 0
        )
      `);
      state.storage.sql.exec(
        "INSERT INTO chatus_conversation_cleanup(chat_id, requested_at, attempts, last_attempt_at) VALUES (?, 10, 1, 20)",
        "legacy-cleanup-chat",
      );
      state.storage.sql.exec("DROP TABLE chatus_conversation_cleanup_v6");

      state.storage.sql.exec("DROP INDEX IF EXISTS workspace_file_operations_due");
      state.storage.sql.exec("DROP INDEX IF EXISTS workspace_file_operations_pending");
      state.storage.sql.exec("DROP INDEX IF EXISTS workspace_file_operations_file");
      state.storage.sql.exec("ALTER TABLE workspace_file_operations RENAME TO workspace_file_operations_v6");
      state.storage.sql.exec(`
        CREATE TABLE workspace_file_operations (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          file_id TEXT NOT NULL DEFAULT '',
          version_id TEXT NOT NULL DEFAULT '',
          generation INTEGER NOT NULL,
          state TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          object_keys_json TEXT NOT NULL DEFAULT '[]',
          size INTEGER NOT NULL DEFAULT 0,
          checksum TEXT NOT NULL DEFAULT '',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      state.storage.sql.exec(`
        INSERT INTO workspace_file_operations(
          id, kind, file_id, version_id, generation, state, fingerprint,
          object_keys_json, size, checksum, attempts, last_error, created_at, updated_at
        ) VALUES ('legacy-workspace-cleanup', 'upload', 'legacy-file', 'legacy-version', 1,
          'pending', 'legacy-fingerprint', '[]', 1, '', 2, 'legacy_stable_error', 10, 20)
      `);
      state.storage.sql.exec("DROP TABLE workspace_file_operations_v6");
      state.storage.sql.exec(
        "CREATE INDEX workspace_file_operations_pending ON workspace_file_operations(state, updated_at)",
      );
      state.storage.sql.exec(
        "CREATE INDEX workspace_file_operations_file ON workspace_file_operations(file_id, created_at DESC)",
      );
      state.storage.sql.exec("DELETE FROM _sql_schema_migrations WHERE id = 6");
      (instance as unknown as { applySchemaMigrations(): void }).applySchemaMigrations();
    });

    await expect(root.listPendingConversationCleanups(3, 1, true)).resolves.toEqual([
      expect.objectContaining({ chatId: "legacy-cleanup-chat", attempts: 1, nextAttemptAt: 0, terminalAt: 0 }),
    ]);
    await expect(root.listPendingWorkspaceOperations(3, 1, true)).resolves.toEqual([
      expect.objectContaining({
        operationId: "legacy-workspace-cleanup",
        attempts: 2,
        nextAttemptAt: 0,
        terminalAt: 0,
      }),
    ]);
  });

  it("defers pending upload reconciliation and retains terminal cleanup evidence", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const operationId = `terminal-upload-${crypto.randomUUID()}`;
    const content = "terminal cleanup fixture";
    const reservation = await root.reserveWorkspaceUpload({
      operationId,
      relativePath: "cleanup/terminal.txt",
      size: new TextEncoder().encode(content).byteLength,
      mediaType: "text/plain",
      checksum: await sha256(content),
    });
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) throw new Error(reservation.error);

    const [pending] = await root.listPendingWorkspaceOperations();
    expect(pending).toMatchObject({ operationId, kind: "upload", attempts: 0 });
    expect(pending!.nextAttemptAt - pending!.updatedAt).toBe(60_000);
    expect(await root.listPendingWorkspaceOperations(3, pending!.nextAttemptAt - 1, true)).toEqual([]);
    expect(await root.listPendingWorkspaceOperations(3, pending!.nextAttemptAt, true)).toHaveLength(1);

    const expectedDelays = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];
    for (const [index, delay] of expectedDelays.entries()) {
      const failedAt = 200_000 + index * 1_000_000;
      await expect(root.recordWorkspaceOperationFailure(
        operationId,
        reservation.reservation.generation,
        "workspace_reconcile_failed",
        failedAt,
        false,
      )).resolves.toBe(true);
      const [record] = await root.listPendingWorkspaceOperations();
      expect(record).toMatchObject({
        operationId,
        attempts: index + 1,
        nextAttemptAt: failedAt + delay,
      });
      expect(await root.listPendingWorkspaceOperations(3, failedAt + delay - 1, true)).toEqual([]);
    }
    await expect(root.recordWorkspaceOperationFailure(
      operationId,
      reservation.reservation.generation,
      "workspace_reconcile_failed",
      9_000_000,
      false,
    )).resolves.toBe(true);

    expect(await root.listPendingWorkspaceOperations()).toEqual([]);
    const summary = await root.inspectCleanupReliability();
    expect(summary.workspace).toEqual({
      pending: 1,
      terminal: 1,
      oldestDueAt: 0,
      maxAttempts: 8,
    });
    expect(summary.scheduledAt).toBeGreaterThan(Date.now() - 60_000);
    const evidence = JSON.stringify(summary);
    expect(evidence).not.toContain(operationId);
    expect(evidence).not.toContain(reservation.reservation.objectKey);
    expect(evidence).not.toContain(member.label);
  });

  it("bounds a due Workspace cleanup selection to three operations", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const operationIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const operationId = `bounded-cleanup-${index}-${crypto.randomUUID()}`;
      operationIds.push(operationId);
      await expect(root.reserveWorkspaceUpload({
        operationId,
        relativePath: `cleanup/bounded-${index}.txt`,
        size: 1,
        mediaType: "text/plain",
        checksum: await sha256(String(index)),
      })).resolves.toMatchObject({ ok: true });
    }
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec("UPDATE workspace_file_operations SET next_attempt_at = 1");
    });

    await expect(root.listPendingWorkspaceOperations(10, Date.now(), true)).resolves.toHaveLength(4);
    const batch = await root.listPendingWorkspaceOperations(3, Date.now(), true);
    expect(batch).toHaveLength(3);
    expect(new Set(batch.map((operation) => operation.operationId)).size).toBe(3);
    expect(batch.every((operation) => operationIds.includes(operation.operationId))).toBe(true);
  });

  it("enforces text and document upload byte limits at the exact boundary", async () => {
    const member = await login();
    const textAtLimit = await upload(
      member.cookie,
      new Uint8Array(MAX_TEXT_DOCUMENT_BYTES),
      "limits/exact.txt",
      { operationId: "text-exact-limit" },
    );
    expect(textAtLimit.response.status, JSON.stringify(textAtLimit.payload)).toBe(201);
    const textOverLimit = await upload(
      member.cookie,
      new Uint8Array(MAX_TEXT_DOCUMENT_BYTES + 1),
      "limits/over.txt",
      { operationId: "text-over-limit" },
    );
    expect(textOverLimit.response.status).toBe(413);
    expect(textOverLimit.payload).toMatchObject({ error: "workspace_file_too_large" });

    const pdfPrefix = new TextEncoder().encode("%PDF-1.4\n/Launch\n");
    const pdfAtLimit = new Uint8Array(MAX_WORKSPACE_FILE_BYTES);
    pdfAtLimit.set(pdfPrefix);
    const documentAtLimit = await upload(
      member.cookie,
      pdfAtLimit,
      "limits/exact.pdf",
      { operationId: "document-exact-limit", mediaType: "application/pdf" },
    );
    expect(documentAtLimit.response.status, JSON.stringify(documentAtLimit.payload)).toBe(201);
    const pdfOverLimit = new Uint8Array(MAX_WORKSPACE_FILE_BYTES + 1);
    pdfOverLimit.set(pdfPrefix);
    const documentOverLimit = await upload(
      member.cookie,
      pdfOverLimit,
      "limits/over.pdf",
      { operationId: "document-over-limit", mediaType: "application/pdf" },
    );
    expect(documentOverLimit.response.status).toBe(413);
    expect(documentOverLimit.payload).toMatchObject({ error: "workspace_file_too_large" });
  });

  it("keeps immutable versions, pins an old version, and sends only that version to the fake Provider", async () => {
    const member = await login();
    const conversation = await createConversation(member.cookie);
    const first = await upload(member.cookie, "old exact workspace content", "notes/release.txt", {
      operationId: "upload-old-version",
    });
    expect(first.response.status, JSON.stringify(first.payload)).toBe(201);
    const file = first.payload.file;
    const oldVersionId = file.currentVersion.id;

    const second = await upload(member.cookie, "new content must not leak", "notes/release.txt", {
      operationId: "upload-new-version",
      fileId: file.id,
      expectedUpdatedAt: file.updatedAt,
    });
    expect(second.response.status, JSON.stringify(second.payload)).toBe(200);
    expect(second.payload.file.currentVersion.id).not.toBe(oldVersionId);

    const versionsResponse = await apiRequest(`/api/workspace/files/${file.id}/versions`, member.cookie);
    const versions = await versionsResponse.json() as any;
    expect(versions.versions.filter((version: any) => version.state === "ready")).toHaveLength(2);
    expect(JSON.stringify(versions)).not.toContain("workspace/v1/");

    const selectedResponse = await apiRequest(
      `/api/agent/conversations/${conversation.id}/workspace-files`,
      member.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: conversation.updatedAt,
          files: [{ fileId: file.id, versionId: oldVersionId }],
        }),
      },
    );
    expect(selectedResponse.status, await selectedResponse.clone().text()).toBe(200);
    const selected = (await selectedResponse.json() as any).conversation;
    expect(selected.workspaceFiles).toEqual([expect.objectContaining({ fileId: file.id, versionId: oldVersionId })]);

    const renamedResponse = await apiRequest(`/api/workspace/files/${file.id}`, member.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relativePath: "notes/renamed-release.txt",
        expectedUpdatedAt: second.payload.file.updatedAt,
      }),
    });
    expect(renamedResponse.status, await renamedResponse.clone().text()).toBe(200);
    await expect((await getRootAgent(member.label)).resolveConversationWorkspaceFiles(conversation.id)).resolves.toEqual([
      expect.objectContaining({
        fileId: file.id,
        versionId: oldVersionId,
        path: "notes/renamed-release.txt",
      }),
    ]);

    const exportedResponse = await apiRequest("/api/user-data/export", member.cookie);
    expect(exportedResponse.status, await exportedResponse.clone().text()).toBe(200);
    const exportedText = await exportedResponse.text();
    const exported = JSON.parse(exportedText) as any;
    expect(exported.conversations[0]).not.toHaveProperty("workspaceFiles");
    expect(exportedText).not.toContain(file.id);
    expect(exportedText).not.toContain(file.currentVersion.checksum);

    const download = await apiRequest(
      `/api/workspace/files/${file.id}/download?versionId=${oldVersionId}`,
      member.cookie,
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("old exact workspace content");

    let providerBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      providerBody = JSON.parse(String(init?.body));
      return fakeProviderResponse("local response");
    });
    const agent = await getConversationAgent(member.label, conversation.id);
    await agent.importLegacyMessages([{
      id: "workspace-user-message",
      role: "user",
      parts: [{ type: "text", text: "Use the selected workspace file." }],
    }]);
    const result = await runInDurableObject(agent, async (instance) => {
      const response = await instance.onChatMessage(async () => undefined, {});
      return { status: response.status, body: await response.text() };
    });
    expect(result.status, result.body).toBe(200);
    expect(JSON.stringify(providerBody)).toContain("old exact workspace content");
    expect(JSON.stringify(providerBody)).not.toContain("new content must not leak");

    const root = await getRootAgent(member.label);
    const oldVersion = await root.getWorkspaceFileVersion(file.id, oldVersionId);
    expect(oldVersion).toBeDefined();
    const replacement = "x".repeat(oldVersion!.size);
    await env.WORKSPACE_FILES.put(oldVersion!.objectKey, replacement, { sha256: await sha256(replacement) });
    const invalidDownload = await apiRequest(
      `/api/workspace/files/${file.id}/download?versionId=${oldVersionId}`,
      member.cookie,
    );
    expect(invalidDownload.status).toBe(503);
    await expect(invalidDownload.json()).resolves.toMatchObject({ error: "workspace_object_invalid" });
  });

  it("reconciles a stored pending upload, rejects operation reuse, and completes a pending delete", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const content = "recover after finalize interruption";
    const input = {
      operationId: "recover-upload",
      relativePath: "Recovery/Result.txt",
      size: new TextEncoder().encode(content).byteLength,
      mediaType: "text/plain",
      checksum: await sha256(content),
    };
    const reserved = await root.reserveWorkspaceUpload(input);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) throw new Error(reserved.error);
    await expect(root.beginWorkspaceAccountPurge(input.operationId))
      .resolves.toEqual({ error: "workspace_operation_conflict" });
    await expect(root.reserveWorkspaceUpload({
      ...input,
      operationId: "overlapping-upload",
      fileId: reserved.reservation.fileId,
      expectedUpdatedAt: reserved.reservation.file.updatedAt,
      checksum: await sha256("overlapping content"),
      size: new TextEncoder().encode("overlapping content").byteLength,
    })).resolves.toMatchObject({ ok: false, error: "workspace_file_conflict" });
    await expect(root.reserveWorkspaceFileDelete(
      reserved.reservation.fileId,
      reserved.reservation.file.updatedAt,
      "delete-during-upload",
    )).resolves.toMatchObject({ ok: false, error: "workspace_file_conflict" });
    await expect(root.beginWorkspaceAccountPurge("purge-during-upload"))
      .resolves.toEqual({ error: "workspace_purge_pending_upload" });
    await env.WORKSPACE_FILES.put(reserved.reservation.objectKey, content, { sha256: input.checksum });
    const beforeDue = await apiRequest("/api/workspace/files", member.cookie);
    expect(beforeDue.status).toBe(200);
    await expect(beforeDue.json()).resolves.toMatchObject({
      files: [expect.objectContaining({ id: reserved.reservation.fileId, state: "uploading" })],
    });
    await expect(root.deferWorkspaceOperation(
      reserved.reservation.operationId,
      reserved.reservation.generation,
      1,
    )).resolves.toBe(true);

    const repeated = await root.reserveWorkspaceUpload(input);
    expect(repeated).toMatchObject({ ok: true, reservation: { existing: true, versionId: reserved.reservation.versionId } });
    await expect(root.reserveWorkspaceUpload({ ...input, relativePath: "other.txt" }))
      .resolves.toMatchObject({ ok: false, error: "workspace_operation_conflict" });

    const listResponse = await apiRequest("/api/workspace/files", member.cookie);
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as any;
    expect(listed.files).toEqual([expect.objectContaining({ id: reserved.reservation.fileId, state: "ready" })]);
    const file = listed.files[0];
    const caseConflict = await upload(member.cookie, "collision", "recovery/result.txt", {
      operationId: "case-conflict",
    });
    expect(caseConflict.response.status).toBe(409);
    expect(caseConflict.payload.error).toBe("workspace_path_conflict");

    const deletion = await root.reserveWorkspaceFileDelete(file.id, file.updatedAt, "recover-delete");
    expect(deletion.ok).toBe(true);
    if (!deletion.ok) throw new Error(deletion.error);
    const objectKey = deletion.reservation.objectKeys[0];
    expect(await env.WORKSPACE_FILES.get(objectKey)).not.toBeNull();
    await expect(root.deferWorkspaceOperation(
      deletion.reservation.operationId,
      deletion.reservation.generation,
      1,
    )).resolves.toBe(true);
    const reconciled = await apiRequest("/api/workspace/files", member.cookie);
    expect(reconciled.status).toBe(200);
    expect((await reconciled.json() as any).files).toEqual([]);
    expect(await env.WORKSPACE_FILES.get(objectKey)).toBeNull();
  });

  it("continues member account cleanup after a pending upload rejects the initiating request and the Root is evicted", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const content = "account cleanup resumes without another request";
    const reservation = await root.reserveWorkspaceUpload({
      operationId: `account-cleanup-upload-${crypto.randomUUID()}`,
      relativePath: "account/pending.txt",
      size: new TextEncoder().encode(content).byteLength,
      mediaType: "text/plain",
      checksum: await sha256(content),
    });
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) throw new Error(reservation.error);
    await env.WORKSPACE_FILES.put(reservation.reservation.objectKey, content, {
      sha256: await sha256(content),
    });

    const rejected = await apiRequest("/api/user-data", member.cookie, { method: "DELETE" });
    expect(rejected.status).toBe(503);
    await expect(rejected.json()).resolves.toMatchObject({ error: "user_data_purge_incomplete" });
    expect((await apiRequest("/api/session", member.cookie)).status).toBe(200);
    await expect(root.hasAccountCleanupRequest()).resolves.toBe(true);
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_file_operations SET next_attempt_at = 1 WHERE id = ?",
        reservation.reservation.operationId,
      );
      state.storage.sql.exec("UPDATE cf_agents_schedules SET time = 1 WHERE callback = 'runCleanupSchedule'");
    });

    await evictDurableObject(root);
    const instance = await getTeamAgentInstanceName(member.label);
    const restored = await getAgentByName(env.TEAM_AGENT, instance) as DurableObjectStub<TeamAgent>;
    await expect(runDurableObjectAlarm(restored)).resolves.toBe(true);
    await expect(env.CHAT_STORE.get(`session:${member.cookie.split("=", 2)[1]}`)).resolves.toBeNull();
    expect((await apiRequest("/api/session", member.cookie)).status).toBe(401);
    await expect(env.WORKSPACE_FILES.get(reservation.reservation.objectKey)).resolves.toBeNull();
  });

  it("schedules a persisted member cleanup request before a purge operation exists", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    await root.registerAccountCleanupRequest(Date.now() + 60_000);
    await expect(root.hasWorkspaceAccountPurgeOperation()).resolves.toBe(false);
    await expect(root.inspectCleanupReliability()).resolves.toMatchObject({
      account: { pending: 0, terminal: 0 },
      scheduledAt: expect.any(Number),
    });
    const summary = await root.inspectCleanupReliability();
    expect(summary.scheduledAt).toBeGreaterThan(Date.now());
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec("UPDATE cf_agents_schedules SET time = 1 WHERE callback = 'runCleanupSchedule'");
    });

    await evictDurableObject(root);
    const instance = await getTeamAgentInstanceName(member.label);
    const restored = await getAgentByName(env.TEAM_AGENT, instance) as DurableObjectStub<TeamAgent>;
    await expect(runDurableObjectAlarm(restored)).resolves.toBe(true);
    expect((await apiRequest("/api/session", member.cookie)).status).toBe(401);
  });

  it("marks a stale pending upload with a missing R2 object as retryable", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const content = "lost before r2 put";
    const input = {
      operationId: "missing-object-upload",
      relativePath: "Recovery/Missing.txt",
      size: new TextEncoder().encode(content).byteLength,
      mediaType: "text/plain",
      checksum: await sha256(content),
    };
    const reserved = await root.reserveWorkspaceUpload(input);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) throw new Error(reserved.error);
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_file_operations SET updated_at = 1, next_attempt_at = 1 WHERE id = 'missing-object-upload'",
      );
    });

    const listResponse = await apiRequest("/api/workspace/files", member.cookie);
    expect(listResponse.status, await listResponse.clone().text()).toBe(200);
    const listed = await listResponse.json() as any;
    expect(listed.files).toEqual([
      expect.objectContaining({
        id: reserved.reservation.fileId,
        state: "failed",
        retryAvailable: true,
      }),
    ]);
    await expect(root.beginWorkspaceAccountPurge("purge-after-missing-object"))
      .resolves.toMatchObject({
        completed: false,
        objectKeys: [reserved.reservation.objectKey, `${reserved.reservation.objectKey}.extracted.1.txt`],
      });
  });

  it("holds an account purge lock across empty workspace cleanup until explicit release", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const purge = await root.beginWorkspaceAccountPurge("empty-workspace-purge");
    expect(purge).toMatchObject({
      operationId: "empty-workspace-purge",
      generation: 1,
      objectKeys: [],
      existing: false,
      completed: false,
    });
    if ("error" in purge) throw new Error(purge.error);
    await expect(root.beginWorkspaceAccountPurge("second-account-purge"))
      .resolves.toMatchObject({
        operationId: purge.operationId,
        generation: purge.generation,
        existing: true,
        completed: false,
      });

    const blockedUpload = await upload(member.cookie, "must not become an orphan", "purge/blocked.txt", {
      operationId: "blocked-during-account-purge",
    });
    expect(blockedUpload.response.status).toBe(409);
    expect(blockedUpload.payload).toMatchObject({ error: "workspace_account_purge_in_progress" });
    await expect(env.WORKSPACE_FILES.list()).resolves.toMatchObject({ objects: [] });

    await expect(root.completeWorkspaceAccountPurge(purge.operationId, purge.generation)).resolves.toBe(true);
    await expect(root.reserveWorkspaceUpload({
      operationId: "blocked-after-workspace-finalize",
      relativePath: "purge/still-blocked.txt",
      size: 1,
      mediaType: "text/plain",
      checksum: await sha256("x"),
    })).resolves.toMatchObject({ ok: false, error: "workspace_account_purge_in_progress" });
    await root.purgeRootData();
    await expect(root.reserveWorkspaceUpload({
      operationId: "blocked-after-root-purge",
      relativePath: "purge/still-locked.txt",
      size: 1,
      mediaType: "text/plain",
      checksum: await sha256("y"),
    })).resolves.toMatchObject({ ok: false, error: "workspace_account_purge_in_progress" });

    await expect(root.releaseWorkspaceAccountPurge(purge.operationId, purge.generation)).resolves.toBe(true);
    await expect(root.reserveWorkspaceUpload({
      operationId: "allowed-after-purge-release",
      relativePath: "purge/allowed.txt",
      size: 1,
      mediaType: "text/plain",
      checksum: await sha256("z"),
    })).resolves.toMatchObject({ ok: true });
  });

  it("completes a raw workspace purge without revoking the member or rescheduling it forever", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const purge = await root.beginWorkspaceAccountPurge(`raw-purge-${crypto.randomUUID()}`);
    if ("error" in purge) throw new Error(purge.error);
    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_file_operations SET next_attempt_at = 1 WHERE id = ?",
        purge.operationId,
      );
      state.storage.sql.exec("UPDATE cf_agents_schedules SET time = 1 WHERE callback = 'runCleanupSchedule'");
    });

    await expect(runDurableObjectAlarm(root)).resolves.toBe(true);
    expect((await apiRequest("/api/session", member.cookie)).status).toBe(200);
    await expect(root.listPendingWorkspaceOperations()).resolves.toEqual([
      expect.objectContaining({
        operationId: purge.operationId,
        kind: "account_purge",
        state: "completed",
      }),
    ]);
    const summary = await root.inspectCleanupReliability();
    expect(summary.account).toMatchObject({ pending: 1, terminal: 0 });
    expect(summary.scheduledAt).toBe(0);
  });

  it("marks failed documents unavailable without exposing storage identifiers or raw content to the fake Provider", async () => {
    const member = await login();
    const conversation = await createConversation(member.cookie);
    const rawDocument = "%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /Launch >> >> endobj\n%%EOF";
    const uploaded = await upload(member.cookie, rawDocument, "documents/report.pdf", {
      mediaType: "application/pdf",
    });
    expect(uploaded.response.status).toBe(201);
    const file = uploaded.payload.file;
    await waitForIngestStatus(await getRootAgent(member.label), file.id, "failed");
    const selected = await apiRequest(
      `/api/agent/conversations/${conversation.id}/workspace-files`,
      member.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: conversation.updatedAt,
          files: [{ fileId: file.id, versionId: file.currentVersion.id }],
        }),
      },
    );
    expect(selected.status, await selected.clone().text()).toBe(200);

    let providerBody: unknown = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      providerBody = JSON.parse(String(init?.body));
      return fakeProviderResponse("local response");
    });
    const agent = await getConversationAgent(member.label, conversation.id);
    await agent.importLegacyMessages([{
      id: "workspace-document-message",
      role: "user",
      parts: [{ type: "text", text: "Use the selected document." }],
    }]);
    const result = await runInDurableObject(agent, async (instance) => {
      const response = await instance.onChatMessage(async () => undefined, {});
      return { status: response.status, body: await response.text() };
    });
    expect(result.status, result.body).toBe(200);
    const serialized = JSON.stringify(providerBody);
    expect(serialized).toContain("attached_file_unavailable");
    expect(serialized).toContain("document_ingest_failed");
    expect(serialized).not.toContain(rawDocument);
    expect(serialized).not.toContain(file.id);
    expect(serialized).not.toContain(file.currentVersion.id);
    expect(serialized).not.toContain("workspace/v1/");
  });

  it("retries failed document ingest without exposing the internal Queue message", async () => {
    const member = await login();
    const uploaded = await upload(
      member.cookie,
      "%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /Launch >> >> endobj\n%%EOF",
      "documents/retry-report.pdf",
      { mediaType: "application/pdf" },
    );
    expect(uploaded.response.status).toBe(201);
    const file = uploaded.payload.file;
    await waitForIngestStatus(await getRootAgent(member.label), file.id, "failed");

    const response = await apiRequest(`/api/workspace/files/${file.id}/ingest-retry`, member.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: file.currentVersion.id }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(JSON.stringify(body)).not.toContain(member.label);

    const readyUpload = await upload(member.cookie, "ready text", "documents/ready.txt");
    expect(readyUpload.response.status).toBe(201);
    await waitForIngestStatus(await getRootAgent(member.label), readyUpload.payload.file.id, "ready");
    const nonRetryable = await apiRequest(
      `/api/workspace/files/${readyUpload.payload.file.id}/ingest-retry`,
      member.cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: readyUpload.payload.file.currentVersion.id }),
      },
    );
    expect(nonRetryable.status).toBe(409);

    const outsider = await login();
    const outsiderResponse = await apiRequest(`/api/workspace/files/${file.id}/ingest-retry`, outsider.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: file.currentVersion.id }),
    });
    expect(outsiderResponse.status).toBe(404);
  });

  it("sends only ready extracted PDF text for the selected exact version", async () => {
    const member = await login();
    const conversation = await createConversation(member.cookie);
    const rawDocument = minimalPdfSource("ready extracted PDF context");
    const uploaded = await upload(member.cookie, rawDocument, "documents/ready-report.pdf", {
      mediaType: "application/pdf",
    });
    expect(uploaded.response.status, JSON.stringify(uploaded.payload)).toBe(201);
    const file = uploaded.payload.file;
    const root = await getRootAgent(member.label);
    await waitForIngestStatus(root, file.id, "ready");
    const resolved = await root.getWorkspaceFileVersion(file.id, file.currentVersion.id);
    expect(resolved?.extractedObjectKey).toContain(".extracted.1.txt");

    const selected = await apiRequest(
      `/api/agent/conversations/${conversation.id}/workspace-files`,
      member.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: conversation.updatedAt,
          files: [{ fileId: file.id, versionId: file.currentVersion.id }],
        }),
      },
    );
    expect(selected.status, await selected.clone().text()).toBe(200);

    let providerBody: unknown = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      providerBody = JSON.parse(String(init?.body));
      return fakeProviderResponse("local response");
    });
    const agent = await getConversationAgent(member.label, conversation.id);
    await agent.importLegacyMessages([{
      id: "workspace-ready-document-message",
      role: "user",
      parts: [{ type: "text", text: "Use the ready document." }],
    }]);
    const result = await runInDurableObject(agent, async (instance) => {
      const response = await instance.onChatMessage(async () => undefined, {});
      return { status: response.status, body: await response.text() };
    });
    expect(result.status, result.body).toBe(200);
    const serialized = JSON.stringify(providerBody);
    expect(serialized).toContain("ready extracted PDF context");
    expect(serialized).not.toContain("%PDF-1.4");
    expect(serialized).not.toContain("xref");
    expect(serialized).not.toContain(file.id);
    expect(serialized).not.toContain(file.currentVersion.id);
    expect(serialized).not.toContain(resolved!.objectKey);
    expect(serialized).not.toContain(resolved!.extractedObjectKey);
  });

  it("fails before Provider execution when a ready extracted artifact is tampered", async () => {
    const member = await login();
    const conversation = await createConversation(member.cookie);
    const uploaded = await upload(member.cookie, "original text must not be used", "documents/integrity.txt");
    expect(uploaded.response.status).toBe(201);
    const file = uploaded.payload.file;
    const root = await getRootAgent(member.label);
    await waitForIngestStatus(root, file.id, "ready");
    const resolved = await root.getWorkspaceFileVersion(file.id, file.currentVersion.id);
    expect(resolved).toBeDefined();

    const selected = await apiRequest(
      `/api/agent/conversations/${conversation.id}/workspace-files`,
      member.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: conversation.updatedAt,
          files: [{ fileId: file.id, versionId: file.currentVersion.id }],
        }),
      },
    );
    expect(selected.status).toBe(200);

    const replacement = "x".repeat(resolved!.extractedBytes);
    await env.WORKSPACE_FILES.put(resolved!.extractedObjectKey, replacement, { sha256: await sha256(replacement) });
    const providerFetch = vi.spyOn(globalThis, "fetch");
    const failureLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const agent = await getConversationAgent(member.label, conversation.id);
    await agent.importLegacyMessages([{
      id: "workspace-tampered-artifact-message",
      role: "user",
      parts: [{ type: "text", text: "Use the selected file." }],
    }]);
    const requestId = "turn_workspace-123";
    const result = await runInDurableObject(agent, async (instance) => {
      const response = await instance.onChatMessage(async () => undefined, { requestId });
      return {
        status: response.status,
        requestId: response.headers.get("X-Request-ID"),
        body: await response.text(),
      };
    });
    expect(result.status).toBe(503);
    expect(result.requestId).toBe(requestId);
    expect(result.body).toContain("workspace_context_unavailable");
    expect(result.body).toContain(requestId);
    expect(result.body).not.toContain(resolved!.objectKey);
    expect(result.body).not.toContain(resolved!.extractedObjectKey);
    const log = failureLog.mock.calls
      .map(([value]) => typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : null)
      .find((value) => value?.event === "agent_turn_failed");
    expect(log).toMatchObject({
      event: "agent_turn_failed",
      requestId,
      phase: "workspace_context",
      error: "workspace_context_unavailable",
    });
    expect(JSON.stringify(log)).not.toContain(resolved!.objectKey);
    expect(JSON.stringify(log)).not.toContain(resolved!.extractedObjectKey);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("sends at most ten exact ready versions while consuming one user-message quota unit", async () => {
    await env.CHAT_STORE.put(ROUTES_CONFIG_KEY, JSON.stringify({
      routes: {
        files: {
          label: "Files",
          type: "openai-chat",
          baseUrl: "https://workspace-provider.example/v1",
          model: "workspace-model",
          apiKey: "workspace-key",
        },
      },
      defaults: {
        defaultRoute: "files",
        allowedRoutes: ["files"],
        dailyMessageLimit: 1,
        minuteMessageLimit: 10,
      },
    }));
    const member = await login();
    const conversation = await createConversation(member.cookie);
    const root = await getRootAgent(member.label);
    const uploaded = [];
    for (let index = 0; index < 11; index += 1) {
      const result = await upload(
        member.cookie,
        `turn-file-${index}`,
        `turn/file-${index}.txt`,
        { operationId: `turn-file-${index}` },
      );
      expect(result.response.status, JSON.stringify(result.payload)).toBe(201);
      await waitForIngestStatus(root, result.payload.file.id, "ready");
      uploaded.push(result.payload.file);
    }

    const tenRefs = uploaded.slice(0, 10).map((file) => ({
      fileId: file.id,
      versionId: file.currentVersion.id,
    }));
    const nineResponse = await apiRequest(
      `/api/agent/conversations/${conversation.id}/workspace-files`,
      member.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: conversation.updatedAt, files: tenRefs.slice(0, 9) }),
      },
    );
    expect(nineResponse.status, await nineResponse.clone().text()).toBe(200);
    const nineConversation = (await nineResponse.json() as any).conversation;
    expect(nineConversation.workspaceFiles).toHaveLength(9);

    const selectedResponse = await apiRequest(
      `/api/agent/conversations/${conversation.id}/workspace-files`,
      member.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: nineConversation.updatedAt, files: tenRefs }),
      },
    );
    expect(selectedResponse.status, await selectedResponse.clone().text()).toBe(200);
    const selectedConversation = (await selectedResponse.json() as any).conversation;
    expect(selectedConversation.workspaceFiles).toHaveLength(10);

    const elevenResponse = await apiRequest(
      `/api/agent/conversations/${conversation.id}/workspace-files`,
      member.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: selectedConversation.updatedAt,
          files: [
            ...tenRefs,
            { fileId: uploaded[10].id, versionId: uploaded[10].currentVersion.id },
          ],
        }),
      },
    );
    expect(elevenResponse.status).toBe(400);
    await expect(elevenResponse.json()).resolves.toMatchObject({ error: "workspace_refs_invalid" });

    let providerBody: unknown = null;
    const providerFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      providerBody = JSON.parse(String(init?.body));
      return fakeProviderResponse("local response");
    });
    const agent = await getConversationAgent(member.label, conversation.id);
    await agent.importLegacyMessages([{
      id: "workspace-ten-file-message",
      role: "user",
      parts: [{ type: "text", text: "Use all ten exact files." }],
    }]);
    const first = await runInDurableObject(agent, async (instance) => {
      const response = await instance.onChatMessage(async () => undefined, {});
      return { status: response.status, body: await response.text() };
    });
    expect(first.status, first.body).toBe(200);
    expect(providerFetch).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(providerBody);
    expect(serialized.match(/<attached_file /gu)).toHaveLength(10);
    for (let index = 0; index < 10; index += 1) expect(serialized).toContain(`turn-file-${index}`);
    expect(serialized).not.toContain("turn-file-10");

    const second = await runInDurableObject(agent, async (instance) => {
      const response = await instance.onChatMessage(async () => undefined, {});
      return { status: response.status, body: await response.text() };
    });
    expect(second.status).toBe(429);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("searches and paginates files, then renames, pins, and deletes through the HTTP API", async () => {
    const member = await login();
    const alpha = await upload(member.cookie, "alpha", "folder/alpha.txt");
    const beta = await upload(member.cookie, "beta", "folder/beta.txt");
    const gamma = await upload(member.cookie, "gamma", "folder/gamma.txt");
    expect([alpha.response.status, beta.response.status, gamma.response.status]).toEqual([201, 201, 201]);

    const renamedResponse = await apiRequest(`/api/workspace/files/${alpha.payload.file.id}`, member.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relativePath: "Reference/Renamed.txt",
        pinned: true,
        expectedUpdatedAt: alpha.payload.file.updatedAt,
      }),
    });
    expect(renamedResponse.status).toBe(200);
    const renamed = (await renamedResponse.json() as any).file;
    expect(renamed).toMatchObject({ path: "Reference/Renamed.txt", name: "Renamed.txt", pinned: true });

    const searched = await apiRequest("/api/workspace/files?q=renamed", member.cookie);
    expect(searched.status).toBe(200);
    const searchedPayload = await searched.json() as any;
    expect(searchedPayload).toMatchObject({
      files: [expect.objectContaining({ id: alpha.payload.file.id, pinned: true })],
      usage: {
        quotaBytes: 14,
        extractedBytes: 14,
        pendingCleanupBytes: 0,
        trackedBytes: 28,
        limitBytes: MAX_WORKSPACE_MEMBER_BYTES,
      },
    });
    expect(Object.keys(searchedPayload.usage)).toEqual([
      "quotaBytes",
      "extractedBytes",
      "pendingCleanupBytes",
      "trackedBytes",
      "limitBytes",
    ]);

    const firstPage = await apiRequest("/api/workspace/files?limit=1", member.cookie).then((response) => response.json()) as any;
    expect(firstPage.files).toHaveLength(1);
    expect(firstPage.files[0].id).toBe(alpha.payload.file.id);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await apiRequest(
      `/api/workspace/files?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      member.cookie,
    ).then((response) => response.json()) as any;
    expect(secondPage.files).toHaveLength(1);
    expect(secondPage.files[0].id).not.toBe(firstPage.files[0].id);

    const root = await getRootAgent(member.label);
    const betaVersion = await root.getWorkspaceFileVersion(
      beta.payload.file.id,
      beta.payload.file.currentVersion.id,
    );
    expect(betaVersion).toBeDefined();
    const deleted = await apiRequest(
      `/api/workspace/files/${beta.payload.file.id}?expectedUpdatedAt=${beta.payload.file.updatedAt}&operationId=delete-beta`,
      member.cookie,
      { method: "DELETE" },
    );
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ ok: true, deleted: true });
    expect(await env.WORKSPACE_FILES.get(betaVersion!.objectKey)).toBeNull();
    const afterDelete = await apiRequest("/api/workspace/files?q=beta", member.cookie).then((response) => response.json()) as any;
    expect(afterDelete.files).toEqual([]);
  });

  it("recovers a failed upload with a new immutable operation and version", async () => {
    const member = await login();
    const root = await getRootAgent(member.label);
    const failedContent = "failed before R2 write";
    const reservation = await root.reserveWorkspaceUpload({
      operationId: "failed-upload",
      relativePath: "retry/failed.txt",
      size: new TextEncoder().encode(failedContent).byteLength,
      mediaType: "text/plain",
      checksum: await sha256(failedContent),
    });
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) throw new Error(reservation.error);
    await root.recordWorkspaceOperationFailure(
      reservation.reservation.operationId,
      reservation.reservation.generation,
      "workspace_r2_put_failed",
    );
    await expect(root.deferWorkspaceOperation(
      reservation.reservation.operationId,
      reservation.reservation.generation,
      1,
    )).resolves.toBe(true);

    const reconciled = await apiRequest("/api/workspace/files?q=failed", member.cookie);
    expect(reconciled.status).toBe(200);
    const failedFile = (await reconciled.json() as any).files[0];
    expect(failedFile).toMatchObject({ id: reservation.reservation.fileId, state: "failed", retryAvailable: true });

    const retried = await upload(member.cookie, "retry succeeded", failedFile.path, {
      operationId: "retry-upload",
      fileId: failedFile.id,
      expectedUpdatedAt: failedFile.updatedAt,
    });
    expect(retried.response.status, JSON.stringify(retried.payload)).toBe(200);
    expect(retried.payload.file).toMatchObject({ id: failedFile.id, state: "ready", retryAvailable: false });
    expect(retried.payload.file.currentVersion.id).not.toBe(reservation.reservation.versionId);
    const versions = await root.listWorkspaceFileVersions(failedFile.id);
    expect(versions?.versions).toEqual([
      expect.objectContaining({ id: retried.payload.file.currentVersion.id, state: "ready" }),
    ]);
  });

  it("copies exact references to branches and removes only the deleted conversation references", async () => {
    const member = await login();
    const conversation = await createConversation(member.cookie);
    const uploaded = await upload(member.cookie, "branch pinned content", "branches/source.txt");
    expect(uploaded.response.status).toBe(201);
    const file = uploaded.payload.file;
    const versionId = file.currentVersion.id;

    const selectedResponse = await apiRequest(
      `/api/agent/conversations/${conversation.id}/workspace-files`,
      member.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: conversation.updatedAt,
          files: [{ fileId: file.id, versionId }],
        }),
      },
    );
    expect(selectedResponse.status).toBe(200);

    const sourceAgent = await getConversationAgent(member.label, conversation.id);
    await sourceAgent.importLegacyMessages([
      { id: "workspace-branch-user", role: "user", parts: [{ type: "text", text: "Use the pinned file." }] },
      { id: "workspace-branch-assistant", role: "assistant", parts: [{ type: "text", text: "Acknowledged." }] },
    ]);
    const root = await getRootAgent(member.label);
    await root.recordConversationActivity({ id: conversation.id, messageCount: 2 });
    const source = (await root.listConversations()).find((item) => item.id === conversation.id)!;

    const branchResponse = await apiRequest(
      `/api/agent/conversations/${conversation.id}/branches`,
      member.cookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: `workspace-branch-${crypto.randomUUID()}`,
          action: "branch",
          sourceMessageId: "workspace-branch-assistant",
          expectedUpdatedAt: source.updatedAt,
        }),
      },
    );
    expect(branchResponse.status, await branchResponse.clone().text()).toBe(200);
    const branch = (await branchResponse.json() as any).conversation;
    expect(branch.workspaceFiles).toEqual([expect.objectContaining({ fileId: file.id, versionId })]);
    await expect(root.resolveConversationWorkspaceFiles(conversation.id)).resolves.toEqual([
      expect.objectContaining({ fileId: file.id, versionId }),
    ]);
    await expect(root.resolveConversationWorkspaceFiles(branch.id)).resolves.toEqual([
      expect.objectContaining({ fileId: file.id, versionId }),
    ]);

    const version = await root.getWorkspaceFileVersion(file.id, versionId);
    expect(version).toBeDefined();
    const deletedSource = await apiRequest(
      `/api/agent/conversations/${conversation.id}?expectedUpdatedAt=${source.updatedAt}`,
      member.cookie,
      { method: "DELETE" },
    );
    expect(deletedSource.status, await deletedSource.clone().text()).toBe(200);
    await expect(root.resolveConversationWorkspaceFiles(conversation.id)).resolves.toEqual([]);
    await expect(root.resolveConversationWorkspaceFiles(branch.id)).resolves.toHaveLength(1);
    expect(await env.WORKSPACE_FILES.get(version!.objectKey)).not.toBeNull();

    const currentBranch = (await root.listConversations()).find((item) => item.id === branch.id)!;
    const deletedBranch = await apiRequest(
      `/api/agent/conversations/${branch.id}?expectedUpdatedAt=${currentBranch.updatedAt}`,
      member.cookie,
      { method: "DELETE" },
    );
    expect(deletedBranch.status, await deletedBranch.clone().text()).toBe(200);
    await expect(root.resolveConversationWorkspaceFiles(branch.id)).resolves.toEqual([]);
    expect(await env.WORKSPACE_FILES.get(version!.objectKey)).not.toBeNull();
  });

  it("rejects stale mutations and file or version identifiers owned by another member", async () => {
    const owner = await login();
    const uploaded = await upload(owner.cookie, "owner only", "private/owner.txt");
    expect(uploaded.response.status).toBe(201);
    const file = uploaded.payload.file;

    const staleRename = await apiRequest(`/api/workspace/files/${file.id}`, owner.cookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relativePath: "private/renamed.txt", expectedUpdatedAt: file.updatedAt - 1 }),
    });
    expect(staleRename.status).toBe(409);
    await expect(staleRename.json()).resolves.toMatchObject({ error: "workspace_file_conflict" });

    for (const body of [
      { expectedUpdatedAt: file.updatedAt, pinned: "yes" },
      { expectedUpdatedAt: file.updatedAt },
      { expectedUpdatedAt: file.updatedAt, pinned: true, objectKey: "private" },
    ]) {
      const invalidUpdate = await apiRequest(`/api/workspace/files/${file.id}`, owner.cookie, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(invalidUpdate.status).toBe(400);
      await expect(invalidUpdate.json()).resolves.toMatchObject({ error: "workspace_update_invalid" });
    }

    const outsider = await login();
    const outsiderConversation = await createConversation(outsider.cookie);
    expect((await apiRequest(`/api/workspace/files/${file.id}/versions`, outsider.cookie)).status).toBe(404);
    expect((await apiRequest(
      `/api/workspace/files/${file.id}/download?versionId=${file.currentVersion.id}`,
      outsider.cookie,
    )).status).toBe(404);
    const forgedRef = await apiRequest(
      `/api/agent/conversations/${outsiderConversation.id}/workspace-files`,
      outsider.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: outsiderConversation.updatedAt,
          files: [{ fileId: file.id, versionId: file.currentVersion.id }],
        }),
      },
    );
    expect(forgedRef.status).toBe(409);
    const malformedRef = await apiRequest(
      `/api/agent/conversations/${outsiderConversation.id}/workspace-files`,
      outsider.cookie,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: outsiderConversation.updatedAt,
          files: [{ fileId: file.id, versionId: file.currentVersion.id, objectKey: "private" }],
        }),
      },
    );
    expect(malformedRef.status).toBe(400);
    await expect(malformedRef.json()).resolves.toMatchObject({ error: "workspace_refs_invalid" });
  });

  it("purges R2 objects before revoking the account session", async () => {
    const member = await login();
    const uploaded = await upload(member.cookie, "account owned object", "account/data.txt");
    expect(uploaded.response.status).toBe(201);
    const root = await getRootAgent(member.label);
    const version = await root.getWorkspaceFileVersion(
      uploaded.payload.file.id,
      uploaded.payload.file.currentVersion.id,
    );
    expect(version).toBeDefined();
    expect(await env.WORKSPACE_FILES.get(version!.objectKey)).not.toBeNull();
    const purge = await root.beginWorkspaceAccountPurge("account-purge-race-lock");
    expect(purge).toMatchObject({
      operationId: "account-purge-race-lock",
      objectKeys: [version!.objectKey, version!.extractedObjectKey],
      existing: false,
      completed: false,
    });
    await expect(root.reserveWorkspaceUpload({
      operationId: "unsnapshotted-account-upload",
      relativePath: "account/unsnapshotted.txt",
      size: 1,
      mediaType: "text/plain",
      checksum: await sha256("x"),
    })).resolves.toMatchObject({ ok: false, error: "workspace_account_purge_in_progress" });

    const deleted = await apiRequest("/api/user-data", member.cookie, { method: "DELETE" });
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    expect(await env.WORKSPACE_FILES.get(version!.objectKey)).toBeNull();
    await expect(root.listWorkspaceFiles()).resolves.toMatchObject({ files: [] });
    await expect(env.WORKSPACE_FILES.list()).resolves.toMatchObject({ objects: [] });
    const operationCount = await runInDurableObject(root, async (_instance, state) => (
      state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM workspace_file_operations",
      ).one().count
    ));
    expect(operationCount).toBe(0);
    expect((await apiRequest("/api/workspace/files", member.cookie)).status).toBe(401);
  });
});
