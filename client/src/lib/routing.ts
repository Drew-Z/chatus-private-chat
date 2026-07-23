export type ClientSurface = "chat" | "admin";

export function resolveClientSurface(pathname: string): ClientSurface {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/react-chat/admin" ? "admin" : "chat";
}
