import fs from "node:fs";
import path from "node:path";

/** Wrangler config for D1 local/remote scripts and tests (not static wrangler.jsonc). */
export function d1WranglerConfigPath(root) {
  if (process.env.WRANGLER_D1_CONFIG) {
    return path.resolve(root, process.env.WRANGLER_D1_CONFIG);
  }
  const local = path.join(root, "wrangler.d1.jsonc");
  if (fs.existsSync(local)) return local;
  return path.join(root, "wrangler.d1.example.jsonc");
}

export function d1DatabaseName(root) {
  const cfgPath = d1WranglerConfigPath(root);
  try {
    const raw = fs.readFileSync(cfgPath, "utf8").replace(/\/\/.*$/gm, "");
    const parsed = JSON.parse(raw);
    const db = parsed.d1_databases?.[0]?.database_name;
    if (db) return db;
  } catch {
    /* ignore */
  }
  return "pinkeepr-places";
}