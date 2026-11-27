import type {
  ActionResult,
  ArticleChanges,
  ArticleContext,
  ClockPort,
  FetchPort,
  NotificationPort,
} from './ports.js';
import type { RuleAction, RuleRecord } from './types/rules.js';

export function changeArticle(action: RuleAction, changes: ArticleChanges, clock: ClockPort) {
  switch (action.type) {
    case 'star':
      changes.starredAt = clock.now();
      break;
    case 'mark_read':
      changes.readAt = clock.now();
      break;
    case 'hide':
      changes.hidden = true;
      break;
    case 'highlight':
      changes.highlightColor = action.color;
      break;
    case 'feature_in_brew':
      changes.featuredInBrew = true;
      changes.excludedFromBrew = false;
      break;
    case 'exclude_from_brew':
      changes.excludedFromBrew = true;
      changes.featuredInBrew = false;
      break;
  }
}
export function actionFailure(action: RuleAction, error: unknown): ActionResult {
  return {
    type: action.type,
    ok: false,
    error: error instanceof Error ? error.message : 'Action failed',
  };
}
export async function externalRuleAction(
  action: Extract<RuleAction, { type: 'notify' | 'webhook' }>,
  rule: RuleRecord,
  context: ArticleContext,
  network: FetchPort,
  notifications: NotificationPort,
): Promise<void> {
  if (action.type === 'notify') {
    await notifications.notify({ id: context.id, title: context.title, url: context.url });
    return;
  }
  const payload = JSON.stringify({
    article: { id: context.id, title: context.title, url: context.url },
    rule: { id: rule.id, name: rule.name },
  });
  let lastError = 'Webhook failed';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await network.fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(5_000),
      });
      void response.body?.cancel().catch(() => {});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Webhook failed';
    }
  }
  throw new Error(lastError);
}
