import { smtpConfigFromEnv } from './outbound-config.js';
import { createApp } from './app.js';
import { inboundConfigFromEnv } from './inbound-config.js';

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === 'mcp' || args[0] === '--mcp')) {
  try {
    await (await import('./mcp-stdio.js')).runMcpStdio();
  } catch {
    console.error('Could not start Brew MCP. Check the database path and instance configuration.');
    process.exitCode = 1;
  }
} else if (args.length) {
  console.error('Usage: node dist/targets/node/src/index.js [mcp]');
  process.exitCode = 2;
} else {
  const app = await createApp({
    serveWeb: process.env.NODE_ENV === 'production',
    publicUrl: process.env.BREW_PUBLIC_URL || undefined,
    startPoller: true,
    smtp: smtpConfigFromEnv(process.env),
    inbound: inboundConfigFromEnv(process.env),
  });

  try {
    await app.listen({ port: 4400, host: '127.0.0.1' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const close = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
