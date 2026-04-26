import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

/** Codex / some frontier IDs are Responses-API (or legacy completions), not chat/completions — Vercel AI SDK uses chat. */
function isChatCompletionsIncompatibleOpenAIId(id: string): boolean {
  return /codex/i.test(id);
}

export default class OpenAIProvider extends BaseProvider {
  name = 'OpenAI';
  getApiKeyLink = 'https://platform.openai.com/api-keys';

  config = {
    apiTokenKey: 'OPENAI_API_KEY',
  };

  staticModels: ModelInfo[] = [
    /*
     * Essential fallback models - modern OpenAI defaults
     * Keep these stable so users have working options before dynamic loading completes.
     * GPT-5.4 / GPT-5: see https://developers.openai.com/api/docs/models/gpt-5.4,
     * https://developers.openai.com/api/docs/models/gpt-5
     * (Codex models such as gpt-5-codex use /v1/responses, not chat/completions — omitted here.)
     */
    {
      name: 'gpt-5.4',
      label: 'GPT-5.4',
      provider: 'OpenAI',
      maxTokenAllowed: 1_050_000,
      maxCompletionTokens: 128_000,
    },
    {
      name: 'gpt-5.4-pro',
      label: 'GPT-5.4 Pro',
      provider: 'OpenAI',
      maxTokenAllowed: 1_050_000,
      maxCompletionTokens: 128_000,
    },
    {
      name: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      provider: 'OpenAI',
      maxTokenAllowed: 400_000,
      maxCompletionTokens: 128_000,
    },
    {
      name: 'gpt-5.4-nano',
      label: 'GPT-5.4 Nano',
      provider: 'OpenAI',
      maxTokenAllowed: 400_000,
      maxCompletionTokens: 128_000,
    },
    {
      name: 'gpt-5',
      label: 'GPT-5',
      provider: 'OpenAI',
      maxTokenAllowed: 400_000,
      maxCompletionTokens: 128_000,
    },
    {
      name: 'gpt-5-mini',
      label: 'GPT-5 Mini',
      provider: 'OpenAI',
      maxTokenAllowed: 400_000,
      maxCompletionTokens: 128_000,
    },
    {
      name: 'gpt-5-nano',
      label: 'GPT-5 Nano',
      provider: 'OpenAI',
      maxTokenAllowed: 400_000,
      maxCompletionTokens: 128_000,
    },
    { name: 'gpt-4.1', label: 'GPT-4.1', provider: 'OpenAI', maxTokenAllowed: 128000, maxCompletionTokens: 32768 },

    // Cost-effective GPT-4.1 variants
    {
      name: 'gpt-4.1-mini',
      label: 'GPT-4.1 Mini',
      provider: 'OpenAI',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 16384,
    },

    {
      name: 'gpt-4.1-nano',
      label: 'GPT-4.1 Nano',
      provider: 'OpenAI',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },

    // Latest reasoning-oriented families
    {
      name: 'o3',
      label: 'o3',
      provider: 'OpenAI',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 100000,
    },

    {
      name: 'o4-mini',
      label: 'o4-mini',
      provider: 'OpenAI',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 100000,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'OPENAI_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const response = await fetch(`https://api.openai.com/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const res = (await response.json()) as any;
    const staticModelIds = this.staticModels.map((m) => m.name);

    const data = res.data.filter(
      (model: any) =>
        model.object === 'model' &&
        (model.id.startsWith('gpt-') || model.id.startsWith('o') || model.id.startsWith('chatgpt-')) &&
        !staticModelIds.includes(model.id) &&
        !isChatCompletionsIncompatibleOpenAIId(model.id),
    );

    return data.map((m: any) => {
      // Get accurate context window from OpenAI API
      let contextWindow = 32000; // default fallback

      // OpenAI provides context_length in their API response
      if (m.context_length) {
        contextWindow = m.context_length;
      } else if (m.id?.includes('gpt-5.4-pro')) {
        contextWindow = 1_050_000; // Same long context as GPT-5.4
      } else if (m.id?.includes('gpt-5.4-mini') || m.id?.includes('gpt-5.4-nano')) {
        contextWindow = 400_000; // Smaller GPT-5.4 variants (OpenAI model docs)
      } else if (m.id?.includes('gpt-5.4')) {
        contextWindow = 1_050_000; // GPT-5.4 + dated snapshots
      } else if (m.id?.startsWith('gpt-5')) {
        contextWindow = 400_000; // GPT-5 / mini / nano / 5.1-* (non-5.4) / dated snapshots
      } else if (m.id?.includes('gpt-4o')) {
        contextWindow = 128000; // GPT-4o has 128k context
      } else if (m.id?.includes('gpt-4-turbo') || m.id?.includes('gpt-4-1106')) {
        contextWindow = 128000; // GPT-4 Turbo has 128k context
      } else if (m.id?.includes('gpt-4.1')) {
        contextWindow = 128000; // Keep fallback conservative for app stability
      } else if (m.id?.includes('gpt-4')) {
        contextWindow = 8192; // Standard GPT-4 has 8k context
      }

      // Determine completion token limits based on model type (accurate 2025 limits)
      let maxCompletionTokens = 4096; // default for most models

      if (m.id?.startsWith('o1-preview')) {
        maxCompletionTokens = 32000; // o1-preview: 32K output limit
      } else if (m.id?.startsWith('o1-mini')) {
        maxCompletionTokens = 65000; // o1-mini: 65K output limit
      } else if (m.id?.startsWith('o1')) {
        maxCompletionTokens = 32000; // Other o1 models: 32K limit
      } else if (m.id?.includes('o3') || m.id?.includes('o4')) {
        maxCompletionTokens = 100000; // o3/o4 models: 100K output limit
      } else if (m.id?.includes('gpt-5.4')) {
        maxCompletionTokens = 128000; // GPT-5.4 family upper bound per OpenAI docs
      } else if (m.id?.startsWith('gpt-5')) {
        maxCompletionTokens = 128000; // GPT-5 family default max output
      } else if (m.id?.includes('gpt-4.1')) {
        maxCompletionTokens = 32768; // Modern GPT-4.1 family default
      } else if (m.id?.includes('gpt-4o')) {
        maxCompletionTokens = 4096; // GPT-4o standard: 4K (64K with long output mode)
      } else if (m.id?.includes('gpt-4')) {
        maxCompletionTokens = 8192; // Standard GPT-4: 8K output limit
      }

      return {
        name: m.id,
        label: `${m.id} (${Math.floor(contextWindow / 1000)}k context)`,
        provider: this.name,
        maxTokenAllowed: Math.min(contextWindow, 1_050_000), // Allow long-context GPT-5.4; cap at largest known OpenAI window
        maxCompletionTokens,
      };
    });
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'OPENAI_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    if (isChatCompletionsIncompatibleOpenAIId(model)) {
      throw new Error(
        `Model "${model}" is not available on chat/completions (Bolt uses the OpenAI Chat API). Pick a chat model such as gpt-5.4 or gpt-5, or use Codex from the OpenAI Codex product / Responses API.`,
      );
    }

    const openai = createOpenAI({
      apiKey,
    });

    return openai(model);
  }
}
