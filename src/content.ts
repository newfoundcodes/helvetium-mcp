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

export const text = (value: string, annotations?: Annotations): TextContent => ({
  type: 'text',
  text: value,
  ...(annotations ? { annotations } : {}),
});

export const image = (data: string, mimeType: string, annotations?: Annotations): ImageContent => ({
  type: 'image',
  data,
  mimeType,
  ...(annotations ? { annotations } : {}),
});

export const audio = (data: string, mimeType: string, annotations?: Annotations): AudioContent => ({
  type: 'audio',
  data,
  mimeType,
  ...(annotations ? { annotations } : {}),
});

export const textResource = (
  uri: string,
  value: string,
  mimeType?: string,
): TextResourceContents => ({ uri, text: value, ...(mimeType ? { mimeType } : {}) });

export const blobResource = (
  uri: string,
  blob: string,
  mimeType?: string,
): BlobResourceContents => ({ uri, blob, ...(mimeType ? { mimeType } : {}) });

export const embeddedResource = (
  resource: TextResourceContents | BlobResourceContents,
  annotations?: Annotations,
): EmbeddedResource => ({ type: 'resource', resource, ...(annotations ? { annotations } : {}) });

export const resourceLink = (
  uri: string,
  name: string,
  options: Omit<ResourceLink, 'type' | 'uri' | 'name'> = {},
): ResourceLink => ({ type: 'resource_link', uri, name, ...options });
