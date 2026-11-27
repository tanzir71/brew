import { renderBrewEmail, renderBrewJson } from './brew-outputs.js';
import { brewIssuePath } from './brew-output-paths.js';
import type { AsyncBrewStoragePort, ClockPort } from './ports.js';
import type { BrewSnapshot, BrewDelivery } from './types/composition.js';
import type { BrewDeliveryOptions, BrewDeliveryResults } from './types/delivery.js';

export const WEBHOOK_TIMEOUT_MS = 5_000;

export class BrewDeliveryRunner {
  constructor(
    private storage: Pick<
      AsyncBrewStoragePort,
      'claimDelivery' | 'saveDelivery' | 'deliveryResults'
    >,
    private clock: ClockPort,
    private options: BrewDeliveryOptions = {},
  ) {}
  async deliver(issue: BrewSnapshot, delivery: BrewDelivery): Promise<BrewDeliveryResults> {
    const results: BrewDeliveryResults = {
      version: 1,
      email: !delivery.email
        ? { status: 'disabled', attempts: 0 }
        : !this.options.mail
          ? { status: 'unavailable', attempts: 0, error: 'unavailable' }
          : !this.options.baseUrl
            ? { status: 'unavailable', attempts: 0, error: 'configuration' }
            : { status: 'pending', attempts: 0 },
      webhook: !delivery.webhook
        ? { status: 'disabled', attempts: 0 }
        : !this.options.fetcher
          ? { status: 'unavailable', attempts: 0, error: 'unavailable' }
          : { status: 'pending', attempts: 0 },
    };
    // Claim before any external I/O. Never silently resend a completed or interrupted issue.
    if (!(await this.storage.claimDelivery(issue.id, results)))
      return (await this.storage.deliveryResults(issue.id)) ?? results;
    // Both channels mutate one receipt. Capture each state now and serialize
    // asynchronous writes so an older pending state cannot overwrite completion.
    let pending = Promise.resolve();
    const save = () => {
      const snapshot = structuredClone(results);
      pending = pending.then(() => this.storage.saveDelivery(issue.id, snapshot));
      return pending;
    };
    const key = this.options.baseUrl
      ? `${this.options.baseUrl}${brewIssuePath(issue)}`
      : `urn:brew:${issue.brewConfigId}:${issue.id}`;
    await Promise.all([
      (async () => {
        if (results.email.status !== 'pending') return;
        const result = results.email;
        result.attempts = 1;
        result.attemptedAt = this.clock.now().toISOString();
        await save();
        try {
          const { html, text } = renderBrewEmail(issue, { baseUrl: this.options.baseUrl });
          const receipt = await this.options.mail!.send({
            to: delivery.email!.to,
            subject: `${issue.configName} · No. ${issue.issueNumber}`,
            html,
            text,
            idempotencyKey: key,
          });
          result.status = 'sent';
          if (receipt.messageId)
            result.messageId = receipt.messageId.replace(/[\r\n]/g, '').slice(0, 255);
        } catch {
          result.status = 'failed';
          result.error = 'email';
        }
        result.completedAt = this.clock.now().toISOString();
        await save();
      })(),
      (async () => {
        if (results.webhook.status !== 'pending') return;
        const result = results.webhook;
        const payload = renderBrewJson(issue, { baseUrl: this.options.baseUrl });
        for (let attempt = 1; attempt <= 2; attempt++) {
          delete result.httpStatus;
          delete result.error;
          result.attempts = attempt;
          result.attemptedAt = this.clock.now().toISOString();
          await save();
          const controller = new AbortController();
          let timedOut = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const response = await Promise.race([
              this.options.fetcher!(delivery.webhook!.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
                body: payload,
                redirect: 'manual',
                signal: controller.signal,
              }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  timedOut = true;
                  controller.abort();
                  reject(new Error('Webhook timeout'));
                }, WEBHOOK_TIMEOUT_MS);
              }),
            ]);
            void response.body?.cancel().catch(() => {});
            // Workers does not implement redirect:error. Refuse redirects
            // explicitly, preserving the same no-forwarding failure on Node.
            if ([301, 302, 303, 307, 308].includes(response.status))
              throw new Error('Webhook redirect refused');
            result.httpStatus = response.status;
            if (response.ok) {
              result.status = 'sent';
              delete result.error;
              break;
            }
            result.error = 'http';
          } catch {
            result.error = timedOut ? 'timeout' : 'network';
          } finally {
            clearTimeout(timer);
          }
        }
        if (result.status !== 'sent') result.status = 'failed';
        result.completedAt = this.clock.now().toISOString();
        await save();
      })(),
    ]);
    return results;
  }
}
