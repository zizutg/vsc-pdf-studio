export function parseExternalLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8_192) {
    return null;
  }

  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
