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
  /**
   * Can the *caller* place a cache breakpoint? Anthropic only. Drives whether
   * we send `providerOptions.anthropic.cacheControl`, nothing else.
   *
   * This is NOT "does this provider cache". OpenAI and Google cache
   * automatically; there is simply no knob to turn.
   */
  supportsExplicitCaching: boolean;
  /**
   * Do we expect `usage.inputTokenDetails.cacheReadTokens` to be populated for
   * this provider? Drives whether the cache probe runs at all.
   *
   * Kept separate from `supportsExplicitCaching` because conflating the two
   * silently skipped the probe on every provider that caches automatically —
   * i.e. most of the lineup, and the whole OpenAI column of the §7.3 cost
   * model. "No breakpoint API" and "no measurable caching" are different
   * claims.
   *
   * `false` on the OpenAI-compatible providers means *unverified*, not
   * *absent*: several of them do cache (§7.3), but they are reached through
   * `createOpenAI({ baseURL })` and whether their cache accounting survives
   * into the SDK's normalised `inputTokenDetails` has never been observed.
   * Asserting `true` there would make the probe report "prompt layout is not
   * caching" for what is actually an unmapped usage field — a false alarm on a
   * gate. Probe one with `--force-cache-check`; flip it to `true` once a real
   * run shows cache-read tokens.
   */
  reportsCacheReads: boolean;
}

export const PROVIDERS: Readonly<Record<string, ProviderSpec>> = {
  anthropic: {
    id: 'anthropic',
    kind: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    supportsExplicitCaching: true,
    reportsCacheReads: true,
  },
  // Automatic prefix caching at >=1,024 tokens, TTL ~5-10 min (Master Plan
  // §7.3). No breakpoint to place; the reads are still reported and billed.
  openai: {
    id: 'openai',
    kind: 'openai',
    envKey: 'OPENAI_API_KEY',
    supportsExplicitCaching: false,
    reportsCacheReads: true,
  },
  // Implicit caching (~90% off reads, no storage fee) — §7.3. Verified
  // 2026-08-13 on gemini-2.5-flash: calls 1 and 2 both missed, call 3 read
  // 34,789. Slower to warm than OpenAI — the reason the automatic regime
  // retries instead of concluding "broken" after two calls.
  google: {
    id: 'google',
    kind: 'google',
    envKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    supportsExplicitCaching: false,
    reportsCacheReads: true,
  },
  // §7.3 documents cached-input pricing, but reporting through
  // createOpenAI({ baseURL }) is unverified. Probe with --force-cache-check.
  xai: {
    id: 'xai',
    kind: 'openai-compatible',
    envKey: 'XAI_API_KEY',
    baseURL: 'https://api.x.ai/v1',
    supportsExplicitCaching: false,
    reportsCacheReads: false,
  },
  mistral: {
    id: 'mistral',
    kind: 'openai-compatible',
    envKey: 'MISTRAL_API_KEY',
    baseURL: 'https://api.mistral.ai/v1',
    supportsExplicitCaching: false,
    reportsCacheReads: false,
  },
  // Automatic disk prefix cache (§7.3); reporting shape unverified here.
  deepseek: {
    id: 'deepseek',
    kind: 'openai-compatible',
    envKey: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com/v1',
    supportsExplicitCaching: false,
    reportsCacheReads: false,
  },
  moonshot: {
    id: 'moonshot',
    kind: 'openai-compatible',
    envKey: 'MOONSHOT_API_KEY',
    baseURL: 'https://api.moonshot.ai/v1',
    supportsExplicitCaching: false,
    reportsCacheReads: false,
  },
  deepinfra: {
    id: 'deepinfra',
    kind: 'openai-compatible',
    envKey: 'DEEPINFRA_API_KEY',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    supportsExplicitCaching: false,
    reportsCacheReads: false,
  },
  // Cached input -50% (§7.3); reporting shape unverified here.
  fireworks: {
    id: 'fireworks',
    kind: 'openai-compatible',
    envKey: 'FIREWORKS_API_KEY',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    supportsExplicitCaching: false,
    reportsCacheReads: false,
  },
  groq: {
    id: 'groq',
    kind: 'openai-compatible',
    envKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    supportsExplicitCaching: false,
    reportsCacheReads: false,
  },
  // Verified 2026-08-13 via --force-cache-check, routed to openai/gpt-4.1-mini:
  // call 2 read 30,464 tokens, so cache accounting *does* survive the
  // OpenAI-compatible mapping. Caching still depends on the routed model, and
  // OpenRouter remains a reproducibility hazard for scored runs (silent routing
  // and quantisation drift defeat the manifest's endpoint pinning) — but the
  // flag records what was measured, not what we would prefer.
  openrouter: {
    id: 'openrouter',
    kind: 'openai-compatible',
    envKey: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api/v1',
    supportsExplicitCaching: false,
    reportsCacheReads: true,
  },
};

