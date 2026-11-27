import type { QuickJSWASMModule, QuickJSRuntime, QuickJSContext } from 'quickjs-emscripten-core';
import type { RegexPort } from '../../../packages/core/src/ports.js';

const timeoutError = 'Regular expression timed out.';
export const regexWasmMemory = () => new WebAssembly.Memory({ initial: 256, maximum: 1024 });
const executionError = 'Regular expression exceeded this instance’s execution limits.';

/** QuickJS interrupts inside its regex interpreter, including catastrophic backtracking.
 * Fuel is mandatory: deployed Worker clocks do not advance during CPU-only work.
 */
export class CloudflareRegex implements RegexPort {
  constructor(
    private load: () => Promise<QuickJSWASMModule>,
    private now: () => number = () => performance.now(),
  ) {}
  async test(pattern: string, value: string, timeoutMs = 500) {
    const result = await this.testMany(pattern, [value], timeoutMs);
    return {
      matched: result.matches[0] === true,
      timedOut: result.timedOut,
      ...(result.error ? { error: result.error } : {}),
    };
  }
  async testMany(
    pattern: string,
    values: string[],
    timeoutMs = 500,
  ): Promise<{
    matches: boolean[];
    timedOut: boolean;
    error?: string;
  }> {
    // Bound compilation separately: regex compilation does not poll the execution hook.
    if (pattern.length > 4000) return { matches: [], timedOut: false, error: executionError };
    const budget = Number.isFinite(timeoutMs) ? Math.min(500, Math.max(0, timeoutMs)) : 500;
    if (budget === 0) return { matches: [], timedOut: true, error: timeoutError };
    let units = 0;
    if (
      values.length > 50_000 ||
      values.some(
        (value) => value.length > 4 * 1024 * 1024 || (units += value.length) > 16 * 1024 * 1024,
      )
    )
      return { matches: [], timedOut: false, error: executionError };
    let engine: QuickJSWASMModule;
    try {
      engine = await this.load();
    } catch {
      return { matches: [], timedOut: false, error: 'Regular expression engine could not start.' };
    }
    let runtime: QuickJSRuntime | undefined;
    let context: QuickJSContext | undefined;
    let interrupted = false,
      remaining = Math.max(1, Math.ceil((budget * 512) / 500));
    const deadline = this.now() + budget;
    const exhausted = () => {
      interrupted ||= --remaining < 0 || this.now() >= deadline;
      return interrupted;
    };
    try {
      runtime = engine.newRuntime();
      runtime.setMemoryLimit(32 * 1024 * 1024);
      runtime.setMaxStackSize(256 * 1024);
      runtime.setInterruptHandler(exhausted);
      context = runtime.newContext();
      // Data enters as handles, never interpolated executable source. No host
      // functions, network, storage, module loader or application objects are exposed.
      const source = context.newString(JSON.stringify(pattern));
      try {
        context.setProp(context.global, 'pattern', source);
      } finally {
        source.dispose();
      }
      const compiled = context.evalCode(
        '(function(){const regex=new RegExp(JSON.parse(pattern),"iu");return function(input){return JSON.stringify(JSON.parse(input).map(value=>regex.test(value)));};})()',
        'brew-regex.js',
      );
      if (compiled.error) {
        try {
          const error = interrupted
            ? null
            : (context.dump(compiled.error) as { name?: string } | null);
          return {
            matches: [],
            timedOut: interrupted,
            error: interrupted
              ? timeoutError
              : error?.name === 'SyntaxError'
                ? 'Invalid regular expression.'
                : executionError,
          };
        } finally {
          compiled.error.dispose();
        }
      }
      const matches: boolean[] = [];
      try {
        // Bound transient VM allocations; preserve complete order and discard the
        // entire result if a later chunk fails. Never return partial success.
        for (let offset = 0; offset < values.length;) {
          if (exhausted()) return { matches: [], timedOut: true, error: timeoutError };
          let end = offset + 1,
            chunkUnits = values[offset]!.length;
          while (
            end < values.length &&
            end - offset < 256 &&
            chunkUnits + values[end]!.length <= 128 * 1024
          ) {
            chunkUnits += values[end]!.length;
            end++;
          }
          const input = context.newString(JSON.stringify(values.slice(offset, end)));
          offset = end;
          try {
            const result = context.callFunction(compiled.value, context.undefined, input);
            if (result.error) {
              result.error.dispose();
              return {
                matches: [],
                timedOut: interrupted,
                error: interrupted ? timeoutError : executionError,
              };
            }
            try {
              matches.push(...(JSON.parse(context.getString(result.value)) as boolean[]));
            } finally {
              result.value.dispose();
            }
          } finally {
            input.dispose();
          }
        }
        return { matches, timedOut: false };
      } finally {
        compiled.value.dispose();
      }
    } catch {
      return {
        matches: [],
        timedOut: interrupted,
        error: interrupted ? timeoutError : executionError,
      };
    } finally {
      try {
        context?.dispose();
      } finally {
        runtime?.dispose();
      }
    }
  }
}
