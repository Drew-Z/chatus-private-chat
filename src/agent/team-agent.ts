import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import type { StreamTextOnFinishCallback, ToolSet, UIMessage } from "ai";
import {
  runTeamAgentTextTurn,
  type ChatMessage,
  type Env,
  type Session,
} from "../worker";

export type TeamAgentProps = {
  userLabel: string;
};

type TeamAgentState = {
  version: 1;
  runtime: "cloudflare-ai-chat";
};

const MAX_PERSISTED_TOOL_TEXT_CHARS = 4_000;

export class TeamAgent extends AIChatAgent<Env, TeamAgentState, TeamAgentProps> {
  initialState: TeamAgentState = {
    version: 1,
    runtime: "cloudflare-ai-chat",
  };

  maxPersistedMessages = 200;
  messageConcurrency = "queue" as const;
  private userLabel = "";

  async onStart(props?: TeamAgentProps): Promise<void> {
    await super.onStart(props);
    this.userLabel = normalizeUserLabel(props?.userLabel);
  }

  async healthCheck(): Promise<{ ok: true; runtime: "cloudflare-ai-chat"; storage: true; version: 1 }> {
    this.sql`SELECT 1 AS ok`;
    return { ok: true, runtime: "cloudflare-ai-chat", storage: true, version: 1 };
  }

  async onChatMessage(
    _onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions,
  ): Promise<Response> {
    if (!this.userLabel) {
      return jsonError("agent_identity_unavailable", "Agent identity is unavailable.", 401);
    }

    const body = isRecord(options?.body) ? options.body : {};
    const now = Date.now();
    const session: Session = {
      id: this.name,
      label: this.userLabel,
      createdAt: now,
      lastSeen: now,
    };
    const result = await runTeamAgentTextTurn(this.env, session, {
      messages: toLegacyMessages(this.messages),
      routeId: boundedString(body.routeId, 80),
      skillIds: stringArray(body.skillIds, 3, 80),
      userApiKey: boundedString(body.userApiKey, 8_192),
      sessionSummary: boundedString(body.sessionSummary, 1_200),
      temperature: finiteNumber(body.temperature),
    });

    if (!result.ok) {
      return jsonError(result.error, result.message, result.status, result.routeId);
    }

    return new Response(result.text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Chatus-Route": result.routeId,
      },
    });
  }

  protected sanitizeMessageForPersistence(message: UIMessage): UIMessage {
    return {
      ...message,
      metadata: undefined,
      parts: message.parts.map((part) => {
        if ("output" in part && typeof part.output === "string" && part.output.length > MAX_PERSISTED_TOOL_TEXT_CHARS) {
          return { ...part, output: `${part.output.slice(0, MAX_PERSISTED_TOOL_TEXT_CHARS)}\n[truncated]` };
        }
        if ("input" in part && typeof part.input === "string" && part.input.length > MAX_PERSISTED_TOOL_TEXT_CHARS) {
          return { ...part, input: `${part.input.slice(0, MAX_PERSISTED_TOOL_TEXT_CHARS)}\n[truncated]` };
        }
        return part;
      }),
    };
  }
}

function toLegacyMessages(messages: UIMessage[]): ChatMessage[] {
  const output: ChatMessage[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user";
    const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) {
        parts.push({ type: "text", text: part.text });
      }
      if (
        part.type === "file" &&
        typeof part.mediaType === "string" &&
        part.mediaType.startsWith("image/") &&
        typeof part.url === "string" &&
        part.url.startsWith("data:image/")
      ) {
        parts.push({ type: "image_url", image_url: { url: part.url } });
      }
    }
    if (!parts.length) continue;
    output.push({
      role,
      content: parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts,
    });
  }
  return output;
}

function normalizeUserLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function stringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonError(error: string, message: string, status: number, routeId?: string): Response {
  return new Response(JSON.stringify({ error, message, ...(routeId ? { routeId } : {}) }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
