import {
  decodeStablePrincipalIdentity,
  normalizeMemberAlias,
} from "./identity";

export const MAX_WORKSPACE_PATH_CHARS = 1_024;
export const MAX_WORKSPACE_SEGMENT_CHARS = 255;
export const MAX_WORKSPACE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_DOCUMENT_BYTES = 1 * 1024 * 1024;
export const MAX_DOCUMENT_UPLOAD_BATCH_FILES = 50;
export const MAX_WORKSPACE_MEMBER_BYTES = 250 * 1024 * 1024;
export const MAX_WORKSPACE_FILES_PER_CONVERSATION = 10;
export const MAX_WORKSPACE_LIST_LIMIT = 50;
export const DOCUMENT_INGEST_LEASE_MS = 60_000;

export type WorkspaceFileState = "uploading" | "ready" | "failed" | "deleting" | "deleted";
export type WorkspaceFileVersionState = "pending" | "ready" | "failed" | "deleting";
export type DocumentIngestStatus = "queued" | "extracting" | "ready" | "failed" | "deleted";

export function workspaceExtractedObjectKey(sourceObjectKey: string, generation: number): string {
  return `${sourceObjectKey}.extracted.${generation}.txt`;
}

export type DocumentIngestMessage = {
  ownerId: string;
  principalId: string;
  rootInstanceName: string;
  userStateInstanceName: string;
  registryRevision: number;
  fileId: string;
  versionId: string;
  generation: number;
};

export function decodeDocumentIngestMessage(value: unknown): DocumentIngestMessage | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "ownerId", "principalId", "rootInstanceName", "userStateInstanceName", "registryRevision",
    "fileId", "versionId", "generation",
  ])) return undefined;
  const ownerId = normalizeMemberAlias(value.ownerId);
  const stable = decodeStablePrincipalIdentity({
    version: 1,
    principalId: value.principalId,
    rootInstanceName: value.rootInstanceName,
    userStateInstanceName: value.userStateInstanceName,
    registryRevision: value.registryRevision,
  });
  const fileId = normalizeWorkspaceEntityId(value.fileId);
  const versionId = normalizeWorkspaceEntityId(value.versionId);
  const generation = finitePositiveInteger(value.generation);
  return ownerId && stable && fileId && versionId && generation
    ? {
        ownerId,
        principalId: stable.principalId,
        rootInstanceName: stable.rootInstanceName,
        userStateInstanceName: stable.userStateInstanceName,
        registryRevision: stable.registryRevision,
        fileId,
        versionId,
        generation,
      }
    : undefined;
}

export type DocumentIngestBeginResult =
  | {
      action: "process";
      attempt: number;
      sourceObjectKey: string;
      extractedObjectKey: string;
      name: string;
      size: number;
      mediaType: string;
      checksum: string;
    }
  | { action: "retry"; retryAfterSeconds: number }
  | { action: "ack"; status: DocumentIngestStatus | "stale" };

export type DocumentIngestArtifact = {
  objectKey: string;
  checksum: string;
  bytes: number;
  chars: number;
};

export type DocumentIngestRetryResult =
  | { ok: true; message: DocumentIngestMessage }
  | { ok: false; error: "workspace_file_not_found" | "document_ingest_not_retryable" };

export type WorkspaceFileVersionProjection = {
  id: string;
  fileId: string;
  size: number;
  mediaType: string;
  checksum: string;
  state: WorkspaceFileVersionState;
  ingestStatus: DocumentIngestStatus;
  ingestGeneration: number;
  ingestAttempts: number;
  ingestError?: string;
  createdAt: number;
};

export type WorkspaceFileProjection = {
  id: string;
  path: string;
  name: string;
  pinned: boolean;
  state: WorkspaceFileState;
  createdAt: number;
  updatedAt: number;
  currentVersion?: WorkspaceFileVersionProjection;
  retryAvailable: boolean;
  ingestRetryAvailable: boolean;
};

export type WorkspaceConversationFileRef = {
  fileId: string;
  versionId: string;
  path: string;
  name: string;
  size: number;
  mediaType: string;
  checksum: string;
};

export type WorkspaceTrackedUsage = {
  quotaBytes: number;
  extractedBytes: number;
  pendingCleanupBytes: number;
  trackedBytes: number;
  limitBytes: number;
};

export type WorkspaceFileListResult = {
  files: WorkspaceFileProjection[];
  nextCursor?: string;
  usage: WorkspaceTrackedUsage;
};

export type WorkspaceFileVersionListResult = {
  file: WorkspaceFileProjection;
  versions: WorkspaceFileVersionProjection[];
};

export type WorkspaceUploadReservationInput = {
  operationId: string;
  relativePath: string;
  size: number;
  mediaType: string;
  checksum: string;
  fileId?: string;
  expectedUpdatedAt?: number;
};

export type WorkspaceUploadReservation = {
  operationId: string;
  fileId: string;
  versionId: string;
  objectKey: string;
  generation: number;
  size: number;
  mediaType: string;
  checksum: string;
  existing: boolean;
  completed: boolean;
  file: WorkspaceFileProjection;
};

export type WorkspaceUploadReservationResult =
  | { ok: true; reservation: WorkspaceUploadReservation }
  | {
      ok: false;
      error:
        | "workspace_path_invalid"
        | "workspace_path_conflict"
        | "workspace_file_not_found"
        | "workspace_file_deleted"
        | "workspace_file_conflict"
        | "workspace_account_purge_in_progress"
        | "workspace_operation_conflict"
        | "workspace_operation_failed"
        | "workspace_member_quota_exceeded"
        | "workspace_upload_invalid";
      current?: WorkspaceFileProjection;
    };

