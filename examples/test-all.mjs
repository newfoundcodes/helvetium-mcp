#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

const examplesDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(examplesDir, '..');
const bootDir = resolve(packageDir, '..', 'helvetium-boot');
const mcpImport = pathToFileURL(join(packageDir, 'dist', 'index.js')).href;
const bootImport = pathToFileURL(join(bootDir, 'dist', 'index.js')).href;

const { createMCPHTTPHandler } = await import(`${mcpImport}?test-runner`);
const { createMCPServer } = await import(`${mcpImport}?test-runner-server`);

const protocolVersion = '2026-07-28';
const clientInfo = { name: 'example-test-runner', version: '1.0.0' };

function metadata(extra = {}) {
  return {
    'io.modelcontextprotocol/protocolVersion': protocolVersion,
    'io.modelcontextprotocol/clientInfo': clientInfo,
    'io.modelcontextprotocol/clientCapabilities': {},
    ...extra,
  };
}

function request(method, params = {}, extraMeta = {}) {
  return {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1_000_000),
    method,
    params: { ...params, _meta: metadata(extraMeta) },
  };
}

async function dispatch(server, method, params = {}, extraMeta = {}) {
  const response = await server.dispatch(request(method, params, extraMeta));
  assert(response, `${method} did not return a response`);
  assert(!response.error, `${method} returned ${JSON.stringify(response.error)}`);
  return response.result;
}

function assertText(result, expected) {
  assert(
    result.content?.some((item) => item.type === 'text' && item.text.includes(expected)),
    `expected text content containing ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`,
  );
}

async function httpRequest(handler, method, params = {}, options = {}) {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: options.accept ?? 'application/json',
    'MCP-Protocol-Version': protocolVersion,
    'Mcp-Method': method,
    ...(options.headers ?? {}),
  });

  const response = await handler(
    new Request(options.url ?? 'http://example.test/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify(request(method, params, options.meta)),
      signal: options.signal,
    }),
  );
  return response;
}

async function jsonHTTP(handler, method, params = {}, options = {}) {
  const response = await httpRequest(handler, method, params, options);
  const body = await response.json();

  assert.equal(
    response.status,
    options.status ?? 200,
    `${method} returned HTTP ${response.status}`,
  );
  assert(!body.error, `${method} returned ${JSON.stringify(body.error)}`);
  return body.result;
}

async function parseSSE(response) {
  const text = await response.text();
  return text
    .split(/\n\n/)
    .map((event) => event.match(/^data:\s*(.+)$/m)?.[1])
    .filter(Boolean)
    .map((data) => JSON.parse(data));
}

async function transpileExamples() {
  const directory = await mkdtemp(join(tmpdir(), 'helvetium-mcp-examples-'));
  const files = (await readdir(examplesDir)).filter((file) => /^\d+-.*\.ts$/.test(file));

  for (const file of files) {
    const source = await readFile(join(examplesDir, file), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        sourceMap: false,
      },
      fileName: file,
    }).outputText;

    const rewritten = output
      .replaceAll("'@newfoundcodes/helvetium-mcp'", JSON.stringify(mcpImport))
      .replaceAll('"@newfoundcodes/helvetium-mcp"', JSON.stringify(mcpImport))
      .replaceAll("'@newfoundcodes/helvetium-boot'", JSON.stringify(bootImport))
      .replaceAll('"@newfoundcodes/helvetium-boot"', JSON.stringify(bootImport));

    await writeFile(join(directory, file.replace(/\.ts$/, '.mjs')), rewritten);
  }

  return directory;
}

async function load(directory, name) {
  return import(
    `${pathToFileURL(join(directory, name.replace(/\.ts$/, '.mjs'))).href}?run=${Date.now()}-${Math.random()}`
  );
}

