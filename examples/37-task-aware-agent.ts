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

import { createMCPClient, MCPHTTPClientTransport } from '@newfoundcodes/helvetium-mcp';

const client = createMCPClient(new MCPHTTPClientTransport('https://api.example/mcp'), {
  name: 'task-agent',
  version: '1.0.0',
  elicitation: async () => ({ action: 'accept', content: { approved: true } }),
});

export async function generateReport() {
  return client.callToolAndWait(
    'generate-report',
    {},
    {
      pollIntervalMs: 250,
      maxPolls: 100,
    },
  );
}
