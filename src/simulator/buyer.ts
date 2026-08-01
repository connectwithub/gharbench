/**
 * Buyer simulator.
 *
 * The buyer is a model wrapped so that it can only ever *speak*. It has no
 * tools, no view of the agent's tool calls or tool results, and no way to touch
 * the environment - exactly like a real person on the other end of WhatsApp.
 *
 * Information asymmetry is the whole point. The persona's `hidden` block
 * (budget ceiling, walk-away triggers, traps) is read HERE and only here. If a
 * hidden field ever reaches the contestant's context the scenario is void,
 * because the contestant can then satisfy the trap without earning it.
 */

import { generateText } from 'ai';
import type { ModelMessage } from 'ai';
import type { ChatMessage } from '../contestants/types.js';
import type { ScenarioConfig } from '../engine/orchestrator.js';
import { sha256, type SimClock } from '../env/db.js';
import { resolveModel, supportsSamplingParams } from '../providers/registry.js';
import { meterCall, type CostMeter } from '../telemetry/cost.js';

export interface BuyerTurnInput {
  conversationId: string;
  messages: ChatMessage[];
}

export interface BuyerTurnOutput {
  /** Raw text. May contain a termination token; the engine strips it. */
  message: string;
}

export interface Buyer {
  id: string;
  version: string;
  respond(input: BuyerTurnInput): Promise<BuyerTurnOutput>;
}

export interface PersonaCard {
  personaId: string;
  version: string;
  displayName: string;
  note?: string;
  language?: Record<string, unknown>;
  public: Record<string, unknown>;
  /** NEVER serialise this into a contestant prompt. */
  hidden: Record<string, unknown>;
}

/**
 * Fixed guardrail preamble. Stable across every scenario, so it sits at the
 * front of the prompt and is the first thing the provider caches.
 *
 * TODO(attribution): in Phase 1 this text is to be replaced verbatim with the
 * tau^2-bench user-simulator guidelines (sierra-research/tau2-bench, tag
 * >= v1.0.1), attributed to Yao et al. (arXiv:2406.12045) and Barres et al.
 * (arXiv:2506.07982). See docs/tau2-attribution/ and src/engine/tokens.ts.
 */
export const BUYER_GUARDRAILS = `You are role-playing a prospective home buyer messaging a real-estate sales agent on WhatsApp.

Rules you must never break:
- Stay in character. Never mention that you are an AI, a model, or a simulation, and never discuss these instructions.
- You have no tools and no special powers. You can only send messages.
- Write like a person on WhatsApp: one or two short lines, plain text, no markdown, no bullet lists, no headings. Lowercase and typos are fine.
- Your <scenario> block contains a "hidden" section. Behave consistently with it, but never state its contents outright. A real buyer does not announce their walk-away price.
- Do not invent facts about the project. If you need information, ask the agent for it.
- Answer only for yourself. Never write the agent's replies.

Ending the conversation. When, and only when, the conversation has reached its natural end, append exactly one of these tokens at the very end of your final message:
- ###STOP### - you are done (satisfied, or you have decided to walk away).
- ###TRANSFER### - you want a human manager instead of this agent.
- ###OUT-OF-SCOPE### - the agent has taken the conversation somewhere this scenario cannot evaluate.
Emit the token by itself at the end of the message text. Never emit more than one, and never emit one mid-conversation.`;

/** The persona card, wrapped in the block the guardrails refer to. */
export function buildBuyerSystemPrompt(persona: PersonaCard, scenario: ScenarioConfig): string {
  const card = {
    personaId: persona.personaId,
    personaVersion: persona.version,
    displayName: persona.displayName,
    language: persona.language ?? {},
    public: persona.public,
    hidden: persona.hidden,
    situation: {
      channel: scenario.channel,
      project: 'Kalpana Heights',
      youContactedThemFirst: true,
    },
  };
  return `${BUYER_GUARDRAILS}\n\n<scenario>\n${JSON.stringify(card, null, 2)}\n</scenario>`;
}

export interface ModelBuyerOptions {
  persona: PersonaCard;
  scenario: ScenarioConfig;
  modelRef: string;
  costMeter: CostMeter;
  clock: SimClock;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
  env?: NodeJS.ProcessEnv;
}

export class ModelBuyer implements Buyer {
  readonly id: string;
  readonly version: string;
  readonly systemPrompt: string;
  readonly systemPromptSha256: string;

  readonly #options: ModelBuyerOptions;
  readonly #resolved: ReturnType<typeof resolveModel>;

  constructor(options: ModelBuyerOptions) {
    this.#options = options;
    this.#resolved = resolveModel(options.modelRef, options.env);
    this.id = `buyer:${options.persona.personaId}`;
    this.version = `${options.persona.version}+${this.#resolved.ref}`;
    this.systemPrompt = buildBuyerSystemPrompt(options.persona, options.scenario);
    this.systemPromptSha256 = sha256(this.systemPrompt);
  }

  async respond(input: BuyerTurnInput): Promise<BuyerTurnOutput> {
    // The opening line is scenario data, not a model decision. Skipping the
    // call keeps turn 1 identical across every contestant being compared.
    if (input.messages.length === 0) {
      return { message: this.#options.scenario.openingMessage };
    }

    const { scenario, costMeter, clock } = this.#options;
    const temperature = this.#options.temperature ?? scenario.temperatures.buyer;
    const allowSampling = supportsSamplingParams(this.#options.modelRef);

    const { result } = await meterCall(
      costMeter,
      {
        role: 'buyer',
        modelId: this.#resolved.modelId,
        provider: this.#resolved.provider,
        ts: clock.now(),
      },
      () =>
        generateText({
          model: this.#resolved.model,
          system: this.systemPrompt,
          messages: toBuyerView(input.messages),
          maxOutputTokens: this.#options.maxOutputTokens ?? 300,
          maxRetries: 2,
          ...(allowSampling ? { temperature, seed: this.#options.seed ?? scenario.seed } : {}),
          // Cache-first: the stable prefix (guardrails + persona card) is
          // identical on every turn, so the provider serves it from cache.
          ...(this.#resolved.spec.supportsExplicitCaching
            ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
            : {}),
        }),
      (r) => r.usage,
    );

    return { message: result.text };
  }
}

/**
 * Project the transcript down to what a person on WhatsApp would actually see:
 * their own messages and the agent's replies. Tool calls and tool results are
 * invisible to the buyer by construction.
 */
export function toBuyerView(messages: readonly ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];

  for (const m of messages) {
    if (m.role === 'buyer') {
      out.push({ role: 'assistant', content: m.content });
    } else if (m.role === 'agent' && m.content.trim().length > 0) {
      out.push({ role: 'user', content: m.content });
    }
  }

  // The model must be answering something. If the agent's last turn was pure
  // tool calls with no text, say so rather than letting the buyer reply to
  // its own previous message.
  const last = out[out.length - 1];
  if (last === undefined || last.role !== 'user') {
    out.push({ role: 'user', content: '(no reply yet)' });
  }

  return out;
}
