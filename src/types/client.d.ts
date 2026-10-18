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

interface MCPClientOptions {
  name: string;
  version: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  protocolVersion?: string;
  capabilities?: ClientCapabilities;
  maxInputRounds?: number;
  cache?: boolean;
  tasks?: boolean;

  elicitation?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
  sampling?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
  roots?: (params: Record<string, unknown>) => unknown | Promise<unknown>;
}

interface MCPClientRequestOptions {
  signal?: AbortSignal;
  onNotification?: (n: JSONRPCNotification) => void;
  progressToken?: string | number;
  logLevel?: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
  meta?: Record<string, unknown>;
}

interface Cached<T> {
  value: T;
  expires: number;
  scope: 'private' | 'public';
}
