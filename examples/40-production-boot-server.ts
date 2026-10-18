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
const mcp = createMCPServer({
  name: 'production-agent-api',
  version: '1.0.0',
  title: 'Production Agent API',
  description: 'Tools and resources exposed by the production Helvetium Boot service.',
  ttlMs: 15_000,
  cacheScope: 'private',
  pageSize: 50,
});

mcp.tool('health', { annotations: { readOnlyHint: true, idempotentHint: true } }, () => ({
  healthy: true,
}));
mcp.resource(
  'service://runbook',
  { name: 'Service runbook', mimeType: 'text/markdown' },
  () => `# Runbook\n`,
);
mcp.prompt('incident-triage', () => [
  { role: 'user', content: { type: 'text', text: 'Triage the current incident.' } },
]);

const metadata = protectedResourceMetadata(
  'https://api.example/mcp',
  ['https://identity.example'],
  { scopes_supported: ['mcp'] },
);
mountMCP(app, mcp, {
  path: '/mcp',
  requireOrigin: true,
  allowedOrigins: ['https://agent.example'],
  authorization: {
    metadata,
    verify: (request) => ({ authorized: request.headers.has('authorization'), scopes: ['mcp'] }),
  },
});

export { app, mcp };
