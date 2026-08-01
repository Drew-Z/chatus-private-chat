export type McpOAuthCallbackResult = "connected" | "review_required" | "error";

export function consumeMcpOAuthCallback(href: string): {
  result: McpOAuthCallbackResult | null;
  relativeUrl: string;
} | null {
  const url = new URL(href);
  const value = url.searchParams.get("mcpOAuth");
  if (value === null) return null;
  url.searchParams.delete("mcpOAuth");
  return {
    result: value === "connected" || value === "review_required" || value === "error" ? value : null,
    relativeUrl: `${url.pathname}${url.search}${url.hash}`,
  };
}
