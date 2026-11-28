/** Opaque sandboxed srcdoc frames cannot reach the live page's service worker. */
export async function inlinePreviewImages(html: string, origin: string, fetchImage: typeof fetch) {
  const sources = [
    ...new Set([...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]!)),
  ];
  const images = new Map<string, string>();
  for (let offset = 0; offset < sources.length; offset += 4)
    await Promise.all(
      sources.slice(offset, offset + 4).map(async (source) => {
        const url = new URL(source.replaceAll('&amp;', '&'), origin);
        if (url.origin !== origin || url.pathname !== '/api/img') return;
        const response = await fetchImage(url);
        const type = response.headers.get('content-type')?.split(';')[0];
        if (!response.ok || !type || !/^image\/[a-z0-9.+-]+$/i.test(type)) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192)
          binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        images.set(source, 'data:' + type + ';base64,' + btoa(binary));
      }),
    );
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g, (match, before, source, after) =>
    images.has(source) ? before + images.get(source) + after : match,
  );
}
