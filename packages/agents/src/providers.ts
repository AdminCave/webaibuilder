/**
 * Provider selection for the `byok` adapter (PLAN §4): a tool loop over the
 * Vercel AI SDK, provider freely selectable via API key.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModel } from 'ai';

/** The four providers supported via a BYOK API key. */
export type ByokProvider = 'anthropic' | 'openai' | 'google' | 'xai';

/** Current default per provider, if the config does not set a model. */
export const DEFAULT_MODELS: Readonly<Record<ByokProvider, string>> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-5',
  google: 'gemini-2.5-pro',
  xai: 'grok-4',
};

/** Builds the AI SDK language model for provider + key + (optional) model ID. */
export function resolveModel(provider: ByokProvider, apiKey: string, modelId?: string): LanguageModel {
  const id = modelId ?? DEFAULT_MODELS[provider];
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(id);
    case 'openai':
      return createOpenAI({ apiKey })(id);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(id);
    case 'xai':
      return createXai({ apiKey })(id);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}
