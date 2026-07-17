import { describe, expect, it } from "vitest";
import { sanitizeMarkdownUrl } from "../client/src/lib/markdown";

describe("React Markdown URL sanitization", () => {
  it.each([
    "https://example.com/path",
    "http://example.com/path",
    "mailto:bill@example.com",
    "tel:+8613800000000",
    "#section",
    "/docs/start",
    "./local",
    "../parent",
    "data:image/png;base64,aGVsbG8=",
    "data:image/webp;base64,UklGRg==",
  ])("allows %s", (url) => {
    expect(sanitizeMarkdownUrl(`  ${url}  `)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.com/id",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,",
    "data:image/png;base64,%%%",
    "//external.example/path",
    "example.com/no-scheme",
  ])("blocks %s", (url) => {
    expect(sanitizeMarkdownUrl(url)).toBe("");
  });
});
