import type { ServerResponse } from 'node:http';

export class SseBroker {
  private readonly clients = new Set<ServerResponse>();
  add(response: ServerResponse): () => void { this.clients.add(response); return () => this.clients.delete(response); }
  publish(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) { try { client.write(payload); } catch { this.clients.delete(client); } }
  }
}
