/** Per-city bundle cache for offline D1 API mode (Cache API + IndexedDB fallback). */

const DB_NAME = "pinkeepr-city-cache";
const DB_VER = 1;
const STORE = "bundles";

type CacheRow = { slug: string; version: number; bundle: unknown; savedAt: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "slug" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readCachedBundle(slug: string): Promise<CacheRow | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const get = tx.objectStore(STORE).get(slug);
    get.onsuccess = () => resolve((get.result as CacheRow) || null);
    get.onerror = () => reject(get.error);
  });
}

export async function writeCachedBundle(slug: string, version: number, bundle: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  const row: CacheRow = { slug, version, bundle, savedAt: Date.now() };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheApiResponse(slug: string, response: Response, bundle: unknown): Promise<void> {
  const versionHeader = response.headers.get("X-City-Version");
  const version = versionHeader ? Number(versionHeader) : 0;
  await writeCachedBundle(slug, version, bundle);
  if (typeof caches !== "undefined") {
    const cache = await caches.open("pinkeepr-api-cities");
    await cache.put(`/api/cities/${slug}`, response.clone());
  }
}