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

import { createApp } from '@newfoundcodes/helvetium-boot';
import { createMCPServer, mountMCP } from '@newfoundcodes/helvetium-mcp';

const app = createApp();
const mcp = createMCPServer({ name: 'boot-agent-api', version: '1.0.0' });

mcp.tool('server-status', () => ({ status: 'healthy', runtime: 'Helvetium Boot' }));
mcp.resource(
  'config://public',
  { name: 'Public configuration', mimeType: 'application/json' },
  () => ({ region: 'ap-southeast' }),
);

mountMCP(app, mcp, {
  path: '/mcp',
  allowedOrigins: ['https://agent.example'],
});

app.get('/health', (c) => c.json({ ok: true }));
export { app, mcp };
