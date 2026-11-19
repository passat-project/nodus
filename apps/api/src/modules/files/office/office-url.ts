/** Абсолютный http(s)-URL или null (иные схемы дают origin 'null' — тоже отказ). */
export function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
