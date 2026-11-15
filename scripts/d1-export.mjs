#!/usr/bin/env node
/**
 * Export D1 city bundles to data/cities/*.json (or --out dir).
 * Usage: node scripts/d1-export.mjs [--remote] [--out path]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { d1WranglerConfigPath } from "./lib/d1-wrangler-config.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerConfig = d1WranglerConfigPath(root);
const args = process.argv.slice(2);
const remote = args.includes("--remote");
const outFlag = args.indexOf("--out");
const outDir = outFlag >= 0 ? path.resolve(args[outFlag + 1]) : path.join(root, "data/cities");

const { env, dispose } = await getPlatformProxy({
  configPath: wranglerConfig,
  remoteBindings: remote,
});

const { D1PlaceStore } = await import("../shared/d1-place-store.ts");
const store = new D1PlaceStore(env.DB);
const cities = await store.listCities();
fs.mkdirSync(outDir, { recursive: true });

for (const meta of cities) {
  const bundle = await store.getCityBundle(meta.slug);
  if (!bundle) continue;
  delete bundle.version;
  const dest = path.join(outDir, `${meta.slug}.json`);
  fs.writeFileSync(dest, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`exported ${meta.slug} -> ${dest}`);
}

await dispose();
console.log(`done (${cities.length} cities)`);