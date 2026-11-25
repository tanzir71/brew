import { Worker } from 'node:worker_threads';

const workerSource = `
  const { parentPort, workerData } = require('node:worker_threads');
  try { parentPort.postMessage({ matched: new RegExp(workerData.pattern, 'iu').test(workerData.value) }); }
  catch (error) { parentPort.postMessage({ matched: false, error: error instanceof Error ? error.message : 'Invalid regex' }); }
`;

export async function safeRegexTest(
  pattern: string,
  value: string,
  timeoutMs = 500,
): Promise<{ matched: boolean; timedOut: boolean; error?: string }> {
  return new Promise((resolve) => {
    const worker = new Worker(workerSource, { eval: true, workerData: { pattern, value } });
    let settled = false;
    const finish = (result: { matched: boolean; timedOut: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ matched: false, timedOut: true, error: 'Regular expression timed out' }),
      timeoutMs,
    );
    worker.once('message', (message: { matched: boolean; error?: string }) =>
      finish({
        matched: message.matched,
        timedOut: false,
        ...(message.error ? { error: message.error } : {}),
      }),
    );
    worker.once('error', (error) =>
      finish({
        matched: false,
        timedOut: false,
        error: error instanceof Error ? error.message : 'Regex worker failed',
      }),
    );
  });
}
export function safeRegexMany(
  pattern: string,
  values: string[],
  timeoutMs = 500,
): Promise<{ matches: boolean[]; timedOut: boolean; error?: string }> {
  return new Promise((resolve) => {
    const worker = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads'); try { const regex=new RegExp(workerData.pattern,'iu'); parentPort.postMessage({matches:workerData.values.map(value=>regex.test(value))}); } catch(error){parentPort.postMessage({matches:[],error:error.message})}`,
      { eval: true, workerData: { pattern, values } },
    );
    let settled = false;
    const finish = (result: { matches: boolean[]; timedOut: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ matches: [], timedOut: true, error: 'Regular expression timed out.' }),
      timeoutMs,
    );
    worker.once('message', (value: { matches: boolean[]; error?: string }) =>
      finish({ ...value, timedOut: false }),
    );
    worker.once('error', () =>
      finish({ matches: [], timedOut: false, error: 'Regex worker failed.' }),
    );
  });
}
