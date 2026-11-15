import type { CityBundle, OriginRow, PlaceRow } from "./types.ts";

const PLACE_SCALAR_KEYS = new Set([
  "id",
  "name",
  "name_ru",
  "name_en",
  "category",
  "source",
  "user_note",
  "note_en",
  "description",
  "description_en",
  "warning",
  "warning_en",
  "schedule_text",
  "schedule_en",
  "district",
  "district_en",
  "address",
  "lat",
  "lng",
  "maps_url",
  "maps_place_id",
  "icon",
  "daytrip",
  "sort_km",
  "google",
  "rating",
  "walk",
  "taxi",
  "transit",
  "routes",
]);

export function placeExtras(p: PlaceRow): Record<string, unknown> | null {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (PLACE_SCALAR_KEYS.has(k)) continue;
    if (v === undefined) continue;
    extras[k] = v;
  }
  return Object.keys(extras).length ? extras : null;
}

export function splitEntityRows(bundle: CityBundle): { places: PlaceRow[]; events: PlaceRow[] } {
  return {
    places: bundle.places.map((p) => ({ ...p, source: p.source || "list" })),
    events: bundle.events.map((p) => ({ ...p, source: p.source || "event" })),
  };
}

export function rowToPlaceJson(row: Record<string, unknown>, routesByOrigin: Record<string, Record<string, unknown>>): PlaceRow {
  const place: PlaceRow = {
    id: String(row.id),
    name: String(row.name),
    name_ru: row.name_ru ? String(row.name_ru) : String(row.name),
    name_en: row.name_en ? String(row.name_en) : undefined,
    category: String(row.category),
    source: row.source as PlaceRow["source"],
    maps_url: String(row.maps_url),
    sort_km: Number(row.sort_km ?? 0),
  };
  const optionalScalars = [
    "description",
    "description_en",
    "user_note",
    "note_en",
    "warning",
    "warning_en",
    "schedule_text",
    "schedule_en",
    "district",
    "district_en",
    "address",
    "maps_place_id",
    "icon",
  ] as const;
  for (const k of optionalScalars) {
    if (row[k] != null && row[k] !== "") place[k] = row[k] as string;
  }
  if (row.lat != null) place.lat = Number(row.lat);
  if (row.lng != null) place.lng = Number(row.lng);
  if (row.extras_json) Object.assign(place, JSON.parse(String(row.extras_json)));
  if (row.daytrip != null) place.daytrip = Boolean(row.daytrip);
  if (row.google_json) place.google = JSON.parse(String(row.google_json));
  if (row.rating_json) place.rating = JSON.parse(String(row.rating_json));
  if (row.walk_json) place.walk = JSON.parse(String(row.walk_json));
  if (row.taxi_json) place.taxi = JSON.parse(String(row.taxi_json));
  if (row.transit_json) place.transit = JSON.parse(String(row.transit_json));
  if (Object.keys(routesByOrigin).length) place.routes = routesByOrigin as PlaceRow["routes"];
  return place;
}

export function placeJsonToRow(citySlug: string, entityKind: "place" | "event", p: PlaceRow): Record<string, unknown> {
  const extras = placeExtras(p);
  return {
    id: p.id,
    city_slug: citySlug,
    entity_kind: entityKind,
    category: p.category,
    source: p.source,
    name: p.name,
    name_ru: p.name_ru ?? p.name,
    name_en: p.name_en ?? p.name,
    description: p.description ?? null,
    description_en: p.description_en ?? null,
    user_note: p.user_note ?? null,
    note_en: p.note_en ?? null,
    warning: p.warning ?? null,
    warning_en: p.warning_en ?? null,
    schedule_text: p.schedule_text ?? null,
    schedule_en: p.schedule_en ?? null,
    district: p.district ?? null,
    district_en: p.district_en ?? null,
    address: p.address ?? null,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    maps_url: p.maps_url,
    maps_place_id: p.maps_place_id ?? null,
    google_json: p.google ? JSON.stringify(p.google) : null,
    rating_json: p.rating ? JSON.stringify(p.rating) : null,
    icon: p.icon ?? null,
    daytrip: p.daytrip === true ? 1 : 0,
    sort_km: p.sort_km ?? 0,
    walk_json: p.walk ? JSON.stringify(p.walk) : null,
    taxi_json: p.taxi ? JSON.stringify(p.taxi) : null,
    transit_json: p.transit ? JSON.stringify(p.transit) : null,
    extras_json: extras ? JSON.stringify(extras) : null,
    deleted_at: null,
  };
}

export function originJsonToRow(citySlug: string, o: OriginRow): Record<string, unknown> {
  return {
    city_slug: citySlug,
    id: o.id,
    label_ru: o.label_ru,
    label_en: o.label_en,
    kind: o.kind,
    is_default: o.default ? 1 : 0,
    lat: o.lat,
    lng: o.lng,
    address: o.address ?? null,
    google_maps_url: o.google_maps_url ?? null,
    google_json: o.google ? JSON.stringify(o.google) : null,
  };
}

export function rowToOriginJson(row: Record<string, unknown>): OriginRow {
  const o: OriginRow = {
    id: String(row.id),
    label_ru: String(row.label_ru),
    label_en: String(row.label_en),
    kind: row.kind as OriginRow["kind"],
    lat: Number(row.lat),
    lng: Number(row.lng),
  };
  if (row.is_default !== undefined && row.is_default !== null) o.default = Boolean(row.is_default);
  if (row.address) o.address = String(row.address);
  if (row.google_maps_url) o.google_maps_url = String(row.google_maps_url);
  if (row.google_json) o.google = JSON.parse(String(row.google_json));
  return o;
}

export function routesFromDbRows(rows: { origin_id: string; mode: string; payload_json: string }[]): Record<string, Record<string, unknown>> {
  const byOrigin: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    if (!byOrigin[r.origin_id]) byOrigin[r.origin_id] = {};
    const payload = JSON.parse(r.payload_json) as Record<string, unknown>;
    byOrigin[r.origin_id][r.mode] = payload;
    if (r.mode === "taxi" && typeof payload.km === "number") {
      byOrigin[r.origin_id].sort_km = payload.km;
    }
  }
  return byOrigin;
}

export function flattenRoutesForDb(
  citySlug: string,
  placeId: string,
  routes?: Record<string, { walk?: unknown; taxi?: unknown; transit?: unknown; sort_km?: number }>,
): { city_slug: string; place_id: string; origin_id: string; mode: string; payload_json: string; pending: number }[] {
  if (!routes) return [];
  const out: { city_slug: string; place_id: string; origin_id: string; mode: string; payload_json: string; pending: number }[] = [];
  for (const [originId, bundle] of Object.entries(routes)) {
    for (const mode of ["walk", "taxi", "transit"] as const) {
      const leg = bundle[mode];
      if (leg) {
        out.push({
          city_slug: citySlug,
          place_id: placeId,
          origin_id: originId,
          mode,
          payload_json: JSON.stringify(leg),
          pending: 0,
        });
      }
    }
  }
  return out;
}