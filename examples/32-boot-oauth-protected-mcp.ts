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
import { createMCPServer, mountMCP, protectedResourceMetadata } from '@newfoundcodes/helvetium-mcp';

const app = createApp();
const server = createMCPServer({ name: 'protected-tools', version: '1.0.0' });
server.tool('private-status', () => ({ status: 'secret-ok' }));

const metadata = protectedResourceMetadata('https://api.example/mcp', ['https://auth.example'], {
  scopes_supported: ['mcp:tools'],
});
mountMCP(app, server, {
  path: '/mcp',
  authorization: {
    metadata,
    verify(request) {
      const authorized = request.headers.get('authorization') === 'Bearer demo';
      return { authorized, scopes: ['mcp:tools'], error: authorized ? undefined : 'invalid_token' };
    },
  },
});

export { app, server };
