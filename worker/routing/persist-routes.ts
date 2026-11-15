import type { D1PlaceStore } from "../../shared/d1-place-store.ts";
import type { CityBundle, PlaceRow } from "../../shared/types.ts";
import { defaultOriginId, syncLegacyRoutes } from "../../scripts/lib/routes.mjs";

/** Write full per-origin routes and sync default-origin walk/taxi columns on the place row. */
export async function persistPlaceRoutes(
  st: D1PlaceStore,
  citySlug: string,
  place: PlaceRow,
  city: CityBundle,
  routes: PlaceRow["routes"],
): Promise<void> {
  const def = defaultOriginId(city);
  place.routes = routes;
  syncLegacyRoutes(place, def);
  await st.replaceRoutesForPlace(citySlug, place.id, routes);
  await st.setPlaceLegacyRoutes(place.id, place.walk, place.taxi, place.transit, place.sort_km ?? 0);
}