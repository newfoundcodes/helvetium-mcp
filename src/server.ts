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

import {
  MCPError,
  MCPToolError,
  errorResponse,
  invalidParams,
  methodNotFound,
  missingCapability,
  resourceNotFound,
  unsupportedProtocol,
} from './errors.js';
import { paginate } from './pagination.js';
import { assertJSONSchema } from './schema.js';
import { MCPTaskStore } from './tasks.js';
import { asRecord, stableSortByName } from './util.js';
import { text, textResource } from './content.js';
import {
  JSONRPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  MCP_TASKS_EXTENSION,
  isJSONRPCNotification,
  isJSONRPCRequest,
} from './protocol.js';

const LOG_ORDER: LoggingLevel[] = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
];

function complete<T extends Record<string, unknown>>(value: T): T & { resultType: 'complete' } {
  return { resultType: 'complete', ...value };
}

function isResult(v: unknown): v is Result {
  return !!v && typeof v === 'object' && typeof (v as Result).resultType === 'string';
}

function isInputRequired(v: unknown): v is InputRequiredResult {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as InputRequiredResult).resultType === 'input_required' &&
    !!(v as InputRequiredResult).inputRequests
  );
}

function isTask(v: unknown): v is CreateTaskResult {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as CreateTaskResult).resultType === 'task' &&
    typeof (v as CreateTaskResult).taskId === 'string'
  );
}

function cache<T extends Record<string, unknown>>(
  value: T,
  opts: CacheOptions,
  defaults: { ttlMs: number; cacheScope: CacheScope },
) {
  return complete({
    ...value,
    ttlMs: opts.ttlMs ?? defaults.ttlMs,
    cacheScope: opts.cacheScope ?? defaults.cacheScope,
  });
}

