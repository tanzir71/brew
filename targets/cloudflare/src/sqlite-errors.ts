export const isD1Constraint = (error: unknown) =>
  error instanceof Error && /^D1_ERROR:.*: SQLITE_CONSTRAINT\b/s.test(error.message);
