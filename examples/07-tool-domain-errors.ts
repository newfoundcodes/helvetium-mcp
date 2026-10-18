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

import { createMCPServer, MCPToolError } from '@newfoundcodes/helvetium-mcp';

const server = createMCPServer({ name: 'orders', version: '1.0.0' });
server.tool(
  'cancel-order',
  {
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  ({ id }) => {
    if (id === 'locked') {
      throw new MCPToolError('Order can no longer be cancelled', {
        structuredContent: { code: 'ORDER_LOCKED', id },
      });
    }

    return { cancelled: true, id };
  },
);

export { server };