export type WorkspaceMutationResult =
  | { ok: true; file: WorkspaceFileProjection }
  | {
      ok: false;
      error:
        | "workspace_path_invalid"
        | "workspace_path_conflict"
        | "workspace_update_invalid"
        | "workspace_file_not_found"
        | "workspace_file_deleted"
        | "workspace_file_conflict"
        | "workspace_account_purge_in_progress";
      current?: WorkspaceFileProjection;
    };

export type WorkspaceDeleteReservation = {
  operationId: string;
  fileId: string;
  generation: number;
  objectKeys: string[];
  existing: boolean;
  completed: boolean;
};

export type WorkspaceDeleteReservationResult =
  | { ok: true; reservation: WorkspaceDeleteReservation }
  | {
      ok: false;
      error:
        | "workspace_file_not_found"
        | "workspace_file_conflict"
        | "workspace_account_purge_in_progress"
        | "workspace_operation_conflict";
      current?: WorkspaceFileProjection;
    };

export type WorkspaceResolvedFileVersion = WorkspaceConversationFileRef & {
  objectKey: string;
  generation: number;
  ingestStatus: DocumentIngestStatus;
  ingestGeneration: number;
  ingestAttempts: number;
  ingestError: string;
  extractedObjectKey: string;
  extractedChecksum: string;
  extractedBytes: number;
  extractedChars: number;
};

export type WorkspacePendingOperation = {
  operationId: string;
  kind: "upload" | "delete_file" | "account_purge";
  fileId: string;
  versionId: string;
  generation: number;
  state: "pending" | "failed" | "completed";
  objectKeys: string[];
  size: number;
  checksum: string;
  attempts: number;
  nextAttemptAt: number;
  terminalAt: number;
  lastError: string;
  updatedAt: number;
};

export type WorkspaceAccountPurgeReservation = {
  operationId: string;
  generation: number;
  objectKeys: string[];
  existing: boolean;
  completed: boolean;
};

export type WorkspaceAccountPurgeReservationResult =
  | WorkspaceAccountPurgeReservation
  | { error: "workspace_operation_conflict" | "workspace_purge_pending_upload" };

export type NormalizedWorkspacePath = {
  path: string;
  name: string;
  conflictKey: string;
};

export type WorkspacePathResult =
  | { ok: true; value: NormalizedWorkspacePath }
  | { ok: false; error: "workspace_path_invalid" };

export function normalizeWorkspacePath(value: unknown): WorkspacePathResult {
  if (typeof value !== "string" || !value || value.length > MAX_WORKSPACE_PATH_CHARS) {
    return { ok: false, error: "workspace_path_invalid" };
  }
  if (
    value.startsWith("/")
    || value.startsWith("\\")
    || /^[A-Za-z]:/u.test(value)
    || value.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return { ok: false, error: "workspace_path_invalid" };
  }
  const rawSegments = value.split("/");
  if (!rawSegments.length || rawSegments.some((segment) => !segment)) {
    return { ok: false, error: "workspace_path_invalid" };
  }
  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    const segment = rawSegment.normalize("NFC");
    if (
      !segment
      || segment === "."
      || segment === ".."
      || !segment.trim()
      || segment.length > MAX_WORKSPACE_SEGMENT_CHARS
      || /[\u0000-\u001f\u007f-\u009f]/u.test(segment)
    ) {
      return { ok: false, error: "workspace_path_invalid" };
    }
    segments.push(segment);
  }
  const path = segments.join("/");
  if (path.length > MAX_WORKSPACE_PATH_CHARS) return { ok: false, error: "workspace_path_invalid" };
  return {
    ok: true,
    value: {
      path,
      name: segments[segments.length - 1],
      conflictKey: path.toLowerCase(),
    },
  };
}

export function normalizeWorkspaceSearchQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").trim().toLowerCase().slice(0, 120);
}

export function normalizeWorkspaceOperationId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= 120 && /^[A-Za-z0-9._:-]+$/u.test(normalized) ? normalized : "";
}

export function normalizeWorkspaceEntityId(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : "";
}

export function normalizeWorkspaceChecksum(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value) ? value.toLowerCase() : "";
}

export function normalizeWorkspaceMediaType(value: unknown): string {
  if (typeof value !== "string") return "application/octet-stream";
  const normalized = value.trim().toLowerCase();
  return normalized
    && normalized.length <= 120
    && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(normalized)
    ? normalized
    : "application/octet-stream";
}

export function workspaceDocumentByteLimit(mediaTypeValue: unknown, nameValue: unknown): number {
  const mediaType = normalizeWorkspaceMediaType(mediaTypeValue);
  const name = typeof nameValue === "string" ? nameValue.trim().toLowerCase() : "";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (
    mediaType.startsWith("text/")
    || mediaType === "application/json"
    || mediaType === "application/xml"
    || extension === ".txt"
    || extension === ".md"
    || extension === ".csv"
    || extension === ".json"
    || extension === ".xml"
  ) return MAX_TEXT_DOCUMENT_BYTES;
  if (
    mediaType === "application/pdf"
    || extension === ".pdf"
    || extension === ".docx"
    || extension === ".xlsx"
    || extension === ".pptx"
  ) return MAX_WORKSPACE_FILE_BYTES;
  return 0;
}

function finitePositiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  if (Object.keys(value).length !== expected.length) return false;
  const keys = new Set(expected);
  return Object.keys(value).every((key) => keys.has(key));
}
