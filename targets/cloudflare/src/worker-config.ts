export function publicOrigin(value: string | undefined) {
  try {
    const url = new URL(value ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error('Configure BREW_PUBLIC_URL as the HTTPS origin of this instance.');
  }
}
