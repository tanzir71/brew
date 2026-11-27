import { actionsUpstream } from './actions-upstream.js';
let pending = false,
  released = false;
export default {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === '/hold-status') return Response.json({ pending });
    if (path === '/hold-release') {
      released = true;
      return new Response(null, { status: 204 });
    }
    if (path === '/hold-feed') {
      pending = true;
      released = false;
      const until = Date.now() + 4000;
      while (!released && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 20));
      pending = false;
    }
    return actionsUpstream(request);
  },
};