async function withFetch(fetcher, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;

  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

function serverFetch(server) {
  const handler = createMCPHTTPHandler(server);
  return (input, init) => handler(new Request(input, init));
}

async function stdioRoundTrip(message) {
  const module = await load(compiledDir, '30-stdio-server.ts');
  const output = [];

  await module.run(
    (async function* () {
      yield `${JSON.stringify(message)}\n`;
    })(),
    {
      write(chunk) {
        output.push(String(chunk));
      },
    },
  );

  assert.equal(output.length, 1, `stdio returned ${output.length} messages`);
  return JSON.parse(output[0]);
}

async function testStdioClient(server) {
  const module = await load(compiledDir, '31-stdio-client.ts');
  const input = new AsyncQueue();
  const output = {
    write(chunk) {
      const message = JSON.parse(String(chunk));
      void server.dispatch(message).then((response) => {
        if (response) {
          input.push(`${JSON.stringify(response)}\n`);
        }
      });
    },
    end() {
      input.end();
    },
  };

  const client = module.connect(input, output);
  const tools = await client.listTools();
  const result = await client.callTool('echo', { value: 'hello' });

  await client.close();

  assert(tools.tools.some((tool) => tool.name === 'echo'));
  assertText(result, 'hello');
}

class AsyncQueue {
  values = [];
  waiters = [];
  closed = false;

  push(value) {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  end() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  next() {
    if (this.values.length) {
      return Promise.resolve({ value: this.values.shift(), done: false });
    }

    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise((resolveNext) => this.waiters.push(resolveNext));
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

const tests = new Map();
let compiledDir;

tests.set('01-basic-tool-server.ts', async (module) => {
  const list = await dispatch(module.server, 'tools/list');
  assert.deepEqual(
    list.tools.map((tool) => tool.name),
    ['add'],
  );

  const result = await dispatch(module.server, 'tools/call', {
    name: 'add',
    arguments: { a: 2, b: 3 },
  });
  assert.deepEqual(result.structuredContent, { sum: 5 });
});

tests.set('02-fetch-http-endpoint.ts', async (module) => {
  const response = await module.fetch(
    new Request('http://example.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        origin: 'https://agent.example',
        'MCP-Protocol-Version': protocolVersion,
        'Mcp-Method': 'tools/call',
      },
      body: JSON.stringify(request('tools/call', { name: 'ping', arguments: {} })),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-service'), 'helvetium-mcp');
  assertText((await response.json()).result, 'pong');

  const forbidden = await module.fetch(
    new Request('http://example.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request('tools/list')),
    }),
  );
  assert.equal(forbidden.status, 403);
});

tests.set('03-helvetium-boot-mount.ts', async (module) => {
  const result = await (
    await module.app.fetch(
      new Request('http://example.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          origin: 'https://agent.example',
          'MCP-Protocol-Version': protocolVersion,
          'Mcp-Method': 'tools/call',
        },
        body: JSON.stringify(request('tools/call', { name: 'server-status', arguments: {} })),
      }),
    )
  ).json();
  assert.deepEqual(result.result.structuredContent, {
    status: 'healthy',
    runtime: 'Helvetium Boot',
  });

  const health = await module.app.fetch(new Request('http://example.test/health'));
  assert.deepEqual(await health.json(), { ok: true });
});

tests.set('04-http-client-agent.ts', async (module) => {
  const backend = createMCPServer({ name: 'client-backend', version: '1.0.0' });
  backend.tool('ping', () => 'pong');

  const result = await withFetch(serverFetch(backend), () => module.inspectServer());
  assert.equal(result.server.name, 'client-backend');
  assert(result.tools.some((tool) => tool.name === 'ping'));
});

tests.set('05-tool-routing-headers.ts', async (module) => {
  const handler = createMCPHTTPHandler(module.server);
  const result = await jsonHTTP(
    handler,
    'tools/call',
    {
      name: 'lookup-account',
      arguments: { tenant: 'acme', accountId: 'acct-7' },
    },
    { headers: { 'Mcp-Param-Tenant': 'acme' } },
  );

  assert.deepEqual(result.structuredContent, {
    tenant: 'acme',
    accountId: 'acct-7',
    state: 'active',
  });
});

tests.set('06-structured-tool-output.ts', async (module) => {
  const result = await dispatch(module.server, 'tools/call', {
    name: 'inventory-level',
    arguments: { sku: 'SKU-42' },
  });

  assertText(result, 'Inventory checked for SKU-42');
  assert.deepEqual(result.structuredContent, { sku: 'SKU-42', available: 24 });
});

tests.set('07-tool-domain-errors.ts', async (module) => {
  const ok = await dispatch(module.server, 'tools/call', {
    name: 'cancel-order',
    arguments: { id: 'open-1' },
  });
  assert.deepEqual(ok.structuredContent, { cancelled: true, id: 'open-1' });

  const locked = await dispatch(module.server, 'tools/call', {
    name: 'cancel-order',
    arguments: { id: 'locked' },
  });
  assert.equal(locked.isError, true);
  assert.deepEqual(locked.structuredContent, { code: 'ORDER_LOCKED', id: 'locked' });
});

tests.set('08-paginated-tool-catalog.ts', async (module) => {
  const names = [];
  let cursor;

  do {
    const page = await dispatch(module.server, 'tools/list', cursor ? { cursor } : {});
    names.push(...page.tools.map((tool) => tool.name));

    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(names.length, 20);
  assert.deepEqual(
    names,
    Array.from({ length: 20 }, (_, i) => `operation-${String(i + 1).padStart(2, '0')}`),
  );
});

tests.set('09-static-resources.ts', async (module) => {
  const result = await dispatch(module.server, 'resources/read', { uri: 'docs://architecture' });

  assert(result.contents[0].text.includes('# Architecture'));
  assert(result.contents[0].text.includes('Helvetium Boot'));
});

tests.set('10-resource-templates.ts', async (module) => {
  const result = await dispatch(module.server, 'resources/read', { uri: 'customer://123/profile' });
  assert.deepEqual(JSON.parse(result.contents[0].text), {
    id: '123',
    displayName: 'Customer 123',
    tier: 'standard',
  });
});

tests.set('11-prompts.ts', async (module) => {
  const result = await dispatch(module.server, 'prompts/get', {
    name: 'review-code',
    arguments: { language: 'TypeScript', focus: 'security' },
  });
  assert.equal(result.messages[0].content.text, 'Review this TypeScript code. Focus on security.');
});

tests.set('12-completions.ts', async (module) => {
  const result = await dispatch(module.server, 'completion/complete', {
    ref: { type: 'ref/prompt', name: 'review-code' },
    argument: { name: 'focus', value: 'sec' },
  });

  assert.deepEqual(result.completion.values, ['security']);
});

tests.set('13-progress-streaming.ts', async (module) => {
  const handler = createMCPHTTPHandler(module.server);
  const response = await httpRequest(
    handler,
    'tools/call',
    { name: 'reindex', arguments: {} },
    {
      accept: 'text/event-stream',
      meta: { progressToken: 'reindex-1' },
    },
  );
  const events = await parseSSE(response);

  assert.deepEqual(
    events
      .filter((event) => event.method === 'notifications/progress')
      .map((event) => event.params.message),
    ['scan', 'normalize', 'index', 'commit'],
  );
  assert.equal(events.at(-1).result.structuredContent.indexed, 4);
});

tests.set('14-request-scoped-logging.ts', async (module) => {
  const handler = createMCPHTTPHandler(module.server);
  const response = await httpRequest(
    handler,
    'tools/call',
    { name: 'import-data', arguments: {} },
    {
      accept: 'text/event-stream',
      meta: { 'io.modelcontextprotocol/logLevel': 'info' },
    },
  );
  const events = await parseSSE(response);

  assert.deepEqual(
    events
      .filter((event) => event.method === 'notifications/message')
      .map((event) => event.params.data),
    [{ stage: 'begin' }, { skippedRows: 2 }, { stage: 'complete' }],
  );
  assert.deepEqual(events.at(-1).result.structuredContent, { imported: 98, skipped: 2 });
});

tests.set('15-subscriptions.ts', async (module) => {
  const handler = createMCPHTTPHandler(module.server);
  const controller = new AbortController();
  const response = await httpRequest(
    handler,
    'subscriptions/listen',
    {
      notifications: { resourceSubscriptions: ['status://cluster'] },
    },
    { accept: 'text/event-stream', signal: controller.signal },
  );

  const reader = response.body.getReader();
  const firstChunk = (await reader.read()).value;
  const firstData = new TextDecoder().decode(firstChunk).match(/^data:\s*(.+)$/m)?.[1];
  assert(firstData, 'subscription did not return an acknowledgement');

  const first = JSON.parse(firstData);
  assert.equal(first.method, 'notifications/subscriptions/acknowledged');

  module.publishClusterChange();

  const updateChunk = await reader.read();
  const updateText = new TextDecoder().decode(updateChunk.value);

  assert(updateText.includes('notifications/resources/updated'));
  assert(updateText.includes('status://cluster'));

  controller.abort();
  await reader.cancel();
});

tests.set('16-mrtr-elicitation.ts', async (module) => {
  const first = await dispatch(
    module.server,
    'tools/call',
    { name: 'create-profile', arguments: {} },
    { elicitation: { form: {} } },
  );
  assert.equal(first.resultType, 'input_required');

  const second = await dispatch(
    module.server,
    'tools/call',
    { name: 'create-profile', arguments: {} },
    {
      elicitation: { form: {} },
      inputResponses: { profile: { action: 'accept', content: { name: 'Ada' } } },
    },
  );

  assert.deepEqual(second.structuredContent, { created: true, name: 'Ada' });
});

tests.set('17-mrtr-sampling-compat.ts', async (module) => {
  const first = await dispatch(
    module.server,
    'tools/call',
    { name: 'draft-summary', arguments: {} },
    { sampling: {} },
  );
  assert.equal(first.resultType, 'input_required');

  const sample = { role: 'assistant', content: { type: 'text', text: 'Summary' } };
  const second = await dispatch(
    module.server,
    'tools/call',
    { name: 'draft-summary', arguments: {} },
    { sampling: {}, inputResponses: { sample } },
  );
  assert.deepEqual(second.structuredContent, { acceptedSample: sample });
});

tests.set('18-mrtr-roots-compat.ts', async (module) => {
  const first = await dispatch(
    module.server,
    'tools/call',
    { name: 'workspace-roots', arguments: {} },
    { roots: {} },
  );
  assert.equal(first.resultType, 'input_required');

  const roots = [{ uri: 'file:///workspace' }];
  const second = await dispatch(
    module.server,
    'tools/call',
    { name: 'workspace-roots', arguments: {} },
    { roots: {}, inputResponses: { roots: { roots } } },
  );
  assert.deepEqual(second.structuredContent, { roots });
});

tests.set('19-long-running-task.ts', async (module) => {
  const first = await dispatch(module.server, 'tools/call', {
    name: 'generate-report',
    arguments: {},
  });
  assert.equal(first.resultType, 'task');

  const task = await dispatch(module.server, 'tasks/get', { taskId: first.taskId });
  assert.equal(task.status, 'completed');
  assert.equal(task.result.reportUrl, 'https://reports.example/monthly.pdf');
});

tests.set('20-task-input-required.ts', async (module) => {
  const first = await dispatch(module.server, 'tools/call', { name: 'deploy', arguments: {} });
  assert.equal(first.resultType, 'task');

  const task = await dispatch(module.server, 'tasks/get', { taskId: first.taskId });
  assert.equal(task.status, 'input_required');
  assert(task.inputRequests.approval);

  const updated = await dispatch(module.server, 'tasks/update', {
    taskId: first.taskId,
    inputResponses: { approval: { action: 'accept', content: { approved: true } } },
  });
  assert.equal(updated.status, 'working');
});

tests.set('21-mcp-app-ui.ts', async (module) => {
  const resources = await dispatch(module.server, 'resources/list');
  assert(resources.resources.some((resource) => resource.uri === 'ui://dashboard'));

  const resource = await dispatch(module.server, 'resources/read', { uri: 'ui://dashboard' });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert(resource.contents[0].text.includes('Service dashboard'));
});

tests.set('22-custom-extension.ts', async (module) => {
  const discovery = await dispatch(module.server, 'server/discover');
  assert(discovery.capabilities.extensions['com.newfoundcodes/audit']);

  const result = await dispatch(module.server, 'audit/query', { actor: 'ada' });
  assert.deepEqual(result.events, [{ id: 'evt-1', actor: 'ada' }]);
});

tests.set('23-media-content.ts', async (module) => {
  const result = await dispatch(module.server, 'tools/call', {
    name: 'media-preview',
    arguments: {},
  });

  assert.deepEqual(
    result.content.map((item) => item.type),
    ['text', 'image', 'audio'],
  );
  assert.equal(result.content[1].mimeType, 'image/png');
  assert.equal(result.content[2].mimeType, 'audio/wav');
});

tests.set('24-embedded-resource-content.ts', async (module) => {
  const result = await dispatch(module.server, 'tools/call', {
    name: 'read-runbook',
    arguments: {},
  });

  assert.equal(result.content[0].type, 'resource');
  assert.equal(result.content[0].resource.uri, 'runbook://incident');
  assert.equal(result.content[1].type, 'resource_link');
});

tests.set('25-client-cache.ts', async (module) => {
  const backend = (await load(compiledDir, '08-paginated-tool-catalog.ts')).server;
  const result = await withFetch(serverFetch(backend), () => module.loadCatalog());

  assert.deepEqual(result.first.tools, result.cached.tools);
  assert.deepEqual(result.first.tools, result.refreshed.tools);
});

tests.set('26-protected-resource-metadata.ts', async (module) => {
  assert.equal(module.metadata.resource, 'https://api.example/mcp');
  assert.deepEqual(module.metadata.authorization_servers, ['https://auth.example']);
  assert.equal(module.wellKnownPath, '/.well-known/oauth-protected-resource/mcp');
});

tests.set('27-oauth-discovery.ts', async (module) => {
  await withFetch(
    async (input) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource')) {
        return Response.json({
          resource: 'https://api.example/mcp',
          authorization_servers: ['https://auth.example'],
        });
      }

      return Response.json({
        issuer: 'https://auth.example',
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
      });
    },
    async () => {
      const result = await module.discoverAuthentication();

      assert.equal(result.protectedResource.metadata.resource, 'https://api.example/mcp');
      assert.equal(result.authorizationServer.issuer, 'https://auth.example');
    },
  );
});

tests.set('28-pkce-authorization.ts', async (module) => {
  const result = await module.beginLogin();
  const url = new URL(result.url);

  assert.equal(url.searchParams.get('client_id'), 'agent-client');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('resource'), 'https://api.example/mcp');
  assert.equal(url.searchParams.get('scope'), 'mcp:tools');

  assert(result.pkce.verifier && result.pkce.challenge);
});

