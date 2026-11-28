import type { BrowserLibrary } from '../src/library.js';
import type { BrowserHttpRequest } from '../src/api.js';

/** Forward controlled-page HTTP (including image and iframe requests) to its live library. */
export async function connectBrowserHttp(library: BrowserLibrary, base: URL) {
  if (!navigator.serviceWorker)
    throw new Error('This browser needs service workers to open Brew. Use HTTPS or localhost.');
  const key = crypto.randomUUID();
  const workerUrl = new URL('sw.js', base).href;
  performance.mark('brew:bridge-registering');
  const registration = await navigator.serviceWorker.register(workerUrl, { scope: base.pathname });
  performance.mark('brew:bridge-registered');
  if (navigator.serviceWorker.controller?.scriptURL !== workerUrl)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('The local Brew connection could not start. Reload to retry.'));
      }, 10_000);
      const changed = () => {
        if (navigator.serviceWorker.controller?.scriptURL === workerUrl) {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('controllerchange', changed);
      };
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      if (registration.active?.state === 'activated')
        registration.active.postMessage({ kind: 'brew-claim' });
      changed();
    });
  performance.mark('brew:bridge-controlled');
  const receive = async (
    event: MessageEvent<{ kind: string; key: string; request: BrowserHttpRequest }>,
  ) => {
    if ((event.source as ServiceWorker | null)?.scriptURL !== workerUrl || !event.ports[0]) return;
    const port = event.ports[0];
    if (event.data?.kind === 'brew-owner-probe') {
      port.postMessage({ key });
      port.close();
      return;
    }
    if (event.data?.kind !== 'brew-api' || event.data.key !== key) return;
    try {
      const input = event.data.request;
      const response = await library.fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body as BodyInit | undefined,
      });
      const body = new Uint8Array(await response.arrayBuffer());
      port.postMessage(
        {
          ok: true,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers],
            body,
          },
        },
        [body.buffer],
      );
    } catch (error) {
      port.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : 'The local library could not respond.',
      });
    } finally {
      port.close();
    }
  };
  navigator.serviceWorker.addEventListener('message', receive);
  const announce = () =>
    new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error('The local Brew connection did not acknowledge setup.'));
      }, 10_000);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        channel.port1.close();
        resolve();
      };
      navigator.serviceWorker.controller!.postMessage({ kind: 'brew-owner', key }, [channel.port2]);
    });
  const changed = () =>
    void announce().catch(() => {
      window.dispatchEvent(
        new CustomEvent('brew:runtime-error', {
          detail: 'The local Brew connection changed. Reload to reconnect.',
        }),
      );
    });
  try {
    performance.mark('brew:bridge-announcing');
    await announce();
  } catch (error) {
    navigator.serviceWorker.removeEventListener('message', receive);
    throw error;
  }
  navigator.serviceWorker.addEventListener('controllerchange', changed);
  return () => {
    navigator.serviceWorker.controller?.postMessage({ kind: 'brew-owner-close', key });
    navigator.serviceWorker.removeEventListener('message', receive);
    navigator.serviceWorker.removeEventListener('controllerchange', changed);
  };
}
