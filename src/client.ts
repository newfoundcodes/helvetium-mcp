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

import { MCPError } from './errors.js';
import { LATEST_PROTOCOL_VERSION, MCP_TASKS_EXTENSION } from './protocol.js';
import { isJSONRPCErrorResponse } from './protocol.js';
import { sleep } from './util.js';

export class MCPClient {
  readonly transport: MCPClientTransport;
  readonly options: MCPClientOptions;
  readonly info: Implementation;
  private id = 0;
  private cache = new Map<string, Cached<unknown>>();
  private toolCache = new Map<string, Tool>();
  private serverInfo?: Implementation;

  constructor(transport: MCPClientTransport, options: MCPClientOptions) {
    this.transport = transport;
    this.options = options;
    this.info = {
      name: options.name,
      version: options.version,
      ...(options.title ? { title: options.title } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(options.websiteUrl ? { websiteUrl: options.websiteUrl } : {}),
    };
  }

  getServerInfo() {
    return this.serverInfo;
  }

  clearCache() {
    this.cache.clear();
    this.toolCache.clear();
  }

  private nextId(): RequestId {
    return ++this.id;
  }

  private clientCapabilities(): ClientCapabilities {
    const configured = this.options.capabilities ?? {};
    const extensions = {
      ...(this.options.tasks === false ? {} : { [MCP_TASKS_EXTENSION]: {} }),
      ...(configured.extensions ?? {}),
    };
    return {
      ...configured,
      ...(this.options.elicitation ? { elicitation: configured.elicitation ?? { form: {} } } : {}),
      ...(this.options.sampling ? { sampling: configured.sampling ?? {} } : {}),
      ...(this.options.roots ? { roots: configured.roots ?? {} } : {}),
      extensions,
    };
  }

  private meta(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      'io.modelcontextprotocol/protocolVersion':
        this.options.protocolVersion ?? LATEST_PROTOCOL_VERSION,
      'io.modelcontextprotocol/clientInfo': this.info,
      'io.modelcontextprotocol/clientCapabilities': this.clientCapabilities(),
      ...extra,
    };
  }

  private async raw(
    method: string,
    params: Record<string, unknown> = {},
    options: MCPClientRequestOptions & { tool?: Tool } = {},
  ): Promise<Result> {
    const extraMeta = {
      ...(options.meta ?? {}),
      ...(options.progressToken === undefined ? {} : { progressToken: options.progressToken }),
      ...(options.logLevel ? { 'io.modelcontextprotocol/logLevel': options.logLevel } : {}),
    };
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method,
      params: { ...params, _meta: this.meta(extraMeta) },
    };
    const response = await this.transport.request(request, {
      signal: options.signal,
      tool: options.tool,
      onNotification: options.onNotification,
    });

    if (isJSONRPCErrorResponse(response)) {
      throw new MCPError(response.error.code, response.error.message, {
        data: response.error.data,
      });
    }

    const info = (
      response.result._meta as { 'io.modelcontextprotocol/serverInfo'?: Implementation }
    )?.['io.modelcontextprotocol/serverInfo'];

    if (info) {
      this.serverInfo = info;
    }

