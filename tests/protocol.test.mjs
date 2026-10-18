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
  encodeMCPHeaderValue,
  decodeMCPHeaderValue,
  buildMCPHeaders,
  validateMCPHeaders,
  requestPrincipalName,
  encodeCursor,
  decodeCursor,
  paginate,
  validateJSONSchema,
  assertJSONSchema,
  text,
  image,
  audio,
  textResource,
  blobResource,
  embeddedResource,
  resourceLink,
  inputRequired,
  input,
  inputResponse,
  requestState,
  LATEST_PROTOCOL_VERSION,
  MCPError,
} from '../dist/index.js';

function meta(extra = {}) {
  return {
    'io.modelcontextprotocol/protocolVersion': LATEST_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientCapabilities': {},
    ...extra,
  };
}

function req(method, params = {}) {
  return { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta() } };
}

test('latest protocol version is 2026-07-28', () =>
  assert.equal(LATEST_PROTOCOL_VERSION, '2026-07-28'));

test('header encoding leaves safe ASCII unchanged', () =>
  assert.equal(encodeMCPHeaderValue('weather_v2'), 'weather_v2'));

test('header encoding round trips Unicode', () =>
  assert.equal(decodeMCPHeaderValue(encodeMCPHeaderValue('Hello 世界')), 'Hello 世界'));

test('header encoding protects sentinel-looking values', () =>
  assert.equal(
    decodeMCPHeaderValue(encodeMCPHeaderValue('=?base64?literal?=')),
    '=?base64?literal?=',
  ));

test('request principal derives tool name', () =>
  assert.equal(requestPrincipalName(req('tools/call', { name: 'echo' })), 'echo'));

test('request principal derives resource URI', () =>
  assert.equal(requestPrincipalName(req('resources/read', { uri: 'file:///x' })), 'file:///x'));

test('request principal derives prompt name', () =>
  assert.equal(requestPrincipalName(req('prompts/get', { name: 'review' })), 'review'));

test('request principal derives task id', () =>
  assert.equal(requestPrincipalName(req('tasks/get', { taskId: 'abc' })), 'abc'));

test('buildMCPHeaders mirrors protocol method and name', () => {
  const h = buildMCPHeaders(req('tools/call', { name: 'echo' }));

  assert.equal(h.get('MCP-Protocol-Version'), LATEST_PROTOCOL_VERSION);
  assert.equal(h.get('Mcp-Method'), 'tools/call');
  assert.equal(h.get('Mcp-Name'), 'echo');
});

test('custom x-mcp-header is generated from tool argument', () => {
  const r = req('tools/call', { name: 'tenant', arguments: { tenant: 'acme' } });
  const tool = {
    name: 'tenant',
    inputSchema: {
      type: 'object',
      properties: { tenant: { type: 'string', 'x-mcp-header': 'Tenant' } },
    },
  };

  const h = buildMCPHeaders(r, tool);
  assert.equal(h.get('Mcp-Param-Tenant'), 'acme');
});

test('validateMCPHeaders accepts matching headers', () => {
  const r = req('tools/call', { name: 'echo' });
  assert.doesNotThrow(() => validateMCPHeaders(r, buildMCPHeaders(r)));
});

test('validateMCPHeaders rejects method mismatch', () => {
  const r = req('tools/list');
  const h = buildMCPHeaders(r);

  h.set('Mcp-Method', 'prompts/list');
  assert.throws(
    () => validateMCPHeaders(r, h),
    (e) => e.code === -32020,
  );
});

test('cursor encode/decode round trip', () => assert.equal(decodeCursor(encodeCursor(123)), 123));

test('invalid cursor is rejected', () =>
  assert.throws(
    () => decodeCursor('not-a-cursor'),
    (e) => e.code === -32602,
  ));

test('paginate returns next cursor', () => {
  const r = paginate([1, 2, 3, 4], undefined, 2);
  assert.deepEqual(r.items, [1, 2]);
  assert.ok(r.nextCursor);
  assert.deepEqual(paginate([1, 2, 3, 4], r.nextCursor, 2).items, [3, 4]);
});

test('schema validator validates nested objects', () => {
  const schema = {
    type: 'object',
    required: ['user'],
    properties: {
      user: {
        type: 'object',
        required: ['age'],
        properties: { age: { type: 'integer', minimum: 18 } },
      },
    },
  };

  assert.equal(validateJSONSchema(schema, { user: { age: 20 } }).valid, true);
  assert.equal(validateJSONSchema(schema, { user: { age: 17 } }).valid, false);
});

test('schema validator handles arrays and uniqueness', () =>
  assert.equal(
    validateJSONSchema({ type: 'array', uniqueItems: true, items: { type: 'string' } }, ['a', 'a'])
      .valid,
    false,
  ));

test('schema validator handles oneOf', () =>
  assert.equal(
    validateJSONSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] }, true).valid,
    false,
  ));

test('assertJSONSchema throws MCP invalid params', () =>
  assert.throws(
    () => assertJSONSchema({ type: 'string' }, 1),
    (e) => e instanceof MCPError && e.code === -32602,
  ));

test('content helpers build text/image/audio blocks', () => {
  assert.deepEqual(text('x'), { type: 'text', text: 'x' });
  assert.equal(image('AA==', 'image/png').type, 'image');
  assert.equal(audio('AA==', 'audio/wav').type, 'audio');
});

test('resource content helpers create text/blob resources', () => {
  assert.equal(textResource('file:///x', 'hi').text, 'hi');
  assert.equal(blobResource('file:///x', 'AA==').blob, 'AA==');
});

test('embedded resource and resource link helpers are typed blocks', () => {
  assert.equal(embeddedResource(textResource('file:///x', 'x')).type, 'resource');
  assert.equal(resourceLink('file:///x', 'x').type, 'resource_link');
});

test('inputRequired constructs MRTR result', () =>
  assert.equal(
    inputRequired({ name: input.elicit({ message: 'Name?' }) }).resultType,
    'input_required',
  ));

test('input helpers cover elicitation sampling and roots', () => {
  assert.equal(input.elicit({}).method, 'elicitation/create');
  assert.equal(input.sample({}).method, 'sampling/createMessage');
  assert.equal(input.roots().method, 'roots/list');
});

test('inputResponse and requestState read retry metadata', () => {
  const p = { _meta: { inputResponses: { x: 42 }, requestState: { step: 1 } } };
  assert.equal(inputResponse(p, 'x'), 42);
  assert.deepEqual(requestState(p), { step: 1 });
});
