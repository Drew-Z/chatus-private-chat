import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { describe, expect, it } from "vitest";
import type { TeamAgent } from "../src/agent/team-agent";
import {
  DOCUMENT_INGEST_LEASE_MS,
  MAX_DOCUMENT_UPLOAD_BATCH_FILES,
  MAX_TEXT_DOCUMENT_BYTES,
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_MEMBER_BYTES,
  workspaceDocumentByteLimit,
  type DocumentIngestMessage,
} from "../src/contracts/workspace-file";
import { getTeamAgentInstanceName } from "../src/worker";

async function getRootAgent(label = `ingest-${crypto.randomUUID()}`) {
  const instance = await getTeamAgentInstanceName(label);
  const root = await getAgentByName(env.TEAM_AGENT, instance, {
    props: { userLabel: label, scope: "root" },
  }) as DurableObjectStub<TeamAgent>;
  return { label, root };
}

async function createReadyVersion(root: DurableObjectStub<TeamAgent>, suffix = crypto.randomUUID(), size = 12) {
  const reserved = await root.reserveWorkspaceUpload({
    operationId: `upload-${suffix}`,
    relativePath: `documents/${suffix}.pdf`,
    size,
    mediaType: "application/pdf",
    checksum: "a".repeat(64),
  });
  expect(reserved.ok).toBe(true);
  if (!reserved.ok) throw new Error(reserved.error);
  const completed = await root.completeWorkspaceUpload(
    reserved.reservation.operationId,
    reserved.reservation.generation,
  );
  expect(completed.ok).toBe(true);
  return reserved.reservation;
}

function ingestMessage(
  ownerId: string,
  version: Awaited<ReturnType<typeof createReadyVersion>>,
  generation = 1,
): DocumentIngestMessage {
  return {
    ownerId,
    fileId: version.fileId,
    versionId: version.versionId,
    generation,
  };
}

