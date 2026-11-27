export default {
  fetch(request: Request, env: { ASSETS: { fetch: typeof fetch } }) {
    if (
      request.headers.has('authorization') ||
      request.headers.has('cookie') ||
      request.headers.has('cf-access-jwt-assertion') ||
      new URL(request.url).search
    )
      return new Response('Private request data reached the published copy.', { status: 500 });
    return env.ASSETS.fetch(request);
  },
};
