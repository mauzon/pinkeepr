#!/usr/bin/env node
/**
 * Lossless JSON -> D1 -> export diff (ignores version, compares normalized JSON).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, ".tmp/d1-roundtrip");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

execSync("npm run d1:seed", { cwd: root, stdio: "inherit" });
execSync(`npm run d1:export -- --out ${tmp}`, { cwd: root, stdio: "inherit" });

const slugs = ["london"];
for (const slug of slugs) {
  const a = normalizeCity(JSON.parse(fs.readFileSync(path.join(root, "data/cities", `${slug}.json`), "utf8")));
  const b = normalizeCity(JSON.parse(fs.readFileSync(path.join(tmp, `${slug}.json`), "utf8")));
  assert.deepEqual(b, a, `roundtrip mismatch: ${slug}`);
  console.log(`✓ roundtrip ${slug}`);
}

console.log("d1 roundtrip OK");

function normalizeCity(city) {
  const clone = structuredClone(city);
  delete clone.version;
  if (Array.isArray(clone.origins)) {
    clone.origins.sort((a, b) => a.id.localeCompare(b.id));
    for (const o of clone.origins) {
      if (o.default === false) delete o.default;
    }
  }
  sortPlaces(clone.places);
  sortPlaces(clone.events);
  for (const p of [...clone.places, ...clone.events]) {
    if (p.daytrip === false) delete p.daytrip;
    if (!p.name_ru && p.name) p.name_ru = p.name;
    if (p.routes) {
      const next = {};
      for (const originId of Object.keys(p.routes).sort()) {
        const leg = p.routes[originId];
        if (!leg || typeof leg !== "object") continue;
        const stable = {};
        delete leg.sort_km;
        if (leg.walk) stable.walk = leg.walk;
        if (leg.taxi) stable.taxi = leg.taxi;
        if (leg.transit) stable.transit = leg.transit;
        next[originId] = stable;
      }
      p.routes = next;
    }
  }
  return clone;
}

function sortPlaces(arr) {
  arr.sort((x, y) => x.id.localeCompare(y.id));
}