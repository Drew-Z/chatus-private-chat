export const MAX_WORKSPACE_PATH_CHARS = 1_024;
export const MAX_WORKSPACE_SEGMENT_CHARS = 255;
export const MAX_WORKSPACE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_FILES_PER_CONVERSATION = 10;
export const MAX_WORKSPACE_LIST_LIMIT = 50;

export type WorkspaceFileState = "uploading" | "ready" | "failed" | "deleting" | "deleted";
export type WorkspaceFileVersionState = "pending" | "ready" | "failed" | "deleting";

export type WorkspaceFileVersionProjection = {
  id: string;
  fileId: string;
  size: number;
  mediaType: string;
  checksum: string;
  state: WorkspaceFileVersionState;
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

export type WorkspaceFileListResult = {
  files: WorkspaceFileProjection[];
  nextCursor?: string;
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
};

export type WorkspacePendingOperation = {
  operationId: string;
  kind: "upload" | "delete_file" | "account_purge";
  fileId: string;
  versionId: string;
  generation: number;
  state: "pending" | "failed";
  objectKeys: string[];
  size: number;
  checksum: string;
  attempts: number;
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
