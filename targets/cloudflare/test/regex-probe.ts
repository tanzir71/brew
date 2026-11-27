import { cloudflareRegex, loadRegexEngine } from '../src/regex-worker.js';
import { CloudflareRegex } from '../src/regex.js';
// Test-only ingress, including a frozen clock to model deployed Workers.
export default {
  async fetch(request: Request) {
    const input = (await request.json()) as {
      pattern: string;
      values: string[];
      timeout?: number;
      frozen?: boolean;
      single?: boolean;
    };
    const regex = input.frozen ? new CloudflareRegex(loadRegexEngine, () => 0) : cloudflareRegex;
    return Response.json(
      input.single
        ? await regex.test(input.pattern, input.values[0]!, input.timeout)
        : await regex.testMany(input.pattern, input.values, input.timeout),
    );
  },
};
