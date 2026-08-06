import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import {
  emptyProviderTokenUsage,
  type ProviderTokenUsageV1,
  type ProviderUsageEvidenceSource,
} from "../contracts/provider-finance";

export function normalizeLanguageModelV3Usage(usage: LanguageModelV3Usage): ProviderTokenUsageV1 {
  const raw = isRecord(usage.raw) ? usage.raw : undefined;
  if (raw && looksLikeOpenAiUsage(raw)) return normalizeOpenAiProviderUsage(raw);
  if (raw && looksLikeAnthropicUsage(raw)) return normalizeAnthropicProviderUsage(raw);
  return {
    inputNoCacheTokens: safeCount(usage.inputTokens.noCache),
    cacheReadInputTokens: safeCount(usage.inputTokens.cacheRead),
    cacheWriteInputTokens: safeCount(usage.inputTokens.cacheWrite),
    outputTextTokens: safeCount(usage.outputTokens.text),
    reasoningOutputTokens: safeCount(usage.outputTokens.reasoning),
  };
}

export function normalizeOpenAiProviderUsage(value: unknown): ProviderTokenUsageV1 {
  if (!isRecord(value)) return emptyProviderTokenUsage();
  const prompt = ownCount(value, "prompt_tokens");
  const completion = ownCount(value, "completion_tokens");
  const promptDetails = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : undefined;
  const completionDetails = isRecord(value.completion_tokens_details) ? value.completion_tokens_details : undefined;
  const cached = promptDetails ? ownCount(promptDetails, "cached_tokens") : null;
  const reasoning = completionDetails ? ownCount(completionDetails, "reasoning_tokens") : null;
  return {
    inputNoCacheTokens: prompt === null ? null : Math.max(0, prompt - (cached ?? 0)),
    cacheReadInputTokens: cached,
    cacheWriteInputTokens: null,
    outputTextTokens: completion === null ? null : Math.max(0, completion - (reasoning ?? 0)),
    reasoningOutputTokens: reasoning,
  };
}

export function normalizeAnthropicProviderUsage(value: unknown): ProviderTokenUsageV1 {
  if (!isRecord(value)) return emptyProviderTokenUsage();
  return {
    inputNoCacheTokens: ownCount(value, "input_tokens"),
    cacheReadInputTokens: ownCount(value, "cache_read_input_tokens"),
    cacheWriteInputTokens: ownCount(value, "cache_creation_input_tokens"),
    outputTextTokens: ownCount(value, "output_tokens"),
    reasoningOutputTokens: null,
  };
}

export function providerUsageEvidenceId(attemptId: string, source: ProviderUsageEvidenceSource): string {
  return `usage:${attemptId}:${source}`;
}

function looksLikeOpenAiUsage(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, "prompt_tokens")
    || Object.prototype.hasOwnProperty.call(value, "completion_tokens")
    || Object.prototype.hasOwnProperty.call(value, "prompt_tokens_details")
    || Object.prototype.hasOwnProperty.call(value, "completion_tokens_details");
}

function looksLikeAnthropicUsage(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, "input_tokens")
    || Object.prototype.hasOwnProperty.call(value, "output_tokens")
    || Object.prototype.hasOwnProperty.call(value, "cache_read_input_tokens")
    || Object.prototype.hasOwnProperty.call(value, "cache_creation_input_tokens");
}

function ownCount(value: Record<string, unknown>, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  return safeCount(value[key]);
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
