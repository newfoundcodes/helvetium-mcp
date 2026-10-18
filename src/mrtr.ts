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

export function inputRequired(
  inputRequests: Record<string, InputRequest>,
  requestState?: unknown,
): InputRequiredResult {
  return {
    resultType: 'input_required',
    inputRequests,
    ...(requestState === undefined ? {} : { requestState }),
  };
}

export const input = {
  elicit(params: Record<string, unknown>): InputRequest {
    return { method: 'elicitation/create', params };
  },

  sample(params: Record<string, unknown>): InputRequest {
    return { method: 'sampling/createMessage', params };
  },

  roots(params: Record<string, unknown> = {}): InputRequest {
    return { method: 'roots/list', params };
  },
};

export function inputResponse<T = unknown>(
  params: Record<string, unknown> | undefined,
  key: string,
): T | undefined {
  return (params as { _meta?: { inputResponses?: Record<string, unknown> } })?._meta
    ?.inputResponses?.[key] as T | undefined;
}

export function requestState<T = unknown>(
  params: Record<string, unknown> | undefined,
): T | undefined {
  return (params as { _meta?: { requestState?: unknown } })?._meta?.requestState as T | undefined;
}
