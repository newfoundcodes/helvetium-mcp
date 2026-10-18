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

export const LATEST_PROTOCOL_VERSION = '2026-07-28' as const;
export const JSONRPC_VERSION = '2.0' as const;
export const MCP_TASKS_EXTENSION = 'io.modelcontextprotocol/tasks' as const;
export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui' as const;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
export const HEADER_MISMATCH = -32020;
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;
export const RESOURCE_NOT_FOUND = -32002;

export function isJSONRPCRequest(value: unknown): value is JSONRPCRequest {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).jsonrpc === '2.0' &&
    'id' in (value as Record<string, unknown>) &&
    typeof (value as Record<string, unknown>).method === 'string'
  );
}

export function isJSONRPCNotification(value: unknown): value is JSONRPCNotification {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).jsonrpc === '2.0' &&
    !('id' in (value as Record<string, unknown>)) &&
    typeof (value as Record<string, unknown>).method === 'string'
  );
}

export function isJSONRPCErrorResponse(value: unknown): value is JSONRPCErrorResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).jsonrpc === '2.0' &&
    !!(value as Record<string, unknown>).error
  );
}
