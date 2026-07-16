export type ProviderType = "openai-chat" | "anthropic-messages";

export type RouteConfig = {
  enabled?: boolean;
  label: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  apiKey?: string;
  apiKeyRef?: string;
  authHeader?: string;
  authPrefix?: string;
  directEndpoint?: boolean;
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  fallbacks?: string[];
  allowUserKey?: boolean;
  requiresUserKey?: boolean;
  supportsImages?: boolean;
  supportsTools?: boolean;
};

export type ProviderCredentialSource = "user" | "legacy" | "managed" | "worker" | "missing";

export type ProviderCredential = {
  apiKey: string;
  source: ProviderCredentialSource;
  usedUserKey: boolean;
};
