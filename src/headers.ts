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

import { headerMismatch } from './errors.js';
import { headerAnnotatedProperties } from './schema.js';

const SENTINEL_PREFIX = '=?base64?',
  SENTINEL_SUFFIX = '?=';

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }

  return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
  const raw = atob(s),
    out = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }

  return out;
}

export function encodeMCPHeaderValue(value: string): string {
  const ascii =
    /^[\x21-\x7E]+$/.test(value) &&
    value.trim() === value &&
    !value.includes('\r') &&
    !value.includes('\n') &&
    !value.startsWith(SENTINEL_PREFIX);

  if (ascii) {
    return value;
  }

  return `${SENTINEL_PREFIX}${bytesToBase64(new TextEncoder().encode(value))}${SENTINEL_SUFFIX}`;
}

export function decodeMCPHeaderValue(value: string): string {
  if (value.startsWith(SENTINEL_PREFIX) && value.endsWith(SENTINEL_SUFFIX)) {
    const body = value.slice(SENTINEL_PREFIX.length, -SENTINEL_SUFFIX.length);
    try {
      return new TextDecoder().decode(base64ToBytes(body));
    } catch {
      throw headerMismatch('Invalid base64 MCP header value');
    }
  }

  return value;
}

export function requestPrincipalName(request: JSONRPCRequest): string | undefined {
  const p = request.params as Record<string, unknown>;
  if (request.method === 'tools/call' || request.method === 'prompts/get') {
    return typeof p?.name === 'string' ? p.name : undefined;
  }

  if (request.method === 'resources/read') {
    return typeof p?.uri === 'string' ? p.uri : undefined;
  }

  if (request.method.startsWith('tasks/')) {
    return typeof p?.taskId === 'string' ? p.taskId : undefined;
  }

  return undefined;
}

function getPath(value: unknown, path: string[]): unknown {
  let cur = value;
  for (const part of path) {
    if (cur == null || typeof cur !== 'object') {
      return undefined;
    }

    cur = (cur as Record<string, unknown>)[part];
  }

  return cur;
}

export function buildMCPHeaders(request: JSONRPCRequest, tool?: Tool): Headers {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });
  const meta = (request.params?._meta ?? {}) as RequestMetaObject;
  const version = meta['io.modelcontextprotocol/protocolVersion'];

  if (version) {
    headers.set('MCP-Protocol-Version', version);
  }

  headers.set('Mcp-Method', request.method);

  const name = requestPrincipalName(request);
  if (name !== undefined) {
    headers.set('Mcp-Name', encodeMCPHeaderValue(name));
  }

  if (request.method === 'tools/call' && tool) {
    for (const item of headerAnnotatedProperties(tool.inputSchema)) {
      const value = getPath((request.params as { arguments?: unknown })?.arguments, item.path);
      if (value === undefined) {
        continue;
      }

      headers.set(
        `Mcp-Param-${item.header}`,
        encodeMCPHeaderValue(typeof value === 'string' ? value : JSON.stringify(value)),
      );
    }
  }

  return headers;
}

export function validateMCPHeaders(request: JSONRPCRequest, headers: Headers, tool?: Tool): void {
  const meta = (request.params?._meta ?? {}) as RequestMetaObject;
  const bodyVersion = meta['io.modelcontextprotocol/protocolVersion'];
  const hv = headers.get('MCP-Protocol-Version');

  if (!bodyVersion && !hv) {
    return;
  }

  if (!hv) {
    throw headerMismatch('Missing MCP-Protocol-Version header');
  }

  if (bodyVersion !== undefined && bodyVersion !== hv) {
    throw headerMismatch('MCP-Protocol-Version header does not match request metadata', {
      header: hv,
      body: bodyVersion,
    });
  }

  const method = headers.get('Mcp-Method');
  if (method !== null && method !== request.method) {
    throw headerMismatch('Mcp-Method header does not match request body', {
      header: method,
      body: request.method,
    });
  }

  const expected = requestPrincipalName(request);
  if (expected !== undefined) {
    const raw = headers.get('Mcp-Name');
    if (raw !== null) {
      const actual = decodeMCPHeaderValue(raw);
      if (actual !== expected) {
        throw headerMismatch('Mcp-Name header does not match request body', {
          header: actual,
          body: expected,
        });
      }
    }
  }

  if (request.method === 'tools/call' && tool) {
    for (const item of headerAnnotatedProperties(tool.inputSchema)) {
      const body = getPath((request.params as { arguments?: unknown })?.arguments, item.path);
      if (body === undefined) {
        continue;
      }

      const raw = headers.get(`Mcp-Param-${item.header}`);
      if (raw !== null) {
        const actual = decodeMCPHeaderValue(raw);
        const expectedValue = typeof body === 'string' ? body : JSON.stringify(body);

        if (actual !== expectedValue) {
          throw headerMismatch(`Mcp-Param-${item.header} header does not match tool argument`);
        }
      }
    }
  }
}
