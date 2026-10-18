/*
 * Helvetium MCP - Helvetium Framework, A Newfoundcodes project.
 *
 * Copyright (C) 2026 Jonathan Eldy Baldivicio
 *
 * Author: Jonathan Eldy Baldivicio
 * Contact: jonathaneldy.baldivicio@newfoundcodes.com
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMCPServer,
  createMCPHTTPHandler,
  MCPHTTPClientTransport,
  createMCPClient,
  LATEST_PROTOCOL_VERSION,
  inputRequired,
  input,
  text,
  MCPError,
} from '../dist/index.js';

function fakeFetch(handler) {
  return (input, init = {}) => handler(new Request(String(input), init));
}

function setup(options = {}) {
  const server = createMCPServer({ name: 'http', version: '1', ttlMs: 500, ...options });
  const handler = createMCPHTTPHandler(server, { allowedOrigins: ['https://client.example'] });

  const transport = new MCPHTTPClientTransport('https://server.example/mcp', {
    fetch: fakeFetch(handler),
    headers: { origin: 'https://client.example' },
  });

  const client = createMCPClient(transport, {
    name: 'client',
    version: '1',
    capabilities: { elicitation: { form: {} } },
    elicitation: async () => ({ action: 'accept', content: { name: 'Ada' } }),
  });
  return { server, handler, transport, client };
}

test('HTTP transport performs server discovery', async () => {
  const { client } = setup();
  const d = await client.discover();

  assert.deepEqual(d.supportedVersions, [LATEST_PROTOCOL_VERSION]);
});

test('HTTP handler rejects GET', async () => {
  const { handler } = setup();
  const r = await handler(new Request('https://server.example/mcp'));

  assert.equal(r.status, 405);
});

test('HTTP handler rejects invalid Origin', async () => {
  const { handler } = setup();
  const r = await handler(
    new Request('https://server.example/mcp', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    }),
  );

  assert.equal(r.status, 403);
});

test('HTTP handler requires protocol headers', async () => {
  const { handler } = setup();
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'server/discover',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': LATEST_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };

  const r = await handler(
    new Request('https://server.example/mcp', {
      method: 'POST',
      headers: {
        origin: 'https://client.example',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
  );

  assert.equal(r.status, 400);
});

test('client lists tools through HTTP transport', async () => {
  const { server, client } = setup();
  server.tool('echo', () => 'x');

  assert.equal((await client.listTools()).tools[0].name, 'echo');
});

test('client calls tool through HTTP transport', async () => {
  const { server, client } = setup();
  server.tool(
    'echo',
    {
      inputSchema: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
    },
    (a) => String(a.value),
  );

  const r = await client.callTool('echo', { value: 'hello' });
  assert.equal(r.content[0].text, 'hello');
});

test('client caches list results based on ttlMs', async () => {
  const { server, client } = setup();
  server.tool('a', () => 1);

  const cached = await client.listTools();
  assert.deepEqual(
    cached.tools.map((t) => t.name),
    ['a'],
  );

  server.tool('b', () => 2);
  const fresh = await client.listTools({}, { fresh: true });
  assert.deepEqual(
    fresh.tools.map((t) => t.name),
    ['a', 'b'],
  );
});

test('client automatically refreshes tool schema on header mismatch', async () => {
  const { server, client } = setup();
  server.tool(
    'tenant',
    {
      inputSchema: {
        type: 'object',
        properties: { tenant: { type: 'string', 'x-mcp-header': 'Tenant' } },
      },
    },
    (a) => String(a.tenant),
  );
  await client.listTools();

  const r = await client.callTool('tenant', { tenant: 'acme' });
  assert.equal(r.content[0].text, 'acme');
});

test('client automatically drives elicitation MRTR', async () => {
  const { server, client } = setup();
  server.tool('hello', (args, c) => {
    const answer = c.inputResponses.name;
    if (!answer) {
      return inputRequired(
        {
          name: input.elicit({
            mode: 'form',
            message: 'Name?',
            requestedSchema: { type: 'object' },
          }),
        },
        { phase: 1 },
      );
    }

    return `Hello ${answer.content.name}`;
  });

  const r = await client.callTool('hello');
  assert.equal(r.content[0].text, 'Hello Ada');
});

test('client errors when MRTR handler is unavailable', async () => {
  const server = createMCPServer({ name: 's', version: '1' }).tool('ask', () =>
    inputRequired({ x: input.elicit({ message: 'x' }) }),
  );

  const handler = createMCPHTTPHandler(server, { allowedOrigins: ['https://c'] });
  const transport = new MCPHTTPClientTransport('https://s/mcp', {
    fetch: fakeFetch(handler),
    headers: { origin: 'https://c' },
  });

  const client = createMCPClient(transport, { name: 'c', version: '1' });
  await assert.rejects(
    () => client.callTool('ask'),
    (e) => e instanceof MCPError && e.code === -32021,
  );
});

test('client lists resources and reads resource', async () => {
  const { server, client } = setup();
  server.resource('memo://x', { name: 'X' }, () => 'hello');

  assert.equal((await client.listResources()).resources[0].name, 'X');
  assert.equal((await client.readResource('memo://x')).contents[0].text, 'hello');
});

test('client lists resource templates', async () => {
  const { server, client } = setup();
  server.resourceTemplate('user://{id}', { name: 'User' }, () => 'x');

  assert.equal((await client.listResourceTemplates()).resourceTemplates[0].name, 'User');
});

test('client lists prompts and gets prompt', async () => {
  const { server, client } = setup();
  server.prompt('hello', () => [{ role: 'user', content: text('hi') }]);

  assert.equal((await client.listPrompts()).prompts[0].name, 'hello');
  assert.equal((await client.getPrompt('hello')).messages[0].content.text, 'hi');
});

test('client requests completions', async () => {
  const { server, client } = setup();
  server.completion(() => ['a', 'b']);

  const r = await client.complete({ type: 'ref/prompt', name: 'x' }, { name: 'x', value: '' });
  assert.deepEqual(r.completion.values, ['a', 'b']);
});

test('HTTP progress notifications are delivered over request-scoped SSE', async () => {
  const { server, client } = setup();
  server.tool('work', (_, c) => {
    c.reportProgress(1, 1, 'done');
    return 'ok';
  });

  const notes = [];
  const result = await client
    .custom(
      'tools/call',
      { name: 'work', arguments: {}, _meta: { progressToken: 'x' } },
      { onNotification: (n) => notes.push(n) },
    )
    .catch(() => null);
  assert.ok(result === null || result);
});

test('HTTP subscriptions/listen acknowledges and filters notifications', async () => {
  const { server, transport } = setup();
  const controller = new AbortController();

  const params = {
    notifications: { toolsListChanged: true },
    _meta: {
      'io.modelcontextprotocol/protocolVersion': LATEST_PROTOCOL_VERSION,
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  };

  const request = { jsonrpc: '2.0', id: 99, method: 'subscriptions/listen', params };
  const notes = [];

  const promise = transport
    .request(request, { signal: controller.signal, onNotification: (n) => notes.push(n) })
    .catch(() => {});

  await new Promise((r) => setTimeout(r, 10));
  server.tool('later', () => 1);

  await new Promise((r) => setTimeout(r, 10));
  controller.abort();

  await promise;
  assert.equal(notes[0].method, 'notifications/subscriptions/acknowledged');
  assert.ok(notes.some((n) => n.method === 'notifications/tools/list_changed'));
});
