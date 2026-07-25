export const TEXT_FILE_MEDIA_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "text/xml",
  "text/html",
  "text/css",
  "text/javascript",
  "text/typescript",
  "application/json",
  "application/x-ndjson",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-toml",
  "application/sql",
] as const;

export const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".text",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".cs",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".php",
  ".swift",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".sql",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".log",
] as const;

export const TEXT_FILE_BASENAMES = [
  "dockerfile",
  "makefile",
  "rakefile",
  "gemfile",
  "procfile",
] as const;

export type TextFileMediaType = (typeof TEXT_FILE_MEDIA_TYPES)[number];
export type TextFileExtension = (typeof TEXT_FILE_EXTENSIONS)[number];

export type FileInputPolicy = {
  acceptedMediaTypes: string[];
  acceptedExtensions: string[];
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxExtractedChars: number;
};

export type FileValidationErrorCode =
  | "file_not_supported"
  | "invalid_file_type"
  | "invalid_file_data"
  | "file_too_large"
  | "too_many_files"
  | "files_too_large"
  | "file_text_too_large";

export type TextFileValidationState = {
  fileCount: number;
  totalBytes: number;
  totalChars: number;
};

export type ParsedTextFile = {
  filename: string;
  mediaType: string;
  bytes: number;
  text: string;
  contextText: string;
};

export type TextFileParseResult =
  | { ok: true; file: ParsedTextFile; state: TextFileValidationState }
  | { ok: false; error: FileValidationErrorCode };

export const MAX_INLINE_FILE_BYTES_PER_MESSAGE = 512 * 1024;

export const DEFAULT_FILE_INPUT_POLICY: Readonly<FileInputPolicy> = {
  acceptedMediaTypes: [...TEXT_FILE_MEDIA_TYPES],
  acceptedExtensions: [...TEXT_FILE_EXTENSIONS],
  maxFiles: 5,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: MAX_INLINE_FILE_BYTES_PER_MESSAGE,
  maxExtractedChars: MAX_INLINE_FILE_BYTES_PER_MESSAGE,
};

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".jsx": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".ts": "application/typescript",
  ".tsx": "application/typescript",
  ".mts": "application/typescript",
  ".cts": "application/typescript",
  ".sql": "application/sql",
  ".toml": "application/toml",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".zsh": "application/x-sh",
  ".ps1": "text/plain",
  ".env": "text/plain",
  ".log": "text/plain",
};

export function emptyTextFileValidationState(): TextFileValidationState {
  return { fileCount: 0, totalBytes: 0, totalChars: 0 };
}

export function normalizeTextFilename(value: unknown, fallback = "attachment.txt"): string {
  const normalized = typeof value === "string"
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]+/g, "_")
    : "";
  return (normalized || fallback).slice(0, 200);
}

export function textFileExtension(filename: unknown): string {
  if (typeof filename !== "string") return "";
  const normalized = normalizeTextFilename(filename, "");
  const lower = normalized.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot > 0 && dot < lower.length - 1) return lower.slice(dot);
  if (TEXT_FILE_BASENAMES.includes(lower as (typeof TEXT_FILE_BASENAMES)[number])) return lower;
  return "";
}

export function normalizeTextFileMediaType(mediaType: unknown, filename?: unknown): string | null {
  const rawMediaType = typeof mediaType === "string" ? mediaType.split(";")[0]?.trim().toLowerCase() || "" : "";
  if (rawMediaType && TEXT_FILE_MEDIA_TYPES.includes(rawMediaType as TextFileMediaType)) return rawMediaType;
  if (rawMediaType.startsWith("text/")) return rawMediaType.slice(0, 120);

  const extension = textFileExtension(filename);
  if (!extension) return null;
  if (
    TEXT_FILE_EXTENSIONS.includes(extension as TextFileExtension) ||
    TEXT_FILE_BASENAMES.includes(extension as (typeof TEXT_FILE_BASENAMES)[number])
  ) {
    return EXTENSION_MEDIA_TYPES[extension] || "text/plain";
  }
  return null;
}

