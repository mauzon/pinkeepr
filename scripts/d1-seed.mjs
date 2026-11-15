#!/usr/bin/env node
/**
 * Load data/cities/*.json into local or remote D1.
 * Usage: node scripts/d1-seed.mjs [--remote] [--city slug]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { getPlatformProxy } from "wrangler";
import { d1DatabaseName, d1WranglerConfigPath } from "./lib/d1-wrangler-config.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerConfig = d1WranglerConfigPath(root);
const dbName = d1DatabaseName(root);
const args = process.argv.slice(2);
const remote = args.includes("--remote");
const cityFlag = args.indexOf("--city");
const onlyCity = cityFlag >= 0 ? args[cityFlag + 1] : null;

const migrateArgs = remote
  ? ["d1", "migrations", "apply", dbName, "--remote", "-c", wranglerConfig]
  : ["d1", "migrations", "apply", dbName, "--local", "-c", wranglerConfig];
execSync(`npx wrangler ${migrateArgs.join(" ")}`, { cwd: root, stdio: "inherit" });

const { env, dispose } = await getPlatformProxy({
  configPath: wranglerConfig,
  remoteBindings: remote,
});

const { D1PlaceStore } = await import("../shared/d1-place-store.ts");
const store = new D1PlaceStore(env.DB);
const citiesDir = path.join(root, "data/cities");
const files = fs
  .readdirSync(citiesDir)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !onlyCity || f.replace(/\.json$/, "") === onlyCity);

if (!files.length) {
  console.error("No city JSON in data/cities — run npm run demo:london or copy a pack first.");
  process.exit(1);
}

const actor = { kind: "agent", id: "d1-seed" };
for (const file of files) {
  const bundle = JSON.parse(fs.readFileSync(path.join(citiesDir, file), "utf8"));
  const version = await store.replaceCityBundle(bundle.slug, bundle, actor);
  console.log(`seeded ${bundle.slug} (v${version}, ${bundle.places.length}+${bundle.events.length} rows)`);
}

await dispose();
console.log(`done (${files.length} cities, ${remote ? "remote" : "local"} D1)`);