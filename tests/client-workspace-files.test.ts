import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_UPLOAD_BATCH_FILES,
  MAX_TEXT_DOCUMENT_BYTES,
  MAX_WORKSPACE_FILE_BYTES,
} from "../src/contracts/workspace-file";
import { workspaceUploadSelectionError } from "../client/src/lib/workspace-files";

function candidates(count: number, input: Partial<{
  name: string;
  mediaType: string;
  relativePath: string;
  size: number;
}> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    name: input.name || `notes-${index}.txt`,
    mediaType: input.mediaType || "text/plain",
    relativePath: input.relativePath || `notes/notes-${index}.txt`,
    size: input.size ?? 1,
  }));
}

describe("workspace upload selection", () => {
  it("accepts batch 49 and 50 but rejects 51", () => {
    expect(workspaceUploadSelectionError(candidates(MAX_DOCUMENT_UPLOAD_BATCH_FILES - 1))).toBe("");
    expect(workspaceUploadSelectionError(candidates(MAX_DOCUMENT_UPLOAD_BATCH_FILES))).toBe("");
    expect(workspaceUploadSelectionError(candidates(MAX_DOCUMENT_UPLOAD_BATCH_FILES + 1))).toContain("50");
  });

  it("enforces text and document limits at minus one, exact, and plus one", () => {
    for (const size of [MAX_TEXT_DOCUMENT_BYTES - 1, MAX_TEXT_DOCUMENT_BYTES]) {
      expect(workspaceUploadSelectionError(candidates(1, { size }))).toBe("");
    }
    expect(workspaceUploadSelectionError(candidates(1, { size: MAX_TEXT_DOCUMENT_BYTES + 1 }))).toContain("1.0 MB");

    const document = { name: "report.pdf", relativePath: "reports/report.pdf", mediaType: "application/pdf" };
    for (const size of [MAX_WORKSPACE_FILE_BYTES - 1, MAX_WORKSPACE_FILE_BYTES]) {
      expect(workspaceUploadSelectionError(candidates(1, { ...document, size }))).toBe("");
    }
    expect(workspaceUploadSelectionError(candidates(1, { ...document, size: MAX_WORKSPACE_FILE_BYTES + 1 })))
      .toContain("10.0 MB");
  });

  it("rejects unsupported document types", () => {
    expect(workspaceUploadSelectionError(candidates(1, {
      name: "archive.zip",
      relativePath: "archive.zip",
      mediaType: "application/zip",
    }))).toContain("不受支持");
  });
});
