import { it, expect } from 'vitest';
import { inlinePreviewImages } from '../src/preview-images.js';

it('embeds local proxy images for an opaque preview without requesting remote URLs or changing links', async () => {
  const requested: string[] = [];
  const html =
    '<a href="https://publisher.test/story">Original</a><img alt="A" src="/api/img?src=https%3A%2F%2Fpublisher.test%2Fa"><img src="https://publisher.test/direct"><img src="/api/img?src=https%3A%2F%2Fpublisher.test%2Fa">';
  const result = await inlinePreviewImages(html, 'https://brew.test', async (input) => {
    requested.push(String(input));
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
  });
  expect(requested).toEqual(['https://brew.test/api/img?src=https%3A%2F%2Fpublisher.test%2Fa']);
  expect(result.match(/data:image\/png;base64,AQID/g)).toHaveLength(2);
  expect(result).toContain('<a href="https://publisher.test/story">Original</a>');
  expect(result).toContain('<img alt="A"');
  expect(result).toContain('<img src="https://publisher.test/direct">');
});
it('does not embed rejected or non-image responses', async () => {
  const html = '<img src="/api/img?src=one"><img src="/api/img?src=two">';
  expect(
    await inlinePreviewImages(html, 'https://brew.test', async (input) =>
      String(input).includes('one')
        ? new Response('no', { status: 400 })
        : new Response('html', { headers: { 'Content-Type': 'text/html' } }),
    ),
  ).toBe(html);
});
