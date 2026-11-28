import Parser from 'rss-parser';
import { parseFeedDocument } from '../../../packages/core/src/feed-parser.js';

const parser = new Parser();
export const parseCloudflareFeed = (body: string, contentType: string, now: () => Date) =>
  parseFeedDocument(body, contentType, { parse: (xml) => parser.parseString(xml) }, now);

export { MAX_FEED_BYTES, readFeedBody } from '../../../packages/core/src/feed-body.js';
