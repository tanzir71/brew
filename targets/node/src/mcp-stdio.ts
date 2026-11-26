import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createBrewMcpServer } from '../../../packages/api/src/mcp.js';
import { createApp, nodeServices } from './app.js';

/** A local owner process: no socket, poller, scheduler, inbound mailbox, or SMTP startup. */
export async function runMcpStdio() {
  const app = await createApp({
    logger: false,
    publicUrl: process.env.BREW_PUBLIC_URL || undefined,
  });
  let closed: Promise<void> | undefined;
  const closeApp = () => (closed ??= app.close());
  const handle = serveStdio(() => {
    const server = createBrewMcpServer(nodeServices(app), { write: true });
    server.server.onclose = () => {
      void closeApp();
    };
    return server;
  });
  const close = async () => {
    await handle.close();
    await closeApp();
  };
  process.once('SIGINT', () => {
    void close();
  });
  process.once('SIGTERM', () => {
    void close();
  });
  process.stdin.once('end', () => {
    void close();
  });
}
