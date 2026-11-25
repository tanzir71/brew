import Parser from 'rss-parser';
import { parseFeedDocument as parseDocument } from '../../../../packages/core/src/feed-parser.js';
export type { ParsedArticle, ParsedFeedDocument } from '../../../../packages/core/src/feed-parser.js';
const parser = new Parser();
export const parseFeedDocument = (body: string, contentType = '') =>
  parseDocument(body, contentType, { parse: (xml) => parser.parseString(xml) });
