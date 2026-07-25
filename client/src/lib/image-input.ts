import type { FileUIPart } from "ai";
import {
  normalizeImageMediaType,
  parseDataImage,
  type ImageInputPolicy,
  type ImageMediaType,
} from "../../../src/contracts/image";

export type DraftImageError =
  | "unsupported_type"
  | "too_large"
  | "too_many"
  | "total_too_large"
  | "read_failed";

export type DraftImageAttachment = {
  id: string;
  file: File;
  filename: string;
  mediaType: ImageMediaType | "";
  size: number;
  previewUrl: string;
  dataUrl?: string;
  status: "reading" | "ready" | "error";
  error?: DraftImageError;
};

type ImageInputRuntime = {
  createId: () => string;
  createObjectURL: (file: File) => string;
};

export function addDraftImageFiles(
  current: DraftImageAttachment[],
  files: File[],
  policy: ImageInputPolicy,
  runtime: ImageInputRuntime = {
    createId: () => crypto.randomUUID(),
    createObjectURL: (file) => URL.createObjectURL(file),
  },
): DraftImageAttachment[] {
  const next = [...current];
  let acceptedCount = current.filter((attachment) => attachment.status !== "error").length;
  let acceptedBytes = current.reduce(
    (total, attachment) => total + (attachment.status === "error" ? 0 : attachment.size),
    0,
  );

  for (const file of files) {
    const base = {
      id: runtime.createId(),
      file,
      filename: boundedFilename(file.name),
      size: file.size,
      previewUrl: "",
    };
    const mediaType = normalizeImageMediaType(file.type);
    if (!mediaType || !policy.acceptedMediaTypes.includes(mediaType)) {
      next.push({ ...base, mediaType: "", status: "error", error: "unsupported_type" });
      continue;
    }
    if (acceptedCount >= policy.maxImages) {
      next.push({ ...base, mediaType, status: "error", error: "too_many" });
      continue;
    }
    if (file.size > policy.maxImageBytes) {
      next.push({ ...base, mediaType, status: "error", error: "too_large" });
      continue;
    }
    if (acceptedBytes + file.size > policy.maxTotalImageBytes) {
      next.push({ ...base, mediaType, status: "error", error: "total_too_large" });
      continue;
    }
    acceptedCount += 1;
    acceptedBytes += file.size;
    next.push({
      ...base,
      mediaType,
      previewUrl: runtime.createObjectURL(file),
      status: "reading",
    });
  }

  return next;
}

export async function readDraftImage(
  attachment: DraftImageAttachment,
  readFile: (file: File) => Promise<string> = readFileAsDataUrl,
): Promise<DraftImageAttachment> {
  if (attachment.status !== "reading" || !attachment.mediaType) return attachment;
  try {
    const dataUrl = await readFile(attachment.file);
    const parsed = parseDataImage(dataUrl, attachment.mediaType);
    if (!parsed.ok || parsed.image.decodedBytes !== attachment.size) {
      return { ...attachment, status: "error", error: "read_failed", dataUrl: undefined };
    }
    return {
      ...attachment,
      status: "ready",
      dataUrl: `data:${parsed.image.mediaType};base64,${parsed.image.data}`,
      error: undefined,
    };
  } catch {
    return { ...attachment, status: "error", error: "read_failed", dataUrl: undefined };
  }
}

export function toImageFileParts(attachments: DraftImageAttachment[]): FileUIPart[] {
  return attachments.flatMap((attachment) => (
    attachment.status === "ready" && attachment.mediaType && attachment.dataUrl
      ? [{
          type: "file" as const,
          mediaType: attachment.mediaType,
          filename: attachment.filename,
          url: attachment.dataUrl,
        }]
      : []
  ));
}

export function restoreRejectedImages(
  current: DraftImageAttachment[],
  submitted: DraftImageAttachment[],
): DraftImageAttachment[] {
  return current.length ? current : submitted;
}

export function releaseImagePreviews(
  attachments: DraftImageAttachment[],
  revokeObjectURL: (url: string) => void = (url) => URL.revokeObjectURL(url),
): void {
  const urls = new Set(attachments.map((attachment) => attachment.previewUrl).filter(Boolean));
  for (const url of urls) revokeObjectURL(url);
}

export function imageAttachmentErrorLabel(error: DraftImageError): string {
  if (error === "unsupported_type") return "不支持此格式";
  if (error === "too_large") return "图片过大";
  if (error === "too_many") return "数量超限";
  if (error === "total_too_large") return "总大小超限";
  return "读取失败";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("read_failed"));
    }, { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("read_failed")), { once: true });
    reader.addEventListener("abort", () => reject(new Error("read_failed")), { once: true });
    reader.readAsDataURL(file);
  });
}

function boundedFilename(value: string): string {
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return (normalized || "image").slice(0, 200);
}