/**
 * Spreadable call options that make the cache-first prompt layout actually pay.
 *
 * Union rather than a loose record so a typo in a breakpoint shape is a compile
 * error instead of a silently ignored request field.
 */
export type CacheCallOptions =
  | { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
  | { providerOptions: { openai: { promptCacheKey: string } } }
  | Record<string, never>;

/**
 * Per-provider cache wiring, in one place so the probe and the conversation
 * paths cannot drift apart.
 *
 * - **Anthropic** places an explicit breakpoint.
 * - **OpenAI** caches automatically, but *routing* is not automatic. Without a
 *   stable `promptCacheKey`, byte-identical requests land on different backends
 *   and miss. Measured on gpt-4.1-mini: four identical 30,641-token calls read
 *   **0** cached tokens; adding the key made call 2 read **30,464**. This is not
 *   a micro-optimisation — it is the difference between paying the §7.3 cached
 *   rate and paying list price on every sweep.
 *
 * `promptCacheOptions: { mode: 'explicit' }` is in the SDK surface but returns
 * HTTP 400 "not supported on this model" for gpt-4.1-mini, so it is
 * deliberately not sent. Revisit per-model if a newer contestant supports it.
 *
 * Restricted to `kind === 'openai'`: the OpenAI-*compatible* endpoints reject
 * unknown request fields, and a 400 mid-sweep is worse than an uncached call.
 *
 * @param routingKey Stable id for the shared prefix — pass a hash of the
 * system prompt, never anything per-turn, or the key defeats its own purpose.
 */
export function cacheCallOptions(spec: ProviderSpec, routingKey: string): CacheCallOptions {
  if (spec.supportsExplicitCaching) {
    return { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } };
  }
  if (spec.kind === 'openai') {
    // Hard API limit: >64 chars is a 400, and `prefix-<sha256>` is 80. Truncate
    // here rather than at each call site — a caller that trips this discovers
    // it mid-sweep, and a truncated sha still has ample collision headroom.
    return { providerOptions: { openai: { promptCacheKey: routingKey.slice(0, 64) } } };
  }
  return {};
}

/** OpenAI rejects a `prompt_cache_key` longer than this. */
export const MAX_PROMPT_CACHE_KEY_LENGTH = 64;

/**
 * Floating alias -> dated snapshot.
 *
 * A provider can repoint an alias like `gpt-4.1-mini` at a new model with no
 * announcement and no signal in the response. Because no provider honours
 * `seed` (ADR-0006), that silent swap is the most likely way a scored run gets
 * invalidated without anyone noticing: the manifest still records
 * `gpt-4.1-mini`, the numbers still look plausible, and half the sweep ran
 * against a different model from the other half.
 *
 * Every entry below is copied from the installed provider SDK's own model-id
 * union, not from memory. An alias with no verified dated snapshot is
 * deliberately absent rather than guessed - the same discipline the price
 * table applies to dollars. Notably absent:
 *
 * - `gemini-2.5-flash` - Google publishes no dated GA snapshot for it. The
 *   `-preview-` ids in the SDK union are different models, not pins.
 * - `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5` - no dated variant
 *   declared yet.
 *
 * Re-check at freeze, alongside the price table.
 */
export const MODEL_PINS: Readonly<Record<string, string>> = {
  // OpenAI - @ai-sdk/openai OpenAIResponsesModelId
  'gpt-4.1': 'gpt-4.1-2025-04-14',
  'gpt-4.1-mini': 'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano': 'gpt-4.1-nano-2025-04-14',
  'gpt-5': 'gpt-5-2025-08-07',
  'gpt-5-mini': 'gpt-5-mini-2025-08-07',
  'gpt-5-nano': 'gpt-5-nano-2025-08-07',
  'gpt-5.1': 'gpt-5.1-2025-11-13',
  'gpt-5.2': 'gpt-5.2-2025-12-11',
  // Anthropic - @ai-sdk/anthropic AnthropicMessagesModelId
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-opus-4-5': 'claude-opus-4-5-20251101',
  'claude-opus-4-1': 'claude-opus-4-1-20250805',
};

const SNAPSHOT_TO_ALIAS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MODEL_PINS).map(([alias, snapshot]) => [snapshot, alias]),
);

/** Resolve a floating alias to its dated snapshot. Unknown ids pass through. */
export function pinModelId(modelId: string): { modelId: string; pinned: boolean } {
  const snapshot = MODEL_PINS[modelId];
  if (snapshot) return { modelId: snapshot, pinned: true };
  // Already a dated snapshot we know about.
  if (SNAPSHOT_TO_ALIAS[modelId]) return { modelId, pinned: true };
  return { modelId, pinned: false };
}

/**
 * Dated snapshot -> the alias it pins. Lets the price table stay keyed on
 * readable ids instead of duplicating every row per snapshot.
 */
