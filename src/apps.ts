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

export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui' as const;

export function appToolMeta(resourceUri: string, meta: MetaObject = {}): MCPAppToolMeta {
  return { ...meta, ui: { resourceUri } };
}

export function appHTMLResource(
  uri: string,
  html: string,
  options: MCPAppResourceOptions = {},
): ResourceContents & { _meta?: MetaObject } {
  return {
    uri,
    text: html,
    mimeType: 'text/html;profile=mcp-app',
    _meta: { 'io.modelcontextprotocol/ui': options },
  };
}

export function appResourceUri(name: string): string {
  return name.startsWith('ui://') ? name : `ui://${name.replace(/^\/+/, '')}`;
}
