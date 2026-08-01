/**
 * model-ref -> AI SDK LanguageModel.
 *
 * A model ref is `provider/model-id`, e.g. `anthropic/claude-haiku-4-5` or
 * `groq/llama-3.3-70b-versatile`. A bare id is accepted for the three direct
 * SDKs and inferred from its prefix, so `claude-haiku-4-5` works too.
 *
 * Every provider that is not Anthropic / OpenAI / Google is reached through
 * `createOpenAI({ baseURL })` — an OpenAI-compatible endpoint. That is one
 * fewer dependency than `@ai-sdk/openai-compatible` and keeps the whole
 * registry inside the agreed dependency list.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'openai-compatible';

export interface ProviderSpec {
  id: string;
  kind: ProviderKind;
  envKey: string;
  /** Only for `openai-compatible`. */
  baseURL?: string;
  /** Whether the provider supports explicit prompt-cache breakpoints. */
  supportsExplicitCaching: boolean;
}

export const PROVIDERS: Readonly<Record<string, ProviderSpec>> = {
  anthropic: {
    id: 'anthropic',
    kind: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    supportsExplicitCaching: true,
  },
  openai: {
    id: 'openai',
    kind: 'openai',
    envKey: 'OPENAI_API_KEY',
    supportsExplicitCaching: false,
  },
  google: {
    id: 'google',
    kind: 'google',
    envKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    supportsExplicitCaching: false,
  },
  xai: {
    id: 'xai',
    kind: 'openai-compatible',
    envKey: 'XAI_API_KEY',
    baseURL: 'https://api.x.ai/v1',
    supportsExplicitCaching: false,
  },
  mistral: {
    id: 'mistral',
    kind: 'openai-compatible',
    envKey: 'MISTRAL_API_KEY',
    baseURL: 'https://api.mistral.ai/v1',
    supportsExplicitCaching: false,
  },
  deepseek: {
    id: 'deepseek',
    kind: 'openai-compatible',
    envKey: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com/v1',
    supportsExplicitCaching: false,
  },
  moonshot: {
    id: 'moonshot',
    kind: 'openai-compatible',
    envKey: 'MOONSHOT_API_KEY',
    baseURL: 'https://api.moonshot.ai/v1',
    supportsExplicitCaching: false,
  },
  deepinfra: {
    id: 'deepinfra',
    kind: 'openai-compatible',
    envKey: 'DEEPINFRA_API_KEY',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    supportsExplicitCaching: false,
  },
  fireworks: {
    id: 'fireworks',
    kind: 'openai-compatible',
    envKey: 'FIREWORKS_API_KEY',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    supportsExplicitCaching: false,
  },
  groq: {
    id: 'groq',
    kind: 'openai-compatible',
    envKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    supportsExplicitCaching: false,
  },
  openrouter: {
    id: 'openrouter',
    kind: 'openai-compatible',
    envKey: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api/v1',
    supportsExplicitCaching: false,
  },
};

export interface ModelRef {
  provider: string;
  modelId: string;
  /** Canonical `provider/modelId` form, used as the manifest key. */
  ref: string;
}

/** Infer the provider for a bare model id. Returns null when ambiguous. */
function inferProvider(modelId: string): string | null {
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('gpt-') || /^o[0-9]/.test(modelId)) return 'openai';
  return null;
}

export function parseModelRef(ref: string): ModelRef {
  const slash = ref.indexOf('/');
  if (slash === -1) {
    const provider = inferProvider(ref);
    if (provider === null) {
      throw new Error(
        `Cannot infer a provider for bare model id "${ref}". Use "provider/model", e.g. "groq/${ref}". Known providers: ${Object.keys(PROVIDERS).sort().join(', ')}`,
      );
    }
    return { provider, modelId: ref, ref: `${provider}/${ref}` };
  }

  const provider = ref.slice(0, slash);
  const modelId = ref.slice(slash + 1);
  if (!(provider in PROVIDERS)) {
    throw new Error(
      `Unknown provider "${provider}". Known providers: ${Object.keys(PROVIDERS).sort().join(', ')}`,
    );
  }
  if (modelId.length === 0) {
    throw new Error(`Model ref "${ref}" has an empty model id.`);
  }
  // OpenRouter model ids legitimately contain a slash (`vendor/model`).
  return { provider, modelId, ref: `${provider}/${modelId}` };
}

export function getProvider(providerId: string): ProviderSpec {
  const spec = PROVIDERS[providerId];
  if (!spec) {
    throw new Error(`Unknown provider "${providerId}".`);
  }
  return spec;
}

export function hasCredentials(providerId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env[getProvider(providerId).envKey];
  return typeof key === 'string' && key.length > 0;
}

export interface ResolvedModel extends ModelRef {
  model: LanguageModel;
  spec: ProviderSpec;
}

/** Build a LanguageModel for a ref. Throws if the provider key is missing. */
export function resolveModel(ref: string, env: NodeJS.ProcessEnv = process.env): ResolvedModel {
  const parsed = parseModelRef(ref);
  const spec = getProvider(parsed.provider);
  const apiKey = env[spec.envKey];

  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error(
      `Missing ${spec.envKey} for provider "${spec.id}". Copy .env.example to .env and fill it in.`,
    );
  }

  let model: LanguageModel;
  switch (spec.kind) {
    case 'anthropic':
      model = createAnthropic({ apiKey })(parsed.modelId);
      break;
    case 'openai':
      model = createOpenAI({ apiKey })(parsed.modelId);
      break;
    case 'google':
      model = createGoogleGenerativeAI({ apiKey })(parsed.modelId);
      break;
    case 'openai-compatible':
      model = createOpenAI({ apiKey, baseURL: spec.baseURL, name: spec.id })(parsed.modelId);
      break;
  }

  return { ...parsed, model, spec };
}

/**
 * Newer Anthropic models reject `temperature` / `top_p` / `top_k` outright
 * (HTTP 400). Callers ask before setting them rather than discovering it at
 * request time, because a sweep that dies on turn one wastes the whole run.
 */
const REJECTS_SAMPLING_PARAMS =
  /^claude-(fable-5|mythos-5|opus-5|opus-4-8|opus-4-7|sonnet-5)(-|$)/;

export function supportsSamplingParams(ref: string): boolean {
  const { provider, modelId } = parseModelRef(ref);
  if (provider !== 'anthropic') return true;
  return !REJECTS_SAMPLING_PARAMS.test(modelId);
}

/** Endpoint recorded in the run manifest, so a result names where it came from. */
export function providerEndpoint(providerId: string): string {
  const spec = getProvider(providerId);
  switch (spec.kind) {
    case 'anthropic':
      return 'https://api.anthropic.com/v1 (@ai-sdk/anthropic default)';
    case 'openai':
      return 'https://api.openai.com/v1 (@ai-sdk/openai default)';
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta (@ai-sdk/google default)';
    case 'openai-compatible':
      return spec.baseURL ?? 'unknown';
  }
}
