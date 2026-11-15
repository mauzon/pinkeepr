import type { CityBundle, PlaceRow } from "../../shared/types.ts";
import { buildBilingualRouteBundle, coordsMatch } from "../../scripts/lib/routes.mjs";

const OSRM = "https://router.project-osrm.org/route/v1/driving";

export async function osrmDrive(lat1: number, lng1: number, lat2: number, lng2: number): Promise<{ distance_m: number; duration_s: number }> {
  const url = `${OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "pinkeepr-worker/1.0" } });
    if (res.status === 429) {
      await delay(500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error("routing unavailable");
    const json = (await res.json()) as { routes?: { distance: number; duration: number }[] };
    const route = json.routes?.[0];
    if (!route) throw new Error("routing unavailable");
    return { distance_m: Math.round(route.distance), duration_s: Math.round(route.duration) };
  }
  throw new Error("routing unavailable");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function originsFromCity(city: CityBundle): { id: string; lat: number; lng: number }[] {
  if (city.origins?.length) {
    return city.origins.map((o) => ({ id: o.id, lat: o.lat, lng: o.lng }));
  }
  const h = city.hotel as { lat: number; lng: number };
  return [{ id: "hotel", lat: h.lat, lng: h.lng }];
}

export async function computeRoutesForPlace(city: CityBundle, place: PlaceRow, originId?: string): Promise<PlaceRow["routes"]> {
  if (place.lat == null || place.lng == null) return place.routes || {};
  const origins = originsFromCity(city).filter((o) => !originId || o.id === originId);
  const routes: NonNullable<PlaceRow["routes"]> = { ...(place.routes || {}) };
  for (const origin of origins) {
    if (coordsMatch(origin, place)) {
      delete routes[origin.id];
      continue;
    }
    const drive = await osrmDrive(origin.lat, origin.lng, place.lat, place.lng);
    const bundle = buildBilingualRouteBundle(
      origin,
      place,
      drive,
      city as Parameters<typeof buildBilingualRouteBundle>[3],
    );
    routes[origin.id] = bundle;
  }
  return routes;
}

export async function recomputeCityRoutes(
  city: CityBundle,
  originId: string,
  places: PlaceRow[],
): Promise<Map<string, PlaceRow["routes"]>> {
  const out = new Map<string, PlaceRow["routes"]>();
  for (const place of places) {
    const routes = await computeRoutesForPlace(city, place, originId);
    out.set(place.id, routes);
    const bundle = routes?.[originId];
    if (bundle?.sort_km != null) place.sort_km = bundle.sort_km;
  }
  return out;
}

export function cityUsesTflTransit(city: CityBundle): boolean {
  const routing = city.routing as { transit?: string } | undefined;
  return routing?.transit === "tfl";
}

export async function scheduleTflTransit(
  _ctx: ExecutionContext,
  _city: CityBundle,
  _placeId: string,
): Promise<void> {
  /* Phase 1: mark transit pending in routes row; full TfL enrichment async in waitUntil later. */
}