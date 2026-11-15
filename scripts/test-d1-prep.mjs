#!/usr/bin/env node
/** Ensure demo London city JSON exists for D1 tests (no personal trip data). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "demo/london/london.json");
const dest = path.join(root, "data/cities/london.json");
if (!fs.existsSync(src)) {
  console.error("missing demo/london/london.json");
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("test-d1-prep: copied demo london -> data/cities/london.json");