/**
 * AI-SDK-backed contestant.
 *
 * Uses the AI SDK v6 agent loop (`ToolLoopAgent`) with the six environment
 * tools declared as Zod tools.
 *
 * Deliberate design decision: the tools are declared WITHOUT an `execute`
 * function, so the SDK surfaces tool calls and hands control back instead of
 * running them itself. The Environment stays the single execution site, which
 * is what makes DB hashing, Layer-1 event capture, and parity with the
 * `httpEndpoint` contestant possible. `stopWhen: stepCountIs(1)` makes that
 * boundary explicit rather than incidental.
 */

import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import type { ModelMessage, ToolSet } from 'ai';
import type { z } from 'zod';
import type { ScenarioConfig } from '../engine/orchestrator.js';
import { sha256, type SimClock } from '../env/db.js';
import { TOOL_SPECS } from '../env/tools.js';
import { cacheCallOptions, resolveModel, supportsSamplingParams } from '../providers/registry.js';
import { meterCall, type CostMeter } from '../telemetry/cost.js';
import type {
  ChatMessage,
  Contestant,
  ContestantTurnInput,
  ContestantTurnOutput,
  ToolCall,
  ToolResult,
} from './types.js';

/**
 * Tool schemas for the model. No `execute`: the Environment runs the tool.
 * Built once and reused so the serialised tool block is byte-stable, which is
 * a precondition for the prompt cache ever hitting.
 */
export function buildToolSet(): ToolSet {
  const set: ToolSet = {};
  for (const spec of TOOL_SPECS) {
    set[spec.name] = tool({
      description: spec.description,
      // The six schemas are six different ZodObject types; as a union they
      // infer to `never`. The runtime value is exactly what the SDK wants, so
      // widen it rather than duplicating the schemas per tool.
      inputSchema: spec.schema as z.ZodType<Record<string, unknown>>,
    });
  }
  return set;
}

/** Stable prefix: policy first, variable conversation last. */
export function buildAgentSystemPrompt(scenario: ScenarioConfig): string {
  return [
    scenario.agentBrief.role,
    '',
    'Objectives:',
    ...scenario.agentBrief.objectives.map((o, i) => `${i + 1}. ${o}`),
    '',
    'Policy:',
    '- Every fact you state about the project must come from a tool result. Never invent a unit, price, date, discount or amenity.',
    '- If the buyer asks for something the project does not have, say so plainly. Do not offer a substitute you have not verified with a tool.',
    `- Write like a sales executive on ${scenario.channel}: short, plain-text messages. No markdown, no bullet lists, no headings.`,
    '- Collect the buyer name and phone before booking a site visit. Phone numbers must be in +91XXXXXXXXXX form.',
    '- Close the conversation by either booking a site visit and logging the qualification, or escalating to a human.',
  ].join('\n');
}

export interface ProviderModelContestantOptions {
  modelRef: string;
  scenario: ScenarioConfig;
  costMeter: CostMeter;
  clock: SimClock;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
  env?: NodeJS.ProcessEnv;
  id?: string;
  version?: string;
}

export class ProviderModelContestant implements Contestant {
  readonly id: string;
  readonly version: string;
  readonly systemPrompt: string;
  readonly systemPromptSha256: string;
  readonly toolSchemaSha256: string;

  readonly #options: ProviderModelContestantOptions;
  readonly #resolved: ReturnType<typeof resolveModel>;
  readonly #agent: ToolLoopAgent<never, ToolSet>;

  constructor(options: ProviderModelContestantOptions) {
    this.#options = options;
    this.#resolved = resolveModel(options.modelRef, options.env);
    this.systemPrompt = buildAgentSystemPrompt(options.scenario);
    this.systemPromptSha256 = sha256(this.systemPrompt);
    this.toolSchemaSha256 = sha256(
      JSON.stringify(TOOL_SPECS.map((s) => ({ name: s.name, description: s.description }))),
    );
    this.id = options.id ?? `contestant:${this.#resolved.ref}`;
    this.version = options.version ?? this.#resolved.ref;

    const allowSampling = supportsSamplingParams(options.modelRef);
    const temperature = options.temperature ?? options.scenario.temperatures.contestant;

    this.#agent = new ToolLoopAgent({
      model: this.#resolved.model,
      instructions: this.systemPrompt,
      tools: buildToolSet(),
      // One model step per turn: tool calls come back to the Environment.
      stopWhen: stepCountIs(1),
      maxOutputTokens: options.maxOutputTokens ?? 800,
      maxRetries: 2,
      ...(allowSampling ? { temperature, seed: options.seed ?? options.scenario.seed } : {}),
      // Cache-first: breakpoint on Anthropic, stable cache routing on OpenAI.
      // Keyed on the prompt hash, so every turn sharing this prefix routes to
      // the same backend and can actually hit.
      ...cacheCallOptions(this.#resolved.spec, `gharbench-agent-${this.systemPromptSha256}`),
    });
  }

  async turn(input: ContestantTurnInput): Promise<ContestantTurnOutput> {
    const { result } = await meterCall(
      this.#options.costMeter,
      {
        role: 'contestant',
        modelId: this.#resolved.modelId,
        provider: this.#resolved.provider,
        ts: this.#options.clock.now(),
      },
      () => this.#agent.generate({ messages: toModelMessages(input.messages) }),
      (r) => r.totalUsage,
    );

    const toolCalls: ToolCall[] = result.toolCalls.map((c) => ({
      id: c.toolCallId,
      name: c.toolName,
      args: c.input,
    }));

    const text = result.text.trim();
    return {
      ...(text.length > 0 ? { message: text } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}

/**
 * Transcript -> AI SDK prompt.
 *
 * The buyer is the `user`, the agent is the `assistant`, and tool results
 * become `tool` messages correlated by `toolCallId`. Tool calls the model made
 * are replayed as `tool-call` parts so the model sees its own history exactly
 * as it produced it.
 */
export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];

  for (const m of messages) {
    switch (m.role) {
      case 'system':
        // The system prompt is supplied via `instructions`; a stray system
        // message in the transcript would break the cached prefix.
        break;

      case 'buyer':
        out.push({ role: 'user', content: m.content });
        break;

      case 'agent': {
        const parts: Extract<ModelMessage, { role: 'assistant' }>['content'] = [];
        if (m.content.trim().length > 0) {
          parts.push({ type: 'text', text: m.content });
        }
        for (const call of m.toolCalls ?? []) {
          parts.push({
            type: 'tool-call',
            toolCallId: call.id,
            toolName: call.name,
            input: call.args,
          });
        }
        if (Array.isArray(parts) && parts.length > 0) {
          out.push({ role: 'assistant', content: parts });
        }
        break;
      }

      case 'tool': {
        const results = m.toolResults ?? [];
        if (results.length === 0) break;
        out.push({ role: 'tool', content: results.map(toToolResultPart) });
        break;
      }
    }
  }

  return out;
}

function toToolResultPart(
  result: ToolResult,
): Extract<ModelMessage, { role: 'tool' }>['content'][number] {
  return {
    type: 'tool-result',
    toolCallId: result.toolCallId,
    toolName: result.name,
    output: result.ok
      ? { type: 'json', value: (result.result ?? null) as never }
      : { type: 'error-json', value: (result.error ?? null) as never },
  };
}
