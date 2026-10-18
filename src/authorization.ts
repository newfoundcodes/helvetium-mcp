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

import { randomUUID } from './util.js';
import type { AuthorizationServerMetadata } from './types/public.js';

function base64url(bytes: Uint8Array): string {
  let raw = '';

  for (const b of bytes) {
    raw += String.fromCharCode(b);
  }

  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createPKCE(): Promise<PKCEPair> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const verifier = base64url(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge: base64url(digest), method: 'S256' };
}

export function protectedResourceMetadata(
  resource: string,
  authorizationServers: string[],
  options: Omit<ProtectedResourceMetadata, 'resource' | 'authorization_servers'> = {},
): ProtectedResourceMetadata {
  if (!authorizationServers.length) {
    throw new TypeError('At least one authorization server is required');
  }

  return { resource, authorization_servers: authorizationServers, ...options };
}

export function protectedResourceMetadataPath(mcpEndpoint: string | URL): string {
  const url = new URL(String(mcpEndpoint));
  const path = url.pathname === '/' ? '' : url.pathname.replace(/^\//, '');
  return path
    ? `/.well-known/oauth-protected-resource/${path}`
    : '/.well-known/oauth-protected-resource';
}

export function bearerChallenge(
  resourceMetadataUrl: string,
  options: { scopes?: string[]; error?: string; errorDescription?: string } = {},
): string {
  const parts = [`resource_metadata="${resourceMetadataUrl.replace(/"/g, '%22')}"`];
  if (options.scopes?.length) {
    parts.push(`scope="${options.scopes.join(' ')}"`);
  }

  if (options.error) {
    parts.push(`error="${options.error}"`);
  }

  if (options.errorDescription) {
    parts.push(`error_description="${options.errorDescription.replace(/"/g, "'")}"`);
  }

  return `Bearer ${parts.join(', ')}`;
}

export function parseWWWAuthenticate(value: string | null): Record<string, string> {
  if (!value) {
    return {};
  }

  const out: Record<string, string> = {};
  const body = value.replace(/^Bearer\s+/i, '');

  for (const match of body.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^,\s]+))/g)) {
    out[match[1]] = match[2] ?? match[3] ?? '';
  }

  return out;
}

export async function discoverProtectedResource(
  mcpEndpoint: string | URL,
  options: {
    fetch?: typeof fetch;
    wwwAuthenticate?: string | null;
    Authenticate?: string | null;
  } = {},
): Promise<{ metadata: ProtectedResourceMetadata; url: string }> {
  const f = options.fetch ?? fetch;
  const parsed = parseWWWAuthenticate(options.wwwAuthenticate ?? options.Authenticate ?? null);
  const candidates: string[] = [];

  if (parsed.resource_metadata) {
    candidates.push(parsed.resource_metadata);
  }

  const endpoint = new URL(String(mcpEndpoint));
  const path = protectedResourceMetadataPath(endpoint);
  candidates.push(new URL(path, endpoint).toString());

  if (path !== '/.well-known/oauth-protected-resource') {
    candidates.push(new URL('/.well-known/oauth-protected-resource', endpoint).toString());
  }

  for (const url of [...new Set(candidates)]) {
    const r = await f(url, { headers: { accept: 'application/json' } });
    if (!r.ok) {
      continue;
    }

    const metadata = (await r.json()) as ProtectedResourceMetadata;
    if (
      metadata.resource &&
      Array.isArray(metadata.authorization_servers) &&
      metadata.authorization_servers.length
    ) {
      return { metadata, url };
    }
  }

  throw new Error('Unable to discover MCP Protected Resource Metadata');
}

function issuerMetadataCandidates(issuer: string): string[] {
  const u = new URL(issuer),
    base = `${u.protocol}//${u.host}`,
    path = u.pathname.replace(/^\//, '');
  return path
    ? [
        `${base}/.well-known/oauth-authorization-server/${path}`,
        `${base}/.well-known/openid-configuration/${path}`,
        `${base}/${path}/.well-known/openid-configuration`,
      ]
    : [
        `${base}/.well-known/oauth-authorization-server`,
        `${base}/.well-known/openid-configuration`,
      ];
}

export async function discoverAuthorizationServer(
  issuer: string,
  options: { fetch?: typeof fetch } = {},
): Promise<AuthorizationServerMetadata> {
  const f = options.fetch ?? fetch;
  for (const url of issuerMetadataCandidates(issuer)) {
    const r = await f(url, { headers: { accept: 'application/json' } });
    if (!r.ok) {
      continue;
    }

    const metadata = (await r.json()) as AuthorizationServerMetadata;
    if (metadata.issuer !== issuer) {
      throw new Error(
        `Authorization server issuer mismatch: expected ${issuer}, got ${metadata.issuer}`,
      );
    }

    if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
      throw new Error('Authorization server metadata is incomplete');
    }

    return metadata;
  }

  throw new Error(`Unable to discover authorization server metadata for ${issuer}`);
}

export function buildAuthorizationURL(
  metadata: AuthorizationServerMetadata,
  options: AuthorizationRequestOptions,
): URL {
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('Authorization server does not advertise PKCE S256 support');
  }

  const url = new URL(metadata.authorization_endpoint);
  const p = url.searchParams;

  p.set('response_type', 'code');
  p.set('client_id', options.clientId);
  p.set('redirect_uri', options.redirectUri);
  p.set('code_challenge', options.pkce.challenge);
  p.set('code_challenge_method', 'S256');
  p.set('resource', options.resource);
  p.set('state', options.state ?? randomUUID());

  if (options.scopes?.length) {
    p.set('scope', options.scopes.join(' '));
  }

  for (const [k, v] of Object.entries(options.extra ?? {})) {
    p.set(k, v);
  }

  return url;
}

export function validateAuthorizationResponseIssuer(
  metadata: AuthorizationServerMetadata,
  responseURL: string | URL,
): void {
  const iss = new URL(String(responseURL)).searchParams.get('iss');
  if (metadata.authorization_response_iss_parameter_supported === true && !iss) {
    throw new Error('Authorization response is missing required iss parameter');
  }

  if (iss !== null && iss !== metadata.issuer) {
    throw new Error(
      `Authorization response issuer mismatch: expected ${metadata.issuer}, got ${iss}`,
    );
  }
}

export async function exchangeAuthorizationCode(
  metadata: AuthorizationServerMetadata,
  options: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
    resource: string;
    fetch?: typeof fetch;
    clientSecret?: string;
  },
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code_verifier: options.verifier,
    resource: options.resource,
  });
  if (options.clientSecret) {
    body.set('client_secret', options.clientSecret);
  }

  const r = await (options.fetch ?? fetch)(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const data = (await r.json()) as Record<string, unknown>;

  if (!r.ok) {
    throw new Error(`Token exchange failed: ${String(data.error ?? r.status)}`);
  }

  return data;
}

export async function dynamicClientRegistration(
  metadata: AuthorizationServerMetadata,
  document: Record<string, unknown>,
  options: { fetch?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  if (!metadata.registration_endpoint) {
    throw new Error('Authorization server has no registration_endpoint');
  }

  const r = await (options.fetch ?? fetch)(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(document),
  });
  const data = (await r.json()) as Record<string, unknown>;

  if (!r.ok) {
    throw new Error(`Dynamic client registration failed: ${String(data.error ?? r.status)}`);
  }

  return data;
}

export function bearerHeaders(accessToken: string): HeadersInit {
  return { authorization: `Bearer ${accessToken}` };
}
