/** City bundle shape aligned with data/schema/city.schema.json */
export type CityBundle = {
  slug: string;
  name_ru: string;
  name_en?: string;
  country: string;
  timezone: string;
  currency: string;
  hotel: Record<string, unknown>;
  origins?: OriginRow[];
  transport: Record<string, unknown>;
  routing?: Record<string, unknown>;
  places: PlaceRow[];
  events: PlaceRow[];
  sources: string[];
  ui?: Record<string, unknown>;
  version?: number;
  [key: string]: unknown;
};

export type OriginRow = {
  id: string;
  label_ru: string;
  label_en: string;
  kind: "hotel" | "venue" | "other";
  default?: boolean;
  lat: number;
  lng: number;
  address?: string;
  google_maps_url?: string;
  google?: Record<string, unknown>;
};

export type PlaceRow = Record<string, unknown> & {
  id: string;
  name: string;
  name_ru?: string;
  name_en?: string;
  category: string;
  source: "list" | "added" | "event";
  maps_url: string;
  sort_km: number;
  routes?: Record<string, OriginRouteBundle>;
};

export type OriginRouteBundle = {
  walk?: Record<string, unknown>;
  taxi?: Record<string, unknown>;
  transit?: Record<string, unknown>;
  sort_km?: number;
};

export type CitySummary = {
  slug: string;
  name_ru: string;
  name_en: string;
  version: number;
  places: number;
  events: number;
};

export type WriteActor = {
  kind: "access" | "agent" | "dev" | "public";
  id: string;
};