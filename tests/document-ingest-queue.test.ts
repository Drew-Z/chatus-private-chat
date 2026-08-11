import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamAgent } from "../src/agent/team-agent";
import type { DocumentIngestMessage } from "../src/contracts/workspace-file";
import { IDENTITY_REGISTRY_INSTANCE_NAME } from "../src/identity-registry";
import { getTeamAgentInstanceName } from "../src/worker";
import worker from "../src/worker";
import { normalDocumentFixtures } from "./document-fixtures";

async function rootAgent(label = `queue-${crypto.randomUUID()}`) {
  const legacyInstance = await getTeamAgentInstanceName(label);
  const principal = await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).resolveOrCreatePrincipal({
    version: 1,
    operationId: `queue-principal:${crypto.randomUUID()}`,
    alias: label,
    origin: "legacy",
    legacyRootInstance: legacyInstance,
    legacyUserStateInstance: `queue-state-${crypto.randomUUID()}`,
  });
  const root = await getAgentByName(env.TEAM_AGENT, principal.rootInstanceName, {
    props: { userLabel: label, scope: "root" },
  }) as DurableObjectStub<TeamAgent>;
  await root.ensureStableIdentity({
    version: 1,
    principalId: principal.principalId,
    rootInstanceName: principal.rootInstanceName,
    userStateInstanceName: principal.userStateInstanceName,
    registryRevision: principal.registryRevision,
    scope: "root",
    resourceId: "",
    resourceRegistryRevision: 0,
    pinnedInstanceName: principal.rootInstanceName,
  });
  return { label, root, principal };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readyVersion(
  label: string,
  root: DurableObjectStub<TeamAgent>,
  principal: Awaited<ReturnType<typeof rootAgent>>["principal"],
  bytes: Uint8Array,
  name: string,
  mediaType: string,
) {
  const checksum = await sha256(bytes);
  const reserved = await root.reserveWorkspaceUpload({
    operationId: `queue-upload-${crypto.randomUUID()}`,
    relativePath: name,
    size: bytes.byteLength,
    mediaType,
    checksum,
  });
  expect(reserved.ok).toBe(true);
  if (!reserved.ok) throw new Error(reserved.error);
  await env.WORKSPACE_FILES.put(reserved.reservation.objectKey, bytes, { sha256: checksum });
  await root.completeWorkspaceUpload(reserved.reservation.operationId, reserved.reservation.generation);
  const message: DocumentIngestMessage = {
    ownerId: label,
    principalId: principal.principalId,
    rootInstanceName: principal.rootInstanceName,
    userStateInstanceName: principal.userStateInstanceName,
    registryRevision: principal.registryRevision,
    fileId: reserved.reservation.fileId,
    versionId: reserved.reservation.versionId,
    generation: 1,
  };
  return { message, reservation: reserved.reservation };
}

