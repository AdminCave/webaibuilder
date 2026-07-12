/**
 * Provider-Auswahl für den `byok`-Adapter (PLAN §4): ein Tool-Loop über die
 * Vercel AI SDK, Anbieter frei wählbar per API-Key.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModel } from 'ai';

/** Die vier per BYOK-API-Key unterstützten Anbieter. */
export type ByokProvider = 'anthropic' | 'openai' | 'google' | 'xai';

/** Aktueller Default je Anbieter, falls die Config kein Modell setzt. */
export const DEFAULT_MODELS: Readonly<Record<ByokProvider, string>> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-5',
  google: 'gemini-2.5-pro',
  xai: 'grok-4',
};

/** Baut das AI-SDK-Sprachmodell für Anbieter + Key + (optional) Modell-ID. */
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
      throw new Error(`Unbekannter Anbieter: ${String(exhaustive)}`);
    }
  }
}