tests.set('29-token-exchange.ts', async (module) => {
  const result = await withFetch(
    async () => Response.json({ access_token: 'test-token', token_type: 'Bearer' }),
    () => module.finishLogin('code-1', 'verifier-1'),
  );
  assert.deepEqual(result, { access_token: 'test-token', token_type: 'Bearer' });
});

tests.set('30-stdio-server.ts', async () => {
  const response = await stdioRoundTrip(
    request('tools/call', { name: 'echo', arguments: { value: 'hello' } }),
  );
  assertText(response.result, 'hello');
});

tests.set('31-stdio-client.ts', async () => {
  const server = createMCPServer({ name: 'stdio-test-server', version: '1.0.0' });
  server.tool('echo', ({ value }) => String(value ?? ''));

  await testStdioClient(server);
});

tests.set('32-boot-oauth-protected-mcp.ts', async (module) => {
  const metadata = await module.app.fetch(
    new Request('http://example.test/.well-known/oauth-protected-resource/mcp'),
  );
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).resource, 'https://api.example/mcp');

  const unauthorized = await module.app.fetch(
    new Request('http://example.test/mcp', { method: 'POST' }),
  );
  assert.equal(unauthorized.status, 401);

  const authorized = await module.app.fetch(
    new Request('http://example.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: 'Bearer demo',
        'MCP-Protocol-Version': protocolVersion,
        'Mcp-Method': 'tools/call',
      },
      body: JSON.stringify(request('tools/call', { name: 'private-status', arguments: {} })),
    }),
  );

  assert.deepEqual((await authorized.json()).result.structuredContent, { status: 'secret-ok' });
});