    return response.result;
  }

  private async fulfillInput(result: InputRequiredResult): Promise<Record<string, unknown>> {
    const answers: Record<string, unknown> = {};
    for (const [key, req] of Object.entries(result.inputRequests)) {
      switch (req.method) {
        case 'elicitation/create':
          if (!this.options.elicitation) {
            throw new MCPError(-32021, 'Client has no elicitation handler');
          }

          answers[key] = await this.options.elicitation(req.params);
          break;

        case 'sampling/createMessage':
          if (!this.options.sampling) {
            throw new MCPError(-32021, 'Client has no sampling handler');
          }

          answers[key] = await this.options.sampling(req.params);
          break;

        case 'roots/list':
          if (!this.options.roots) {
            throw new MCPError(-32021, 'Client has no roots handler');
          }

          answers[key] = await this.options.roots(req.params);
          break;

        default:
          throw new MCPError(-32601, `Unsupported input request: ${req.method}`);
      }
    }

    return answers;
  }

  private async request(
    method: string,
    params: Record<string, unknown> = {},
    options: MCPClientRequestOptions & { tool?: Tool } = {},
  ): Promise<Result> {
    let inputResponses: Record<string, unknown> | undefined, requestState: unknown;
    for (let round = 0; round <= (this.options.maxInputRounds ?? 10); round++) {
      const meta = {
        ...(options.meta ?? {}),
        ...(inputResponses ? { inputResponses } : {}),
        ...(requestState === undefined ? {} : { requestState }),
      };
      const result = await this.raw(method, params, { ...options, meta });

      if (result.resultType !== 'input_required') {
        return result;
      }

      const inputRequired = result as InputRequiredResult;
      inputResponses = await this.fulfillInput(inputRequired);
      requestState = inputRequired.requestState;
    }

    throw new MCPError(-32603, 'Maximum MCP multi-round-trip rounds exceeded');
  }

  async discover(options: { signal?: AbortSignal } = {}): Promise<DiscoverResult> {
    return (await this.request('server/discover', {}, options)) as DiscoverResult;
  }

  private getCached<T>(key: string): T | undefined {
    if (this.options.cache === false) {
      return undefined;
    }

    const c = this.cache.get(key);
    if (!c) {
      return undefined;
    }

    if (c.expires <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }

    return c.value as T;
  }

  private putCached<T extends { ttlMs?: number; cacheScope?: 'private' | 'public' }>(
    key: string,
    value: T,
  ): T {
    if (this.options.cache !== false && typeof value.ttlMs === 'number' && value.ttlMs > 0) {
      this.cache.set(key, {
        value,
        expires: Date.now() + value.ttlMs,
        scope: value.cacheScope ?? 'private',
      });
    }

    return value;
  }

  async listTools(
    params: { cursor?: Cursor } = {},
    options: { signal?: AbortSignal; fresh?: boolean } = {},
  ): Promise<ListToolsResult> {
    const key = `tools:${params.cursor ?? ''}`;
    if (!options.fresh) {
      const c = this.getCached<ListToolsResult>(key);
      if (c) {
        return c;
      }
    }

    const r = (await this.request('tools/list', params, options)) as ListToolsResult;
    for (const t of r.tools) {
      this.toolCache.set(t.name, t);
    }

    return this.putCached(key, r);
  }

  async listAllTools(options: { signal?: AbortSignal; maxPages?: number } = {}): Promise<Tool[]> {
    const out: Tool[] = [];
    let cursor: Cursor | undefined;

    for (let i = 0; i < (options.maxPages ?? 100); i++) {
      const r = await this.listTools({ cursor }, { signal: options.signal });
      out.push(...r.tools);
      cursor = r.nextCursor;

      if (!cursor) {
        return out;
      }
    }

    throw new MCPError(-32603, 'tools/list exceeded maxPages');
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options: MCPClientRequestOptions = {},
  ): Promise<CallToolResult | Task> {
    let tool = this.toolCache.get(name);
    try {
      return (await this.request('tools/call', { name, arguments: args }, { ...options, tool })) as
        CallToolResult | Task;
    } catch (error) {
      if (error instanceof MCPError && error.code === -32020) {
        await this.listTools({}, { signal: options.signal, fresh: true });

        tool = this.toolCache.get(name);
        return (await this.request(
          'tools/call',
          { name, arguments: args },
          { ...options, tool },
        )) as CallToolResult | Task;
      }

      throw error;
    }
  }

  async callToolAndWait(
    name: string,
    args: Record<string, unknown> = {},
    options: MCPClientRequestOptions & { pollIntervalMs?: number; maxPolls?: number } = {},
  ): Promise<CallToolResult | Result> {
    const first = await this.callTool(name, args, options);
    if (first.resultType !== 'task') {
      return first as CallToolResult;
    }

    let task = first as Task;
    for (let i = 0; i < (options.maxPolls ?? 1000); i++) {
      if (task.status === 'completed') {
        return task.result ?? { resultType: 'complete' };
      }

      if (task.status === 'failed') {
        throw new MCPError(task.error?.code ?? -32603, task.error?.message ?? 'Task failed', {
          data: task.error?.data,
        });
      }

      if (task.status === 'cancelled') {
        throw new MCPError(-32603, 'Task cancelled');
      }

      if (task.status === 'input_required' && task.inputRequests) {
        const answers = await this.fulfillInput({
          resultType: 'input_required',
          inputRequests: task.inputRequests,
        } as InputRequiredResult);
        task = await this.updateTask(task.taskId, answers, { signal: options.signal });
      } else {
        await sleep(options.pollIntervalMs ?? task.pollIntervalMs ?? 1000, options.signal);
        task = await this.getTask(task.taskId, { signal: options.signal });
      }
    }

    throw new MCPError(-32603, 'Task polling exceeded maxPolls');
  }

  async listResources(
    params: { cursor?: Cursor } = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<ListResourcesResult> {
    return this.putCached(
      `resources:${params.cursor ?? ''}`,
      (await this.request('resources/list', params, options)) as ListResourcesResult,
    );
  }

  async listResourceTemplates(
    params: { cursor?: Cursor } = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<ListResourceTemplatesResult> {
    return this.putCached(
      `resourceTemplates:${params.cursor ?? ''}`,
      (await this.request(
        'resources/templates/list',
        params,
        options,
      )) as ListResourceTemplatesResult,
    );
  }

  async readResource(
    uri: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ReadResourceResult> {
    return this.putCached(
      `resource:${uri}`,
      (await this.request('resources/read', { uri }, options)) as ReadResourceResult,
    );
  }

  async listPrompts(
    params: { cursor?: Cursor } = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<ListPromptsResult> {
    return this.putCached(
      `prompts:${params.cursor ?? ''}`,
      (await this.request('prompts/list', params, options)) as ListPromptsResult,
    );
  }

  async getPrompt(
    name: string,
    args: Record<string, string> = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<GetPromptResult> {
    return (await this.request(
      'prompts/get',
      { name, arguments: args },
      options,
    )) as GetPromptResult;
  }

  async complete(
    ref: Record<string, unknown>,
    argument: { name: string; value: string },
    options: { signal?: AbortSignal } = {},
  ): Promise<CompleteResult> {
    return (await this.request(
      'completion/complete',
      { ref, argument },
      options,
    )) as CompleteResult;
  }

  async getTask(taskId: string, options: { signal?: AbortSignal } = {}): Promise<Task> {
    return (await this.request('tasks/get', { taskId }, options)) as Task;
  }

  async updateTask(
    taskId: string,
    inputResponses: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<Task> {
    return (await this.request('tasks/update', { taskId, inputResponses }, options)) as Task;
  }

  async cancelTask(taskId: string, options: { signal?: AbortSignal } = {}): Promise<Task> {
    return (await this.request('tasks/cancel', { taskId }, options)) as Task;
  }

  async custom<T extends Result = Result>(
    method: string,
    params: Record<string, unknown> = {},
    options: MCPClientRequestOptions = {},
  ): Promise<T> {
    return (await this.request(method, params, options)) as T;
  }

  async listen(
    notifications: Record<string, unknown>,
    onNotification: (n: JSONRPCNotification) => void,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    try {
      await this.raw(
        'subscriptions/listen',
        { notifications },
        { signal: options.signal, onNotification },
      );
    } catch (error) {
      if (options.signal?.aborted) {
        return;
      }

      throw error;
    }
  }

  async close(): Promise<void> {
    await this.transport.close?.();
  }
}

export function createMCPClient(
  transport: MCPClientTransport,
  options: MCPClientOptions,
): MCPClient {
  return new MCPClient(transport, options);
}
