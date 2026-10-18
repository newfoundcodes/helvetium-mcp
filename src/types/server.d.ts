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

type ToolHandler = (
  args: Record<string, unknown>,
  context: MCPServerRequestContext,
) => unknown | Promise<unknown>;

type ResourceHandler = (
  uri: string,
  params: Record<string, string>,
  context: MCPServerRequestContext,
) => unknown | InputRequiredResult | Promise<unknown | InputRequiredResult>;

type PromptHandler = (
  args: Record<string, string>,
  context: MCPServerRequestContext,
) =>
  | GetPromptResult
  | PromptMessage[]
  | InputRequiredResult
  | Promise<GetPromptResult | PromptMessage[] | InputRequiredResult>;

type CompletionHandler = (
  argument: { name: string; value: string },
  ref: Record<string, unknown>,
  context: MCPServerRequestContext,
) =>
  | string[]
  | { values: string[]; total?: number; hasMore?: boolean }
  | Promise<string[] | { values: string[]; total?: number; hasMore?: boolean }>;

type CustomMethodHandler = (
  params: Record<string, unknown>,
  context: MCPServerRequestContext,
) => Result | unknown | Promise<Result | unknown>;

interface MCPServerOptions {
  name: string;
  version: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  instructions?: string;
  supportedProtocolVersions?: string[];
  pageSize?: number;
  ttlMs?: number;
  cacheScope?: CacheScope;
  capabilities?: Partial<ServerCapabilities>;
  extensions?: Record<string, object>;
  taskStore?: MCPTaskStore;
  tasks?: boolean;
}

interface ToolOptions {
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  icons?: unknown[];
  _meta?: MetaObject;
}

interface ResourceOptions {
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: Record<string, unknown>;
  icons?: unknown[];
  _meta?: MetaObject;
}

interface ResourceTemplateOptions extends Omit<ResourceOptions, 'size'> {
  name: string;
}

interface PromptOptions {
  title?: string;
  description?: string;
  arguments?: Prompt['arguments'];
  icons?: unknown[];
  _meta?: MetaObject;
}

interface CacheOptions {
  ttlMs?: number;
  cacheScope?: CacheScope;
}

interface MCPServerRequestContext extends MCPRequestContextInfo {
  server: MCPServer;
  request: JSONRPCRequest;
  inputResponses: Record<string, unknown>;
  requestState: unknown;

  reportProgress(progress: number, total?: number, message?: string): void;
  log(level: LoggingLevel, data: unknown, logger?: string): void;
  requireCapability(path: string): void;
}

interface McpTool extends ToolOptions {
  handler: ToolHandler;
}

interface ToolRegistration {
  definition: Tool;
  handler: ToolHandler;
}

interface ResourceRegistration {
  definition: Resource;
  handler: ResourceHandler;
}

interface TemplateRegistration {
  definition: ResourceTemplate;
  regex: RegExp;
  variables: string[];
  handler: ResourceHandler;
}

interface PromptRegistration {
  definition: Prompt;
  handler: PromptHandler;
}
