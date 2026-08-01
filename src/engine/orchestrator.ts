/**
 * The half-duplex conversation loop.
 *
 * Clean-room port of the tau^2-bench orchestration pattern (see the attribution
 * note in ./tokens.ts): exactly one party speaks at a time.
 *
 *   Buyer -> Agent -> (tool calls -> Environment -> results -> Agent, <= N) -> Buyer -> ...
 *
 * Terminates on: a buyer termination token, `maxSteps` exhaustion, or a
 * successful flow-ending tool call listed in the scenario config.
 */

import {
  executeTool,
  getToolSpec,
  type ToolContext,
  type ToolErrorCode,
  type ToolKind,
  type ToolOutcome,
} from '../env/tools.js';
import { hashDb, type RealEstateDb, type SimClock } from '../env/db.js';
import type { ChatMessage, Contestant, ToolCall, ToolResult } from '../contestants/types.js';
import type { Buyer } from '../simulator/buyer.js';
import { scanTerminationTokens, type TerminationToken } from './tokens.js';
import type { CostMeter, CostSummary } from '../telemetry/cost.js';

export interface Environment extends ToolContext {
  db: RealEstateDb;
  clock: SimClock;
}

export function createEnvironment(db: RealEstateDb, clock: SimClock): Environment {
  return { db, clock };
}

export interface ScenarioConfig {
  scenarioId: string;
  version: string;
  personaId: string;
  dbVersion: string;
  channel: string;
  seed: number;
  clock: { startIso: string; stepSeconds: number };
  temperatures: { buyer: number; contestant: number };
  maxSteps: number;
  maxToolStepsPerTurn: number;
  flowEndingTools: string[];
  openingMessage: string;
  agentBrief: { role: string; objectives: string[] };
}

export type TerminationReason =
  | { kind: 'buyer_token'; token: TerminationToken }
  | { kind: 'flow_ending_tool'; tool: string; toolCallId: string }
  | { kind: 'max_steps'; maxSteps: number }
  | { kind: 'error'; message: string };

export type ToolEventType = 'call' | 'result' | ToolErrorCode | 'tool_step_limit';

export interface ToolEvent {
  type: ToolEventType;
  ts: string;
  toolName?: string;
  toolCallId?: string;
  toolKind?: ToolKind;
  detail?: unknown;
}

export interface ConversationRecord {
  scenarioId: string;
  scenarioVersion: string;
  runIndex: number;
  conversationId: string;
  contestantId: string;
  contestantVersion: string;
  buyerId: string;
  buyerVersion: string;
  seed: number;
  temperatures: { buyer: number; contestant: number };
  messages: ChatMessage[];
  terminationReason: TerminationReason;
  steps: number;
  dbHashStart: string;
  dbHashEnd: string;
  toolEvents: ToolEvent[];
  cost: CostSummary | null;
}

export interface OrchestratorOptions {
  contestant: Contestant;
  buyer: Buyer;
  environment: Environment;
  scenario: ScenarioConfig;
  /** Hard ceiling on buyer turns + agent steps combined. */
  maxSteps?: number;
  seed?: number;
  runIndex?: number;
  costMeter?: CostMeter;
}

export class Orchestrator {
  readonly #contestant: Contestant;
  readonly #buyer: Buyer;
  readonly #env: Environment;
  readonly #scenario: ScenarioConfig;
  readonly #maxSteps: number;
  readonly #seed: number;
  readonly #runIndex: number;
  readonly #costMeter: CostMeter | undefined;
  #toolCallSeq = 0;

  constructor(options: OrchestratorOptions) {
    this.#contestant = options.contestant;
    this.#buyer = options.buyer;
    this.#env = options.environment;
    this.#scenario = options.scenario;
    this.#maxSteps = options.maxSteps ?? options.scenario.maxSteps ?? 100;
    this.#seed = options.seed ?? options.scenario.seed;
    this.#runIndex = options.runIndex ?? 0;
    this.#costMeter = options.costMeter;
  }

