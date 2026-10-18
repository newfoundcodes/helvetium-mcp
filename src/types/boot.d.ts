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

type BootHandlerLike = (context: BootContextLike, next?: unknown) => Response | Promise<Response>;

interface BootContextLike {
  request: Request;
  json?(value: unknown, status?: number, headers?: HeadersInit): Response;
}

interface BootAppLike {
  post(path: string, ...handlers: BootHandlerLike[]): unknown;
  get(path: string, ...handlers: BootHandlerLike[]): unknown;
}

interface MCPAuthorizationDecision {
  authorized: boolean;
  status?: 401 | 403;
  scopes?: string[];
  error?: string;
  errorDescription?: string;
}

interface MCPBootAuthorizationOptions {
  metadata: ProtectedResourceMetadata;
  verify: (request: Request) => MCPAuthorizationDecision | Promise<MCPAuthorizationDecision>;
  metadataPath?: string;
}

interface MCPBootOptions extends MCPHTTPServerOptions {
  path?: string;
  authorization?: MCPBootAuthorizationOptions;
}
