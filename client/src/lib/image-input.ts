import type { FileUIPart } from "ai";
import {
  normalizeTextFileMediaType,
  normalizeTextFilename,
  isSupportedTextFileDescriptor,
  type FileInputPolicy,
} from "../../../src/contracts/file";
import {
  normalizeImageMediaType,
  parseDataImage,
  type ImageInputPolicy,
  type ImageMediaType,
} from "../../../src/contracts/image";

export type DraftAttachmentError =
  | "unsupported_type"
  | "too_large"
  | "too_many"
  | "total_too_large"
  | "text_too_large"
  | "read_failed"
  | "capability_disabled";

export type DraftAttachmentKind = "image" | "file";

export type DraftAttachment = {
  id: string;
  kind: DraftAttachmentKind;
  file: File;
  filename: string;
  mediaType: string;
  size: number;
  previewUrl: string;
  dataUrl?: string;
  text?: string;
  status: "reading" | "ready" | "error";
  error?: DraftAttachmentError;
};

export type DraftImageAttachment = DraftAttachment;

type AttachmentInputRuntime = {
  createId: () => string;
  createObjectURL: (file: File) => string;
};

type AttachmentCapabilities = {
  imagesSupported: boolean;
  filesSupported: boolean;
};

export function addDraftAttachmentFiles(
  current: DraftAttachment[],
  files: File[],
  imagePolicy: ImageInputPolicy,
  filePolicy: FileInputPolicy,
  capabilities: AttachmentCapabilities,
  runtime: AttachmentInputRuntime = {
    createId: () => crypto.randomUUID(),
    createObjectURL: (file) => URL.createObjectURL(file),
  },
): DraftAttachment[] {
  const next = [...current];
  let acceptedImages = current.filter((attachment) => attachment.kind === "image" && attachment.status !== "error").length;
  let acceptedImageBytes = current.reduce(
    (total, attachment) => total + (attachment.kind === "image" && attachment.status !== "error" ? attachment.size : 0),
    0,
  );
  let acceptedFiles = current.filter((attachment) => attachment.kind === "file" && attachment.status !== "error").length;
  let acceptedFileBytes = current.reduce(
    (total, attachment) => total + (attachment.kind === "file" && attachment.status !== "error" ? attachment.size : 0),
    0,
  );

  for (const file of files) {
    const filename = normalizeTextFilename(file.name, "attachment");
    const imageMediaType = normalizeImageMediaType(file.type);
    const fileMediaType = normalizeTextFileMediaType(file.type, filename);
    const base = {
      id: runtime.createId(),
      file,
      filename,
      size: file.size,
      previewUrl: "",
    };

    if (imageMediaType && imagePolicy.acceptedMediaTypes.includes(imageMediaType)) {
      if (!capabilities.imagesSupported) {
        next.push({ ...base, kind: "image", mediaType: imageMediaType, status: "error", error: "capability_disabled" });
        continue;
      }
      if (acceptedImages >= imagePolicy.maxImages) {
        next.push({ ...base, kind: "image", mediaType: imageMediaType, status: "error", error: "too_many" });
        continue;
      }
      if (file.size > imagePolicy.maxImageBytes) {
        next.push({ ...base, kind: "image", mediaType: imageMediaType, status: "error", error: "too_large" });
        continue;
      }
      if (acceptedImageBytes + file.size > imagePolicy.maxTotalImageBytes) {
        next.push({ ...base, kind: "image", mediaType: imageMediaType, status: "error", error: "total_too_large" });
        continue;
      }
      acceptedImages += 1;
      acceptedImageBytes += file.size;
      next.push({
        ...base,
        kind: "image",
        mediaType: imageMediaType,
        previewUrl: runtime.createObjectURL(file),
        status: "reading",
      });
      continue;
    }

    if (fileMediaType && isSupportedTextFileDescriptor(fileMediaType, filename, filePolicy)) {
      if (!capabilities.filesSupported) {
        next.push({ ...base, kind: "file", mediaType: fileMediaType, status: "error", error: "capability_disabled" });
        continue;
      }
      if (acceptedFiles >= filePolicy.maxFiles) {
        next.push({ ...base, kind: "file", mediaType: fileMediaType, status: "error", error: "too_many" });
        continue;
      }
      if (file.size > filePolicy.maxFileBytes) {
        next.push({ ...base, kind: "file", mediaType: fileMediaType, status: "error", error: "too_large" });
        continue;
      }
      if (acceptedFileBytes + file.size > filePolicy.maxTotalBytes) {
        next.push({ ...base, kind: "file", mediaType: fileMediaType, status: "error", error: "total_too_large" });
        continue;
      }
      acceptedFiles += 1;
      acceptedFileBytes += file.size;
      next.push({ ...base, kind: "file", mediaType: fileMediaType, status: "reading" });
      continue;
    }

    next.push({ ...base, kind: "file", mediaType: fileMediaType || "", status: "error", error: "unsupported_type" });
  }

  return next;
}