  async run(): Promise<ConversationRecord> {
    const scenario = this.#scenario;
    const clock = this.#env.clock;
    const conversationId = `${scenario.scenarioId}#${this.#runIndex}`;

    const messages: ChatMessage[] = [];
    const toolEvents: ToolEvent[] = [];
    const dbHashStart = hashDb(this.#env.db);
    const flowEnding = new Set(scenario.flowEndingTools);

    let steps = 0;
    let terminationReason: TerminationReason = { kind: 'max_steps', maxSteps: this.#maxSteps };
    let finished = false;

    try {
      while (!finished && steps < this.#maxSteps) {
        // ---- Buyer half-turn -------------------------------------------------
        const buyerOut = await this.#buyer.respond({ conversationId, messages });
        steps += 1;
        const scan = scanTerminationTokens(buyerOut.message);
        const buyerTs = clock.tick();

        if (scan.text.length > 0) {
          messages.push({ role: 'buyer', content: scan.text, ts: buyerTs });
        }

        if (scan.token !== null) {
          terminationReason = { kind: 'buyer_token', token: scan.token };
          break;
        }
        if (steps >= this.#maxSteps) break;

        // ---- Agent half-turn (with bounded inner tool loop) -------------------
        let pendingResults: ToolResult[] | undefined;
        let innerStep = 0;

        for (; innerStep < scenario.maxToolStepsPerTurn; innerStep += 1) {
          const turnInput = {
            conversationId,
            messages,
            ...(pendingResults ? { toolResults: pendingResults } : {}),
          };
          const out = await this.#contestant.turn(turnInput);
          steps += 1;
          const agentTs = clock.tick();

          const surface = (out.message ?? '').trim();
          const calls = this.#stampCallIds(out.toolCalls ?? []);

          if (surface.length > 0 || calls.length > 0) {
            messages.push({
              role: 'agent',
              content: surface,
              ts: agentTs,
              ...(calls.length > 0 ? { toolCalls: calls } : {}),
            });
          }

          if (calls.length === 0) {
            pendingResults = undefined;
            break;
          }

          const results: ToolResult[] = [];
          let flowEndingHit: { tool: string; toolCallId: string } | null = null;

          for (const call of calls) {
            const spec = getToolSpec(call.name);
            toolEvents.push({
              type: 'call',
              ts: agentTs,
              toolName: call.name,
              toolCallId: call.id,
              ...(spec ? { toolKind: spec.kind } : {}),
              detail: { args: call.args },
            });

            const outcome: ToolOutcome = executeTool(call.name, call.args, this.#env);
            const resultTs = clock.tick();

            if (outcome.ok) {
              results.push({
                toolCallId: call.id,
                name: call.name,
                ok: true,
                result: outcome.result,
              });
              toolEvents.push({
                type: 'result',
                ts: resultTs,
                toolName: call.name,
                toolCallId: call.id,
                ...(spec ? { toolKind: spec.kind } : {}),
              });
              if (flowEnding.has(call.name) && flowEndingHit === null) {
                flowEndingHit = { tool: call.name, toolCallId: call.id };
              }
            } else {
              results.push({
                toolCallId: call.id,
                name: call.name,
                ok: false,
                error: outcome.error,
              });
              toolEvents.push({
                type: outcome.error.code,
                ts: resultTs,
                toolName: call.name,
                toolCallId: call.id,
                ...(spec ? { toolKind: spec.kind } : {}),
                detail: outcome.error,
              });
            }
          }

          messages.push({
            role: 'tool',
            content: '',
            ts: clock.now(),
            toolResults: results,
          });

          if (flowEndingHit !== null) {
            terminationReason = {
              kind: 'flow_ending_tool',
              tool: flowEndingHit.tool,
              toolCallId: flowEndingHit.toolCallId,
            };
            finished = true;
            break;
          }

          pendingResults = results;

          if (steps >= this.#maxSteps) {
            finished = true;
            break;
          }
        }

        // Inner loop exhausted while the agent still had tool results pending:
        // its next reply never happened. Record it; the buyer speaks again.
        if (!finished && innerStep >= scenario.maxToolStepsPerTurn) {
          toolEvents.push({
            type: 'tool_step_limit',
            ts: clock.now(),
            detail: { maxToolStepsPerTurn: scenario.maxToolStepsPerTurn },
          });
        }
      }
    } catch (cause) {
      terminationReason = {
        kind: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }

    return {
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      runIndex: this.#runIndex,
      conversationId,
      contestantId: this.#contestant.id,
      contestantVersion: this.#contestant.version,
      buyerId: this.#buyer.id,
      buyerVersion: this.#buyer.version,
      seed: this.#seed,
      temperatures: scenario.temperatures,
      messages,
      terminationReason,
      steps,
      dbHashStart,
      dbHashEnd: hashDb(this.#env.db),
      toolEvents,
      cost: this.#costMeter?.summary() ?? null,
    };
  }

  /**
   * Contestants may return calls without ids (an HTTP endpoint has no reason to
   * mint one). Ids must exist and be unique for result correlation, so the
   * orchestrator assigns any that are missing, deterministically.
   */
  #stampCallIds(calls: readonly ToolCall[]): ToolCall[] {
    return calls.map((call) => {
      this.#toolCallSeq += 1;
      const id =
        call.id && call.id.length > 0
          ? call.id
          : `tc_${String(this.#toolCallSeq).padStart(4, '0')}`;
      return { id, name: call.name, args: call.args };
    });
  }
}
