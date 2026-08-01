/**
 * External-endpoint contestant.
 *
 * This is the reason the `Contestant` interface exists in Phase 0: a team that
 * already runs a WhatsApp sales bot can point GharBench at their deployed
 * endpoint and be scored on the same scenarios, with the same tools and the
 * same transcript, without touching their code.
 *
 * The wire format is modelled loosely on the WhatsApp Business Cloud API
 * message shape, so an existing webhook handler is a small adapter away rather
 * than a rewrite. It is a GharBench contract, not the Meta API: the harness
 * calls the endpoint synchronously and expects the reply in the HTTP response.
 */

import { z } from 'zod';
import type {
  Contestant,
  ContestantTurnInput,
  ContestantTurnOutput,
  ChatMessage,
  ToolCall,
  ToolResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Wire contract
// ---------------------------------------------------------------------------

export interface WhatsAppLikeToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface WhatsAppLikeToolResult {
  tool_call_id: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

export interface WhatsAppLikeMessage {
  id: string;
  from: 'buyer' | 'agent' | 'system';
  timestamp: string;
  type: 'text' | 'tool_calls' | 'tool_results';
  text?: { body: string };
  tool_calls?: WhatsAppLikeToolCall[];
  tool_results?: WhatsAppLikeToolResult[];
}

export interface HttpEndpointRequest {
  messaging_product: 'whatsapp';
  conversation_id: string;
  contact: { wa_id: string; profile: { name: string } };
  /** Full conversation so far, oldest first. */
  messages: WhatsAppLikeMessage[];
  /** Results for the tool calls returned on the previous response. */
  tool_results?: WhatsAppLikeToolResult[];
  /** Names of the tools the endpoint may call this turn. */
  available_tools?: string[];
}

/** Response validator. A malformed reply is a contestant failure, not a crash. */
export const httpEndpointResponseSchema = z.object({
  messaging_product: z.literal('whatsapp').optional(),
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.literal('text').optional(),
        text: z.object({ body: z.string() }),
      }),
    )
    .optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        arguments: z.unknown(),
      }),
    )
    .optional(),
});

export type HttpEndpointResponse = z.infer<typeof httpEndpointResponseSchema>;

export class HttpEndpointError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'HttpEndpointError';
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export interface HttpEndpointContestantOptions {
  url: string;
  id: string;
  version: string;
  /** Sent as `Authorization: Bearer <token>` when set. */
  bearerToken?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Retries for network errors and 5xx only. 4xx is a contract failure. */
  maxRetries?: number;
  retryBaseMs?: number;
  /** Value put in `contact.wa_id`. Fixed per scenario, never a real number. */
  buyerWaId?: string;
  buyerName?: string;
  availableTools?: readonly string[];
  fetchImpl?: typeof fetch;
  /** Injected so retry backoff is testable without real waiting. */
  sleep?: (ms: number) => Promise<void>;
}

export class HttpEndpointContestant implements Contestant {
  readonly id: string;
  readonly version: string;
  readonly #options: Required<
    Pick<
      HttpEndpointContestantOptions,
      'url' | 'timeoutMs' | 'maxRetries' | 'retryBaseMs' | 'buyerWaId' | 'buyerName'
    >
  > &
    HttpEndpointContestantOptions;

