/**
 * The Contestant abstraction.
 *
 * This is the product-critical seam of the whole harness. It is defined in
 * Phase 0, before any personas or scenarios exist, so that a *real deployed
 * sales bot* can later be scored without modifying it: whatever speaks this
 * interface can be dropped into the orchestrator and graded like any model.
 *
 * Deliberate constraint: a contestant NEVER executes tools itself. It returns
 * tool *calls*; the Environment executes them and hands back results on the
 * next turn. That keeps one execution site for DB mutation, hashing and
 * Layer-1 event recording, and it means an external endpoint contestant and a
 * local model contestant are graded on exactly the same evidence.
 */

import type { ToolError } from '../env/tools.js';

export type Role = 'system' | 'buyer' | 'agent' | 'tool';

export interface ToolCall {
  /** Unique within a conversation. Correlates a call to its result. */
  id: string;
  name: string;
  /** Raw, unvalidated. Bad args are evidence, so they are preserved verbatim. */
  args: unknown;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: ToolError;
}

export interface ChatMessage {
  role: Role;
  /** WhatsApp-style surface text. Empty for a pure tool-call turn. */
  content: string;
  /** Simulated clock timestamp (ISO 8601). Never a wall clock. */
  ts: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ContestantTurnInput {
  conversationId: string;
  /** Full history: buyer turns, agent turns and tool results, in order. */
  messages: ChatMessage[];
  /** Results for the tool calls the contestant made on its previous turn. */
  toolResults?: ToolResult[];
}

export interface ContestantTurnOutput {
  /** The agent's reply. Optional when the turn is only tool calls. */
  message?: string;
  /** Zero or more calls against the six-tool schema. */
  toolCalls?: ToolCall[];
}

export interface Contestant {
  id: string;
  /**
   * Version of the contestant under test (model snapshot, prompt revision,
   * deployed build id...). Recorded in the run manifest; a benchmark result
   * without it is not reproducible.
   */
  version: string;
  turn(input: ContestantTurnInput): Promise<ContestantTurnOutput>;
}
