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

import { MCPError, errorResponse } from '../errors.js';
import { isJSONRPCNotification, isJSONRPCRequest } from '../protocol.js';
import type { MCPServer } from '../server.js';

function line(value: unknown): string {
  return JSON.stringify(value) + '\n';
}

async function* linesFrom(source: AsyncIterable<string | Uint8Array>): AsyncGenerator<string> {
  let buffer = '';
  const decoder = new TextDecoder();

  for await (const chunk of source) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const value = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);

      if (value.trim()) {
        yield value;
      }
    }
  }

  if (buffer.trim()) {
    yield buffer;
  }
}

export async function serveMCPStdio(
  server: MCPServer,
  input: LineReadable,
  output: LineWritable,
  options: MCPStdioServerOptions = {},
): Promise<void> {
  const subscriptions = new Map<RequestId, () => void>();
  const active = new Map<RequestId, AbortController>();
  const work = new Set<Promise<void>>();
  const track = (job: Promise<void>) => {
    work.add(job);
    void job.finally(() => work.delete(job));
  };

  for await (const raw of linesFrom(input)) {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      output.write(line(errorResponse(error)));
      continue;
    }

    if (isJSONRPCNotification(message) && message.method === 'notifications/cancelled') {
      const id = (message.params as Record<string, unknown>)?.requestId as RequestId;
      const close = subscriptions.get(id);

      if (close) {
        close();
        subscriptions.delete(id);

        output.write(
          line({
            jsonrpc: '2.0',
            id,
            result: {
              resultType: 'complete',
              _meta: {
                'io.modelcontextprotocol/subscriptionId': id,
                'io.modelcontextprotocol/serverInfo': server.info,
              },
            },
          }),
        );
        continue;
      }

      const controller = active.get(id as RequestId);
      if (controller) {
        controller.abort((message.params as Record<string, unknown>)?.reason ?? 'cancelled');
        active.delete(id);
      }

      continue;
    }

    if (isJSONRPCRequest(message) && message.method === 'subscriptions/listen') {
      const requested = ((message.params as { notifications?: Record<string, unknown> })
        ?.notifications ?? {}) as Record<string, unknown>;
      const caps = server.capabilities();
      const filter: Record<string, unknown> = {};

      if (requested.toolsListChanged && caps.tools?.listChanged) {
        filter.toolsListChanged = true;
      }

      if (requested.promptsListChanged && caps.prompts?.listChanged) {
        filter.promptsListChanged = true;
      }

      if (requested.resourcesListChanged && caps.resources?.listChanged) {
        filter.resourcesListChanged = true;
      }

      if (Array.isArray(requested.resourceSubscriptions) && caps.resources?.subscribe) {
        filter.resourceSubscriptions = requested.resourceSubscriptions.filter(
          (v: unknown) => typeof v === 'string',
        );
      }

      const id = message.id;
      const matches = (n: JSONRPCNotification) =>
        (n.method === 'notifications/tools/list_changed' && filter.toolsListChanged) ||
        (n.method === 'notifications/prompts/list_changed' && filter.promptsListChanged) ||
        (n.method === 'notifications/resources/list_changed' && filter.resourcesListChanged) ||
        (n.method === 'notifications/resources/updated' &&
          Array.isArray(filter.resourceSubscriptions) &&
          filter.resourceSubscriptions.includes((n.params as Record<string, unknown>)?.uri));
      const ack = {
        jsonrpc: '2.0',
        method: 'notifications/subscriptions/acknowledged',
        params: { notifications: filter, _meta: { 'io.modelcontextprotocol/subscriptionId': id } },
      };
      output.write(line(ack));

      const unsubscribe = server.notifications.subscribe((n) => {
        if (!matches(n)) {
          return;
        }

        output.write(
          line({
            ...n,
            params: {
              ...(n.params ?? {}),
              _meta: {
                ...((n.params as { _meta?: Record<string, unknown> })?._meta ?? {}),
                'io.modelcontextprotocol/subscriptionId': id,
              },
            },
          }),
        );
      });

      subscriptions.set(id, unsubscribe);
      continue;
    }

    if (isJSONRPCRequest(message)) {
      const controller = new AbortController();
      active.set(message.id, controller);

      const job = (async () => {
        try {
          const response = await server.dispatch(message, {
            signal: controller.signal,
            emit: (n) => output.write(line(n)),
          });

          if (response) {
            output.write(line(response));
          }
        } catch (error) {
          options.onError?.(error);
          output.write(line(errorResponse(error, message.id)));
        } finally {
          active.delete(message.id);
        }
      })();

      track(job);
      continue;
    }

    try {
      await server.dispatch(message, { emit: (n) => output.write(line(n)) });
    } catch (error) {
      options.onError?.(error);
    }
  }

  for (const controller of active.values()) {
    controller.abort('stdio input closed');
  }

  for (const close of subscriptions.values()) {
    close();
  }

  await Promise.allSettled([...work]);
}

export class MCPStdioClientTransport implements MCPClientTransport {
  readonly cachePartition: string;
  private pending = new Map<RequestId, Pending>();
  private closed = false;
  private reader: Promise<void>;

  constructor(
    private input: LineReadable,
    private output: LineWritable,
    options: { cachePartition?: string } = {},
  ) {
    this.cachePartition = options.cachePartition ?? 'stdio';
    this.reader = this.readLoop();
  }

  private async readLoop() {
    try {
      for await (const raw of linesFrom(this.input)) {
        const message = JSON.parse(raw);
        if (
          message &&
          typeof message === 'object' &&
          'id' in message &&
          ('result' in message || 'error' in message)
        ) {
          const p = this.pending.get(message.id);
          if (p) {
            this.pending.delete(message.id);

            p.abort?.();
            p.resolve(message);
          }
        } else if (message?.method) {
          const subscriptionId = message.params?._meta?.['io.modelcontextprotocol/subscriptionId'];
          if (subscriptionId !== undefined) {
            this.pending.get(subscriptionId)?.onNotification?.(message);
          } else {
            for (const p of this.pending.values()) {
              p.onNotification?.(message);
            }
          }
        }
      }
    } catch (error) {
      for (const p of this.pending.values()) {
        p.reject(error);
      }
    } finally {
      this.closed = true;

      for (const p of this.pending.values()) {
        p.reject(new MCPError(-32603, 'stdio transport closed'));
      }

      this.pending.clear();
    }
  }

  request(
    message: JSONRPCRequest,
    options: { signal?: AbortSignal; onNotification?: (n: JSONRPCNotification) => void } = {},
  ): Promise<JSONRPCResponse> {
    if (this.closed) {
      return Promise.reject(new MCPError(-32603, 'stdio transport is closed'));
    }

    return new Promise((resolve, reject) => {
      let abort: undefined | (() => void);
      if (options.signal) {
        const onAbort = () => {
          this.notify({
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: {
              requestId: message.id,
              reason: String(options.signal?.reason ?? 'cancelled'),
            },
          }).catch(() => {});

          this.pending.delete(message.id);
          reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        };

        options.signal.addEventListener('abort', onAbort, { once: true });
        abort = () => options.signal?.removeEventListener('abort', onAbort);
      }

      this.pending.set(message.id, {
        resolve,
        reject,
        onNotification: options.onNotification,
        abort,
      });

      this.output.write(line(message));
    });
  }

  async notify(message: JSONRPCNotification): Promise<void> {
    if (this.closed) {
      throw new MCPError(-32603, 'stdio transport is closed');
    }

    this.output.write(line(message));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.output.end?.();

    await Promise.race([this.reader, Promise.resolve()]);
  }
}
