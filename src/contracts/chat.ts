export type ChatRole = "system" | "user" | "assistant";

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ToolEventSummary = {
  id: string;
  toolId: string;
  label: string;
  source: "builtin" | "mcp";
  status: "pending" | "approved" | "running" | "completed" | "failed" | "denied";
  argumentSummary?: string;
  resultPreview?: string;
  confirmation?: "once" | "conversation";
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
  truncated?: boolean;
};

export type ChatMessage = {
  role: ChatRole;
  content: string | ChatPart[];
  routeId?: string;
  fallback?: boolean;
  createdAt?: number;
  rating?: "up" | "down";
  ratingReason?: string;
  finishReason?: string;
  toolEvents?: ToolEventSummary[];
};
