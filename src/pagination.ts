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

import { invalidParams } from './errors.js';

function base64url(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function unbase64url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

export function encodeCursor(offset: number): Cursor {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('offset must be a non-negative safe integer');
  }

  return base64url(JSON.stringify({ o: offset }));
}

export function decodeCursor(cursor?: Cursor): number {
  if (!cursor) {
    return 0;
  }

  try {
    const parsed = JSON.parse(unbase64url(cursor));
    if (!Number.isSafeInteger(parsed?.o) || parsed.o < 0) {
      throw new Error();
    }

    return parsed.o;
  } catch {
    throw invalidParams('Invalid cursor');
  }
}

export function paginate<T>(
  items: readonly T[],
  cursor?: Cursor,
  pageSize = 50,
): { items: T[]; nextCursor?: Cursor } {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new TypeError('pageSize must be a positive safe integer');
  }

  const start = decodeCursor(cursor);
  if (start > items.length) {
    throw invalidParams('Cursor is out of range');
  }

  const page = items.slice(start, start + pageSize);
  const next = start + page.length < items.length ? encodeCursor(start + page.length) : undefined;
  return { items: page, ...(next ? { nextCursor: next } : {}) };
}
