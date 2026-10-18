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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPKCE,
  protectedResourceMetadata,
  protectedResourceMetadataPath,
  bearerChallenge,
  parseWWWAuthenticate,
  discoverProtectedResource,
  discoverAuthorizationServer,
  buildAuthorizationURL,
  validateAuthorizationResponseIssuer,
  bearerHeaders,
  appResourceUri,
  appToolMeta,
  appHTMLResource,
  createMCPServer,
  mountMCP,
  createMCPClient,
  MCPHTTPClientTransport,
} from '../dist/index.js';

test('PKCE uses S256 and creates verifier/challenge', async () => {
  const p = await createPKCE();

  assert.equal(p.method, 'S256');
  assert.ok(p.verifier.length >= 43);
  assert.ok(p.challenge.length > 20);
});

test('protected resource metadata requires authorization server', () =>
  assert.throws(() => protectedResourceMetadata('https://mcp', [])));

test('protected resource metadata path includes MCP endpoint path', () =>
  assert.equal(
    protectedResourceMetadataPath('https://x.example/public/mcp'),
    '/.well-known/oauth-protected-resource/public/mcp',
  ));

test('bearer challenge includes resource metadata and scopes', () => {
  const v = bearerChallenge('https://x/meta', { scopes: ['tools:read'] });

  assert.match(v, /resource_metadata=/);
  assert.match(v, /scope="tools:read"/);
});

test('WWW-Authenticate parser extracts resource metadata', () =>
  assert.equal(
    parseWWWAuthenticate('Bearer resource_metadata="https://x/meta", scope="a b"')
      .resource_metadata,
    'https://x/meta',
  ));

test('protected-resource discovery prefers WWW-Authenticate URL', async () => {
  const fetch = async (_) =>
    new Response(
      JSON.stringify({ resource: 'https://mcp', authorization_servers: ['https://auth'] }),
      { headers: { 'content-type': 'application/json' } },
    );

  const r = await discoverProtectedResource('https://mcp/mcp', {
    fetch,
    Authenticate: 'Bearer resource_metadata="https://mcp/custom-meta"',
  });

  assert.equal(r.url, 'https://mcp/custom-meta');
});

test('authorization server discovery validates issuer', async () => {
  const fetch = async () =>
    new Response(
      JSON.stringify({
        issuer: 'https://auth.example',
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        code_challenge_methods_supported: ['S256'],
      }),
    );

  const r = await discoverAuthorizationServer('https://auth.example', { fetch });
  assert.equal(r.issuer, 'https://auth.example');
});

test('authorization server discovery rejects issuer mismatch', async () => {
  const fetch = async () =>
    new Response(
      JSON.stringify({
        issuer: 'https://evil.example',
        authorization_endpoint: 'https://evil/authorize',
        token_endpoint: 'https://evil/token',
      }),
    );

  await assert.rejects(
    () => discoverAuthorizationServer('https://auth.example', { fetch }),
    /issuer mismatch/,
  );
});

test('authorization URL includes PKCE and resource indicator', async () => {
  const pkce = await createPKCE();
  const u = buildAuthorizationURL(
    {
      issuer: 'https://a',
      authorization_endpoint: 'https://a/auth',
      token_endpoint: 'https://a/token',
      code_challenge_methods_supported: ['S256'],
    },
    {
      clientId: 'client',
      redirectUri: 'http://localhost/cb',
      resource: 'https://mcp',
      scopes: ['tools:read'],
      pkce,
      state: 's',
    },
  );

  assert.equal(u.searchParams.get('resource'), 'https://mcp');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), 's');
});

test('authorization URL refuses server without S256 PKCE advertisement', async () => {
  const pkce = await createPKCE();
  assert.throws(
    () =>
      buildAuthorizationURL(
        {
          issuer: 'https://a',
          authorization_endpoint: 'https://a/auth',
          token_endpoint: 'https://a/token',
        },
        { clientId: 'c', redirectUri: 'http://localhost', resource: 'https://mcp', pkce },
      ),
    /PKCE/,
  );
});

