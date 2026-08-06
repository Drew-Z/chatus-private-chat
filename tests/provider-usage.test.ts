import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
  normalizeAnthropicProviderUsage,
  normalizeLanguageModelV3Usage,
  normalizeOpenAiProviderUsage,
} from "../src/services/provider-usage";

describe("provider usage normalization", () => {
  it("preserves missing OpenAI fields as unknown instead of SDK-shaped zero", () => {
    const usage = {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
      raw: { total_tokens: 0 },
    } satisfies LanguageModelV3Usage;
    expect(normalizeLanguageModelV3Usage(usage)).toEqual({
      inputNoCacheTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTextTokens: 0,
      reasoningOutputTokens: 0,
    });

    expect(normalizeOpenAiProviderUsage({ prompt_tokens_details: {} })).toEqual({
      inputNoCacheTokens: null,
      cacheReadInputTokens: null,
      cacheWriteInputTokens: null,
      outputTextTokens: null,
      reasoningOutputTokens: null,
    });
  });

  it("splits OpenAI cache and reasoning dimensions without double counting", () => {
    expect(normalizeOpenAiProviderUsage({
      prompt_tokens: 120,
      completion_tokens: 30,
      prompt_tokens_details: { cached_tokens: 20 },
      completion_tokens_details: { reasoning_tokens: 10 },
    })).toEqual({
      inputNoCacheTokens: 100,
      cacheReadInputTokens: 20,
      cacheWriteInputTokens: null,
      outputTextTokens: 20,
      reasoningOutputTokens: 10,
    });
  });

  it("keeps Anthropic cache creation and cache reads distinct", () => {
    expect(normalizeAnthropicProviderUsage({
      input_tokens: 80,
      output_tokens: 16,
      cache_read_input_tokens: 12,
      cache_creation_input_tokens: 4,
    })).toEqual({
      inputNoCacheTokens: 80,
      cacheReadInputTokens: 12,
      cacheWriteInputTokens: 4,
      outputTextTokens: 16,
      reasoningOutputTokens: null,
    });
  });
});
