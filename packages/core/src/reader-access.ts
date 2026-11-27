import { ReaderSyncError } from './reader-sync.js';

export const readerWriteMessage = 'brew-reader-write-v1';
export function readerUsername(value: unknown): string {
  const input = value as { username?: unknown } | null;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== 'username') ||
    typeof input.username !== 'string' ||
    !/^[a-z\d@._+-]{1,100}$/i.test(input.username)
  )
    throw new ReaderSyncError(
      400,
      'Choose a username of 1–100 letters, digits, @, period, underscore, plus or hyphen.',
    );
  return input.username;
}
export function readerSessionCredential(authorization: string | null, writeToken?: string) {
  const writeOnly = !authorization && Boolean(writeToken);
  const token = writeOnly
    ? writeToken
    : /^(?:GoogleLogin\s+auth=|Bearer\s+)(brs_[a-z\d_-]{43})$/i.exec(authorization ?? '')?.[1];
  return token ? { token, writeOnly } : null;
}
