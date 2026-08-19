export const VISION_EVIDENCE_VERSION = 1 as const;
export const DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS = 6_000;
export const MIN_VISION_ASSIST_MAX_OUTPUT_CHARS = 512;
export const MAX_VISION_ASSIST_MAX_OUTPUT_CHARS = 12_000;
export const MAX_VISION_EVIDENCE_DESCRIPTION_CHARS = 4_000;
export const MAX_VISION_EVIDENCE_OCR_LINES = 32;
export const MAX_VISION_EVIDENCE_OCR_LINE_CHARS = 500;
export const MAX_VISION_EVIDENCE_LIMITATIONS = 16;
export const MAX_VISION_EVIDENCE_LIMITATION_CHARS = 300;
export const IMAGE_INSPECT_TOOL_NAME = "image_inspect" as const;

export type PublicImageMode = "native" | "assisted_tool" | "assisted_preanswer" | "none";

export type VisionAssistConfig = {
  enabled?: boolean;
  routeId: string;
  maxOutputChars?: number;
};

export type VisionEvidenceV1 = {
  version: 1;
  description: string;
  ocrText: string[];
  limitations: string[];
};

export type VisionEvidenceRecordV1 = {
  sourceMessageId: string;
  evidence: VisionEvidenceV1;
};

const EXACT_EVIDENCE_KEYS = ["version", "description", "ocrText", "limitations"] as const;
const FORBIDDEN_EXTERNAL_REFERENCE = /(?:https?:\/\/|data:|file:|ftp:|www\.)/iu;

export function normalizeVisionAssistMaxOutputChars(value: unknown): number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_VISION_ASSIST_MAX_OUTPUT_CHARS
    && value <= MAX_VISION_ASSIST_MAX_OUTPUT_CHARS
    ? value
    : DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS;
}

export function decodeVisionEvidenceV1(
  value: unknown,
  maxOutputChars = DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS,
): VisionEvidenceV1 | undefined {
  if (!isExactRecord(value, EXACT_EVIDENCE_KEYS) || value.version !== VISION_EVIDENCE_VERSION) return undefined;
  if (!isBoundedEvidenceText(value.description, MAX_VISION_EVIDENCE_DESCRIPTION_CHARS, false)) return undefined;
  const ocrText = decodeTextList(
    value.ocrText,
    MAX_VISION_EVIDENCE_OCR_LINES,
    MAX_VISION_EVIDENCE_OCR_LINE_CHARS,
  );
  const limitations = decodeTextList(
    value.limitations,
    MAX_VISION_EVIDENCE_LIMITATIONS,
    MAX_VISION_EVIDENCE_LIMITATION_CHARS,
  );
  if (!ocrText || !limitations) return undefined;
  const evidence: VisionEvidenceV1 = {
    version: VISION_EVIDENCE_VERSION,
    description: value.description,
    ocrText,
    limitations,
  };
  const boundedMax = normalizeVisionAssistMaxOutputChars(maxOutputChars);
  return JSON.stringify(evidence).length <= boundedMax ? evidence : undefined;
}

export function parseVisionEvidenceV1(
  text: string,
  maxOutputChars = DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS,
): VisionEvidenceV1 | undefined {
  const normalized = text.trim();
  if (!normalized || normalized.length > normalizeVisionAssistMaxOutputChars(maxOutputChars)) return undefined;
  try {
    return decodeVisionEvidenceV1(JSON.parse(normalized), maxOutputChars);
  } catch {
    return undefined;
  }
}

export function formatVisionEvidenceForModel(evidence: VisionEvidenceV1): string {
  return [
    "[受限图像证据]",
    `描述：${evidence.description}`,
    evidence.ocrText.length ? `OCR：\n${evidence.ocrText.map((line) => `- ${line}`).join("\n")}` : "OCR：未识别到文字",
    evidence.limitations.length
      ? `局限：\n${evidence.limitations.map((line) => `- ${line}`).join("\n")}`
      : "局限：无额外说明",
    "[/受限图像证据]",
  ].join("\n");
}

export function visionEvidencePrompt(maxOutputChars: number): string {
  return [
    "Inspect only the attached images and return strict JSON with exactly these keys:",
    '{"version":1,"description":"...","ocrText":["..."],"limitations":["..."]}',
    "Describe visible content concisely, transcribe only visible text, and state uncertainty in limitations.",
    "Do not include URLs, data URIs, hidden reasoning, markdown fences, or any additional keys.",
    `The complete JSON must be at most ${normalizeVisionAssistMaxOutputChars(maxOutputChars)} characters.`,
  ].join(" ");
}

function decodeTextList(value: unknown, maxItems: number, maxChars: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const output: string[] = [];
  for (const item of value) {
    if (!isBoundedEvidenceText(item, maxChars, false)) return undefined;
    output.push(item);
  }
  return output;
}

function isBoundedEvidenceText(value: unknown, maxChars: number, allowEmpty: boolean): value is string {
  if (typeof value !== "string" || value.length > maxChars || value.trim() !== value) return false;
  if ((!allowEmpty && !value.length) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return false;
  return !FORBIDDEN_EXTERNAL_REFERENCE.test(value);
}

function isExactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => (keys as readonly string[]).includes(key));
}
