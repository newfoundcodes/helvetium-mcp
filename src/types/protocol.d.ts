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

type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | JSONObject | JSONValue[];

type RequestId = string | number;
type ProgressToken = string | number;
type Cursor = string;
type CacheScope = 'private' | 'public';
type ResultType = 'complete' | 'input_required' | 'task' | string;
type Role = 'user' | 'assistant';
type LoggingLevel =
  'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

type JSONRPCResponse = JSONRPCResultResponse | JSONRPCErrorResponse;
type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse;

type ResourceContents = TextResourceContents | BlobResourceContents;

type ContentBlock = TextContent | ImageContent | AudioContent | EmbeddedResource | ResourceLink;

type CompletionReference = PromptReference | ResourceTemplateReference;

type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

interface JSONObject {
  [key: string]: JSONValue;
}

interface Implementation {
  name: string;
  version: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  icons?: Icon[];
}

interface Icon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: 'light' | 'dark';
}

interface Annotations {
  audience?: Role[];
  priority?: number;
  lastModified?: string;
}

interface MetaObject {
  [key: string]: unknown;
}

interface ClientCapabilities {
  experimental?: Record<string, object>;
  extensions?: Record<string, object>;
  elicitation?: { form?: object; url?: object };

  roots?: {};

  sampling?: { context?: object; tools?: object };
}

interface ServerCapabilities {
  experimental?: Record<string, object>;
  extensions?: Record<string, object>;
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  completions?: object;

  logging?: object;
}

interface RequestMetaObject extends MetaObject {
  progressToken?: ProgressToken;
  'io.modelcontextprotocol/protocolVersion': string;
  'io.modelcontextprotocol/clientInfo'?: Implementation;
  'io.modelcontextprotocol/clientCapabilities': ClientCapabilities;

  'io.modelcontextprotocol/logLevel'?: LoggingLevel;
}

interface ResultMetaObject extends MetaObject {
  'io.modelcontextprotocol/serverInfo'?: Implementation;
}

interface NotificationMetaObject extends MetaObject {
  'io.modelcontextprotocol/subscriptionId'?: RequestId;
}

interface RequestParams {
  _meta: RequestMetaObject;
  [key: string]: unknown;
}

interface Result {
  resultType: ResultType;
  _meta?: ResultMetaObject;
  [key: string]: unknown;
}

interface CacheableResult extends Result {
  ttlMs: number;
  cacheScope: CacheScope;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: RequestId;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResultResponse {
  jsonrpc: '2.0';
  id: RequestId;
  result: Result;
}

interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

interface JSONRPCErrorResponse {
  jsonrpc: '2.0';
  id?: RequestId;
  error: JSONRPCError;
}

interface TextContent {
  type: 'text';
  text: string;
  annotations?: Annotations;
  _meta?: MetaObject;
}

interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: MetaObject;
}

interface AudioContent {
  type: 'audio';
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: MetaObject;
}

interface TextResourceContents {
  uri: string;
  text: string;
  mimeType?: string;
  _meta?: MetaObject;
}

interface BlobResourceContents {
  uri: string;
  blob: string;
  mimeType?: string;
  _meta?: MetaObject;
}

interface EmbeddedResource {
  type: 'resource';
  resource: ResourceContents;
  annotations?: Annotations;
  _meta?: MetaObject;
}

interface ResourceLink {
  type: 'resource_link';
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: Annotations;
  icons?: Icon[];
  _meta?: MetaObject;
}

interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  icons?: Icon[];
  _meta?: MetaObject;
}

interface ListToolsResult extends CacheableResult {
  tools: Tool[];
  nextCursor?: Cursor;
}

interface CallToolResult extends Result {
  content: ContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface Resource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: Annotations;
  icons?: Icon[];
  _meta?: MetaObject;
}

interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: Annotations;
  icons?: Icon[];
  _meta?: MetaObject;
}

interface ListResourcesResult extends CacheableResult {
  resources: Resource[];
  nextCursor?: Cursor;
}

interface ListResourceTemplatesResult extends CacheableResult {
  resourceTemplates: ResourceTemplate[];
  nextCursor?: Cursor;
}

interface ReadResourceResult extends CacheableResult {
  contents: ResourceContents[];
}

interface PromptArgument {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
}

interface Prompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: PromptArgument[];
  icons?: Icon[];
  _meta?: MetaObject;
}

interface PromptMessage {
  role: Role;
  content: ContentBlock;
}

interface ListPromptsResult extends CacheableResult {
  prompts: Prompt[];
  nextCursor?: Cursor;
}

interface GetPromptResult extends Result {
  description?: string;
  messages: PromptMessage[];
}

interface PromptReference {
  type: 'ref/prompt';
  name: string;
}

interface ResourceTemplateReference {
  type: 'ref/resource';
  uri: string;
}

interface CompleteResult extends Result {
  completion: { values: string[]; total?: number; hasMore?: boolean };
}

interface DiscoverResult extends CacheableResult {
  supportedVersions: string[];
  capabilities: ServerCapabilities;
  instructions?: string;
}

interface ProgressNotificationParams {
  progressToken: ProgressToken;
  progress: number;
  total?: number;
  message?: string;
  _meta?: NotificationMetaObject;
}

interface LoggingMessageParams {
  level: LoggingLevel;
  logger?: string;
  data: unknown;
  _meta?: NotificationMetaObject;
}

interface InputRequest {
  method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list' | string;
  params: Record<string, unknown>;
}

interface InputRequiredResult extends Result {
  resultType: 'input_required';
  inputRequests: Record<string, InputRequest>;
  requestState?: unknown;
}

interface InputResponsesMeta {
  inputResponses?: Record<string, unknown>;
  requestState?: unknown;
}

interface Task extends Result {
  resultType: 'task' | 'complete';
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number;
  pollIntervalMs?: number;
  inputRequests?: Record<string, InputRequest>;
  result?: Result;
  error?: JSONRPCError;
  _meta?: ResultMetaObject;
}

interface CreateTaskResult extends Task {
  resultType: 'task';
}

interface MCPRequestContextInfo {
  protocolVersion: string;
  clientInfo?: Implementation;
  clientCapabilities: ClientCapabilities;
  logLevel?: LoggingLevel;
  progressToken?: ProgressToken;
  signal: AbortSignal;
}

interface MCPTransportRequest {
  request: JSONRPCRequest | JSONRPCNotification;
  protocolVersion?: string;
  headers?: Headers;
  signal?: AbortSignal;
}
