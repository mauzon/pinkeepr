import type { CityBundle, CitySummary, PlaceRow, WriteActor } from "./types.ts";
import type { z } from "zod";
import type { originPutSchema, placeCreateSchema, placePatchSchema } from "./validation.ts";

export type PlaceCreateInput = z.infer<typeof placeCreateSchema>;
export type PlacePatchInput = z.infer<typeof placePatchSchema>;
export type OriginPutInput = z.infer<typeof originPutSchema>;

/**
 * Storage adapter for city bundles.
 * - JSON: static build / fallback when no D1 binding.
 * - D1: production API persistence.
 * Future: add e.g. `TursoPlaceStore` implementing the same interface (libSQL), no API changes.
 */
export interface PlaceStore {
  listCities(): Promise<CitySummary[]>;
  getCityVersion(slug: string): Promise<number | null>;
  getCityBundle(slug: string): Promise<CityBundle | null>;
  replaceCityBundle(slug: string, bundle: CityBundle, actor: WriteActor): Promise<number>;
  createPlace(citySlug: string, input: PlaceCreateInput, actor: WriteActor): Promise<PlaceRow>;
  updatePlace(placeId: string, input: PlacePatchInput, actor: WriteActor): Promise<PlaceRow>;
  softDeletePlace(placeId: string, actor: WriteActor): Promise<void>;
  putOrigin(citySlug: string, input: OriginPutInput, actor: WriteActor): Promise<void>;
}