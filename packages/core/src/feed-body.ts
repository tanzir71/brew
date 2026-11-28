export const MAX_FEED_BYTES = 10 * 1024 * 1024;
export async function readFeedBody(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_FEED_BYTES) {
    await response.body?.cancel();
    throw new Error('Feed exceeds the 10 MiB limit.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error('Feed exceeds the 10 MiB limit.');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}
