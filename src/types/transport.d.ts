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

interface MCPHTTPServerOptions {
  allowedOrigins?: string[] | ((origin: string, request: Request) => boolean | Promise<boolean>);
  requireOrigin?: boolean;
  extraHeaders?: HeadersInit;

  onRequest?: (request: Request, message: JSONRPCRequest) => void | Promise<void>;

  validateAccept?: boolean;
  validateContentType?: boolean;
}

interface MCPClientTransport {
  request(
    message: JSONRPCRequest,
    options?: {
      signal?: AbortSignal;
      tool?: Tool;
      onNotification?: (n: JSONRPCNotification) => void;
    },
  ): Promise<JSONRPCResponse>;
  notify?(message: JSONRPCNotification, options?: { signal?: AbortSignal }): Promise<void>;
  close?(): Promise<void> | void;
  cachePartition?: string;
}

interface MCPHTTPClientOptions {
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  fetch?: typeof fetch;
  cachePartition?: string;
}

interface LineReadable extends AsyncIterable<string | Uint8Array> {}

interface LineWritable {
  write(chunk: string | Uint8Array): unknown;
  end?(): unknown;
}

interface MCPStdioServerOptions {
  onError?: (error: unknown) => void;
}

interface Pending {
  resolve: (response: JSONRPCResponse) => void;
  reject: (error: unknown) => void;
  onNotification?: (n: JSONRPCNotification) => void;
  abort?: () => void;
}