export function addDraftImageFiles(
  current: DraftAttachment[],
  files: File[],
  policy: ImageInputPolicy,
  runtime?: AttachmentInputRuntime,
): DraftAttachment[] {
  return addDraftAttachmentFiles(
    current,
    files,
    policy,
    {
      acceptedMediaTypes: [],
      acceptedExtensions: [],
      maxFiles: 0,
      maxFileBytes: 0,
      maxTotalBytes: 0,
      maxExtractedChars: 0,
    },
    { imagesSupported: true, filesSupported: false },
    runtime,
  );
}

export async function readDraftAttachment(
  attachment: DraftAttachment,
  filePolicy: FileInputPolicy,
  readers: {
    readImage?: (file: File) => Promise<string>;
    readBuffer?: (file: File) => Promise<ArrayBuffer>;
  } = {},
): Promise<DraftAttachment> {
  if (attachment.status !== "reading" || !attachment.mediaType) return attachment;
  if (attachment.kind === "image") return readDraftImage(attachment, readers.readImage);

  try {
    const buffer = await (readers.readBuffer || readFileAsArrayBuffer)(attachment.file);
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength !== attachment.size || bytes.byteLength > filePolicy.maxFileBytes) {
      return { ...attachment, status: "error", error: "read_failed", dataUrl: undefined, text: undefined };
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/, "");
    if (text.length > filePolicy.maxExtractedChars) {
      return { ...attachment, status: "error", error: "text_too_large", dataUrl: undefined, text: undefined };
    }
    return {
      ...attachment,
      status: "ready",
      dataUrl: `data:${attachment.mediaType};base64,${base64EncodeBytes(bytes)}`,
      text,
      error: undefined,
    };
  } catch {
    return { ...attachment, status: "error", error: "read_failed", dataUrl: undefined, text: undefined };
  }
}

export async function readDraftImage(
  attachment: DraftAttachment,
  readFile: (file: File) => Promise<string> = readFileAsDataUrl,
): Promise<DraftAttachment> {
  if (attachment.status !== "reading" || attachment.kind !== "image" || !attachment.mediaType) return attachment;
  try {
    const dataUrl = await readFile(attachment.file);
    const parsed = parseDataImage(dataUrl, attachment.mediaType);
    if (!parsed.ok || parsed.image.decodedBytes !== attachment.size) {
      return { ...attachment, status: "error", error: "read_failed", dataUrl: undefined };
    }
    return {
      ...attachment,
      status: "ready",
      mediaType: parsed.image.mediaType,
      dataUrl: `data:${parsed.image.mediaType};base64,${parsed.image.data}`,
      error: undefined,
    };
  } catch {
    return { ...attachment, status: "error", error: "read_failed", dataUrl: undefined };
  }
}

export function toAttachmentFileParts(attachments: DraftAttachment[]): FileUIPart[] {
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

export function toImageFileParts(attachments: DraftAttachment[]): FileUIPart[] {
  return toAttachmentFileParts(attachments.filter((attachment) => attachment.kind === "image"));
}

export function restoreRejectedAttachments(
  current: DraftAttachment[],
  submitted: DraftAttachment[],
): DraftAttachment[] {
  return current.length ? current : submitted;
}

export const restoreRejectedImages = restoreRejectedAttachments;

export function releaseAttachmentPreviews(
  attachments: DraftAttachment[],
  revokeObjectURL: (url: string) => void = (url) => URL.revokeObjectURL(url),
): void {
  const urls = new Set(
    attachments
      .filter((attachment) => attachment.kind === "image")
      .map((attachment) => attachment.previewUrl)
      .filter(Boolean),
  );
  for (const url of urls) revokeObjectURL(url);
}

export const releaseImagePreviews = releaseAttachmentPreviews;

export function attachmentErrorLabel(error: DraftAttachmentError, kind: DraftAttachmentKind): string {
  if (error === "unsupported_type") return "不支持此格式";
  if (error === "too_large") return kind === "image" ? "图片过大" : "文件过大";
  if (error === "too_many") return kind === "image" ? "图片数量超限" : "文件数量超限";
  if (error === "total_too_large") return kind === "image" ? "图片总大小超限" : "文件总大小超限";
  if (error === "text_too_large") return "文本过长";
  if (error === "capability_disabled") return kind === "image" ? "当前模型不支持图片" : "当前会话不支持文件";
  return "读取失败";
}

export const imageAttachmentErrorLabel = (error: DraftAttachmentError): string => attachmentErrorLabel(error, "image");

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

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("read_failed"));
    }, { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("read_failed")), { once: true });
    reader.addEventListener("abort", () => reject(new Error("read_failed")), { once: true });
    reader.readAsArrayBuffer(file);
  });
}

function base64EncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
