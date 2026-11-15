const CACHE_NAME = "pinkeepr-city-bundles-v1";

function cacheKey(slug: string, version: number): Request {
  return new Request(`https://pinkeepr.bundle/${slug}/v${version}`);
}

function cacheAvailable(): boolean {
  return typeof caches !== "undefined";
}

export async function getCachedCityBody(slug: string, version: number): Promise<string | null> {
  if (!cacheAvailable()) return null;
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(cacheKey(slug, version));
  if (!hit || !hit.ok) return null;
  return hit.text();
}

export async function putCachedCityBody(slug: string, version: number, body: string, etag: string): Promise<void> {
  if (!cacheAvailable()) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    cacheKey(slug, version),
    new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    }),
  );
}