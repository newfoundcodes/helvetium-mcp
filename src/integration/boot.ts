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

import { bearerChallenge, protectedResourceMetadataPath } from '../authorization.js';
import { createMCPHTTPHandler } from '../transport/http.js';
import type { MCPServer } from '../server.js';

export function createMCPBootHandler(
  server: MCPServer,
  options: MCPBootOptions = {},
): BootHandlerLike {
  const handler = createMCPHTTPHandler(server, options);
  return async (c) => {
    if (options.authorization) {
      const decision = await options.authorization.verify(c.request);
      if (!decision.authorized) {
        const endpoint = new URL(c.request.url);
        const metadataPath =
          options.authorization.metadataPath ??
          protectedResourceMetadataPath(new URL(options.path ?? '/mcp', endpoint));
        const metadataURL = new URL(metadataPath, endpoint).toString();
        const challenge = bearerChallenge(metadataURL, {
          scopes: decision.scopes,
          error: decision.error,
          errorDescription: decision.errorDescription,
        });
        return new Response(null, {
          status: decision.status ?? 401,
          headers: { 'www-authenticate': challenge },
        });
      }
    }

    return handler(c.request);
  };
}

export function mountMCP(
  app: BootAppLike,
  server: MCPServer,
  options: MCPBootOptions = {},
): BootAppLike {
  const path = options.path ?? '/mcp';

  app.post(path, createMCPBootHandler(server, { ...options, path }));
  app.get(
    path,
    () => new Response('Helvetium MCP Server', { headers: { 'content-type': 'text/plain' } }),
  );

  if (options.authorization) {
    const metadataPath =
      options.authorization.metadataPath ??
      protectedResourceMetadataPath(new URL(path, 'http://localhost'));
    app.get(
      metadataPath,
      (_) =>
        new Response(JSON.stringify(options.authorization!.metadata), {
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
        }),
    );

    if (metadataPath !== '/.well-known/oauth-protected-resource') {
      app.get(
        '/.well-known/oauth-protected-resource',
        (_) =>
          new Response(JSON.stringify(options.authorization!.metadata), {
            headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
          }),
      );
    }
  }

  return app;
}
