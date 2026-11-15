import type { CityData } from "./types";
import { cacheApiResponse, readCachedBundle } from "./city-cache";

const ACCESS_HOST_RE = /cloudflareaccess\.com/i;

const FETCH_INIT: RequestInit = {
  redirect: "manual",
  credentials: "same-origin",
  cache: "no-store",
};

function badApiResponse(response: Response | null | undefined): boolean {
  if (!response) return true;
  if (response.type === "opaqueredirect") return true;
  if (response.status === 0) return true;
  if (response.status === 401 || response.status === 403) return true;
  if (response.redirected && ACCESS_HOST_RE.test(response.url || "")) return true;
  return false;
}

function bundleVersion(data: CityData): number | null {
  const v = (data as CityData & { version?: number }).version;
  return typeof v === "number" ? v : null;
}

/** Stale snapshot: IndexedDB cache or build-time JSON (offline / first paint). */
export async function readLocalCityBundle(slug: string, fallback: CityData): Promise<CityData> {
  try {
    const cached = await readCachedBundle(slug);
    if (cached?.bundle) return { ...(cached.bundle as CityData), version: cached.version };
  } catch {
    /* ignore */
  }
  return fallback;
}

async function fetchVersion(slug: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/cities/${slug}/version`, FETCH_INIT);
    if (badApiResponse(res) || !res.ok) return null;
    const json = (await res.json()) as { version?: number };
    return typeof json.version === "number" ? json.version : null;
  } catch {
    return null;
  }
}

async function fetchCityJson(slug: string, headers?: HeadersInit): Promise<Response> {
  return fetch(`/api/cities/${slug}`, { ...FETCH_INIT, headers });
}

async function parseCityResponse(
  res: Response,
  slug: string,
  remoteVersion: number | null,
  cachedVersion: number | null,
): Promise<CityData | null> {
  if (res.status === 304) return null;
  if (!res.ok || badApiResponse(res)) return null;
  const bundle = (await res.json()) as CityData;
  if (!Array.isArray(bundle.places)) return null;
  if (!Array.isArray(bundle.events)) bundle.events = [];
  const version =
    typeof bundle.version === "number" ? bundle.version : remoteVersion ?? cachedVersion ?? 0;
  const withVersion = { ...bundle, version };
  const wrapped = new Response(JSON.stringify(withVersion), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-City-Version": String(version) },
  });
  await cacheApiResponse(slug, wrapped, withVersion);
  return withVersion;
}

/** Network revalidate; returns fresh bundle or null if unchanged (304) / failed. */
export async function revalidateCityBundle(slug: string, current: CityData): Promise<CityData | null> {
  let cached: Awaited<ReturnType<typeof readCachedBundle>> = null;
  try {
    cached = await readCachedBundle(slug);
  } catch {
    cached = null;
  }

  const remoteVersion = await fetchVersion(slug);
  const localVersion = bundleVersion(current) ?? cached?.version ?? null;

  if (remoteVersion != null && localVersion != null && remoteVersion === localVersion) {
    const res = await fetchCityJson(slug, { "If-None-Match": `"city-v${localVersion}"` });
    if (res.status === 304) return null;
    const parsed = await parseCityResponse(res, slug, remoteVersion, localVersion);
    return parsed;
  }

  try {
    const res = await fetchCityJson(slug);
    return await parseCityResponse(res, slug, remoteVersion, localVersion);
  } catch {
    return null;
  }
}

/** Full blocking load (tests and explicit refresh). */
export async function loadCityBundle(slug: string, fallback: CityData): Promise<CityData> {
  const local = await readLocalCityBundle(slug, fallback);
  const fresh = await revalidateCityBundle(slug, local);
  return fresh ?? local;
}