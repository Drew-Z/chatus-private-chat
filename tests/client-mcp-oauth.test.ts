import { describe, expect, it } from "vitest";
import { consumeMcpOAuthCallback } from "../client/src/lib/mcp-oauth";

describe("MCP OAuth callback state", () => {
  it.each(["connected", "review_required", "error"] as const)("consumes the finite %s result", (result) => {
    expect(consumeMcpOAuthCallback(`https://chatus.example/react-chat/?mcpOAuth=${result}&view=chat#latest`)).toEqual({
      result,
      relativeUrl: "/react-chat/?view=chat#latest",
    });
  });

  it("removes an unknown result without turning it into a notice", () => {
    expect(consumeMcpOAuthCallback("https://chatus.example/react-chat/?mcpOAuth=token-like-value&view=chat")).toEqual({
      result: null,
      relativeUrl: "/react-chat/?view=chat",
    });
  });

  it("does nothing when the callback parameter is absent", () => {
    expect(consumeMcpOAuthCallback("https://chatus.example/react-chat/?view=chat")).toBeNull();
  });
});