function queueMessage(body: DocumentIngestMessage, attempts = 1) {
  return {
    body,
    id: crypto.randomUUID(),
    timestamp: new Date(),
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

async function dispatch(queue: string, message: ReturnType<typeof queueMessage>) {
  await (worker as unknown as {
    queue(batch: unknown, bindings: typeof env, context: ExecutionContext): Promise<void>;
  }).queue({ queue, messages: [message] }, env, {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as ExecutionContext);
}

async function clearWorkspaceBucket() {
  let cursor: string | undefined;
  do {
    const page = await env.WORKSPACE_FILES.list({ cursor, limit: 1_000 });
    if (page.objects.length) await env.WORKSPACE_FILES.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

describe("document ingest Queue runtime", () => {
  beforeEach(clearWorkspaceBucket);
  afterEach(() => vi.restoreAllMocks());

  it("extracts all five queued formats for their exact versions and acknowledges them", async () => {
    const { label, root, principal } = await rootAgent();
    for (const fixture of await normalDocumentFixtures()) {
      const { message, reservation } = await readyVersion(
        label,
        root,
        principal,
        fixture.bytes,
        `queue/${fixture.name}`,
        fixture.mediaType,
      );
      await expect(root.listWorkspaceFileVersions(message.fileId)).resolves.toMatchObject({
        versions: [expect.objectContaining({ ingestStatus: "queued", ingestAttempts: 0 })],
      });
      const queued = queueMessage(message);

      await dispatch("chatus-document-ingest-local", queued);

      expect(queued.ack).toHaveBeenCalledOnce();
      expect(queued.retry).not.toHaveBeenCalled();
      const listed = await root.listWorkspaceFileVersions(message.fileId);
      expect(listed?.versions[0]).toMatchObject({ ingestStatus: "ready", ingestAttempts: 1 });
      const resolved = await root.getWorkspaceFileVersion(message.fileId, message.versionId);
      expect(resolved?.extractedObjectKey).toBe(`${reservation.objectKey}.extracted.1.txt`);
      const extracted = await env.WORKSPACE_FILES.get(resolved!.extractedObjectKey);
      expect(await extracted?.text()).toContain(fixture.expectedText);
    }
  });

  it("permanently fails active PDF content without retrying", async () => {
    const { label, root, principal } = await rootAgent();
    const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /Launch >> >> endobj\n%%EOF");
    const { message } = await readyVersion(label, root, principal, bytes, "documents/unsafe.pdf", "application/pdf");
    const queued = queueMessage(message);
    const providerFetch = vi.spyOn(globalThis, "fetch");

    await dispatch("chatus-document-ingest-local", queued);

    expect(queued.ack).toHaveBeenCalledOnce();
    expect(queued.retry).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
    await expect(root.listWorkspaceFileVersions(message.fileId)).resolves.toMatchObject({
      versions: [expect.objectContaining({ ingestStatus: "failed", ingestError: "pdf_active_content" })],
    });
  });

  it("requests exactly three retries before the fourth failed delivery reaches the DLQ", async () => {
    const { label, root, principal } = await rootAgent();
    const bytes = new TextEncoder().encode("missing source");
    const { message, reservation } = await readyVersion(label, root, principal, bytes, "notes/missing.txt", "text/plain");
    await env.WORKSPACE_FILES.delete(reservation.objectKey);
    for (let delivery = 1; delivery <= 4; delivery += 1) {
      const queued = queueMessage(message, delivery);
      await dispatch("chatus-document-ingest-local", queued);
      expect(queued.retry).toHaveBeenCalledOnce();
      expect(queued.ack).not.toHaveBeenCalled();
      await expect(root.listWorkspaceFileVersions(message.fileId)).resolves.toMatchObject({
        versions: [expect.objectContaining({ ingestStatus: "queued", ingestAttempts: delivery })],
      });
    }

    const dlq = queueMessage(message, 5);
    await dispatch("chatus-document-ingest-dlq-local", dlq);
    expect(dlq.ack).toHaveBeenCalledOnce();
    await expect(root.listWorkspaceFileVersions(message.fileId)).resolves.toMatchObject({
      versions: [expect.objectContaining({
        ingestStatus: "failed",
        ingestAttempts: 4,
        ingestError: "document_ingest_retry_exhausted",
      })],
    });
  });

  it("acknowledges stale principal routes without changing the queued generation", async () => {
    const { label, root, principal } = await rootAgent();
    const bytes = new TextEncoder().encode("stale identity must not ingest");
    const { message, reservation } = await readyVersion(
      label,
      root,
      principal,
      bytes,
      "notes/stale.txt",
      "text/plain",
    );
    const wrongRoute = queueMessage({ ...message, registryRevision: message.registryRevision + 1 });

    await dispatch("chatus-document-ingest-local", wrongRoute);

    expect(wrongRoute.ack).toHaveBeenCalledOnce();
    expect(wrongRoute.retry).not.toHaveBeenCalled();
    await expect(root.listWorkspaceFileVersions(message.fileId)).resolves.toMatchObject({
      versions: [expect.objectContaining({ ingestStatus: "queued", ingestAttempts: 0 })],
    });
    await expect(env.WORKSPACE_FILES.get(`${reservation.objectKey}.extracted.1.txt`)).resolves.toBeNull();

    await runInDurableObject(root, async (_instance, state) => {
      const marker = await state.storage.get<Record<string, unknown>>("chatus:stable-agent-identity:v1");
      await state.storage.put("chatus:stable-agent-identity:v1", {
        ...marker,
        registryRevision: message.registryRevision + 1,
      });
    });
    const driftedMarker = queueMessage(message);
    await dispatch("chatus-document-ingest-local", driftedMarker);
    expect(driftedMarker.ack).toHaveBeenCalledOnce();
    expect(driftedMarker.retry).not.toHaveBeenCalled();
    await expect(root.listWorkspaceFileVersions(message.fileId)).resolves.toMatchObject({
      versions: [expect.objectContaining({ ingestStatus: "queued", ingestAttempts: 0 })],
    });

    await env.IDENTITY_REGISTRY.getByName(IDENTITY_REGISTRY_INSTANCE_NAME).retirePrincipalAlias({
      version: 1,
      operationId: `queue-retire:${crypto.randomUUID()}`,
      principalId: principal.principalId,
      alias: label,
      retiredAt: Date.now(),
    });
    const retired = queueMessage(message, 5);
    await dispatch("chatus-document-ingest-dlq-local", retired);

    expect(retired.ack).toHaveBeenCalledOnce();
    expect(retired.retry).not.toHaveBeenCalled();
    await expect(root.listWorkspaceFileVersions(message.fileId)).resolves.toMatchObject({
      versions: [expect.objectContaining({ ingestStatus: "queued", ingestAttempts: 0 })],
    });
  });
});
