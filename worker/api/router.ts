import { D1PlaceStore, StoreNotFoundError } from "../../shared/d1-place-store.ts";
import type { CityBundle, WriteActor } from "../../shared/types.ts";
import { ZodError } from "zod";
import {
  parseCityImport,
  parseOriginPut,
  parsePlaceCreate,
  parsePlacePatch,
  validationErrorResponse,
} from "../../shared/validation.ts";
import { defaultOriginId } from "../../scripts/lib/routes.mjs";
import { authorizeRead, authorizeWrite } from "../auth/access.ts";
import { rateLimitWrite } from "../auth/rate-limit.ts";
import type { Env } from "../env.ts";
import { isD1ApiEnabled } from "../env.ts";
import { cityUsesTflTransit, computeRoutesForPlace, recomputeCityRoutes } from "../routing/compute-routes.ts";
import { persistPlaceRoutes } from "../routing/persist-routes.ts";
import { getCachedCityBody, putCachedCityBody } from "../city-bundle-cache.ts";
import { BodyTooLargeError, errorResponse, etagForVersion, jsonResponse, readJsonBody, requireJsonContentType } from "./http.ts";

const WRITE_MAX = 64 * 1024;
const IMPORT_MAX = 2 * 1024 * 1024;

export async function handleApiRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

  if (!isD1ApiEnabled(env)) {
    return jsonResponse({ error: "API not configured" }, { status: 404 });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 405 });
  }

  const parts = url.pathname.slice("/api/".length).split("/").filter(Boolean);

  if (request.method === "GET" && parts[0] === "cities" && parts.length === 1) {
    return handleListCities(request, env);
  }
  if (request.method === "GET" && parts[0] === "cities" && parts.length === 2) {
    return handleGetCity(request, env, ctx, parts[1]);
  }
  if (request.method === "GET" && parts[0] === "cities" && parts.length === 3 && parts[2] === "version") {
    return handleGetVersion(request, env, parts[1]);
  }
  if (request.method === "POST" && parts[0] === "cities" && parts.length === 3 && parts[2] === "places") {
    return handleCreatePlace(request, env, ctx, parts[1]);
  }
  if (request.method === "POST" && parts[0] === "cities" && parts.length === 3 && parts[2] === "import") {
    return handleImport(request, env, parts[1]);
  }
  if (
    (request.method === "PUT" || request.method === "POST") &&
    parts[0] === "cities" &&
    parts.length === 3 &&
    (parts[2] === "origin" || parts[2] === "origins")
  ) {
    return handlePutOrigin(request, env, ctx, parts[1]);
  }
  if (request.method === "PATCH" && parts[0] === "places" && parts.length === 2) {
    return handlePatchPlace(request, env, ctx, parts[1]);
  }
  if (request.method === "DELETE" && parts[0] === "places" && parts.length === 2) {
    return handleDeletePlace(request, env, parts[1]);
  }

  return errorResponse(404);
}

function store(env: Env): D1PlaceStore {
  if (!env.DB) throw new Error("DB binding missing");
  return new D1PlaceStore(env.DB);
}

function cityUsesTfl(city: CityBundle): boolean {
  return cityUsesTflTransit(city);
}

async function markTransitPending(st: D1PlaceStore, citySlug: string, placeId: string, originId: string): Promise<void> {
  await st.markTransitPending(citySlug, placeId, originId);
}

async function handleListCities(request: Request, env: Env): Promise<Response> {
  const actor = await authorizeRead(request, env);
  if (!actor) return errorResponse(401);
  const cities = await store(env).listCities();
  return jsonResponse({ cities });
}

async function handleGetVersion(request: Request, env: Env, slug: string): Promise<Response> {
  const actor = await authorizeRead(request, env);
  if (!actor) return errorResponse(401);
  const version = await store(env).getCityVersion(slug);
  if (version == null) return errorResponse(404);
  return jsonResponse({ slug, version });
}

