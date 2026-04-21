import { ConfigError, type Logger, type LLMProvider } from '@cacqa/core';
import { type Env } from '@cacqa/config/env';

import { GeminiProvider } from './gemini-provider.js';
import { MockLLMProvider } from './mock-provider.js';

export interface LLMProviderFactoryInput {
  readonly env: Env;
  readonly logger: Logger;
}

/**
 * Composition root for LLM providers. Reads LLM_PROVIDER and returns the
 * matching implementation. The worker and API both call this — callers never
 * reference concrete providers.
 */
export function createLLMProvider({ env, logger }: LLMProviderFactoryInput): LLMProvider {
  switch (env.LLM_PROVIDER) {
    case 'gemini': {
      if (!env.GEMINI_API_KEY) {
        throw new ConfigError('LLM_PROVIDER=gemini but GEMINI_API_KEY is not set');
      }
      return new GeminiProvider({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
        logger,
      });
    }
    case 'claude': {
      // Wired up when a paying customer is on the other end of a request.
      // Keeping the stub explicit so the error is actionable, not a crash.
      throw new ConfigError(
        'Claude provider not yet implemented. Switch LLM_PROVIDER to gemini or mock.',
      );
    }
    case 'mock': {
      return new MockLLMProvider();
    }
  }
}