test('authorization response issuer validation accepts matching iss', () =>
  assert.doesNotThrow(() =>
    validateAuthorizationResponseIssuer(
      {
        issuer: 'https://a',
        authorization_endpoint: 'https://a/auth',
        token_endpoint: 'https://a/token',
        authorization_response_iss_parameter_supported: true,
      },
      'http://localhost/?code=x&iss=https%3A%2F%2Fa',
    ),
  ));

test('authorization response issuer validation rejects mismatch', () =>
  assert.throws(
    () =>
      validateAuthorizationResponseIssuer(
        {
          issuer: 'https://a',
          authorization_endpoint: 'https://a/auth',
          token_endpoint: 'https://a/token',
        },
        'http://localhost/?iss=https%3A%2F%2Fevil',
      ),
    /issuer mismatch/,
  ));

test('bearerHeaders returns Authorization header', () =>
  assert.equal(new Headers(bearerHeaders('abc')).get('authorization'), 'Bearer abc'));

test('MCP Apps helper normalizes ui resource URI', () =>
  assert.equal(appResourceUri('weather/forecast'), 'ui://weather/forecast'));

test('MCP Apps tool metadata links UI resource', () =>
  assert.equal(appToolMeta('ui://x').ui.resourceUri, 'ui://x'));

test('MCP Apps HTML resource uses MCP app profile MIME type', () =>
  assert.match(appHTMLResource('ui://x', '<h1>x</h1>').mimeType, /mcp-app/));

test('mountMCP integrates with a Boot-like application', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
      return this;
    },

    get(path, handler) {
      routes.set(`GET ${path}`, handler);
      return this;
    },
  };

  const server = createMCPServer({ name: 'boot', version: '1' }).tool('echo', () => 'ok');
  mountMCP(app, server, { path: '/mcp', allowedOrigins: ['https://client'] });
  assert.ok(routes.has('POST /mcp'));

  const transport = new MCPHTTPClientTransport('https://boot.example/mcp', {
    fetch: async (_u, init) =>
      routes.get('POST /mcp')({
        request: new Request('https://boot.example/mcp', {
          ...init,
          headers: { ...Object.fromEntries(new Headers(init.headers)), origin: 'https://client' },
        }),
      }),
  });

  const client = createMCPClient(transport, { name: 'client', version: '1' });
  assert.equal((await client.callTool('echo')).content[0].text, 'ok');
});

test('mountMCP exposes RFC 9728 metadata route when authorization enabled', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
      return this;
    },

    get(path, handler) {
      routes.set(`GET ${path}`, handler);
      return this;
    },
  };

  const server = createMCPServer({ name: 'boot', version: '1' });
  const metadata = protectedResourceMetadata('https://boot.example/mcp', ['https://auth.example']);

  mountMCP(app, server, {
    path: '/mcp',
    authorization: { metadata, verify: () => ({ authorized: false }) },
  });
  assert.ok(routes.has('GET /.well-known/oauth-protected-resource/mcp'));

  const r = await routes.get('GET /.well-known/oauth-protected-resource/mcp')({
    request: new Request('https://boot.example/.well-known/oauth-protected-resource/mcp'),
  });
  assert.equal((await r.json()).authorization_servers[0], 'https://auth.example');
});

test('mountMCP returns bearer challenge for unauthorized request', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
      return this;
    },

    get(path, handler) {
      routes.set(`GET ${path}`, handler);
      return this;
    },
  };

  const server = createMCPServer({ name: 'boot', version: '1' });
  const metadata = protectedResourceMetadata('https://boot.example/mcp', ['https://auth.example']);

  mountMCP(app, server, {
    path: '/mcp',
    authorization: { metadata, verify: () => ({ authorized: false, scopes: ['mcp:use'] }) },
  });

  const r = await routes.get('POST /mcp')({
    request: new Request('https://boot.example/mcp', { method: 'POST' }),
  });

  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /mcp:use/);
});