tests.set('33-multiple-boot-mcp-endpoints.ts', async (module) => {
  const admin = await module.app.fetch(
    new Request('http://example.test/mcp/admin', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'MCP-Protocol-Version': protocolVersion,
        'Mcp-Method': 'tools/call',
      },
      body: JSON.stringify(request('tools/call', { name: 'rotate-key', arguments: {} })),
    }),
  );
  assert.deepEqual((await admin.json()).result.structuredContent, { rotated: true });

  const publicResponse = await module.app.fetch(
    new Request('http://example.test/mcp/public', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'MCP-Protocol-Version': protocolVersion,
        'Mcp-Method': 'tools/call',
      },
      body: JSON.stringify(request('tools/call', { name: 'status', arguments: {} })),
    }),
  );
  assert.deepEqual((await publicResponse.json()).result.structuredContent, { status: 'ok' });
});

tests.set('34-client-progress-and-logs.ts', async (module) => {
  const serverModule = await load(compiledDir, '14-request-scoped-logging.ts');
  const result = await withFetch(serverFetch(serverModule.server), () => module.runImport());

  assert.deepEqual(result.result.structuredContent, { imported: 98, skipped: 2 });
  assert.equal(
    result.notifications.filter((item) => item.method === 'notifications/message').length,
    3,
  );
});