describe("document ingest contracts", () => {
  it("locks upload, batch, member, and turn limits", () => {
    expect(MAX_TEXT_DOCUMENT_BYTES).toBe(1 * 1024 * 1024);
    expect(MAX_WORKSPACE_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_DOCUMENT_UPLOAD_BATCH_FILES).toBe(50);
    expect(MAX_WORKSPACE_MEMBER_BYTES).toBe(250 * 1024 * 1024);
    expect(workspaceDocumentByteLimit("text/plain", "notes.txt")).toBe(MAX_TEXT_DOCUMENT_BYTES);
    expect(workspaceDocumentByteLimit("application/pdf", "report.pdf")).toBe(MAX_WORKSPACE_FILE_BYTES);
    expect(workspaceDocumentByteLimit("application/octet-stream", "report.docx")).toBe(MAX_WORKSPACE_FILE_BYTES);
    expect(workspaceDocumentByteLimit("application/octet-stream", "archive.zip")).toBe(0);
  });

  it("migrates the root schema to ingest metadata idempotently", async () => {
    const { root } = await getRootAgent();
    const schema = await runInDurableObject(root, async (instance, state) => {
      const migrator = instance as unknown as { applySchemaMigrations(): void };
      migrator.applySchemaMigrations();
      migrator.applySchemaMigrations();
      return {
        versions: state.storage.sql.exec<{ id: number }>(
          "SELECT id FROM _sql_schema_migrations ORDER BY id",
        ).toArray().map((row) => row.id),
        columns: state.storage.sql.exec<{ name: string }>(
          "PRAGMA table_info(workspace_file_versions)",
        ).toArray().map((row) => row.name),
      };
    });
    expect(schema.versions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(schema.columns).toEqual(expect.arrayContaining([
      "ingest_status",
      "ingest_generation",
      "ingest_attempts",
      "ingest_error",
      "extracted_object_key",
      "extracted_checksum",
      "extracted_bytes",
      "extracted_chars",
    ]));
  });

  it("uses generation CAS for duplicate, transient, and completed deliveries", async () => {
    const { label, root } = await getRootAgent();
    const version = await createReadyVersion(root);
    const message = ingestMessage(label, version);

    const beginnings = await Promise.all([
      root.beginDocumentIngest(message),
      root.beginDocumentIngest(message),
    ]);
    const first = beginnings.find((result) => result.action === "process");
    expect(first).toMatchObject({
      action: "process",
      attempt: 1,
      sourceObjectKey: version.objectKey,
      extractedObjectKey: `${version.objectKey}.extracted.1.txt`,
    });
    expect(beginnings).toContainEqual(expect.objectContaining({
      action: "retry",
      retryAfterSeconds: expect.any(Number),
    }));
    await expect(root.recordDocumentIngestFailure(message, "upstream_timeout", true)).resolves.toBe(true);

    const second = await root.beginDocumentIngest(message);
    expect(second).toMatchObject({ action: "process", attempt: 2 });
    if (second.action !== "process") throw new Error("expected process action");
    const completed = await root.completeDocumentIngest(message, {
      objectKey: second.extractedObjectKey,
      checksum: "b".repeat(64),
      bytes: 24,
      chars: 24,
    });
    expect(completed).toBe(true);
    await expect(root.beginDocumentIngest(message)).resolves.toEqual({ action: "ack", status: "ready" });
    const listed = await root.listWorkspaceFileVersions(version.fileId);
    expect(listed?.versions[0]).toMatchObject({
      ingestStatus: "ready",
      ingestGeneration: 1,
      ingestAttempts: 2,
    });
  });

  it("reclaims an extracting generation only after its processing lease expires", async () => {
    const { label, root } = await getRootAgent();
    const version = await createReadyVersion(root);
    const message = ingestMessage(label, version);
    await expect(root.beginDocumentIngest(message)).resolves.toMatchObject({ action: "process", attempt: 1 });
    await expect(root.beginDocumentIngest(message)).resolves.toMatchObject({
      action: "retry",
      retryAfterSeconds: expect.any(Number),
    });

    await runInDurableObject(root, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE workspace_file_versions SET updated_at = ? WHERE id = ?",
        Date.now() - DOCUMENT_INGEST_LEASE_MS - 1,
        message.versionId,
      );
    });
    await expect(root.beginDocumentIngest(message)).resolves.toMatchObject({ action: "process", attempt: 2 });
  });

  it("uses a new generation for manual retry and ignores stale DLQ and completion messages", async () => {
    const { label, root } = await getRootAgent();
    const version = await createReadyVersion(root);
    const firstMessage = ingestMessage(label, version);
    await root.beginDocumentIngest(firstMessage);
    await expect(root.recordDocumentIngestFailure(firstMessage, "document_active_content", false)).resolves.toBe(true);

    const retry = await root.retryDocumentIngest(version.fileId, version.versionId);
    expect(retry).toEqual({ ok: true, message: ingestMessage(label, version, 2) });
    await expect(root.beginDocumentIngest(firstMessage)).resolves.toEqual({ action: "ack", status: "stale" });
    await expect(root.recordDocumentIngestDlq(firstMessage, "stale_dlq")).resolves.toBe(false);
    const secondMessage = ingestMessage(label, version, 2);
    const second = await root.beginDocumentIngest(secondMessage);
    expect(second).toMatchObject({ action: "process", attempt: 1 });
    await expect(root.recordDocumentIngestDlq(secondMessage, "retry_exhausted")).resolves.toBe(true);
    await expect(root.completeDocumentIngest(secondMessage, {
      objectKey: `${version.objectKey}.extracted.2.txt`,
      checksum: "c".repeat(64),
      bytes: 4,
      chars: 4,
    })).resolves.toBe(false);
    const listed = await root.listWorkspaceFileVersions(version.fileId);
    expect(listed?.versions[0]).toMatchObject({
      ingestStatus: "failed",
      ingestGeneration: 2,
      ingestAttempts: 1,
      ingestError: "retry_exhausted",
    });
  });

  it("makes deleted terminal and includes original and extracted objects in cleanup", async () => {
    const { label, root } = await getRootAgent();
    const version = await createReadyVersion(root);
    const message = ingestMessage(label, version);
    const begun = await root.beginDocumentIngest(message);
    expect(begun.action).toBe("process");
    const current = await root.listWorkspaceFileVersions(version.fileId);
    const deletion = await root.reserveWorkspaceFileDelete(
      version.fileId,
      current!.file.updatedAt,
      "delete-extracting-document",
    );
    expect(deletion).toMatchObject({ ok: true });
    if (!deletion.ok) throw new Error(deletion.error);
    expect(deletion.reservation.objectKeys.sort()).toEqual([
      version.objectKey,
      `${version.objectKey}.extracted.1.txt`,
    ].sort());
    await expect(root.completeDocumentIngest(message, {
      objectKey: `${version.objectKey}.extracted.1.txt`,
      checksum: "d".repeat(64),
      bytes: 8,
      chars: 8,
    })).resolves.toBe(false);
    await expect(root.recordDocumentIngestFailure(message, "late_failure", true)).resolves.toBe(false);
    await expect(root.recordDocumentIngestDlq(message, "late_dlq")).resolves.toBe(false);
    await expect(root.beginDocumentIngest(message)).resolves.toEqual({ action: "ack", status: "deleted" });
  });

  it("serializes concurrent retained-byte admission at the 250 MiB member boundary", async () => {
    const { root } = await getRootAgent();
    for (let index = 0; index < 24; index += 1) {
      await createReadyVersion(root, `quota-${index}`, MAX_WORKSPACE_FILE_BYTES);
    }
    await createReadyVersion(root, "quota-last-partial", MAX_WORKSPACE_FILE_BYTES - 1);
    const contenders = await Promise.all([
      root.reserveWorkspaceUpload({
        operationId: "quota-final-byte-a",
        relativePath: "documents/quota-final-byte-a.pdf",
        size: 1,
        mediaType: "application/pdf",
        checksum: "e".repeat(64),
      }),
      root.reserveWorkspaceUpload({
        operationId: "quota-final-byte-b",
        relativePath: "documents/quota-final-byte-b.pdf",
        size: 1,
        mediaType: "application/pdf",
        checksum: "f".repeat(64),
      }),
    ]);
    expect(contenders.filter((result) => result.ok)).toHaveLength(1);
    expect(contenders.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ error: "workspace_member_quota_exceeded" }),
    ]);
    await expect(root.reserveWorkspaceUpload({
      operationId: "quota-over-limit",
      relativePath: "documents/quota-over-limit.pdf",
      size: 1,
      mediaType: "application/pdf",
      checksum: "e".repeat(64),
    })).resolves.toMatchObject({ ok: false, error: "workspace_member_quota_exceeded" });
  });
});