async function handleGetCity(request: Request, env: Env, ctx: ExecutionContext, slug: string): Promise<Response> {
  const actor = await authorizeRead(request, env);
  if (!actor) return errorResponse(401);
  const st = store(env);
  const version = await st.getCityVersion(slug);
  if (version == null) return errorResponse(404);
  const etag = etagForVersion(version);
  const inm = request.headers.get("If-None-Match");
  if (inm === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const cachedBody = await getCachedCityBody(slug, version);
  if (cachedBody) {
    const headers = {
      ETag: etag,
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Type": "application/json; charset=utf-8",
    };
    return new Response(cachedBody, { status: 200, headers });
  }

  const bundle = await st.getCityBundle(slug);
  if (!bundle) return errorResponse(404);
  const body = JSON.stringify(bundle);
  const headers = { ETag: etag, "Cache-Control": "private, max-age=0, must-revalidate" };
  ctx.waitUntil(putCachedCityBody(slug, version, body, etag));
  return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

async function requireWrite(request: Request, env: Env): Promise<WriteActor | Response> {
  const actor = await authorizeWrite(request, env);
  if (!actor) {
    const read = await authorizeRead(request, env);
    if (!read) return errorResponse(401);
    return errorResponse(403);
  }
  const key = `${actor.kind}:${actor.id}`;
  if (!rateLimitWrite(key)) return errorResponse(429);
  return actor;
}

async function handleCreatePlace(request: Request, env: Env, ctx: ExecutionContext, slug: string): Promise<Response> {
  const actor = await requireWrite(request, env);
  if (actor instanceof Response) return actor;
  if (!requireJsonContentType(request)) return errorResponse(400);
  try {
    const body = await readJsonBody(request, WRITE_MAX);
    const input = parsePlaceCreate(body);
    const st = store(env);
    const city = await store(env).getCityBundle(slug);
    if (!city) return errorResponse(404);
    const place = await st.createPlace(slug, input, actor);
    const routes = await computeRoutesForPlace(city, place);
    await persistPlaceRoutes(st, slug, place, city, routes);
    const def = defaultOriginId(city);
    if (cityUsesTfl(city)) {
      ctx.waitUntil(markTransitPending(st, slug, place.id, def));
    }
    const version = await st.getCityVersion(slug);
    return jsonResponse({ place, version }, { status: 201 });
  } catch (e) {
    return mapError(e);
  }
}

async function handlePatchPlace(request: Request, env: Env, ctx: ExecutionContext, placeId: string): Promise<Response> {
  const actor = await requireWrite(request, env);
  if (actor instanceof Response) return actor;
  if (!requireJsonContentType(request)) return errorResponse(400);
  try {
    const body = await readJsonBody(request, WRITE_MAX);
    const input = parsePlacePatch(body);
    const st = store(env);
    const citySlug = await st.getCitySlugForPlace(placeId);
    if (!citySlug) return errorResponse(404);
    const city = await st.getCityBundle(citySlug);
    if (!city) return errorResponse(404);
    const place = await st.updatePlace(placeId, input, actor);
    const needsRoutes = input.lat != null || input.lng != null;
    if (needsRoutes) {
      const routes = await computeRoutesForPlace(city, place);
      await persistPlaceRoutes(st, citySlug, place, city, routes);
      const def = defaultOriginId(city);
      if (cityUsesTfl(city)) ctx.waitUntil(markTransitPending(st, citySlug, placeId, def));
    }
    const version = await st.getCityVersion(citySlug);
    return jsonResponse({ place, version });
  } catch (e) {
    return mapError(e);
  }
}

async function handleDeletePlace(request: Request, env: Env, placeId: string): Promise<Response> {
  const actor = await requireWrite(request, env);
  if (actor instanceof Response) return actor;
  try {
    const st = store(env);
    const citySlug = await st.getCitySlugForPlace(placeId);
    await st.softDeletePlace(placeId, actor);
    const version = citySlug ? await st.getCityVersion(citySlug) : null;
    return jsonResponse({ id: placeId, deleted: true, version });
  } catch (e) {
    return mapError(e);
  }
}

async function handlePutOrigin(request: Request, env: Env, ctx: ExecutionContext, slug: string): Promise<Response> {
  const actor = await requireWrite(request, env);
  if (actor instanceof Response) return actor;
  if (!requireJsonContentType(request)) return errorResponse(400);
  try {
    const body = await readJsonBody(request, WRITE_MAX);
    const input = parseOriginPut(body);
    const st = store(env);
    await st.putOrigin(slug, input, actor);
    const city = await st.getCityBundle(slug);
    if (!city) return errorResponse(404);
    const allPlaces = [...city.places, ...city.events];
    const routeMap = await recomputeCityRoutes(city, input.id, allPlaces);
    ctx.waitUntil(
      (async () => {
        for (const p of allPlaces) {
          const routes = routeMap.get(p.id);
          if (!routes) continue;
          await persistPlaceRoutes(st, slug, p, city, routes);
        }
      })(),
    );
    const version = await st.getCityVersion(slug);
    return jsonResponse({ origin: input, routes_recomputing: true, version });
  } catch (e) {
    return mapError(e);
  }
}

async function handleImport(request: Request, env: Env, slug: string): Promise<Response> {
  const actor = await requireWrite(request, env);
  if (actor instanceof Response) return actor;
  if (!requireJsonContentType(request)) return errorResponse(400);
  try {
    const body = await readJsonBody(request, IMPORT_MAX);
    const parsed = parseCityImport(body);
    if (parsed.slug !== slug) return errorResponse(400);
    const bundle = body as CityBundle;
    const st = store(env);
    const version = await st.replaceCityBundle(slug, { ...bundle, slug }, actor);
    return jsonResponse({ slug, version, imported: true });
  } catch (e) {
    return mapError(e);
  }
}

function mapError(e: unknown): Response {
  if (e instanceof BodyTooLargeError) return errorResponse(413);
  if (e instanceof StoreNotFoundError) return errorResponse(404);
  if (e instanceof ZodError) return jsonResponse({ error: "Invalid request" }, { status: 400 });
  const v = validationErrorResponse(e);
  if (v.status === 400) return jsonResponse(v.body, { status: 400 });
  return errorResponse(500);
}