export function isSupportedTextFileDescriptor(
  mediaType: unknown,
  filename: unknown,
  policy: FileInputPolicy,
): boolean {
  const normalizedType = normalizeTextFileMediaType(mediaType, filename);
  const extension = textFileExtension(filename);
  return Boolean(
    (normalizedType && (
      policy.acceptedMediaTypes.includes(normalizedType) ||
      normalizedType.startsWith("text/")
    )) ||
    (extension && (
      policy.acceptedExtensions.includes(extension) ||
      TEXT_FILE_BASENAMES.includes(extension as (typeof TEXT_FILE_BASENAMES)[number])
    )),
  );
}

export function parseDataTextFile(
  value: unknown,
  declaredMediaType: unknown,
  filename: unknown,
  policy: FileInputPolicy,
  state: TextFileValidationState = emptyTextFileValidationState(),
): TextFileParseResult {
  if (state.fileCount >= policy.maxFiles) return { ok: false, error: "too_many_files" };
  const name = normalizeTextFilename(filename);
  const mediaType = normalizeTextFileMediaType(declaredMediaType, name);
  if (!mediaType || !isSupportedTextFileDescriptor(mediaType, name, policy)) {
    return { ok: false, error: "invalid_file_type" };
  }
  if (typeof value !== "string") return { ok: false, error: "invalid_file_data" };

  const parsed = parseDataUrl(value);
  if (!parsed || normalizeTextFileMediaType(parsed.mediaType, name) !== mediaType) {
    return { ok: false, error: "invalid_file_data" };
  }
  if (!isStrictBase64(parsed.data)) return { ok: false, error: "invalid_file_data" };

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(parsed.data);
  } catch {
    return { ok: false, error: "invalid_file_data" };
  }
  if (bytes.byteLength > policy.maxFileBytes) return { ok: false, error: "file_too_large" };
  if (state.totalBytes + bytes.byteLength > policy.maxTotalBytes) {
    return { ok: false, error: "files_too_large" };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return { ok: false, error: "invalid_file_data" };
  }
  if (state.totalChars + text.length > policy.maxExtractedChars) {
    return { ok: false, error: "file_text_too_large" };
  }

  const nextState = {
    fileCount: state.fileCount + 1,
    totalBytes: state.totalBytes + bytes.byteLength,
    totalChars: state.totalChars + text.length,
  };
  return {
    ok: true,
    state: nextState,
    file: {
      filename: name,
      mediaType,
      bytes: bytes.byteLength,
      text,
      contextText: formatAttachedFileContext({ filename: name, mediaType, bytes: bytes.byteLength, text }),
    },
  };
}

export function formatAttachedFileContext(input: {
  filename: string;
  mediaType: string;
  bytes: number;
  text: string;
}): string {
  const filename = escapeAttribute(normalizeTextFilename(input.filename));
  const mediaType = escapeAttribute(input.mediaType.slice(0, 120) || "text/plain");
  const bytes = Math.max(0, Math.floor(input.bytes));
  const text = input.text.replace(/<\/attached_file>/gi, "<\\/attached_file>");
  return `<attached_file name="${filename}" mediaType="${mediaType}" bytes="${bytes}">\n${text}\n</attached_file>`;
}

function parseDataUrl(value: string): { mediaType: string; data: string } | null {
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const metadata = value.slice(0, comma);
  if (!metadata.toLowerCase().startsWith("data:")) return null;
  const metadataParts = metadata.slice(5).split(";").map((part) => part.trim().toLowerCase());
  const mediaType = metadataParts[0] || "";
  if (!metadataParts.includes("base64")) return null;
  return { mediaType, data: value.slice(comma + 1) };
}

function isStrictBase64(value: string): boolean {
  return value.length > 0
    && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
