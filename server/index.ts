import { createApp } from './app.js';

const app = await createApp({ serveWeb: process.env.NODE_ENV === 'production' });

try {
  await app.listen({ port: 4400, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const close = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
