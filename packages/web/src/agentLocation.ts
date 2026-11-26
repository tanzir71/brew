/** Carry a temporary opt-in through native app links and canonical view changes. */
export function agentPageHref(href: string, current = new URL(location.href)): string {
  if (current.searchParams.get('agent') !== '1' || href.startsWith('#')) return href;
  const target = new URL(href, current);
  if (
    target.origin !== current.origin ||
    target.username ||
    target.password ||
    target.searchParams.has('agent') ||
    /\.[a-z0-9]+$/i.test(target.pathname) ||
    !/^\/(?:$|(?:b|a|f|feed|letters|rules|settings)(?:\/|$)|(?:all|today|starred|search|reader|feeds)$)/.test(
      target.pathname,
    )
  )
    return href;
  target.searchParams.set('agent', '1');
  return target.pathname + target.search + target.hash;
}