function templateRegex(template: string): { regex: RegExp; variables: string[] } {
  const variables: string[] = [];
  let source = '^';

  for (let i = 0; i < template.length;) {
    if (template[i] === '{') {
      const end = template.indexOf('}', i);
      if (end < 0) {
        throw new TypeError(`Invalid URI template: ${template}`);
      }

      const name = template.slice(i + 1, end);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new TypeError(`Invalid URI template variable: ${name}`);
      }

      variables.push(name);
      source += '([^/?#]+)';

      i = end + 1;
    } else {
      source += template[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  return { regex: new RegExp(source + '$'), variables };
}

function normalizeResourceResult(
  uri: string,
  value: unknown,
  mimeType?: string,
): ResourceContents[] {
  if (Array.isArray(value)) {
    return value as ResourceContents[];
  }

  if (typeof value === 'string') {
    return [textResource(uri, value, mimeType)];
  }

  if (value instanceof Uint8Array) {
    let s = '';
    for (const b of value) {
      s += String.fromCharCode(b);
    }

    return [{ uri, blob: btoa(s), ...(mimeType ? { mimeType } : {}) }];
  }

  if (
    value &&
    typeof value === 'object' &&
    ('text' in (value as Record<string, unknown>) || 'blob' in (value as Record<string, unknown>))
  ) {
    return [value as ResourceContents];
  }

  return [textResource(uri, JSON.stringify(value), mimeType ?? 'application/json')];
}

function normalizeToolResult(
  value: unknown,
): CallToolResult | InputRequiredResult | CreateTaskResult {
  if (isInputRequired(value) || isTask(value)) {
    return value;
  }

  if (isResult(value) && Array.isArray((value as CallToolResult).content)) {
    return value as CallToolResult;
  }

  if (Array.isArray(value)) {
    return complete({ content: value as ContentBlock[] });
  }

  if (typeof value === 'string') {
    return complete({ content: [text(value)] });
  }

  if (value === undefined) {
    return complete({ content: [] });
  }

  return complete({ content: [text(JSON.stringify(value))], structuredContent: value });
}

function getClientCaps(params: Record<string, unknown>): ClientCapabilities {
  const meta = asRecord(params._meta);
  const key = 'io.modelcontextprotocol/clientCapabilities';
  if (!(key in meta)) {
    if ('capabilities' in params) {
      return asRecord(params.capabilities) as ClientCapabilities;
    }

    throw invalidParams('Missing client capabilities');
  }

  return asRecord(meta[key]) as ClientCapabilities;
}

export class MCPNotificationHub {
  private listeners = new Set<(message: JSONRPCNotification) => void>();

  subscribe(listener: (message: JSONRPCNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(method: string, params: Record<string, unknown> = {}): void {
    const message: JSONRPCNotification = { jsonrpc: '2.0', method, params };
    for (const fn of [...this.listeners]) {
      fn(message);
    }
  }

  get size() {
    return this.listeners.size;
  }
}

export class MCPServer {
  readonly info: Implementation;
  readonly options: MCPServerOptions;
  readonly notifications = new MCPNotificationHub();
  readonly tasks: MCPTaskStore;
  private tools = new Map<string, ToolRegistration>();
  private resources = new Map<string, ResourceRegistration>();
  private templates = new Map<string, TemplateRegistration>();
  private prompts = new Map<string, PromptRegistration>();
  private methods = new Map<string, CustomMethodHandler>();
  private completionHandler?: CompletionHandler;

  constructor(options: MCPServerOptions) {
    if (!options.name || !options.version) {
      throw new TypeError('MCPServer requires name and version');
    }

    this.options = options;
    this.info = {
      name: options.name,
      version: options.version,
      ...(options.title ? { title: options.title } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(options.websiteUrl ? { websiteUrl: options.websiteUrl } : {}),
    };
    this.tasks = options.taskStore ?? new MCPTaskStore();
  }

  tool(name: string, tool: McpTool): this;

  tool(name: string, options: ToolOptions | ToolHandler, handler?: ToolHandler): this;

  tool(name: string, options: ToolOptions | ToolHandler | McpTool, handler?: ToolHandler): this {
    let opts: ToolOptions;
    let fn: ToolHandler;

    if (typeof options === 'function') {
      opts = {};
      fn = options;
    } else if ('handler' in options && typeof options.handler === 'function') {
      opts = options;
      fn = options.handler;
    } else {
      opts = options as ToolOptions;
      fn = handler!;
    }

    if (!fn) {
      throw new TypeError('tool() requires a handler');
    }

    const definition: Tool = {
      name,
      inputSchema: opts.inputSchema ?? {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
      ...opts,
    } as unknown as Tool;

    this.tools.set(name, { definition, handler: fn });
    this.notifications.emit('notifications/tools/list_changed');
    return this;
  }

  removeTool(name: string): boolean {
    const ok = this.tools.delete(name);
    if (ok) {
      this.notifications.emit('notifications/tools/list_changed');
    }

    return ok;
  }

  resource(
    uri: string,
    options: ResourceOptions | ResourceHandler,
    handler?: ResourceHandler,
  ): this {
    const opts = typeof options === 'function' ? {} : options;
    const fn = (typeof options === 'function' ? options : handler)!;

    if (!fn) {
      throw new TypeError('resource() requires a handler');
    }

    const definition = { uri, name: opts.name ?? uri, ...opts } as unknown as Resource;
    this.resources.set(uri, { definition, handler: fn });
    this.notifications.emit('notifications/resources/list_changed');
    return this;
  }

  resourceTemplate(
    uriTemplate: string,
    options: ResourceTemplateOptions,
    handler: ResourceHandler,
  ): this {
    const compiled = templateRegex(uriTemplate);
    this.templates.set(uriTemplate, {
      definition: { uriTemplate, ...options } as unknown as ResourceTemplate,
      ...compiled,
      handler,
    });

    this.notifications.emit('notifications/resources/list_changed');
    return this;
  }

  prompt(name: string, options: PromptOptions | PromptHandler, handler?: PromptHandler): this {
    const opts = typeof options === 'function' ? {} : options;
    const fn = (typeof options === 'function' ? options : handler)!;

    if (!fn) {
      throw new TypeError('prompt() requires a handler');
    }

    this.prompts.set(name, { definition: { name, ...opts } as unknown as Prompt, handler: fn });
    this.notifications.emit('notifications/prompts/list_changed');
    return this;
  }

  completion(handler: CompletionHandler): this {
    this.completionHandler = handler;
    return this;
  }

  method(name: string, handler: CustomMethodHandler): this {
    this.methods.set(name, handler);
    return this;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.notifications.emit(method, params);
  }

  notifyResourceUpdated(uri: string): void {
    this.notifications.emit('notifications/resources/updated', { uri });
  }

  capabilities(): ServerCapabilities {
    return {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
      ...(this.completionHandler ? { completions: {} } : {}),
      ...(this.options.capabilities ?? {}),
      extensions: {
        ...(this.options.tasks === false ? {} : { [MCP_TASKS_EXTENSION]: {} }),
        ...(this.options.extensions ?? {}),
        ...(this.options.capabilities?.extensions ?? {}),
      },
    };
  }

  discover(): DiscoverResult {
    return cache(
      {
        supportedVersions: this.options.supportedProtocolVersions ?? [LATEST_PROTOCOL_VERSION],
        capabilities: this.capabilities(),
        ...(this.options.instructions ? { instructions: this.options.instructions } : {}),
      },
      {},
      { ttlMs: this.options.ttlMs ?? 0, cacheScope: this.options.cacheScope ?? 'private' },
    ) as DiscoverResult;
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name)?.definition;
  }

  private buildContext(
    request: JSONRPCRequest,
    signal: AbortSignal,
    emit: (n: JSONRPCNotification) => void,
  ): MCPServerRequestContext {
    const params = asRecord(request.params);
    const meta = asRecord(params._meta);
    const clientCapabilities = getClientCaps(params);
    const requestedLevel = meta['io.modelcontextprotocol/logLevel'] as LoggingLevel | undefined;
    const progressToken = meta.progressToken as string | number | undefined;

    const reportProgress = (progress: number, total?: number, message?: string) => {
      if (progressToken === undefined) {
        return;
      }

      emit({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: {
          progressToken,
          progress,
          ...(total === undefined ? {} : { total }),
          ...(message ? { message } : {}),
        },
      });
    };

    const log = (level: LoggingLevel, data: unknown, logger?: string) => {
      if (!requestedLevel) {
        return;
      }

      if (LOG_ORDER.indexOf(level) < LOG_ORDER.indexOf(requestedLevel)) {
        return;
      }

      emit({
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level, data, ...(logger ? { logger } : {}) },
      });
    };

    const requireCapability = (path: string) => {
      let cur: unknown = clientCapabilities;
      for (const part of path.split('.')) {
        cur = (cur as Record<string, unknown>)?.[part];
      }

      if (cur === undefined) {
        throw missingCapability(path);
      }
    };

    return {
      server: this,
      request,
      protocolVersion: String(meta['io.modelcontextprotocol/protocolVersion'] ?? ''),
      clientInfo: meta['io.modelcontextprotocol/clientInfo'] as Implementation | undefined,
      clientCapabilities,
      logLevel: requestedLevel,
      progressToken,
      signal,
      inputResponses: asRecord(meta.inputResponses),
      requestState: meta.requestState,
      reportProgress,
      log,
      requireCapability,
    };
  }

  async dispatch(
    message: unknown,
    options: { signal?: AbortSignal; emit?: (n: JSONRPCNotification) => void } = {},
  ): Promise<JSONRPCResponse | undefined> {
    if (isJSONRPCNotification(message)) {
      if (
        message.method === 'notifications/cancelled' ||
        message.method === 'notifications/initialized'
      ) {
        return undefined;
      }

      const custom = this.methods.get(message.method);
      if (custom) {
        const dummy = { ...message, id: 'notification' } as JSONRPCRequest;
        await custom(
          asRecord(message.params),
          this.buildContext(
            dummy,
            options.signal ?? new AbortController().signal,
            options.emit ?? (() => {}),
          ),
        );
        return undefined;
      }

      return undefined;
    }

    if (!isJSONRPCRequest(message)) {
      return errorResponse(new MCPError(-32600, 'Invalid Request'));
    }

    const request = message;
    const emit = options.emit ?? (() => {});

    try {
      const params = asRecord(request.params);
      const meta = asRecord(params._meta);

      let protocolVersion = String(meta['io.modelcontextprotocol/protocolVersion'] ?? '');
      if (!protocolVersion) {
        protocolVersion = '2024-11-05';
      }

      if (
        !(
          this.options.supportedProtocolVersions ?? [LATEST_PROTOCOL_VERSION, '2024-11-05']
        ).includes(protocolVersion)
      ) {
        throw unsupportedProtocol(protocolVersion);
      }

      const ctx = this.buildContext(request, options.signal ?? new AbortController().signal, emit);
      let result: Result;

      switch (request.method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: this.capabilities(),
            serverInfo: this.info,
          } as unknown as DiscoverResult;
          break;

        case 'ping':
          result = { resultType: 'complete' } as Result;
          break;

        case 'server/discover':
          result = this.discover();
          break;

        case 'tools/list': {
          const list = stableSortByName([...this.tools.values()].map((v) => v.definition));
          const page = paginate(
            list,
            params.cursor as Cursor | undefined,
            this.options.pageSize ?? 50,
          );

          result = cache(
            { tools: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
            {},
            { ttlMs: this.options.ttlMs ?? 0, cacheScope: this.options.cacheScope ?? 'private' },
          ) as ListToolsResult;
          break;
        }

        case 'tools/call': {
          const name = String(params.name ?? '');
          const reg = this.tools.get(name);

          if (!reg) {
            throw invalidParams(`Unknown tool: ${name}`);
          }

          const args = asRecord(params.arguments);
          assertJSONSchema(reg.definition.inputSchema, args, `arguments for tool ${name}`);

          try {
            const value = await reg.handler(args, ctx);
            result = normalizeToolResult(value);

            if (
              (result as CallToolResult).structuredContent !== undefined &&
              reg.definition.outputSchema
            ) {
              assertJSONSchema(
                reg.definition.outputSchema,
                (result as CallToolResult).structuredContent,
                `structured output for tool ${name}`,
              );
            }
          } catch (error) {
            if (error instanceof MCPToolError) {
              result = complete({
                content: (error.content as ContentBlock[] | undefined) ?? [text(error.message)],
                structuredContent: error.structuredContent,
                isError: true,
              });
            } else {
              throw error;
            }
          }

          break;
        }

        case 'resources/list': {
          const list = [...this.resources.values()]
            .map((v) => v.definition)
            .sort((a, b) => a.uri.localeCompare(b.uri));
          const page = paginate(
            list,
            params.cursor as Cursor | undefined,
            this.options.pageSize ?? 50,
          );

          result = cache(
            { resources: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
            {},
            { ttlMs: this.options.ttlMs ?? 0, cacheScope: this.options.cacheScope ?? 'private' },
          ) as ListResourcesResult;
          break;
        }

        case 'resources/templates/list': {
          const list = [...this.templates.values()]
            .map((v) => v.definition)
            .sort((a, b) => a.uriTemplate.localeCompare(b.uriTemplate));
          const page = paginate(
            list,
            params.cursor as Cursor | undefined,
            this.options.pageSize ?? 50,
          );

          result = cache(
            {
              resourceTemplates: page.items,
              ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
            },
            {},
            { ttlMs: this.options.ttlMs ?? 0, cacheScope: this.options.cacheScope ?? 'private' },
          ) as ListResourceTemplatesResult;
          break;
        }

        case 'resources/read': {
          const uri = String(params.uri ?? '');
          let contents: ResourceContents[] | undefined;
          let inputRequired: InputRequiredResult | undefined;

          const exact = this.resources.get(uri);
          if (exact) {
            const raw = await exact.handler(uri, {}, ctx);
            if (isInputRequired(raw)) {
              inputRequired = raw;
            } else {
              contents = normalizeResourceResult(uri, raw, exact.definition.mimeType);
            }
          } else {
            for (const reg of this.templates.values()) {
              const m = reg.regex.exec(uri);
              if (m) {
                const vars: Record<string, string> = {};
                reg.variables.forEach((v, i) => (vars[v] = decodeURIComponent(m[i + 1])));

                const raw = await reg.handler(uri, vars, ctx);
                if (isInputRequired(raw)) {
                  inputRequired = raw;
                } else {
                  contents = normalizeResourceResult(uri, raw, reg.definition.mimeType);
                }

                break;
              }
            }
          }

          if (inputRequired) {
            result = inputRequired;
            break;
          }

          if (!contents) {
            throw resourceNotFound(uri);
          }

          result = cache(
            { contents },
            {},
            { ttlMs: this.options.ttlMs ?? 0, cacheScope: this.options.cacheScope ?? 'private' },
          );
          break;
        }

        case 'prompts/list': {
          const list = stableSortByName([...this.prompts.values()].map((v) => v.definition));
          const page = paginate(
            list,
            params.cursor as Cursor | undefined,
            this.options.pageSize ?? 50,
          );

          result = cache(
            { prompts: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
            {},
            { ttlMs: this.options.ttlMs ?? 0, cacheScope: this.options.cacheScope ?? 'private' },
          ) as ListPromptsResult;
          break;
        }

        case 'prompts/get': {
          const name = String(params.name ?? '');
          const reg = this.prompts.get(name);

          if (!reg) {
            throw invalidParams(`Unknown prompt: ${name}`);
          }

          const raw = await reg.handler(
            Object.fromEntries(
              Object.entries(asRecord(params.arguments)).map(([k, v]) => [k, String(v)]),
            ),
            ctx,
          );

          result = Array.isArray(raw) ? complete({ messages: raw }) : raw;
          break;
        }

        case 'completion/complete': {
          if (!this.completionHandler) {
            throw methodNotFound(request.method);
          }

          const raw = await this.completionHandler(
            asRecord(params.argument) as { name: string; value: string },
            asRecord(params.ref),
            ctx,
          );

          const completion = Array.isArray(raw) ? { values: raw } : raw;
          if (completion.values.length > 100) {
            completion.values = completion.values.slice(0, 100);
          }

          result = complete({ completion }) as CompleteResult;
          break;
        }

        case 'tasks/get':
          if (this.options.tasks === false) {
            throw methodNotFound(request.method);
          }

          result = this.tasks.get(String(params.taskId ?? ''));
          break;

        case 'tasks/update': {
          if (this.options.tasks === false) {
            throw methodNotFound(request.method);
          }

          const id = String(params.taskId ?? '');
          const current = this.tasks.get(id);

          if (current.status === 'input_required' && params.inputResponses) {
            result = this.tasks.working(id);
          } else {
            result = current;
          }

          break;
        }

        case 'tasks/cancel':
          if (this.options.tasks === false) {
            throw methodNotFound(request.method);
          }

          result = this.tasks.cancel(String(params.taskId ?? ''));
          break;

        case 'subscriptions/listen':
          throw new MCPError(
            -32603,
            'subscriptions/listen must be handled by a streaming transport',
          );

        default: {
          const custom = this.methods.get(request.method);
          if (!custom) {
            throw methodNotFound(request.method);
          }

          const value = await custom(params, ctx);
          result = isResult(value) ? value : complete({ value });
        }
      }

      const withInfo = {
        ...result,
        _meta: { ...(result._meta ?? {}), 'io.modelcontextprotocol/serverInfo': this.info },
      } as Result;
      return { jsonrpc: JSONRPC_VERSION, id: request.id, result: withInfo };
    } catch (error) {
      return errorResponse(error, request.id);
    }
  }
}

export function createMCPServer(options: MCPServerOptions): MCPServer {
  return new MCPServer(options);
}
