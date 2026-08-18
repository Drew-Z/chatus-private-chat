import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS,
  MAX_VISION_ASSIST_MAX_OUTPUT_CHARS,
  MAX_VISION_EVIDENCE_DESCRIPTION_CHARS,
  MAX_VISION_EVIDENCE_LIMITATIONS,
  MAX_VISION_EVIDENCE_LIMITATION_CHARS,
  MAX_VISION_EVIDENCE_OCR_LINE_CHARS,
  MAX_VISION_EVIDENCE_OCR_LINES,
  MIN_VISION_ASSIST_MAX_OUTPUT_CHARS,
  decodeVisionEvidenceV1,
  formatVisionEvidenceForModel,
  normalizeVisionAssistMaxOutputChars,
  parseVisionEvidenceV1,
  visionEvidencePrompt,
} from "../src/contracts/vision-assist";

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    description: "A whiteboard with a release checklist.",
    ocrText: ["Release", "Tests green"],
    limitations: ["The lower-right corner is blurred."],
    ...overrides,
  };
}

describe("vision assist evidence contract", () => {
  it("accepts only the exact versioned evidence shape", () => {
    expect(decodeVisionEvidenceV1(evidence())).toEqual(evidence());
    expect(decodeVisionEvidenceV1(evidence({ version: 2 }))).toBeUndefined();
    expect(decodeVisionEvidenceV1(evidence({ reasoning: "private chain" }))).toBeUndefined();
    expect(decodeVisionEvidenceV1(evidence({ raw: "provider response" }))).toBeUndefined();
    expect(decodeVisionEvidenceV1({
      version: 1,
      description: "Visible content",
      ocrText: [],
    })).toBeUndefined();
  });

  it("rejects external references, control characters, and padded text", () => {
    for (const description of [
      "https://private.example/image.png",
      "HTTP://private.example/image.png",
      "data:image/png;base64,AAAA",
      "file:///tmp/image.png",
      "ftp://private.example/image.png",
      "www.private.example/image.png",
      "visible\u0000hidden",
      " leading whitespace",
      "trailing whitespace ",
    ]) {
      expect(decodeVisionEvidenceV1(evidence({ description }))).toBeUndefined();
    }
    expect(decodeVisionEvidenceV1(evidence({ ocrText: ["data:text/plain,private"] }))).toBeUndefined();
    expect(decodeVisionEvidenceV1(evidence({ limitations: ["See https://private.example"] }))).toBeUndefined();
  });

  it("enforces field, array, and complete-output bounds", () => {
    expect(decodeVisionEvidenceV1(evidence({
      description: "d".repeat(MAX_VISION_EVIDENCE_DESCRIPTION_CHARS + 1),
    }))).toBeUndefined();
    expect(decodeVisionEvidenceV1(evidence({
      ocrText: Array.from({ length: MAX_VISION_EVIDENCE_OCR_LINES + 1 }, () => "text"),
    }))).toBeUndefined();
    expect(decodeVisionEvidenceV1(evidence({
      ocrText: ["o".repeat(MAX_VISION_EVIDENCE_OCR_LINE_CHARS + 1)],
    }))).toBeUndefined();
    expect(decodeVisionEvidenceV1(evidence({
      limitations: Array.from({ length: MAX_VISION_EVIDENCE_LIMITATIONS + 1 }, () => "uncertain"),
    }))).toBeUndefined();
    expect(decodeVisionEvidenceV1(evidence({
      limitations: ["l".repeat(MAX_VISION_EVIDENCE_LIMITATION_CHARS + 1)],
    }))).toBeUndefined();
    expect(decodeVisionEvidenceV1(evidence({
      description: "d".repeat(MIN_VISION_ASSIST_MAX_OUTPUT_CHARS),
    }), MIN_VISION_ASSIST_MAX_OUTPUT_CHARS)).toBeUndefined();
  });

  it("parses strict JSON and rejects malformed or expanded Provider output", () => {
    const serialized = JSON.stringify(evidence());
    expect(parseVisionEvidenceV1(serialized)).toEqual(evidence());
    expect(parseVisionEvidenceV1(`\n${serialized}\n`)).toEqual(evidence());
    expect(parseVisionEvidenceV1("not-json")).toBeUndefined();
    expect(parseVisionEvidenceV1(`\`\`\`json\n${serialized}\n\`\`\``)).toBeUndefined();
    expect(parseVisionEvidenceV1(`${serialized}\nprovider commentary`)).toBeUndefined();
    expect(parseVisionEvidenceV1(JSON.stringify(evidence({ reasoning: "hidden" })))).toBeUndefined();
    expect(parseVisionEvidenceV1(" ")).toBeUndefined();
  });

  it("normalizes the configured output ceiling and states it in the prompt", () => {
    expect(normalizeVisionAssistMaxOutputChars(MIN_VISION_ASSIST_MAX_OUTPUT_CHARS)).toBe(MIN_VISION_ASSIST_MAX_OUTPUT_CHARS);
    expect(normalizeVisionAssistMaxOutputChars(MAX_VISION_ASSIST_MAX_OUTPUT_CHARS)).toBe(MAX_VISION_ASSIST_MAX_OUTPUT_CHARS);
    for (const invalid of [undefined, 0, MIN_VISION_ASSIST_MAX_OUTPUT_CHARS - 1, MAX_VISION_ASSIST_MAX_OUTPUT_CHARS + 1, 1.5]) {
      expect(normalizeVisionAssistMaxOutputChars(invalid)).toBe(DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS);
    }
    expect(visionEvidencePrompt(MIN_VISION_ASSIST_MAX_OUTPUT_CHARS)).toContain(
      `at most ${MIN_VISION_ASSIST_MAX_OUTPUT_CHARS} characters`,
    );
    expect(visionEvidencePrompt(1)).toContain(
      `at most ${DEFAULT_VISION_ASSIST_MAX_OUTPUT_CHARS} characters`,
    );
  });

  it("formats only normalized evidence for the text model", () => {
    expect(formatVisionEvidenceForModel({
      version: 1,
      description: "A chart with two bars.",
      ocrText: ["North 42", "South 37"],
      limitations: ["The legend is partially cropped."],
    })).toBe([
      "[受限图像证据]",
      "描述：A chart with two bars.",
      "OCR：",
      "- North 42",
      "- South 37",
      "局限：",
      "- The legend is partially cropped.",
      "[/受限图像证据]",
    ].join("\n"));
    expect(formatVisionEvidenceForModel({
      version: 1,
      description: "A blank page.",
      ocrText: [],
      limitations: [],
    })).toContain("OCR：未识别到文字\n局限：无额外说明");
  });
});
