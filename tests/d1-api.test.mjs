#!/usr/bin/env node
/**
 * API + auth + validation tests (local D1 via wrangler getPlatformProxy).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { getPlatformProxy } from "wrangler";
import { d1WranglerConfigPath } from "../scripts/lib/d1-wrangler-config.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITY = "london";
execSync("npm run d1:seed", { cwd: root, stdio: "pipe" });

const TEST_TOKEN = "test-agent-token-phase1";
const tokenHash = createHash("sha256").update(TEST_TOKEN).digest("hex");
const WRONG_TOKEN = "definitely-wrong-token";

const { env, dispose } = await getPlatformProxy({
  configPath: d1WranglerConfigPath(root),
});
env.ACCESS_BYPASS_DEV = "1";
env.AGENT_TOKEN_HASHES = JSON.stringify({ "test-agent": tokenHash });

const worker = (await import("../worker/index.ts")).default;

async function invoke(pathname, init = {}) {
  const req = new Request(`http://localhost${pathname}`, init);
  return worker.fetch(req, env, { waitUntil: () => {}, passThroughOnException: () => {} });
}

let etag;

{
  const res = await invoke(`/api/cities/${CITY}`);
  assert.equal(res.status, 200);
  etag = res.headers.get("ETag");
  assert.ok(etag);
  const json = await res.json();
  assert.equal(json.slug, CITY);
  assert.ok(json.places.length > 0);
}

{
  const res = await invoke(`/api/cities/${CITY}`, { headers: { "If-None-Match": etag } });
  assert.equal(res.status, 304);
}

{
  const res = await invoke(`/api/cities/${CITY}/version`);
  const { version } = await res.json();
  assert.ok(version >= 1);
}

{
  const res = await invoke(`/api/cities/${CITY}/places`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 403);
}

{
  const res = await invoke(`/api/cities/${CITY}/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WRONG_TOKEN}` },
    body: JSON.stringify({
      name: "X",
      name_ru: "X",
      name_en: "X",
      category: "food",
      maps_url: "https://www.google.com/maps/search/?api=1&query=x",
      lat: 51.5074,
      lng: -0.1278,
    }),
  });
  assert.equal(res.status, 403);
}

{
  const bad = {
    name: "Test",
    name_ru: "Тест",
    name_en: "Тест Cyrillic",
    category: "food",
    maps_url: "https://www.google.com/maps/search/?api=1&query=test",
    lat: 51.5074,
    lng: -0.1278,
  };
  const res = await invoke(`/api/cities/${CITY}/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_TOKEN}` },
    body: JSON.stringify(bad),
  });
  assert.equal(res.status, 400);
}

{
  const badCat = {
    name: "Test",
    name_ru: "Test",
    name_en: "Test",
    category: "not-a-real-category",
    maps_url: "https://www.google.com/maps/search/?api=1&query=test",
    lat: 51.5074,
    lng: -0.1278,
  };
  const res = await invoke(`/api/cities/${CITY}/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_TOKEN}` },
    body: JSON.stringify(badCat),
  });
  assert.equal(res.status, 400);
}

{
  const badMaps = {
    name: "Test",
    name_ru: "Test",
    name_en: "Test",
    category: "food",
    maps_url: "https://www.google.com/maps/place/?q=place_id:/g/abc",
    lat: 51.5074,
    lng: -0.1278,
  };
  const res = await invoke(`/api/cities/${CITY}/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_TOKEN}` },
    body: JSON.stringify(badMaps),
  });
  assert.equal(res.status, 400);
}

{
  const ok = {
    name: "API test place",
    name_ru: "API test",
    name_en: "API test place",
    category: "food",
    maps_url: "https://www.google.com/maps/search/?api=1&query=api-test-london",
    lat: 51.5074,
    lng: -0.1278,
  };
  const res = await invoke(`/api/cities/${CITY}/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_TOKEN}` },
    body: JSON.stringify(ok),
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.ok(json.place?.id);
  const del = await invoke(`/api/places/${json.place.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
  assert.equal(del.status, 200);
}

await dispose();
console.log("✓ d1-api tests");