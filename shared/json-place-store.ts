import fs from "node:fs";
import path from "node:path";
import type { PlaceStore, PlaceCreateInput, PlacePatchInput, OriginPutInput } from "./place-store.ts";
import type { CityBundle, CitySummary, PlaceRow, WriteActor } from "./types.ts";

/**
 * Reads city bundles from data/cities/*.json (static build path).
 * Write methods throw — use D1 in production.
 */
export class JsonPlaceStore implements PlaceStore {
  constructor(private readonly citiesDir: string) {}

  private readBundle(slug: string): CityBundle | null {
    const file = path.join(this.citiesDir, `${slug}.json`);
    if (!fs.existsSync(file)) return null;
    const bundle = JSON.parse(fs.readFileSync(file, "utf8")) as CityBundle;
    bundle.version = bundle.version ?? 0;
    return bundle;
  }

  async listCities(): Promise<CitySummary[]> {
    const files = fs.readdirSync(this.citiesDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      const bundle = this.readBundle(f.replace(/\.json$/, ""))!;
      return {
        slug: bundle.slug,
        name_ru: bundle.name_ru,
        name_en: bundle.name_en || bundle.name_ru,
        version: bundle.version ?? 0,
        places: bundle.places.length,
        events: bundle.events.length,
      };
    });
  }

  async getCityVersion(slug: string): Promise<number | null> {
    const b = this.readBundle(slug);
    return b ? (b.version ?? 0) : null;
  }

  async getCityBundle(slug: string): Promise<CityBundle | null> {
    return this.readBundle(slug);
  }

  async replaceCityBundle(_slug: string, _bundle: CityBundle, _actor: WriteActor): Promise<number> {
    throw new Error("JsonPlaceStore is read-only");
  }

  async createPlace(_citySlug: string, _input: PlaceCreateInput, _actor: WriteActor): Promise<PlaceRow> {
    throw new Error("JsonPlaceStore is read-only");
  }

  async updatePlace(_placeId: string, _input: PlacePatchInput, _actor: WriteActor): Promise<PlaceRow> {
    throw new Error("JsonPlaceStore is read-only");
  }

  async softDeletePlace(_placeId: string, _actor: WriteActor): Promise<void> {
    throw new Error("JsonPlaceStore is read-only");
  }

  async putOrigin(_citySlug: string, _input: OriginPutInput, _actor: WriteActor): Promise<void> {
    throw new Error("JsonPlaceStore is read-only");
  }
}