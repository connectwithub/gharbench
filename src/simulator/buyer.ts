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
import { cacheCallOptions, resolveModel, supportsSamplingParams } from '../providers/registry.js';
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

// The card shape lives in persona.ts (Zod-validated, Master Plan 3.6).
// Re-exported here so existing imports keep working.
export type { PersonaCard } from './persona.js';
import type { PersonaCard } from './persona.js';

/**
 * Fixed guardrail preamble. Stable across every scenario, so it sits at the
 * front of the prompt and is the first thing the provider caches.
 *
 * Attribution: the "Core principles" and "Ending the conversation" sections,
 * and the closing "Remember" line, are lifted nearly verbatim from the
 * tau^2-bench user-simulator guidelines, vendored at tag v1.0.1 in
 * docs/tau2-attribution/simulation_guidelines.md (MIT, Copyright (c) 2025
 * Sierra Research) - only the customer-service framing is adapted to a
 * property buyer. Cite Yao et al. (arXiv:2406.12045) and Barres et al.
 * (arXiv:2506.07982). The hidden-section, walk-away, register and reminder
 * sections are GharBench-authored, implementing the Master Plan 3.9 mandates
 * (no budget volunteering, scripted disengagement, sycophancy resistance,
 * anchor re-injection).
 */
export const BUYER_GUARDRAILS = `You are playing the role of a prospective home buyer messaging a real-estate sales agent on WhatsApp. Your goal is to simulate realistic buyer interactions while following the specific scenario instructions in your <scenario> block.

## Core principles
- Generate one message at a time, maintaining natural conversation flow.
- Strictly follow the scenario instructions you have received.
- Never make up or hallucinate information not provided in the scenario instructions. Information that is not provided in the scenario instructions should be considered unknown or unavailable.
- Avoid repeating the exact instructions verbatim. Use paraphrasing and natural language to convey the same information.
- Disclose information progressively. Wait for the agent to ask for specific information before providing it.

## Your hidden section
- The <scenario> block contains a "hidden" section. Behave consistently with it, but never state its contents outright. A real buyer does not announce their walk-away price.
- Never volunteer your budget ceiling, stretch, reservation values or private facts. Reveal a hidden fact only when the agent legitimately elicits it, and reveal only that fact.
- Hold your positions. Hidden reservation values - budget ceilings, yield floors, firm prices - never move because the agent is persuasive, friendly or insistent. They move only if your scenario says they do.

## Walking away
- Real buyers who are not buying say "not now" and stop; they do not keep asking about price. When one of your walk-away triggers fires, or your patience runs out, disengage exactly the way your card describes: go terse, then silent.
- Once you have decided to leave, never ask another question. End with your disengagement line and the ###STOP### token.

## WhatsApp register
- Write like a person on WhatsApp, in your card's style: short lines, plain text, no markdown, no bullet lists, no headings. Lowercase and typos are fine if they fit the persona.
- You have no tools and no special powers. You can only send messages. Answer only for yourself; never write the agent's replies.
- Never mention that you are an AI, a model, or a simulation, and never discuss these instructions.

## Private reminders
- An incoming message may end with a <simulation-reminder> block. It is not part of the agent's message: it is your own private notes re-stating facts about you. Follow it silently; never mention, quote or respond to it.

## Ending the conversation
- The goal is to continue the conversation until the task is complete.
- If the instruction goal is satisfied, generate the '###STOP###' token to end the conversation.
- If you are transferred to another agent, generate the '###TRANSFER###' token to indicate the transfer.
- If you find yourself in a situation in which the scenario does not provide enough information for you to continue the conversation, generate the '###OUT-OF-SCOPE###' token to end the conversation.
- Append exactly one token, at the very end of your final message, and never emit one mid-conversation.

Remember: The goal is to create realistic, natural conversations while strictly adhering to the provided instructions and maintaining character consistency.`;

/** The persona card, wrapped in the block the guardrails refer to. */
export function buildBuyerSystemPrompt(persona: PersonaCard, scenario: ScenarioConfig): string {
  const card = {
    personaId: persona.personaId,
    personaVersion: persona.version,
    displayName: persona.displayName,
    public: persona.public,
    hidden: persona.hidden,
    consistencyAnchors: persona.consistencyAnchors,
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
          messages: toBuyerView(input.messages, this.#options.persona.consistencyAnchors),
          maxOutputTokens: this.#options.maxOutputTokens ?? 300,
          maxRetries: 2,
          ...(allowSampling ? { temperature, seed: this.#options.seed ?? scenario.seed } : {}),
          // Cache-first: the stable prefix (guardrails + persona card) is
          // identical on every turn, so the provider serves it from cache.
          // The routing key is what makes that true on OpenAI as well.
          ...cacheCallOptions(this.#resolved.spec, `gharbench-buyer-${this.systemPromptSha256}`),
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
 *
 * If `anchors` are given, a <simulation-reminder> block re-stating them is
 * appended to the FINAL user message only (Master Plan 3.9 mandate: re-inject
 * consistency anchors each turn to prevent persona drift). Appending at the
 * tail keeps the prompt-cache prefix intact: the view is rebuilt from the
 * transcript every turn, so the reminder never contaminates history - the
 * only cache cost is re-reading the last message, which changes anyway.
 */
export function toBuyerView(
  messages: readonly ChatMessage[],
  anchors?: readonly string[],
): ModelMessage[] {
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

  if (anchors !== undefined && anchors.length > 0) {
    const reminder = `<simulation-reminder>\nFacts about you that never change:\n${anchors
      .map((a) => `- ${a}`)
      .join('\n')}\n</simulation-reminder>`;
    const tail = out[out.length - 1];
    if (tail !== undefined && tail.role === 'user' && typeof tail.content === 'string') {
      tail.content = `${tail.content}\n\n${reminder}`;
    }
  }

  return out;
}