tests.set('35-resource-change-stream.ts', async (module) => {
  const serverModule = await load(compiledDir, '15-subscriptions.ts');
  const controller = new AbortController();
  const promise = withFetch(serverFetch(serverModule.server), () =>
    module.watchCluster(controller.signal),
  );

  await new Promise((resolveNext) => setTimeout(resolveNext, 20));
  serverModule.publishClusterChange();

  await new Promise((resolveNext) => setTimeout(resolveNext, 20));
  controller.abort();

  const updates = await promise;
  assert.deepEqual(updates, ['status://cluster']);
});

tests.set('36-client-automatic-elicitation.ts', async (module) => {
  const serverModule = await load(compiledDir, '16-mrtr-elicitation.ts');
  const result = await withFetch(serverFetch(serverModule.server), () => module.createProfile());

  assert.deepEqual(result.structuredContent, { created: true, name: 'Ada' });
});

tests.set('37-task-aware-agent.ts', async (module) => {
  const serverModule = await load(compiledDir, '19-long-running-task.ts');
  const result = await withFetch(serverFetch(serverModule.server), () => module.generateReport());

  assert.equal(result.reportUrl, 'https://reports.example/monthly.pdf');
});

tests.set('38-custom-rpc-method.ts', async (module) => {
  const serverModule = await load(compiledDir, '22-custom-extension.ts');
  const result = await withFetch(serverFetch(serverModule.server), () => module.queryAudit('ada'));

  assert.deepEqual(result.events, [{ id: 'evt-1', actor: 'ada' }]);
});

