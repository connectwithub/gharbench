import { describe, expect, it } from 'vitest';

import {
  MAX_PROMPT_CACHE_KEY_LENGTH,
  PROVIDERS,
  cacheCallOptions,
  getProvider,
  hasCredentials,
  parseModelRef,
  providerEndpoint,
  resolveModel,
  supportsSamplingParams,
} from '../src/providers/registry.js';

describe('provider cache flags', () => {
  it('keeps "can place a breakpoint" separate from "reports cache reads"', () => {
    // The bug this split fixes: the cache probe used supportsExplicitCaching to
    // decide whether caching was measurable at all, so it skipped every
    // provider that caches automatically.
    const openai = getProvider('openai');
    expect(openai.supportsExplicitCaching).toBe(false);
    expect(openai.reportsCacheReads).toBe(true);
  });

  it('treats explicit caching as implying reportable reads', () => {
    for (const spec of Object.values(PROVIDERS)) {
      if (spec.supportsExplicitCaching) {
        expect(spec.reportsCacheReads, `${spec.id} places breakpoints it cannot observe`).toBe(
          true,
        );
      }
    }
  });

  it('only Anthropic exposes an explicit breakpoint', () => {
    const explicit = Object.values(PROVIDERS)
      .filter((s) => s.supportsExplicitCaching)
      .map((s) => s.id);
    expect(explicit).toEqual(['anthropic']);
  });

  it('declares both flags for every provider', () => {
    for (const [id, spec] of Object.entries(PROVIDERS)) {
      expect(spec.id, `${id} id mismatch`).toBe(id);
      expect(typeof spec.supportsExplicitCaching).toBe('boolean');
      expect(typeof spec.reportsCacheReads).toBe('boolean');
      expect(spec.envKey.length).toBeGreaterThan(0);
      if (spec.kind === 'openai-compatible') {
        expect(spec.baseURL, `${id} needs a baseURL`).toMatch(/^https:\/\//);
      }
    }
  });

  it('names a provider that can close the G1 cache clause', () => {
    const capable = Object.values(PROVIDERS).filter((s) => s.reportsCacheReads);
    expect(capable.length).toBeGreaterThan(0);
  });
});

describe('cacheCallOptions', () => {
  it('places a breakpoint for Anthropic', () => {
    expect(cacheCallOptions(getProvider('anthropic'), 'k')).toEqual({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });
  });

  it('sends a stable routing key for OpenAI', () => {
    // Measured: without promptCacheKey, four identical 30,641-token calls read
    // 0 cached tokens; with it, call 2 read 30,464. Routing, not placement.
    expect(cacheCallOptions(getProvider('openai'), 'gharbench-agent-abc')).toEqual({
      providerOptions: { openai: { promptCacheKey: 'gharbench-agent-abc' } },
    });
  });

  it('does not send prompt_cache_options, which 400s on gpt-4.1-mini', () => {
    const opts = cacheCallOptions(getProvider('openai'), 'k');
    expect(JSON.stringify(opts)).not.toContain('promptCacheOptions');
  });

  it('sends nothing to OpenAI-compatible endpoints, which reject unknown fields', () => {
    for (const id of ['openrouter', 'groq', 'deepseek']) {
      expect(cacheCallOptions(getProvider(id), 'k'), `${id} must not be sent cache options`).toEqual(
        {},
      );
    }
  });

  it('truncates to the 64-char API limit instead of 400-ing mid-sweep', () => {
    // `gharbench-agent-<sha256>` is 80 chars; OpenAI rejects anything over 64.
    const long = `gharbench-agent-${'a'.repeat(64)}`;
    const opts = cacheCallOptions(getProvider('openai'), long);
    const key =
      'providerOptions' in opts && 'openai' in opts.providerOptions
        ? opts.providerOptions.openai.promptCacheKey
        : '';
    expect(key.length).toBe(MAX_PROMPT_CACHE_KEY_LENGTH);
    expect(long.startsWith(key)).toBe(true);
  });

  it('keeps truncated keys distinct across roles', () => {
    const sha = 'a'.repeat(64);
    const agent = cacheCallOptions(getProvider('openai'), `gharbench-agent-${sha}`);
    const buyer = cacheCallOptions(getProvider('openai'), `gharbench-buyer-${sha}`);
    expect(agent).not.toEqual(buyer);
  });

  it('never routes on a key the caller varied per turn', () => {
    // Guard the contract, not the value: two calls with the same prefix hash
    // must produce the same key, or caching silently stops working.
    const a = cacheCallOptions(getProvider('openai'), 'hash-1');
    const b = cacheCallOptions(getProvider('openai'), 'hash-1');
    expect(a).toEqual(b);
  });
});

describe('parseModelRef', () => {
  it('keeps slashes in OpenRouter model ids', () => {
    const ref = parseModelRef('openrouter/anthropic/claude-haiku-4-5');
    expect(ref.provider).toBe('openrouter');
    expect(ref.modelId).toBe('anthropic/claude-haiku-4-5');
    expect(ref.ref).toBe('openrouter/anthropic/claude-haiku-4-5');
  });

  it('infers a provider from a bare id', () => {
    expect(parseModelRef('gpt-4.1-mini').provider).toBe('openai');
    expect(parseModelRef('claude-haiku-4-5').provider).toBe('anthropic');
    expect(parseModelRef('gemini-2.5-flash').provider).toBe('google');
  });

  it('refuses an ambiguous bare id rather than guessing', () => {
    expect(() => parseModelRef('llama-3.3-70b-versatile')).toThrow(/Cannot infer a provider/);
  });

  it('rejects unknown providers and empty model ids', () => {
    expect(() => parseModelRef('nope/some-model')).toThrow(/Unknown provider/);
    expect(() => parseModelRef('openai/')).toThrow(/empty model id/);
  });
});

describe('credentials', () => {
  it('reports presence per provider from an injected env', () => {
    const env = { OPENAI_API_KEY: 'sk-test' } as NodeJS.ProcessEnv;
    expect(hasCredentials('openai', env)).toBe(true);
    expect(hasCredentials('anthropic', env)).toBe(false);
  });

  it('treats an empty string as missing', () => {
    expect(hasCredentials('openai', { OPENAI_API_KEY: '' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('names the env var it wanted when a key is missing', () => {
    expect(() => resolveModel('openai/gpt-4.1-mini', {} as NodeJS.ProcessEnv)).toThrow(
      /OPENAI_API_KEY/,
    );
  });
});

describe('sampling params', () => {
  it('withholds them from Anthropic models that reject them', () => {
    expect(supportsSamplingParams('anthropic/claude-opus-5')).toBe(false);
    expect(supportsSamplingParams('anthropic/claude-haiku-4-5')).toBe(true);
    expect(supportsSamplingParams('openai/gpt-4.1-mini')).toBe(true);
  });
});

describe('providerEndpoint', () => {
  it('records a concrete endpoint for the manifest', () => {
    expect(providerEndpoint('openai')).toMatch(/api\.openai\.com/);
    expect(providerEndpoint('openrouter')).toBe('https://openrouter.ai/api/v1');
  });
});