  constructor(options: HttpEndpointContestantOptions) {
    this.id = options.id;
    this.version = options.version;
    this.#options = {
      ...options,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxRetries: options.maxRetries ?? 2,
      retryBaseMs: options.retryBaseMs ?? 250,
      buyerWaId: options.buyerWaId ?? '910000000000',
      buyerName: options.buyerName ?? 'Buyer',
    };
  }

  async turn(input: ContestantTurnInput): Promise<ContestantTurnOutput> {
    const body = this.buildRequest(input);
    const parsed = await this.#post(body);

    const message = (parsed.messages ?? [])
      .map((m) => m.text.body)
      .join('\n')
      .trim();

    const toolCalls: ToolCall[] = (parsed.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      args: c.arguments,
    }));

    return {
      ...(message.length > 0 ? { message } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  buildRequest(input: ContestantTurnInput): HttpEndpointRequest {
    const request: HttpEndpointRequest = {
      messaging_product: 'whatsapp',
      conversation_id: input.conversationId,
      contact: {
        wa_id: this.#options.buyerWaId,
        profile: { name: this.#options.buyerName },
      },
      messages: input.messages.flatMap(toWireMessages),
    };
    if (input.toolResults && input.toolResults.length > 0) {
      request.tool_results = input.toolResults.map(toWireToolResult);
    }
    if (this.#options.availableTools) {
      request.available_tools = [...this.#options.availableTools];
    }
    return request;
  }

  async #post(body: HttpEndpointRequest): Promise<HttpEndpointResponse> {
    const doFetch = this.#options.fetchImpl ?? fetch;
    const sleep =
      this.#options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#options.maxRetries; attempt += 1) {
      if (attempt > 0) await sleep(this.#options.retryBaseMs * 2 ** (attempt - 1));

      let response: Response;
      try {
        response = await doFetch(this.#options.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.#options.bearerToken
              ? { authorization: `Bearer ${this.#options.bearerToken}` }
              : {}),
            ...this.#options.headers,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.#options.timeoutMs),
        });
      } catch (cause) {
        lastError = new HttpEndpointError(
          `POST ${this.#options.url} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        );
        continue; // network / timeout: retryable
      }

      if (response.status >= 500) {
        lastError = new HttpEndpointError(
          `POST ${this.#options.url} returned ${response.status}`,
          await safeText(response),
        );
        continue; // server-side: retryable
      }

      if (!response.ok) {
        // 4xx is the endpoint telling us the request was wrong. Retrying the
        // identical body cannot help, so fail loudly instead of burning turns.
        throw new HttpEndpointError(
          `POST ${this.#options.url} returned ${response.status}`,
          await safeText(response),
        );
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch (cause) {
        throw new HttpEndpointError('Endpoint response was not valid JSON', cause);
      }

      const parsed = httpEndpointResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new HttpEndpointError(
          'Endpoint response did not match the GharBench contract',
          parsed.error.issues,
        );
      }
      return parsed.data;
    }

    throw lastError ?? new HttpEndpointError('Endpoint call failed with no error recorded');
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2000);
  } catch {
    return '<unreadable body>';
  }
}

function toWireToolResult(result: ToolResult): WhatsAppLikeToolResult {
  return {
    tool_call_id: result.toolCallId,
    name: result.name,
    ok: result.ok,
    ...(result.result !== undefined ? { result: result.result } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}

/** One transcript message can carry both text and tool calls; split as needed. */
function toWireMessages(message: ChatMessage, index: number): WhatsAppLikeMessage[] {
  const id = `m${String(index).padStart(4, '0')}`;

  if (message.role === 'tool') {
    const results = message.toolResults ?? [];
    if (results.length === 0) return [];
    return [
      {
        id,
        from: 'system',
        timestamp: message.ts,
        type: 'tool_results',
        tool_results: results.map(toWireToolResult),
      },
    ];
  }

  if (message.role === 'system') return [];

  const from = message.role === 'buyer' ? 'buyer' : 'agent';
  const hasText = message.content.trim().length > 0;
  const calls = message.toolCalls ?? [];

  if (!hasText && calls.length === 0) return [];

  const wire: WhatsAppLikeMessage = {
    id,
    from,
    timestamp: message.ts,
    type: hasText ? 'text' : 'tool_calls',
  };
  if (hasText) wire.text = { body: message.content };
  if (calls.length > 0) {
    wire.tool_calls = calls.map((c: ToolCall) => ({ id: c.id, name: c.name, arguments: c.args }));
  }
  return [wire];
}
