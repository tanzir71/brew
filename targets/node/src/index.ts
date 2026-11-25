import { smtpConfigFromEnv } from './outbound-config.js';
import { createApp } from './app.js';
import { inboundConfigFromEnv } from './inbound-config.js';

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
