#!/usr/bin/env node
/**
 * Static fork mode: build succeeds; Worker without DB does not expose a working API.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

execSync("npm run build", { cwd: root, stdio: "pipe" });
assert.ok(fs.existsSync(path.join(root, "dist/index.html")));

const worker = (await import("../worker/index.ts")).default;
const env = {
  ASSETS: {
    fetch: async () => new Response("static", { status: 200 }),
  },
};

const api = await worker.fetch(new Request("http://localhost/api/cities"), env, {
  waitUntil: () => {},
  passThroughOnException: () => {},
});
assert.equal(api.status, 404);
const body = await api.json();
assert.equal(body.error, "API not configured");

const html = await worker.fetch(new Request("http://localhost/"), env, {
  waitUntil: () => {},
  passThroughOnException: () => {},
});
assert.equal(html.status, 200);
assert.equal(await html.text(), "static");

console.log("✓ static-no-d1 tests");