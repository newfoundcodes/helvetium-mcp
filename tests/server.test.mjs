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
  LATEST_PROTOCOL_VERSION,
  text,
  inputRequired,
  input,
  MCPToolError,
} from '../dist/index.js';

function request(method, params = {}, id = 1, capabilities = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': LATEST_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': capabilities,
      },
    },
  };
}

async function result(server, method, params = {}, capabilities = {}) {
  const r = await server.dispatch(request(method, params, 1, capabilities));
  if (r.error) {
    throw Object.assign(new Error(r.error.message), r.error);
  }

  return r.result;
}

function server() {
  return createMCPServer({
    name: 'test',
    version: '1.0.0',
    pageSize: 2,
    ttlMs: 1000,
    cacheScope: 'private',
  });
}

test('server/discover advertises current version and server info', async () => {
  const s = server();
  const r = await result(s, 'server/discover');

  assert.deepEqual(r.supportedVersions, [LATEST_PROTOCOL_VERSION]);
  assert.equal(r._meta['io.modelcontextprotocol/serverInfo'].name, 'test');
});

test('discover capability map reflects registered tools', async () => {
  const s = server().tool('echo', () => 'ok');
  assert.ok((await result(s, 'server/discover')).capabilities.tools);
});

test('tools/list is deterministic and paginated', async () => {
  const s = server()
    .tool('z', () => 1)
    .tool('a', () => 2)
    .tool('m', () => 3);
  const a = await result(s, 'tools/list');

  assert.deepEqual(
    a.tools.map((x) => x.name),
    ['a', 'm'],
  );
  assert.ok(a.nextCursor);

  const b = await result(s, 'tools/list', { cursor: a.nextCursor });
  assert.deepEqual(
    b.tools.map((x) => x.name),
    ['z'],
  );
});

test('tools/list includes required cache hints', async () => {
  const s = server().tool('a', () => 1);
  const r = await result(s, 'tools/list');

  assert.equal(r.ttlMs, 1000);
  assert.equal(r.cacheScope, 'private');
});

test('tools/call converts string to text content', async () => {
  const s = server().tool('echo', (_) => 'hello');
  const r = await result(s, 'tools/call', { name: 'echo', arguments: {} });

  assert.equal(r.content[0].text, 'hello');
});

test('tools/call returns structured content for object', async () => {
  const s = server().tool('obj', () => ({ a: 1 }));
  const r = await result(s, 'tools/call', { name: 'obj', arguments: {} });

  assert.deepEqual(r.structuredContent, { a: 1 });
});

test('tool input schema validation rejects invalid arguments', async () => {
  const s = server().tool(
    'age',
    {
      inputSchema: {
        type: 'object',
        required: ['age'],
        properties: { age: { type: 'integer', minimum: 18 } },
      },
    },
    () => 'ok',
  );

  const r = await s.dispatch(request('tools/call', { name: 'age', arguments: { age: 10 } }));
  assert.equal(r.error.code, -32602);
});

test('tool output schema validates structured content', async () => {
  const s = server().tool(
    'bad',
    { outputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } },
    () => ({ nope: true }),
  );
  const r = await s.dispatch(request('tools/call', { name: 'bad', arguments: {} }));

  assert.equal(r.error.code, -32602);
});

test('MCPToolError becomes tool-level isError result', async () => {
  const s = server().tool('fail', () => {
    throw new MCPToolError('expected');
  });
  const r = await result(s, 'tools/call', { name: 'fail', arguments: {} });

  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, 'expected');
});

test('tool can return MRTR input_required result', async () => {
  const s = server().tool('ask', () =>
    inputRequired({ x: input.elicit({ message: 'x' }) }, { phase: 1 }),
  );
  const r = await result(s, 'tools/call', { name: 'ask', arguments: {} });

  assert.equal(r.resultType, 'input_required');
  assert.equal(r.inputRequests.x.method, 'elicitation/create');
});

test('progress notifications are emitted when progress token exists', async () => {
  const s = server().tool('work', (_, c) => {
    c.reportProgress(1, 2, 'half');
    return 'ok';
  });
  const messages = [];
  const r = request('tools/call', { name: 'work', arguments: {} }, 1);

  r.params._meta.progressToken = 'p';
  await s.dispatch(r, { emit: (n) => messages.push(n) });

  assert.equal(messages[0].method, 'notifications/progress');
  assert.equal(messages[0].params.progressToken, 'p');
});

test('logging is emitted only when client opts in by log level', async () => {
  const s = server().tool('work', (_, c) => {
    c.log('info', 'hello');
    return 'ok';
  });
  const none = [];

  await s.dispatch(request('tools/call', { name: 'work', arguments: {} }), {
    emit: (n) => none.push(n),
  });
  assert.equal(none.length, 0);

  const yes = [];
  const r = request('tools/call', { name: 'work', arguments: {} });

  r.params._meta['io.modelcontextprotocol/logLevel'] = 'debug';
  await s.dispatch(r, { emit: (n) => yes.push(n) });
  assert.equal(yes[0].method, 'notifications/message');
});

