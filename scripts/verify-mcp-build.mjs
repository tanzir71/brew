import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createApp, nodeServices } from '../dist/targets/node/src/app.js';
import { openDatabase } from '../dist/targets/node/src/db/database.js';

export async function verifyMcpBuild() {
  const dir = await mkdtemp(join(tmpdir(), 'brew-mcp-build-'));
  const filename = join(dir, 'library.db');
  let app, client;
  const data = (result) => {
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent);
    return result.structuredContent;
  };
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  try {
    const database = openDatabase(filename);
    database.sqlite
      .prepare(
        "INSERT INTO feeds(url,title) VALUES('https://compiled.example.test/feed','Compiled MCP')",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO articles(feed_id,guid,hash,url,title,published_at,content_html) VALUES(1,'compiled-mcp','compiled-mcp','https://compiled.example.test/story','Compiled MCP story',?,'<p>Compiled content.</p>')",
      )
      .run(Date.now());
    app = await createApp({ database, logger: false, webmcp: true });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const token = nodeServices(app).agentAccess.create({
      name: 'Compiled client',
      scopes: 'write',
    }).token;
    client = new Client({ name: 'compiled-http-owner', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    assert.equal((await client.listTools()).tools.length, 12);
    const catalog = await globalThis.fetch(new URL('/api/webmcp/tools', base));
    assert.equal(catalog.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(
      (await catalog.json()).map((tool) => tool.name).sort(),
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
    );
    const webCall = async (name, args) => {
      const response = await globalThis.fetch(new URL('/api/webmcp/call', base), {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      });
      assert.equal(response.status, 200);
      return data(await response.json());
    };
    const webReceipt = await webCall('star', {
      id: 1,
      starred: true,
      confirm: true,
      request_id: 'compiled-webmcp-star-01',
    });
    assert.equal(typeof data(await call('get_item', { id: 1 })).starred_at, 'string');
    await webCall('undo', { undo_id: webReceipt.undo_id, confirm: true });
    assert.equal(data(await call('get_item', { id: 1 })).starred_at, null);
    assert.equal(data(await call('list_unread')).total, 1);
    assert.match(data(await call('get_item', { id: 1 })).markdown, /Compiled content/);
    const target = { kind: 'items', ids: [1] };
    const review = data(await call('mark_read', { target }));
    const request = {
      target,
      revision: review.revision,
      confirm: true,
      request_id: 'compiled-mcp-read-0001',
    };
    const receipt = data(await call('mark_read', request));
    assert.equal(typeof receipt.undo_id, 'number');
    await client.close();
    client = undefined;
    await app.close();
    app = undefined;
    // A new process opens the persisted journal outside cwd, recovers the same
    // receipt without repeating its mutation, and restores the actual article.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../dist/targets/node/src/index.js', import.meta.url)), 'mcp'],
      cwd: dir,
      env: {
        ...process.env,
        BREW_DB_PATH: filename,
        BREW_MCP_TOKEN: token,
        BREW_PUBLIC_URL: '',
        NODE_ENV: 'production',
      },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    client = new Client({ name: 'compiled-stdio-owner', version: '1' });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 12);
    const replay = data(await call('mark_read', request));
    assert.equal(replay.undo_id, receipt.undo_id);
    assert.equal(typeof data(await call('get_item', { id: 1 })).read_at, 'string');
    data(await call('undo', { undo_id: receipt.undo_id, confirm: true }));
    assert.equal(data(await call('get_item', { id: 1 })).read_at, null);
    assert.doesNotMatch(stderr, /incoming request|listening|Error:/);
  } finally {
    if (client) await client.close();
    if (app) await app.close();
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`])
      await rm(path, { force: true });
    await rmdir(dir);
  }
}
