import type { Page } from '@playwright/test';
import type { ActionReceipt } from '../../packages/core/src/actions';
import type { ReadActionTarget } from '../../packages/core/src/read-actions';

// Transport stand-in for pre-existing static visual/keyboard fixtures. Real
// preview, transaction, replay and Undo behavior is tested with Node + SQLite.
export async function installBulkReadFixture(
  page: Page,
  rows: () => Array<{ id: number; readAt: string | null }>,
  update: (id: number, readAt: string | null) => void,
) {
  const records = new Map<number, { receipt: ActionReceipt; ids: number[] }>();
  const requests = new Map<string, number>();
  const selected = (target: ReadActionTarget) =>
    rows().filter((row) => target.kind === 'reader' || target.ids.includes(row.id));
  await page.route('**/api/actions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/actions' && request.method() === 'GET')
      return route.fulfill({ json: [...records.values()].map((item) => item.receipt).reverse() });
    if (path === '/api/actions/mark-read/preview') {
      const target = request.postDataJSON() as ReadActionTarget;
      const items = selected(target);
      return route.fulfill({
        json: {
          revision: 'a'.repeat(64),
          updated: items.filter((row) => !row.readAt).length,
          unavailable: target.kind === 'items' ? target.ids.length - items.length : 0,
        },
      });
    }
    if (path === '/api/actions' && request.method() === 'POST') {
      const input = request.postDataJSON() as {
        kind: string;
        target: ReadActionTarget;
        requestId: string;
      };
      if (input.kind !== 'mark_read') return route.fallback();
      const prior = requests.get(input.requestId);
      if (prior) return route.fulfill({ json: records.get(prior)!.receipt });
      const ids = selected(input.target)
        .filter((row) => !row.readAt)
        .map((row) => row.id);
      for (const id of ids) update(id, new Date().toISOString());
      const id = records.size + 1;
      const receipt: ActionReceipt = {
        id,
        kind: 'mark_read',
        targetId: null,
        summary: `Marked ${ids.length} read.`,
        updated: ids.length,
        status: 'complete',
        externalEffects: false,
        canUndo: ids.length > 0,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        undoneAt: null,
      };
      records.set(id, { receipt, ids });
      requests.set(input.requestId, id);
      return route.fulfill({ json: receipt });
    }
    const match = /^\/api\/actions\/(\d+)\/undo$/.exec(path);
    if (match && records.has(Number(match[1]))) {
      const record = records.get(Number(match[1]))!;
      for (const id of record.ids) update(id, null);
      record.receipt = {
        ...record.receipt,
        status: 'undone',
        undoneAt: new Date().toISOString(),
        canUndo: false,
      };
      return route.fulfill({ json: record.receipt });
    }
    return route.fallback();
  });
}
