type Maybe<T> = T | Promise<T>;
export class ReaderSyncError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 501 | 503,
    message: string,
  ) {
    super(message);
  }
}
export interface ReaderAccessStatus {
  enabled: boolean;
  username: string | null;
}
export interface ReaderSession {
  token: string;
  username: string;
  generation: string;
  writeOnly?: boolean;
}
export interface ReaderAccessPort {
  status(): Maybe<ReaderAccessStatus>;
  configure(value: unknown): Maybe<{ username: string; password: string }>;
  disable(): Maybe<void>;
  login(username: string, password: string): Maybe<string | null>;
  session(authorization: string | null, writeToken?: string): Maybe<ReaderSession | null>;
  writeToken(session: ReaderSession): Maybe<string>;
  checkWrite(session: ReaderSession, token: string): Maybe<boolean>;
  fever(key: string): Maybe<ReaderSession | null>;
}
export type SyncStream =
  | { kind: 'all' | 'read' | 'unread' | 'starred' }
  | { kind: 'feed'; id: number }
  | { kind: 'folder'; id: number }
  | { kind: 'label'; name: string };
export interface SyncQuery {
  idsOnly?: boolean;
  generation?: string;
  streams?: SyncStream[];
  exclude?: SyncStream[];
  ids?: number[];
  after?: number;
  before?: number;
  fetchedAfter?: number;
  fetchedBefore?: number;
  oldest?: boolean;
  limit?: number;
  cursor?: string;
  afterId?: number;
  beforeId?: number;
  byId?: boolean;
}
export interface SyncItem {
  id: number;
  feedId: number;
  title: string;
  author: string | null;
  url: string;
  html: string;
  published: number;
  fetched: number;
  read: boolean;
  starred: boolean;
  feedTitle: string;
  feedUrl: string;
  siteUrl: string | null;
  folder: string | null;
  tags: string[];
}
export interface SyncMetadata {
  feeds: Array<{
    id: number;
    title: string;
    url: string;
    siteUrl: string | null;
    folderId: number | null;
    faviconUrl: string | null;
    updated: number;
    unread: number;
  }>;
  folders: Array<{ id: number; title: string }>;
  tags: Array<{ id: number; name: string }>;
  totalItems: number;
  totalUnread: number;
  newestUnread: number;
}
export interface SyncPatch {
  read?: boolean;
  starred?: boolean;
  add?: string[];
  remove?: string[];
}
export interface ReaderSyncStoragePort {
  now(): number;
  metadata(): Maybe<SyncMetadata>;
  items(query: SyncQuery): Maybe<{ items: SyncItem[]; total: number; continuation?: string }>;
  stateIds(state: 'unread' | 'starred'): Maybe<number[]>;
  change(query: SyncQuery, patch: SyncPatch): Maybe<number>;
  label(
    action: 'create' | 'rename' | 'remove',
    name: string,
    destination?: string,
    generation?: string,
  ): Maybe<void>;
  editFeed(
    id: number,
    title: string,
    folderId: number | null | undefined,
    generation: string,
  ): Maybe<void>;
  notify(): Maybe<void>;
}
export interface ReaderSyncPort {
  access: ReaderAccessPort;
  storage: ReaderSyncStoragePort;
}

export function syncId(value: string): number {
  let result: bigint;
  try {
    if (/^tag:google\.com,2005:reader\/item\/[a-f\d]{1,16}$/i.test(value))
      result = BigInt(`0x${value.split('/').at(-1)}`);
    else if (/^0[a-f\d]{15}$/i.test(value) || /^(?=[a-f\d]{1,16}$)(?=.*[a-f])/i.test(value))
      result = BigInt(`0x${value}`);
    else if (/^\d+$/.test(value)) result = BigInt(value);
    else throw new Error();
    if (result < 1n || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
  } catch {
    throw new ReaderSyncError(400, 'Invalid reader item ID.');
  }
  return Number(result);
}
export const googleItemId = (id: number) =>
  `tag:google.com,2005:reader/item/${BigInt(id).toString(16).padStart(16, '0')}`;
export const googleState = (state: string) => `user/-/state/com.google/${state}`;
export const googleLabel = (name: string) => `user/-/label/${name}`;
export function syncStream(value: string): SyncStream {
  const feed = /^feed\/([1-9]\d*)$/.exec(value);
  if (feed) return { kind: 'feed', id: syncId(feed[1]!) };
  const label = /^user\/(?:-|1)\/label\/(.+)$/.exec(value);
  if (label) {
    if (
      !label[1]!.trim() ||
      label[1]!.length > 200 ||
      [...label[1]!].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new ReaderSyncError(400, 'Invalid reader label.');
    return { kind: 'label', name: label[1]!.trim() };
  }
  const state = value.replace(/^user\/(?:-|1)\/state\/com\.google\//, '');
  if (state === 'reading-list' || state === 'root') return { kind: 'all' };
  if (['read', 'unread', 'starred'].includes(state))
    return { kind: state as 'read' | 'unread' | 'starred' };
  throw new ReaderSyncError(400, 'Unsupported reader stream.');
}
