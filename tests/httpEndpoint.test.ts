/**
 * The external-endpoint contestant, tested against a real local HTTP server.
 *
 * Mocking `fetch` would prove the mapping code runs; a fixture server proves
 * the *contract* holds over the wire - headers, JSON body, status handling,
 * retries. That is what a team integrating their deployed bot depends on.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  HttpEndpointContestant,
  HttpEndpointError,
  type HttpEndpointRequest,
} from '../src/contestants/httpEndpoint.js';
import type { ChatMessage, ContestantTurnInput } from '../src/contestants/types.js';

interface Fixture {
  url: string;
  requests: Array<{ body: HttpEndpointRequest; headers: IncomingMessage['headers'] }>;
  close: () => Promise<void>;
}

type Handler = (request: HttpEndpointRequest, attempt: number, res: ServerResponse) => void;

async function startFixture(handler: Handler): Promise<Fixture> {
  const requests: Fixture['requests'] = [];
  let attempt = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as HttpEndpointRequest;
      requests.push({ body, headers: req.headers });
      attempt += 1;
      handler(body, attempt, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/gharbench`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

const messages: ChatMessage[] = [
  { role: 'buyer', content: 'whats the price for a 2bhk?', ts: '2026-02-10T04:00:45.000Z' },
  {
    role: 'agent',
    content: '',
    ts: '2026-02-10T04:01:30.000Z',
    toolCalls: [{ id: 'tc_1', name: 'check_availability', args: { target: 'units' } }],
  },
  {
    role: 'tool',
    content: '',
    ts: '2026-02-10T04:02:15.000Z',
    toolResults: [
      { toolCallId: 'tc_1', name: 'check_availability', ok: true, result: { matchCount: 2 } },
    ],
  },
];

const turnInput: ContestantTurnInput = {
  conversationId: 'scn_test#0',
  messages,
  toolResults: [
    { toolCallId: 'tc_1', name: 'check_availability', ok: true, result: { matchCount: 2 } },
  ],
};

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe('HttpEndpointContestant - happy path', () => {
  it('maps a well-formed response into a turn output', async () => {
    fixture = await startFixture((_req, _attempt, res) =>
      json(res, 200, {
        messaging_product: 'whatsapp',
        messages: [{ type: 'text', text: { body: 'We have two 2BHKs available.' } }],
        tool_calls: [
          { id: 'ep_1', name: 'send_asset', arguments: { assetId: 'asset_brochure_v3' } },
        ],
      }),
    );

    const contestant = new HttpEndpointContestant({
      url: fixture.url,
      id: 'contestant:fixture',
      version: '1.0.0',
      bearerToken: 'secret-token',
      availableTools: ['check_availability', 'send_asset'],
    });

    const out = await contestant.turn(turnInput);
    expect(out.message).toBe('We have two 2BHKs available.');
    expect(out.toolCalls).toEqual([
      { id: 'ep_1', name: 'send_asset', args: { assetId: 'asset_brochure_v3' } },
    ]);
  });

  it('sends the WhatsApp-shaped request body and the bearer token', async () => {
    fixture = await startFixture((_req, _attempt, res) => json(res, 200, { messages: [] }));

    const contestant = new HttpEndpointContestant({
      url: fixture.url,
      id: 'contestant:fixture',
      version: '1.0.0',
      bearerToken: 'secret-token',
      buyerWaId: '919812345670',
      buyerName: 'Rohan',
      availableTools: ['check_availability'],
    });
    await contestant.turn(turnInput);

    const sent = fixture.requests[0]!;
    expect(sent.headers.authorization).toBe('Bearer secret-token');
    expect(sent.headers['content-type']).toContain('application/json');

    expect(sent.body.messaging_product).toBe('whatsapp');
    expect(sent.body.conversation_id).toBe('scn_test#0');
    expect(sent.body.contact).toEqual({ wa_id: '919812345670', profile: { name: 'Rohan' } });
    expect(sent.body.available_tools).toEqual(['check_availability']);

    expect(sent.body.messages.map((m) => [m.from, m.type])).toEqual([
      ['buyer', 'text'],
      ['agent', 'tool_calls'],
      ['system', 'tool_results'],
    ]);
    expect(sent.body.messages[0]?.text?.body).toBe('whats the price for a 2bhk?');
    expect(sent.body.messages[1]?.tool_calls?.[0]).toEqual({
      id: 'tc_1',
      name: 'check_availability',
      arguments: { target: 'units' },
    });
    expect(sent.body.tool_results?.[0]).toMatchObject({
      tool_call_id: 'tc_1',
      name: 'check_availability',
      ok: true,
    });
  });

  it('omits message and toolCalls when the endpoint returns neither', async () => {
    fixture = await startFixture((_req, _attempt, res) => json(res, 200, {}));
    const contestant = new HttpEndpointContestant({
      url: fixture.url,
      id: 'c',
      version: '1',
    });
    const out = await contestant.turn(turnInput);
    expect(out.message).toBeUndefined();
    expect(out.toolCalls).toBeUndefined();
  });

  it('joins multiple text messages, the way a bot sending two bubbles would', async () => {
    fixture = await startFixture((_req, _attempt, res) =>
      json(res, 200, {
        messages: [{ text: { body: 'Namaste!' } }, { text: { body: 'Sending the brochure.' } }],
      }),
    );
    const contestant = new HttpEndpointContestant({ url: fixture.url, id: 'c', version: '1' });
    const out = await contestant.turn(turnInput);
    expect(out.message).toBe('Namaste!\nSending the brochure.');
  });
});

describe('HttpEndpointContestant - failure handling', () => {
  it('retries a 5xx and succeeds on the retry', async () => {
    fixture = await startFixture((_req, attempt, res) => {
      if (attempt === 1) {
        json(res, 503, { error: 'restarting' });
        return;
      }
      json(res, 200, { messages: [{ text: { body: 'back online' } }] });
    });

    const contestant = new HttpEndpointContestant({
      url: fixture.url,
      id: 'c',
      version: '1',
      maxRetries: 2,
      sleep: async () => {},
    });

    const out = await contestant.turn(turnInput);
    expect(out.message).toBe('back online');
    expect(fixture.requests).toHaveLength(2);
  });

  it('gives up after maxRetries on persistent 5xx', async () => {
    fixture = await startFixture((_req, _attempt, res) => json(res, 500, { error: 'boom' }));
    const contestant = new HttpEndpointContestant({
      url: fixture.url,
      id: 'c',
      version: '1',
      maxRetries: 1,
      sleep: async () => {},
    });

    await expect(contestant.turn(turnInput)).rejects.toThrow(HttpEndpointError);
    expect(fixture.requests).toHaveLength(2); // initial + 1 retry
  });

  it('does not retry a 4xx: the same body cannot become correct', async () => {
    fixture = await startFixture((_req, _attempt, res) => json(res, 400, { error: 'bad request' }));
    const contestant = new HttpEndpointContestant({
      url: fixture.url,
      id: 'c',
      version: '1',
      maxRetries: 3,
      sleep: async () => {},
    });

    await expect(contestant.turn(turnInput)).rejects.toThrow(/returned 400/);
    expect(fixture.requests).toHaveLength(1);
  });

  it('rejects a response that does not match the contract', async () => {
    fixture = await startFixture((_req, _attempt, res) =>
      // `tool_calls[].name` is missing: not a valid contestant reply.
      json(res, 200, { tool_calls: [{ id: 'x', arguments: {} }] }),
    );
    const contestant = new HttpEndpointContestant({ url: fixture.url, id: 'c', version: '1' });
    await expect(contestant.turn(turnInput)).rejects.toThrow(
      /did not match the GharBench contract/,
    );
  });

  it('rejects a non-JSON response', async () => {
    fixture = await startFixture((_req, _attempt, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>oops</html>');
    });
    const contestant = new HttpEndpointContestant({ url: fixture.url, id: 'c', version: '1' });
    await expect(contestant.turn(turnInput)).rejects.toThrow(/not valid JSON/);
  });
});
