-- Travel places: cities, bilingual rows, routes, audit log.
-- Apply: wrangler d1 migrations apply pinkeepr-places --local|--remote

CREATE TABLE IF NOT EXISTS cities (
  slug TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name_ru TEXT NOT NULL,
  name_en TEXT NOT NULL,
  country TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL,
  hotel_json TEXT NOT NULL,
  transport_json TEXT NOT NULL,
  routing_json TEXT,
  ui_json TEXT,
  sources_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS origins (
  city_slug TEXT NOT NULL,
  id TEXT NOT NULL,
  label_ru TEXT NOT NULL,
  label_en TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hotel', 'venue', 'other')),
  is_default INTEGER NOT NULL DEFAULT 0,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT,
  google_maps_url TEXT,
  google_json TEXT,
  PRIMARY KEY (city_slug, id),
  FOREIGN KEY (city_slug) REFERENCES cities(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_origins_city ON origins(city_slug);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY NOT NULL,
  city_slug TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('place', 'event')),
  category TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('list', 'added', 'event')),
  name TEXT NOT NULL,
  name_ru TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description TEXT,
  description_en TEXT,
  user_note TEXT,
  note_en TEXT,
  warning TEXT,
  warning_en TEXT,
  schedule_text TEXT,
  schedule_en TEXT,
  district TEXT,
  district_en TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  maps_url TEXT NOT NULL,
  maps_place_id TEXT,
  google_json TEXT,
  rating_json TEXT,
  icon TEXT,
  daytrip INTEGER NOT NULL DEFAULT 0,
  sort_km REAL NOT NULL DEFAULT 0,
  walk_json TEXT,
  taxi_json TEXT,
  transit_json TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (city_slug) REFERENCES cities(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_places_city_active ON places(city_slug) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS routes (
  city_slug TEXT NOT NULL,
  place_id TEXT NOT NULL,
  origin_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('walk', 'taxi', 'transit')),
  payload_json TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (city_slug, place_id, origin_id, mode),
  FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_routes_place ON routes(place_id);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_slug TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_change_log_city ON change_log(city_slug, created_at DESC);