export function aliasForSnapshot(modelId: string): string | undefined {
  return SNAPSHOT_TO_ALIAS[modelId];
}

export interface ModelRef {
  provider: string;
  /** The id actually sent to the provider - pinned to a dated snapshot when one exists. */
  modelId: string;
  /** Canonical `provider/modelId` form, used as the manifest key. */
  ref: string;
  /** What the caller asked for, before pinning. Recorded so a run says both. */
  requestedModelId: string;
  requestedRef: string;
  /** False means no dated snapshot is published for this id - the run is not version-pinned. */
  pinned: boolean;
  /**
   * OpenRouter upstream host pin from the `@Host` ref suffix
   * (`openrouter/qwen/qwen3-32b@DeepInfra`). Injected into the request body as
   * `provider: { order: [pin], allow_fallbacks: false }` - OpenRouter's own
   * routing-preference field, honoured on both its chat and responses
   * surfaces (verified 2026-08-20: a Groq pin propagates Groq's error, a
   * DeepInfra pin succeeds).
   *
   * Exists because OpenRouter's load balancing is not behaviour-neutral:
   * `qwen/qwen3-32b` is served by DeepInfra, Nebius, SiliconFlow and Groq,
   * and Groq rejects any conversation that ends after an assistant message
   * ("does not support assistant message prefill") - which every buyer-opener
   * scenario produces. Unpinned, 14/20 pilot conversations died on whichever
   * requests landed on Groq. The `:provider` model-id suffix is NOT this: it
   * is silently ignored (`qwen3-32b:deepinfra` routed to Nebius when probed).
   */
  routingPin?: string;
}

function buildModelRef(provider: string, requestedModelId: string): ModelRef {
  // OpenRouter only: an `@Host` suffix pins the upstream provider.
  let routingPin: string | undefined;
  let bareModelId = requestedModelId;
  if (provider === 'openrouter') {
    const at = requestedModelId.lastIndexOf('@');
    if (at > 0) {
      routingPin = requestedModelId.slice(at + 1);
      bareModelId = requestedModelId.slice(0, at);
    }
  }

  // Only the three direct providers. An OpenAI-compatible gateway routes by its
  // own rules, so substituting an id there would imply a guarantee we cannot make.
  const kind = PROVIDERS[provider]?.kind;
  const direct = kind === 'anthropic' || kind === 'openai' || kind === 'google';
  const { modelId, pinned } = direct
    ? pinModelId(bareModelId)
    : { modelId: bareModelId, pinned: false };

  return {
    provider,
    modelId,
    ref: `${provider}/${modelId}`,
    requestedModelId,
    requestedRef: `${provider}/${requestedModelId}`,
    pinned,
    ...(routingPin !== undefined ? { routingPin } : {}),
  };
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
    return buildModelRef(provider, ref);
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
  return buildModelRef(provider, modelId);
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
      `Missing ${spec.envKey} for provider "${spec.id}". Set it in .env (create it from .env.example if absent).`,
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
      // .chat(), not the default callable: the default is the Responses API,
      // which OpenRouter serves through a translation layer with its own
      // pre-flight endpoint-capability checks. Measured 2026-08-20 on
      // qwen/qwen3-32b: batches of byte-reasonable requests 400'd with
      // "does not support assistant message prefill" as endpoint metadata
      // shifted, then the same requests passed 15 minutes later - and a
      // thinking model's text came back empty through the translation while
      // /chat/completions returned it intact. Chat completions is the surface
      // these gateways natively serve; use it.
      model = createOpenAI({
        apiKey,
        baseURL: spec.baseURL,
        name: spec.id,
        ...(parsed.routingPin !== undefined ? { fetch: pinnedFetch(parsed.routingPin) } : {}),
      }).chat(parsed.modelId);
      break;
  }

  return { ...parsed, model, spec };
}

/**
 * A fetch that injects OpenRouter's routing-preference field into every POST
 * body, honouring a ModelRef's `routingPin` (see that field's doc for why).
 * Anything unparseable passes through untouched - failing open here would
 * only reintroduce the load-balancing roulette the pin exists to end.
 */
function pinnedFetch(pin: string): typeof fetch {
  return (input, init) => {
    if (init?.method === 'POST' && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        body['provider'] = { order: [pin], allow_fallbacks: false };
        return fetch(input, { ...init, body: JSON.stringify(body) });
      } catch {
        // fall through to the unmodified request
      }
    }
    return fetch(input, init);
  };
}

/**
 * Newer Anthropic models reject `temperature` / `top_p` / `top_k` outright
 * (HTTP 400). Callers ask before setting them rather than discovering it at
 * request time, because a sweep that dies on turn one wastes the whole run.
 */
const REJECTS_SAMPLING_PARAMS = /^claude-(fable-5|mythos-5|opus-5|opus-4-8|opus-4-7|sonnet-5)(-|$)/;

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
