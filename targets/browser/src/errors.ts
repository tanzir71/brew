export interface WireError {
  name: string;
  message: string;
  sqliteCode?: number;
}
export function wireError(error: unknown): WireError {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : 'Browser library operation failed.',
    ...(error instanceof Error &&
    error.name === 'SQLite3Error' &&
    'resultCode' in error &&
    typeof error.resultCode === 'number'
      ? { sqliteCode: error.resultCode }
      : {}),
  };
}
export function fromWire(error: WireError) {
  return Object.assign(
    new Error(error.message),
    { name: error.name },
    error.sqliteCode === undefined ? {} : { resultCode: error.sqliteCode },
  );
}
export const isSqliteConstraint = (error: unknown) =>
  error instanceof Error &&
  error.name === 'SQLite3Error' &&
  'resultCode' in error &&
  typeof error.resultCode === 'number' &&
  (error.resultCode & 255) === 19;
