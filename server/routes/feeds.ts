import type { FastifyInstance } from 'fastify';
import type { BrewDatabase } from '../db/database.js';
import { FeedService } from '../services/feed-service.js';

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
};

export function registerFeedRoutes(app: FastifyInstance, database: BrewDatabase, fetcher?: typeof fetch): void {
  const service = new FeedService(database, fetcher);
  app.get('/api/feeds', async () => service.listFeeds());
  app.get('/api/folders', async () => service.listFolders());
  app.post<{ Body: { url?: unknown } }>('/api/feeds/discover', async (request, reply) => {
    try { return { candidates: await service.discover(requiredText(request.body?.url, 'url')) }; }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Discovery failed' }); }
  });
  app.post<{ Body: { url?: unknown; folderId?: unknown } }>('/api/feeds', async (request, reply) => {
    try { return reply.code(201).send(await service.add(requiredText(request.body?.url, 'url'), typeof request.body?.folderId === 'number' ? request.body.folderId : null)); }
    catch (error) { const message = error instanceof Error ? error.message : 'Could not add feed'; return reply.code(message.includes('UNIQUE constraint') ? 409 : 400).send({ error: message.includes('UNIQUE constraint') ? 'Feed already exists' : message }); }
  });
  app.patch<{ Params: { id: string }; Body: { title?: unknown; folderId?: unknown } }>('/api/feeds/:id', async (request, reply) => {
    try { const row = service.renameFeed(Number(request.params.id), requiredText(request.body?.title, 'title'), request.body.folderId === null || typeof request.body.folderId === 'number' ? request.body.folderId : undefined); return row ?? reply.code(404).send({ error: 'Feed not found' }); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid feed' }); }
  });
  app.delete<{ Params: { id: string } }>('/api/feeds/:id', async (request, reply) => service.deleteFeed(Number(request.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Feed not found' }));
  app.post<{ Body: { title?: unknown } }>('/api/folders', async (request, reply) => { try { return reply.code(201).send(service.createFolder(requiredText(request.body?.title, 'title'))); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid folder' }); } });
  app.patch<{ Params: { id: string }; Body: { title?: unknown } }>('/api/folders/:id', async (request, reply) => { try { return service.renameFolder(Number(request.params.id), requiredText(request.body?.title, 'title')) ?? reply.code(404).send({ error: 'Folder not found' }); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid folder' }); } });
  app.delete<{ Params: { id: string } }>('/api/folders/:id', async (request, reply) => service.deleteFolder(Number(request.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Folder not found' }));
}
