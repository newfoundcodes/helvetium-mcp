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

import { MCPError, errorResponse, toMCPError } from '../errors.js';
import { buildMCPHeaders, validateMCPHeaders } from '../headers.js';
import { isJSONRPCNotification, isJSONRPCRequest, isJSONRPCErrorResponse } from '../protocol.js';
import type { MCPServer } from '../server.js';

function originAllowed(
  origin: string,
  request: Request,
  allowed?: MCPHTTPServerOptions['allowedOrigins'],
): boolean | Promise<boolean> {
  if (typeof allowed === 'function') {
    return allowed(origin, request);
  }

  if (Array.isArray(allowed)) {
    return allowed.includes(origin);
  }

  return origin === new URL(request.url).origin;
}

function sseEncode(message: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`);
}

function supportedSubscriptionFilter(
  server: MCPServer,
  requested: Record<string, unknown>,
): Record<string, unknown> {
  const caps = server.capabilities();
  const filter: Record<string, unknown> = {};

  if (requested.toolsListChanged === true && caps.tools?.listChanged) {
    filter.toolsListChanged = true;
  }

  if (requested.promptsListChanged === true && caps.prompts?.listChanged) {
    filter.promptsListChanged = true;
  }

  if (requested.resourcesListChanged === true && caps.resources?.listChanged) {
    filter.resourcesListChanged = true;
  }

  if (Array.isArray(requested.resourceSubscriptions) && caps.resources?.subscribe) {
    filter.resourceSubscriptions = requested.resourceSubscriptions.filter(
      (v) => typeof v === 'string',
    );
  }

  return filter;
}

function filterNotification(
  message: JSONRPCNotification,
  filter: Record<string, unknown>,
): boolean {
  switch (message.method) {
    case 'notifications/tools/list_changed':
      return filter.toolsListChanged === true;

    case 'notifications/prompts/list_changed':
      return filter.promptsListChanged === true;

    case 'notifications/resources/list_changed':
      return filter.resourcesListChanged === true;

    case 'notifications/resources/updated':
      return (
        Array.isArray(filter.resourceSubscriptions) &&
        filter.resourceSubscriptions.includes((message.params as Record<string, unknown>)?.uri)
      );

    default:
      return false;
  }
}

export function createMCPHTTPHandler(
  server: MCPServer,
  options: MCPHTTPServerOptions = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { allow: 'POST' } });
    }

    const origin = request.headers.get('origin');
    if (options.requireOrigin && !origin) {
      return new Response('Origin required', { status: 403 });
    }

    if (origin && !(await originAllowed(origin, request, options.allowedOrigins))) {
      return new Response(JSON.stringify(errorResponse(new MCPError(-32600, 'Forbidden origin'))), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (options.validateContentType !== false) {
      const type = (request.headers.get('content-type') ?? '')
        .split(';', 1)[0]!
        .trim()
        .toLowerCase();

      if (type !== 'application/json') {
        return new Response('Content-Type must be application/json', { status: 415 });
      }
    }

    if (options.validateAccept !== false) {
      const accept = (request.headers.get('accept') ?? '').toLowerCase();
      if (!accept.includes('application/json') && !accept.includes('text/event-stream')) {
        return new Response('Accept must include application/json or text/event-stream', {
          status: 406,
        });
      }
    }

    let message: unknown;
    try {
      message = await request.json();
    } catch (error) {
      return new Response(JSON.stringify(errorResponse(error)), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!isJSONRPCRequest(message) && !isJSONRPCNotification(message)) {
      return new Response(JSON.stringify(errorResponse(new MCPError(-32600, 'Invalid Request'))), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const m = message as JSONRPCRequest;
    let tool: Tool | undefined;

    if (isJSONRPCRequest(message) && message.method === 'tools/call') {
      tool = server.getTool(String((message.params as Record<string, unknown>)?.name ?? ''));
    }

    if (isJSONRPCRequest(message)) {
      try {
        validateMCPHeaders(message, request.headers, tool);
        await options.onRequest?.(request, message);
      } catch (error) {
        const e = toMCPError(error);
        return new Response(JSON.stringify(errorResponse(e, message.id)), {
          status: e.httpStatus ?? 400,
          headers: {
            'content-type': 'application/json',
            ...Object.fromEntries(new Headers(options.extraHeaders)),
          },
        });
      }
    }

    if (isJSONRPCRequest(message) && message.method === 'subscriptions/listen') {
      const requested = ((message.params as { notifications?: Record<string, unknown> })
        ?.notifications ?? {}) as Record<string, unknown>;
      const filter = supportedSubscriptionFilter(server, requested);
      const subscriptionId = message.id;

      let unsubscribe = () => {};

      let closed = false;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const ack: JSONRPCNotification = {
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: {
              notifications: filter,
              _meta: { 'io.modelcontextprotocol/subscriptionId': subscriptionId },
            },
          };
          controller.enqueue(sseEncode(ack));

          unsubscribe = server.notifications.subscribe((n) => {
            if (closed || !filterNotification(n, filter)) {
              return;
            }

            const copy: JSONRPCNotification = {
              ...n,
              params: {
                ...(n.params ?? {}),
                _meta: {
                  ...((n.params as { _meta?: Record<string, unknown> })?._meta ?? {}),
                  'io.modelcontextprotocol/subscriptionId': subscriptionId,
                },
              },
            };

            try {
              controller.enqueue(sseEncode(copy));
            } catch {}
          });

          const abort = () => {
            closed = true;
            unsubscribe();

            try {
              controller.close();
            } catch {}
          };

          request.signal.addEventListener('abort', abort, { once: true });
        },
        cancel() {
          closed = true;
          unsubscribe();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          ...Object.fromEntries(new Headers(options.extraHeaders)),
        },
      });
    }

    if (isJSONRPCNotification(message)) {
      await server.dispatch(message, { signal: request.signal });
      return new Response(null, { status: 202, headers: options.extraHeaders });
    }

    const wantsSSE = request.headers.get('accept')?.includes('text/event-stream') === true;
    if (wantsSSE) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            try {
              const response = await server.dispatch(message, {
                signal: request.signal,
                emit: (n) => {
                  try {
                    controller.enqueue(sseEncode(n));
                  } catch {}
                },
              });

              if (response) {
                controller.enqueue(sseEncode(response));
              }

              controller.close();
            } catch (error) {
              try {
                controller.enqueue(sseEncode(errorResponse(error, m.id)));
                controller.close();
              } catch {}
            }
          })();
        },
        cancel() {},
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          ...Object.fromEntries(new Headers(options.extraHeaders)),
        },
      });
    }

    const response = await server.dispatch(message, { signal: request.signal });
    if (!response) {
      return new Response(null, { status: 202, headers: options.extraHeaders });
    }

    return new Response(JSON.stringify(response), {
      status:
        (response as unknown as { error?: { code?: number } }).error?.code === -32020 ? 400 : 200,
      headers: {
        'content-type': 'application/json',
        ...Object.fromEntries(new Headers(options.extraHeaders)),
      },
    });
  };
}

async function parseSSE(
  response: Response,
  onNotification?: (n: JSONRPCNotification) => void,
): Promise<JSONRPCResponse> {
  if (!response.body) {
    throw new MCPError(-32603, 'SSE response has no body');
  }

  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  let final: JSONRPCResponse | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) {
        continue;
      }

      const message = JSON.parse(data);
      if (message && typeof message === 'object' && ('result' in message || 'error' in message)) {
        final = message;
      } else if (message?.method) {
        onNotification?.(message);
      }
    }
  }

  if (!final) {
    throw new MCPError(-32603, 'SSE stream ended without a JSON-RPC response');
  }

  return final;
}

export class MCPHTTPClientTransport implements MCPClientTransport {
  readonly endpoint: string;
  readonly options: MCPHTTPClientOptions;
  readonly cachePartition: string;

  constructor(endpoint: string | URL, options: MCPHTTPClientOptions = {}) {
    this.endpoint = String(endpoint);
    this.options = options;
    this.cachePartition = options.cachePartition ?? new URL(this.endpoint).origin;
  }

  async request(
    message: JSONRPCRequest,
    options: {
      signal?: AbortSignal;
      tool?: Tool;
      onNotification?: (n: JSONRPCNotification) => void;
    } = {},
  ): Promise<JSONRPCResponse> {
    const headers = buildMCPHeaders(message, options.tool);
    const extra =
      typeof this.options.headers === 'function'
        ? await this.options.headers()
        : this.options.headers;
    if (extra) {
      for (const [k, v] of new Headers(extra)) {
        headers.set(k, v);
      }
    }

    const f = this.options.fetch ?? fetch;
    const response = await f(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: options.signal,
    });
    const type = response.headers.get('content-type') ?? '';

    let parsed: JSONRPCResponse;
    if (type.includes('text/event-stream')) {
      parsed = await parseSSE(response, options.onNotification);
    } else {
      const body = await response.text();
      if (!body) {
        throw new MCPError(-32603, `Empty HTTP response (${response.status})`);
      }

      parsed = JSON.parse(body);
    }

    if (!response.ok && !isJSONRPCErrorResponse(parsed)) {
      throw new MCPError(-32603, `HTTP ${response.status}`);
    }

    return parsed;
  }

  async notify(
    message: JSONRPCNotification,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'Mcp-Method': message.method,
    });
    const extra =
      typeof this.options.headers === 'function'
        ? await this.options.headers()
        : this.options.headers;

    if (extra) {
      for (const [k, v] of new Headers(extra)) {
        headers.set(k, v);
      }
    }

    const version = (message.params as { _meta?: Record<string, unknown> })?._meta?.[
      'io.modelcontextprotocol/protocolVersion'
    ] as string | undefined;
    if (version) {
      headers.set('MCP-Protocol-Version', version);
    }

    const response = await (this.options.fetch ?? fetch)(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: options.signal,
    });
    if (!response.ok) {
      throw new MCPError(-32603, `HTTP ${response.status}`);
    }
  }
}
