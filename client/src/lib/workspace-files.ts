import {
  MAX_DOCUMENT_UPLOAD_BATCH_FILES,
  workspaceDocumentByteLimit,
} from "../../../src/contracts/workspace-file";

export type WorkspaceUploadCandidate = {
  name: string;
  mediaType: string;
  relativePath: string;
  size: number;
};

export function workspaceUploadSelectionError(candidates: readonly WorkspaceUploadCandidate[]): string {
  if (candidates.length > MAX_DOCUMENT_UPLOAD_BATCH_FILES) {
    return `一次最多上传 ${MAX_DOCUMENT_UPLOAD_BATCH_FILES} 个文件。`;
  }
  for (const candidate of candidates) {
    const limit = workspaceDocumentByteLimit(candidate.mediaType, candidate.relativePath);
    if (!limit) return `${candidate.name} 的文件类型不受支持。`;
    if (candidate.size > limit) return `${candidate.name} 超过 ${formatBytes(limit)} 限制。`;
  }
  return "";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
