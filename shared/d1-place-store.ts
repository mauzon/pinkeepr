import type { D1Database } from "./d1-types.ts";
import {
  flattenRoutesForDb,
  originJsonToRow,
  placeJsonToRow,
  rowToOriginJson,
  rowToPlaceJson,
  routesFromDbRows,
  splitEntityRows,
} from "./city-mapper.ts";
import type { PlaceStore, PlaceCreateInput, PlacePatchInput, OriginPutInput } from "./place-store.ts";
import type { CityBundle, CitySummary, PlaceRow, WriteActor } from "./types.ts";

type D1Row = Record<string, unknown>;

export class D1PlaceStore implements PlaceStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private async bumpVersion(slug: string): Promise<number> {
    await this.db
      .prepare(`UPDATE cities SET version = version + 1, updated_at = datetime('now') WHERE slug = ?`)
      .bind(slug)
      .run();
    const v = await this.db.prepare(`SELECT version FROM cities WHERE slug = ?`).bind(slug).first<{ version: number }>();
    return v?.version ?? 1;
  }

  async logChange(
    citySlug: string,
    actor: WriteActor,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO change_log (city_slug, actor, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        citySlug,
        `${actor.kind}:${actor.id}`,
        action,
        entityType,
        entityId,
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
      )
      .run();
  }

  async listCities(): Promise<CitySummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT c.slug, c.name_ru, c.name_en, c.version,
          (SELECT COUNT(*) FROM places p WHERE p.city_slug = c.slug AND p.entity_kind = 'place' AND p.deleted_at IS NULL) AS places,
          (SELECT COUNT(*) FROM places p WHERE p.city_slug = c.slug AND p.entity_kind = 'event' AND p.deleted_at IS NULL) AS events
         FROM cities c ORDER BY c.slug`,
      )
      .all();
    return (results as D1Row[]).map((r) => ({
      slug: String(r.slug),
      name_ru: String(r.name_ru),
      name_en: String(r.name_en),
      version: Number(r.version),
      places: Number(r.places),
      events: Number(r.events),
    }));
  }

  async getCityVersion(slug: string): Promise<number | null> {
    const row = await this.db.prepare(`SELECT version FROM cities WHERE slug = ?`).bind(slug).first<{ version: number }>();
    return row ? row.version : null;
  }

  async getCityBundle(slug: string): Promise<CityBundle | null> {
    const [cityMeta, originsMeta, placesMeta, routesMeta] = await this.db.batch([
      this.db.prepare(`SELECT * FROM cities WHERE slug = ?`).bind(slug),
      this.db.prepare(`SELECT * FROM origins WHERE city_slug = ? ORDER BY id`).bind(slug),
      this.db
        .prepare(`SELECT * FROM places WHERE city_slug = ? AND deleted_at IS NULL ORDER BY sort_km, name_en`)
        .bind(slug),
      this.db
        .prepare(`SELECT place_id, origin_id, mode, payload_json FROM routes WHERE city_slug = ?`)
        .bind(slug),
    ]);

    const cityRows = cityMeta.results as D1Row[];
    const city = cityRows[0];
    if (!city) return null;

    const origins = ((originsMeta.results as D1Row[]) ?? []).map(rowToOriginJson);
    const placeRows = (placesMeta.results as D1Row[]) ?? [];

    const routesByPlace = new Map<string, { origin_id: string; mode: string; payload_json: string }[]>();
    for (const r of (routesMeta.results as { place_id: string; origin_id: string; mode: string; payload_json: string }[]) ?? []) {
      const pid = String(r.place_id);
      const list = routesByPlace.get(pid);
      if (list) list.push(r);
      else routesByPlace.set(pid, [r]);
    }

    const places: PlaceRow[] = [];
    const events: PlaceRow[] = [];

    for (const row of placeRows) {
      const pid = String(row.id);
      const routesByOrigin = routesFromDbRows(routesByPlace.get(pid) ?? []);
      const json = rowToPlaceJson(row, routesByOrigin);
      if (row.entity_kind === "event") events.push(json);
      else places.push(json);
    }

    const bundle: CityBundle = {
      slug: String(city.slug),
      name_ru: String(city.name_ru),
      name_en: String(city.name_en),
      country: String(city.country),
      timezone: String(city.timezone),
      currency: String(city.currency),
      hotel: JSON.parse(String(city.hotel_json)),
      transport: JSON.parse(String(city.transport_json)),
      places,
      events,
      sources: JSON.parse(String(city.sources_json)),
      version: Number(city.version),
    };
    if (city.routing_json) bundle.routing = JSON.parse(String(city.routing_json));
    if (city.ui_json) bundle.ui = JSON.parse(String(city.ui_json));
    if (city.source_json) (bundle as CityBundle & { source?: unknown }).source = JSON.parse(String(city.source_json));
    if (origins.length) bundle.origins = origins;
    return bundle;
  }

  async replaceCityBundle(slug: string, bundle: CityBundle, actor: WriteActor): Promise<number> {
    const before = await this.getCityBundle(slug);
    const existing = before != null;

    const stmts: D1PreparedStatement[] = [];
    if (existing) {
      stmts.push(this.db.prepare(`DELETE FROM routes WHERE city_slug = ?`).bind(slug));
      stmts.push(this.db.prepare(`DELETE FROM places WHERE city_slug = ?`).bind(slug));
      stmts.push(this.db.prepare(`DELETE FROM origins WHERE city_slug = ?`).bind(slug));
      stmts.push(
        this.db
          .prepare(
            `UPDATE cities SET name_ru=?, name_en=?, country=?, timezone=?, currency=?, hotel_json=?, transport_json=?, routing_json=?, ui_json=?, sources_json=?, source_json=?, updated_at=datetime('now') WHERE slug=?`,
          )
          .bind(
            bundle.name_ru,
            bundle.name_en || bundle.name_ru,
            bundle.country,
            bundle.timezone,
            bundle.currency,
            JSON.stringify(bundle.hotel),
            JSON.stringify(bundle.transport),
            bundle.routing ? JSON.stringify(bundle.routing) : null,
            bundle.ui ? JSON.stringify(bundle.ui) : null,
            JSON.stringify(bundle.sources),
            (bundle as CityBundle & { source?: unknown }).source
              ? JSON.stringify((bundle as CityBundle & { source?: unknown }).source)
              : null,
            slug,
          ),
      );
    } else {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO cities (slug, version, name_ru, name_en, country, timezone, currency, hotel_json, transport_json, routing_json, ui_json, sources_json, source_json) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            slug,
            bundle.name_ru,
            bundle.name_en || bundle.name_ru,
            bundle.country,
            bundle.timezone,
            bundle.currency,
            JSON.stringify(bundle.hotel),
            JSON.stringify(bundle.transport),
            bundle.routing ? JSON.stringify(bundle.routing) : null,
            bundle.ui ? JSON.stringify(bundle.ui) : null,
            JSON.stringify(bundle.sources),
            (bundle as CityBundle & { source?: unknown }).source
              ? JSON.stringify((bundle as CityBundle & { source?: unknown }).source)
              : null,
          ),
      );
    }

    if (bundle.origins?.length) {
      for (const o of bundle.origins) {
        stmts.push(this.db.prepare(this.insertOriginSql()).bind(...this.originBind(originJsonToRow(slug, o))));
      }
    }

    const { places, events } = splitEntityRows(bundle);
    for (const p of places) {
      stmts.push(...this.placeStatements(slug, "place", p));
    }
    for (const p of events) {
      stmts.push(...this.placeStatements(slug, "event", p));
    }

    await this.db.batch(stmts);
    const version = await this.bumpVersion(slug);
    bundle.version = version;
    await this.logChange(slug, actor, existing ? "import" : "create", "city", slug, before, bundle);
    return version;
  }

  private insertOriginSql(): string {
    return `INSERT INTO origins (city_slug, id, label_ru, label_en, kind, is_default, lat, lng, address, google_maps_url, google_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  }

  private originBind(row: Record<string, unknown>): unknown[] {
    return [
      row.city_slug,
      row.id,
      row.label_ru,
      row.label_en,
      row.kind,
      row.is_default,
      row.lat,
      row.lng,
      row.address,
      row.google_maps_url,
      row.google_json,
    ];
  }

  private placeStatements(slug: string, kind: "place" | "event", p: PlaceRow): D1PreparedStatement[] {
    const row = placeJsonToRow(slug, kind, p);
    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO places (id, city_slug, entity_kind, category, source, name, name_ru, name_en, description, description_en,
            user_note, note_en, warning, warning_en, schedule_text, schedule_en, district, district_en, address, lat, lng,
            maps_url, maps_place_id, google_json, rating_json, icon, daytrip, sort_km, walk_json, taxi_json, transit_json, extras_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.city_slug,
          row.entity_kind,
          row.category,
          row.source,
          row.name,
          row.name_ru,
          row.name_en,
          row.description,
          row.description_en,
          row.user_note,
          row.note_en,
          row.warning,
          row.warning_en,
          row.schedule_text,
          row.schedule_en,
          row.district,
          row.district_en,
          row.address,
          row.lat,
          row.lng,
          row.maps_url,
          row.maps_place_id,
          row.google_json,
          row.rating_json,
          row.icon,
          row.daytrip,
          row.sort_km,
          row.walk_json,
          row.taxi_json,
          row.transit_json,
          row.extras_json,
        ),
    ];
    for (const r of flattenRoutesForDb(slug, p.id, p.routes)) {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO routes (city_slug, place_id, origin_id, mode, payload_json, pending) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(r.city_slug, r.place_id, r.origin_id, r.mode, r.payload_json, r.pending),
      );
    }
    return stmts;
  }

  async createPlace(citySlug: string, input: PlaceCreateInput, actor: WriteActor): Promise<PlaceRow> {
    const id = input.id || `added-${crypto.randomUUID().slice(0, 8)}`;
    const place: PlaceRow = {
      ...input,
      id,
      name: input.name,
      sort_km: 0,
      routes: {},
    };
    const stmts = this.placeStatements(citySlug, input.source === "event" ? "event" : "place", place);
    await this.db.batch(stmts);
    await this.bumpVersion(citySlug);
    await this.logChange(citySlug, actor, "create", "place", id, null, place);
    return place;
  }

  async updatePlace(placeId: string, input: PlacePatchInput, actor: WriteActor): Promise<PlaceRow> {
    const existing = await this.db.prepare(`SELECT * FROM places WHERE id = ? AND deleted_at IS NULL`).bind(placeId).first<D1Row>();
    if (!existing) throw new StoreNotFoundError("place");
    const citySlug = String(existing.city_slug);
    const before = rowToPlaceJson(
      existing,
      routesFromDbRows(
        (
          await this.db
            .prepare(`SELECT origin_id, mode, payload_json FROM routes WHERE city_slug = ? AND place_id = ?`)
            .bind(citySlug, placeId)
            .all()
        ).results as { origin_id: string; mode: string; payload_json: string }[],
      ),
    );
    const merged: PlaceRow = { ...before, ...input, id: placeId };
    const row = placeJsonToRow(citySlug, existing.entity_kind as "place" | "event", merged);
    await this.db
      .prepare(
        `UPDATE places SET category=?, name=?, name_ru=?, name_en=?, description=?, description_en=?, user_note=?, note_en=?,
          warning=?, warning_en=?, schedule_text=?, schedule_en=?, district=?, district_en=?, address=?, lat=?, lng=?,
          maps_url=?, maps_place_id=?, google_json=?, rating_json=?, icon=?, daytrip=?, sort_km=?, updated_at=datetime('now')
         WHERE id = ?`,
      )
      .bind(
        row.category,
        row.name,
        row.name_ru,
        row.name_en,
        row.description,
        row.description_en,
        row.user_note,
        row.note_en,
        row.warning,
        row.warning_en,
        row.schedule_text,
        row.schedule_en,
        row.district,
        row.district_en,
        row.address,
        row.lat,
        row.lng,
        row.maps_url,
        row.maps_place_id,
        row.google_json,
        row.rating_json,
        row.icon,
        row.daytrip,
        row.sort_km,
        placeId,
      )
      .run();
    await this.bumpVersion(citySlug);
    await this.logChange(citySlug, actor, "update", "place", placeId, before, merged);
    return merged;
  }

  async softDeletePlace(placeId: string, actor: WriteActor): Promise<void> {
    const existing = await this.db.prepare(`SELECT city_slug FROM places WHERE id = ? AND deleted_at IS NULL`).bind(placeId).first();
    if (!existing) throw new StoreNotFoundError("place");
    const citySlug = String((existing as D1Row).city_slug);
    await this.db.prepare(`UPDATE places SET deleted_at = datetime('now') WHERE id = ?`).bind(placeId).run();
    await this.bumpVersion(citySlug);
    await this.logChange(citySlug, actor, "delete", "place", placeId, existing, null);
  }

  async putOrigin(citySlug: string, input: OriginPutInput, actor: WriteActor): Promise<void> {
    const before = await this.db.prepare(`SELECT * FROM origins WHERE city_slug = ? AND id = ?`).bind(citySlug, input.id).first();
    const row = originJsonToRow(citySlug, { ...input, default: input.default });
    if (before) {
      await this.db
        .prepare(
          `UPDATE origins SET label_ru=?, label_en=?, kind=?, is_default=?, lat=?, lng=?, address=?, google_maps_url=?, google_json=? WHERE city_slug=? AND id=?`,
        )
        .bind(
          row.label_ru,
          row.label_en,
          row.kind,
          row.is_default,
          row.lat,
          row.lng,
          row.address,
          row.google_maps_url,
          row.google_json,
          citySlug,
          input.id,
        )
        .run();
    } else {
      await this.db.prepare(this.insertOriginSql()).bind(...this.originBind(row)).run();
    }
    if (input.default) {
      await this.db.prepare(`UPDATE origins SET is_default = 0 WHERE city_slug = ? AND id != ?`).bind(citySlug, input.id).run();
    }
    await this.bumpVersion(citySlug);
    await this.logChange(citySlug, actor, "put", "origin", input.id, before, input);
  }

  async replaceRoutesForPlace(citySlug: string, placeId: string, routes: PlaceRow["routes"]): Promise<void> {
    const stmts: D1PreparedStatement[] = [this.db.prepare(`DELETE FROM routes WHERE city_slug = ? AND place_id = ?`).bind(citySlug, placeId)];
    for (const r of flattenRoutesForDb(citySlug, placeId, routes)) {
      stmts.push(
        this.db
          .prepare(`INSERT INTO routes (city_slug, place_id, origin_id, mode, payload_json, pending) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(r.city_slug, r.place_id, r.origin_id, r.mode, r.payload_json, r.pending),
      );
    }
    await this.db.batch(stmts);
  }

  async setPlaceSortKm(placeId: string, sortKm: number): Promise<void> {
    await this.db.prepare(`UPDATE places SET sort_km = ? WHERE id = ?`).bind(sortKm, placeId).run();
  }

  async setPlaceLegacyRoutes(
    placeId: string,
    walk: PlaceRow["walk"],
    taxi: PlaceRow["taxi"],
    transit: PlaceRow["transit"],
    sortKm: number,
  ): Promise<void> {
    await this.db
      .prepare(`UPDATE places SET walk_json = ?, taxi_json = ?, transit_json = ?, sort_km = ? WHERE id = ?`)
      .bind(
        walk ? JSON.stringify(walk) : null,
        taxi ? JSON.stringify(taxi) : null,
        transit ? JSON.stringify(transit) : null,
        sortKm,
        placeId,
      )
      .run();
  }

  async getCitySlugForPlace(placeId: string): Promise<string | null> {
    const row = await this.db.prepare(`SELECT city_slug FROM places WHERE id = ? AND deleted_at IS NULL`).bind(placeId).first();
    return row ? String((row as D1Row).city_slug) : null;
  }

  async markTransitPending(citySlug: string, placeId: string, originId: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO routes (city_slug, place_id, origin_id, mode, payload_json, pending)
         VALUES (?, ?, ?, 'transit', ?, 1)
         ON CONFLICT(city_slug, place_id, origin_id, mode) DO UPDATE SET payload_json = excluded.payload_json, pending = 1`,
      )
      .bind(citySlug, placeId, originId, JSON.stringify({ description_en: "Transit pending", description: "Transit pending" }))
      .run();
  }
}

export class StoreNotFoundError extends Error {
  constructor(entity: string) {
    super(`Not found: ${entity}`);
    this.name = "StoreNotFoundError";
  }
}

type D1PreparedStatement = ReturnType<D1Database["prepare"]>;