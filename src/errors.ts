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
  HEADER_MISMATCH,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  RESOURCE_NOT_FOUND,
  UNSUPPORTED_PROTOCOL_VERSION,
} from './protocol.js';

export class MCPError extends Error {
  readonly code: number;
  readonly data?: unknown;
  readonly httpStatus?: number;

  constructor(
    code: number,
    message: string,
    options: { data?: unknown; httpStatus?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MCPError';
    this.code = code;
    this.data = options.data;
    this.httpStatus = options.httpStatus;
  }

  toJSON(): JSONRPCError {
    return {
      code: this.code,
      message: this.message,
      ...(this.data === undefined ? {} : { data: this.data }),
    };
  }
}

export class MCPToolError extends Error {
  readonly content?: unknown[];
  readonly structuredContent?: unknown;

  constructor(
    message: string,
    options: { content?: unknown[]; structuredContent?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MCPToolError';
    this.content = options.content;
    this.structuredContent = options.structuredContent;
  }
}

export const invalidRequest = (message = 'Invalid Request', data?: unknown) =>
  new MCPError(INVALID_REQUEST, message, { data, httpStatus: 400 });

export const invalidParams = (message = 'Invalid params', data?: unknown) =>
  new MCPError(INVALID_PARAMS, message, { data });

export const methodNotFound = (method: string) =>
  new MCPError(METHOD_NOT_FOUND, `Method not found: ${method}`);

export const headerMismatch = (message: string, data?: unknown) =>
  new MCPError(HEADER_MISMATCH, message, { data, httpStatus: 400 });

export const missingCapability = (capability: string) =>
  new MCPError(
    MISSING_REQUIRED_CLIENT_CAPABILITY,
    `Missing required client capability: ${capability}`,
    { data: { capability } },
  );

export const unsupportedProtocol = (version: string) =>
  new MCPError(UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version: ${version}`, {
    data: { version },
    httpStatus: 400,
  });

export const resourceNotFound = (uri: string) =>
  new MCPError(RESOURCE_NOT_FOUND, `Resource not found: ${uri}`, { data: { uri } });

export function toMCPError(error: unknown): MCPError {
  if (error instanceof MCPError) {
    return error;
  }

  if (error instanceof SyntaxError) {
    return invalidRequest('Invalid JSON');
  }

  return new MCPError(INTERNAL_ERROR, 'Internal error', { cause: error });
}

export function errorResponse(error: unknown, id?: RequestId) {
  const e = toMCPError(error);
  return { jsonrpc: '2.0' as const, ...(id === undefined ? {} : { id }), error: e.toJSON() };
}
