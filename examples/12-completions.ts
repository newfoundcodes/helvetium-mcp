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

import { createMCPServer } from '@newfoundcodes/helvetium-mcp';

const server = createMCPServer({ name: 'completion-service', version: '1.0.0' });
server.completion(async (argument, ref) => {
  const candidates =
    ref.type === 'ref/prompt'
      ? ['security', 'performance', 'correctness', 'maintainability']
      : ['docs://architecture', 'docs://operations'];
  const values = candidates.filter((value) => value.startsWith(argument.value.toLowerCase()));
  return { values, total: values.length, hasMore: false };
});

export { server };
