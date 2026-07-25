export type ProviderType = "openai-chat" | "anthropic-messages";

export type ProviderConcurrency = "unlimited" | "exclusive" | "bounded";

export type ProviderStreamShape = "progressive" | "single_chunk";

export type ProviderConfig = {
  enabled?: boolean;
  label: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  apiKeyRef?: string;
  authHeader?: string;
  authPrefix?: string;
  directEndpoint?: boolean;
  headers?: Record<string, string>;
  allowUserKey?: boolean;
  requiresUserKey?: boolean;
  supportsImages?: boolean;
  supportsTools?: boolean;
  concurrency?: ProviderConcurrency;
  maxConcurrent?: number;
  queueTimeoutMs?: number;
  priority?: number;
};

export type ModelOffering = {
  providerId: string;
  model: string;
  enabled?: boolean;
  priority?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
};

export type RouteConfig = {
  enabled?: boolean;
  label: string;
  offerings?: ModelOffering[];
  fallbacks?: string[];
  maxTokens?: number;
  temperature?: number;
  allowUserKey?: boolean;
  requiresUserKey?: boolean;
  supportsImages?: boolean;
  supportsTools?: boolean;

  // Compatibility shadow for configurations written before provider pools.
  // Runtime requests must use ResolvedProviderRoute instead of these fields.
  type?: ProviderType;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyRef?: string;
  authHeader?: string;
  authPrefix?: string;
  directEndpoint?: boolean;
  headers?: Record<string, string>;
};

export type ResolvedProviderRoute = {
  routeId: string;
  providerId: string;
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
  allowUserKey: boolean;
  requiresUserKey: boolean;
  supportsImages: boolean;
  supportsTools: boolean;
  concurrency: ProviderConcurrency;
  maxConcurrent: number;
  queueTimeoutMs: number;
  priority: number;
};

export type ProviderCredentialSource = "user" | "legacy" | "managed" | "worker" | "missing";

export type ProviderCredential = {
  apiKey: string;
  source: ProviderCredentialSource;
  usedUserKey: boolean;
};
