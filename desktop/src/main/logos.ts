/**
 * Third-party artwork, inlined as data URIs.
 *
 * The renderer's CSP grants it `img-src 'self' data:` and no network at all, so
 * every icon in the window is fetched here and handed across as a data URI.
 * That is also the only reason it is safe to display artwork from a host this
 * project does not control: an `<img>` loads SVG in secure static mode — no
 * scripts, no external references, no same-origin credentials. Never inline any
 * of this into the DOM as markup.
 *
 * Shared by the market and RWA panels so those guards — a size cap, an
 * `image/*` content type, and a miss that returns nothing — are written once.
 * An icon is decoration; nothing here may fail a panel that would otherwise
 * have data to show.
 */

const MAX_LOGO_BYTES = 96 * 1024;

export async function inlineImage(
  url: string,
  fallbackType = "image/svg+xml",
): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_LOGO_BYTES) return null;

    const type = response.headers.get("content-type")?.split(";")[0] ?? fallbackType;
    if (!type.startsWith("image/")) return null;

    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Run with a small concurrency cap so N icons do not open N sockets. */
export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}
