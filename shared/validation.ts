import { z } from "zod";
import { hasCyrillic, ValidationLocaleError } from "./locale.ts";
import { hasForbiddenMapsPattern, isKnowledgeGraphMid, isRealPlaceId } from "../lib/google-maps-links.mjs";

export const PLACE_CATEGORIES = [
  "events",
  "food",
  "cafe",
  "sights",
  "markets",
  "nightlife",
  "shopping",
  "spa",
  "parks",
  "hotels",
  "coworking",
  "activities",
  "uncategorized",
  "other",
] as const;

function enText(max: number, min = 0) {
  let s = z.string().max(max);
  if (min > 0) s = s.min(min);
  return s.refine((v) => !hasCyrillic(v), { message: "Cyrillic in EN field" });
}

const googleFields = z
  .object({
    cid: z.string().optional(),
    place_id: z.string().optional(),
    mid: z.string().optional(),
    maps_url: z.string().url().optional(),
    feature_id: z.string().optional(),
  })
  .optional();

const placeWriteBase = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(500),
  name_ru: z.string().min(1).max(500),
  name_en: enText(500, 1),
  category: z.enum(PLACE_CATEGORIES),
  source: z.enum(["list", "added", "event"]).default("added"),
  user_note: z.string().max(2000).optional(),
  note_en: enText(2000).optional(),
  description: z.string().max(8000).optional(),
  description_en: enText(8000).optional(),
  warning: z.string().max(2000).optional(),
  warning_en: enText(2000).optional(),
  schedule_text: z.string().max(500).optional(),
  schedule_en: enText(500).optional(),
  district: z.string().max(200).optional(),
  district_en: enText(200).optional(),
  address: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  maps_url: z.string().url(),
  maps_place_id: z.string().optional(),
  google: googleFields,
  icon: z.string().max(32).optional(),
  daytrip: z.boolean().optional(),
});

export const placeCreateSchema = placeWriteBase.extend({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const placePatchSchema = placeWriteBase.partial().extend({
  category: z.enum(PLACE_CATEGORIES).optional(),
});

export const originPutSchema = z.object({
  id: z.string().min(1).max(80),
  label_ru: z.string().min(1).max(200),
  label_en: enText(200, 1),
  kind: z.enum(["hotel", "venue", "other"]),
  default: z.boolean().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(500).optional(),
  google_maps_url: z.string().url().optional(),
  google: googleFields,
});

export const cityImportSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name_ru: z.string().min(1),
  name_en: enText(500, 1).optional(),
  country: z.string().length(2),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  hotel: z.record(z.unknown()),
  transport: z.record(z.unknown()),
  places: z.array(z.record(z.unknown())),
  events: z.array(z.record(z.unknown())),
  sources: z.array(z.string().url()).min(1),
});

export function validateMapsRules(row: { id?: string; maps_url?: string; maps_place_id?: string; google?: { place_id?: string; mid?: string } }): void {
  if (row.maps_url && hasForbiddenMapsPattern(row.maps_url)) {
    throw new MapsValidationError("maps_url");
  }
  if (row.maps_place_id && isKnowledgeGraphMid(row.maps_place_id)) {
    throw new MapsValidationError("maps_place_id");
  }
  if (row.google?.place_id && !isRealPlaceId(row.google.place_id)) {
    throw new MapsValidationError("google.place_id");
  }
  if (row.google?.mid && !isKnowledgeGraphMid(row.google.mid)) {
    throw new MapsValidationError("google.mid");
  }
}

export class MapsValidationError extends Error {
  constructor(public readonly field: string) {
    super(`Invalid maps link: ${field}`);
    this.name = "MapsValidationError";
  }
}

export function parsePlaceCreate(body: unknown) {
  const data = placeCreateSchema.parse(body);
  validateMapsRules(data);
  assertEnPlace(data);
  return data;
}

export function parsePlacePatch(body: unknown) {
  const data = placePatchSchema.parse(body);
  validateMapsRules(data);
  assertEnPlace(data);
  return data;
}

export function parseOriginPut(body: unknown) {
  const data = originPutSchema.parse(body);
  if (data.google_maps_url) validateMapsRules({ maps_url: data.google_maps_url });
  return data;
}

export function parseCityImport(body: unknown) {
  const data = cityImportSchema.parse(body);
  for (const row of [...data.places, ...data.events]) {
    const p = row as { id?: string; maps_url?: string; maps_place_id?: string; google?: { place_id?: string; mid?: string }; name_en?: string };
    if (p.name_en && hasCyrillic(p.name_en)) throw new ValidationLocaleError("name_en");
    if (p.maps_url) validateMapsRules(p);
  }
  return data;
}

function assertEnPlace(data: { name_en?: string; description_en?: string; note_en?: string; warning_en?: string; schedule_en?: string; district_en?: string }) {
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && k.endsWith("_en") && hasCyrillic(v)) {
      throw new ValidationLocaleError(k);
    }
  }
}

export function validationErrorResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof z.ZodError) return { status: 400, body: { error: "Invalid request" } };
  if (err instanceof ValidationLocaleError) return { status: 400, body: { error: "Invalid request" } };
  if (err instanceof MapsValidationError) return { status: 400, body: { error: "Invalid request" } };
  return { status: 400, body: { error: "Invalid request" } };
}