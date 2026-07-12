import { describe, expect, it } from "vitest";
import { sanitizeMarkdownUrl } from "../public/markdown.js";

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
