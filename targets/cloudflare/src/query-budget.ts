/** D1 calls, rather than SQL statements: one native batch consumes one call.
 * Admission reserves an entire unit of work, including its final writes. Counting
 * itself never throws after an unknown write outcome or during lease cleanup.
 */
export class CloudflareQueryBudget {
  private count = 0;
  private held = 0;
  constructor(
    readonly limit = 50,
    private readonly parent?: CloudflareQueryBudget,
  ) {
    if (!Number.isInteger(limit) || limit < 0 || limit > 50)
      throw new Error('The D1 query allowance must be an integer from 0 to 50.');
  }
  get used(): number {
    return this.count;
  }
  get remaining(): number {
    return Math.max(
      0,
      Math.min(this.limit - this.count - this.held, this.parent?.remaining ?? Infinity),
    );
  }
  record() {
    this.count++;
    this.parent?.record();
  }
  /** Synchronous admission prevents concurrent feeds from claiming the same capacity.
   * Hold the full estimate until completion; partially spent reservations deliberately
   * overestimate concurrent demand. Unused capacity becomes available on release.
   */
  reserve(calls: number): (() => void) | null {
    if (!Number.isSafeInteger(calls) || calls < 1) throw new Error('Invalid D1 reservation.');
    if (this.remaining < calls) return null;
    const releaseParent = this.parent?.reserve(calls);
    if (releaseParent === null) return null;
    this.held += calls;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.held -= calls;
      releaseParent?.();
    };
  }
  /** A phase can spend only its share, while every call still counts globally. */
  share(limit: number) {
    return new CloudflareQueryBudget(limit, this);
  }
}