test('resources/list and read static resources', async () => {
  const s = server().resource('memo://a', { name: 'A', mimeType: 'text/plain' }, () => 'alpha');

  assert.equal((await result(s, 'resources/list')).resources[0].uri, 'memo://a');
  assert.equal((await result(s, 'resources/read', { uri: 'memo://a' })).contents[0].text, 'alpha');
});

test('resource templates resolve URI variables', async () => {
  const s = server().resourceTemplate('user://{id}', { name: 'User' }, (_uri, p) => `id=${p.id}`);
  const r = await result(s, 'resources/read', { uri: 'user://42' });

  assert.equal(r.contents[0].text, 'id=42');
});

test('unknown resource produces resource-not-found protocol error', async () => {
  const s = server();
  const r = await s.dispatch(request('resources/read', { uri: 'missing://x' }));

  assert.equal(r.error.code, -32002);
});

test('resources/templates/list returns templates', async () => {
  const s = server().resourceTemplate('user://{id}', { name: 'User' }, () => 'x');
  assert.equal(
    (await result(s, 'resources/templates/list')).resourceTemplates[0].uriTemplate,
    'user://{id}',
  );
});

test('prompts/list and prompts/get work', async () => {
  const s = server().prompt('review', { description: 'Review' }, (args) => [
    { role: 'user', content: text(`Review ${args.file}`) },
  ]);
  assert.equal((await result(s, 'prompts/list')).prompts[0].name, 'review');

  const r = await result(s, 'prompts/get', { name: 'review', arguments: { file: 'a.ts' } });
  assert.equal(r.messages[0].content.text, 'Review a.ts');
});

test('completion/complete caps values at 100', async () => {
  const s = server().completion(() => Array.from({ length: 110 }, (_, i) => String(i)));
  const r = await result(s, 'completion/complete', {
    ref: { type: 'ref/prompt', name: 'x' },
    argument: { name: 'x', value: '' },
  });

  assert.equal(r.completion.values.length, 100);
});

test('custom method handler returns complete result', async () => {
  const s = server().method('com.example/ping', () => ({ pong: true }));
  const r = await result(s, 'com.example/ping');

  assert.equal(r.value.pong, true);
});

test('unsupported protocol version is rejected', async () => {
  const s = server();
  const r = request('server/discover');
  r.params._meta['io.modelcontextprotocol/protocolVersion'] = '1900-01-01';

  const out = await s.dispatch(r);
  assert.equal(out.error.code, -32022);
});

test('missing client capabilities is invalid params', async () => {
  const s = server();
  const r = request('server/discover');
  delete r.params._meta['io.modelcontextprotocol/clientCapabilities'];

  const out = await s.dispatch(r);
  assert.equal(out.error.code, -32602);
});

test('server notification hub broadcasts list changes', () => {
  const s = server();
  const seen = [];

  const off = s.notifications.subscribe((n) => seen.push(n.method));
  s.tool('x', () => 1);
  off();

  s.tool('y', () => 1);
  assert.deepEqual(seen, ['notifications/tools/list_changed']);
});

test('resource update notification broadcasts URI', () => {
  const s = server();
  let message;

  const off = s.notifications.subscribe((n) => (message = n));
  s.notifyResourceUpdated('file:///a');

  off();
  assert.equal(message.params.uri, 'file:///a');
});

test('tasks can be created and polled', async () => {
  const s = server();
  const task = s.tasks.create({ pollIntervalMs: 5 });

  assert.equal(
    (
      await result(
        s,
        'tasks/get',
        { taskId: task.taskId },
        { extensions: { 'io.modelcontextprotocol/tasks': {} } },
      )
    ).status,
    'working',
  );
});

test('tasks can transition to input required and back to working', async () => {
  const s = server();
  const t = s.tasks.create();
  s.tasks.requireInput(t.taskId, { x: input.elicit({ message: 'x' }) });

  assert.equal((await result(s, 'tasks/get', { taskId: t.taskId })).status, 'input_required');
  assert.equal(
    (
      await result(s, 'tasks/update', {
        taskId: t.taskId,
        inputResponses: { x: { action: 'accept' } },
      })
    ).status,
    'working',
  );
});

test('tasks can complete with result', async () => {
  const s = server();
  const t = s.tasks.create();
  s.tasks.complete(t.taskId, { resultType: 'complete', content: [text('done')] });

  const r = await result(s, 'tasks/get', { taskId: t.taskId });
  assert.equal(r.status, 'completed');
  assert.equal(r.result.content[0].text, 'done');
});

test('tasks can be cancelled', async () => {
  const s = server();
  const t = s.tasks.create();
  assert.equal((await result(s, 'tasks/cancel', { taskId: t.taskId })).status, 'cancelled');
});
