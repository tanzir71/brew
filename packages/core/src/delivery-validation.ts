/** One bare mailbox, never a Nodemailer recipient list or a header fragment. */
export function isDeliveryAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  return (
    local.length > 0 &&
    local.length <= 64 &&
    !local.startsWith('.') &&
    !local.endsWith('.') &&
    !local.includes('..') &&
    /^[a-z\d.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) &&
    domain.includes('.') &&
    domain.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
  );
}
export function isDeliveryWebhook(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}