tests.set('39-agent-resource-tool-workflow.ts', async (module) => {
  const backend = createMCPServer({ name: 'support-backend', version: '1.0.0' });
  backend.resource(
    'docs://support-policy',
    { name: 'Support policy', mimeType: 'text/markdown' },
    () => '# Support policy',
  );
  backend.tool('resolve-case', ({ caseId }) => ({ caseId, resolved: true }));

  const result = await withFetch(serverFetch(backend), () => module.resolveSupportCase('CASE-1'));
  assert(result.policy.contents[0].text.includes('Support policy'));
  assert.deepEqual(result.result.structuredContent, { caseId: 'CASE-1', resolved: true });
});

tests.set('40-production-boot-server.ts', async (module) => {
  const response = await module.app.fetch(
    new Request('http://example.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        origin: 'https://agent.example',
        authorization: 'Bearer test-token',
        'MCP-Protocol-Version': protocolVersion,
        'Mcp-Method': 'tools/call',
      },
      body: JSON.stringify(request('tools/call', { name: 'health', arguments: {} })),
    }),
  );

  assert.deepEqual((await response.json()).result.structuredContent, { healthy: true });
});

compiledDir = await transpileExamples();

const failures = [];
const numberedExamples = (await readdir(examplesDir)).filter((file) => /^\d+-.*\.ts$/.test(file));
const untestedExamples = numberedExamples.filter((file) => !tests.has(file));

assert.equal(untestedExamples.length, 0, `missing tests for: ${untestedExamples.join(', ')}`);
assert.equal(tests.size, numberedExamples.length, 'test count does not match example count');

try {
  for (const [name, test] of tests) {
    process.stdout.write(`- ${name} ... `);
    try {
      await test(await load(compiledDir, name));
      console.log('ok');
    } catch (error) {
      failures.push({ name, error });
      console.log('FAIL');
      console.error(`  ${error instanceof Error ? error.stack : String(error)}`);
    }
  }
} finally {
  await rm(compiledDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} example test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${tests.size} example tests passed.`);
}
