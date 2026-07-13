import { describe, expect, it } from "vitest";
import { parseMarkdownTable, sanitizeMarkdownUrl } from "../public/markdown.js";

describe("sanitizeMarkdownUrl", () => {
  it("allows expected links", () => {
    expect(sanitizeMarkdownUrl("https://example.com/a", "link")).toBe("https://example.com/a");
    expect(sanitizeMarkdownUrl("mailto:friend@example.com", "link")).toBe("mailto:friend@example.com");
  });

  it("blocks executable and arbitrary data URLs", () => {
    expect(sanitizeMarkdownUrl("javascript:alert(1)", "link")).toBeNull();
    expect(sanitizeMarkdownUrl("vbscript:msgbox(1)", "link")).toBeNull();
    expect(sanitizeMarkdownUrl("data:text/html;base64,PHNjcmlwdD4=", "image")).toBeNull();
  });

  it("allows only supported base64 image types", () => {
    expect(sanitizeMarkdownUrl("data:image/png;base64,aGVsbG8=", "image")).toBe("data:image/png;base64,aGVsbG8=");
    expect(sanitizeMarkdownUrl("data:image/svg+xml;base64,PHN2Zz4=", "image")).toBeNull();
  });
});

describe("parseMarkdownTable", () => {
  it("parses alignment and normalizes short rows", () => {
    expect(parseMarkdownTable([
      "| 模型 | 速度 | 说明 |",
      "| :--- | :---: | ---: |",
      "| A | 快 | 稳定 |",
      "| B | 慢 |",
      "后续文字",
    ])).toEqual({
      headers: ["模型", "速度", "说明"],
      alignments: ["left", "center", "right"],
      rows: [["A", "快", "稳定"], ["B", "慢", ""]],
      nextIndex: 4,
    });
  });

  it("keeps escaped pipes inside cells and rejects ordinary prose", () => {
    expect(parseMarkdownTable(["命令 | 作用", "--- | ---", "a\\|b | 测试"])?.rows[0]).toEqual(["a|b", "测试"]);
    expect(parseMarkdownTable(["普通 | 文本", "不是 | 表格"])).toBeNull();
  });
});
