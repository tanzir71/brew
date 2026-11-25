import type { EventsPort } from '../../../../packages/api/src/ports.js';

export class SseBroker implements EventsPort {
  private readonly clients = new Map<(event: string, data: unknown) => void, () => void>();
  subscribe(listener: (event: string, data: unknown) => void, onClose: () => void): () => void {
    this.clients.set(listener, onClose);
    return () => {
      this.clients.delete(listener);
    };
  }
  publish(event: string, data: unknown): void {
    for (const [write, close] of this.clients) {
      try {
        write(event, data);
      } catch {
        close();
        this.clients.delete(write);
      }
    }
  }
  close(): void {
    for (const close of this.clients.values()) close();
    this.clients.clear();
  }
}
